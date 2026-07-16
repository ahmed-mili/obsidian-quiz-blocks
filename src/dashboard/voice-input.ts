import { Notice } from "obsidian";
import type { ChildProcess } from "child_process";
import { getStatus } from "./voice-install";
import type { DashboardCtx } from "../types/dashboard-ctx";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   VOICE INPUT — Dictée push-to-talk (composer IA)
   Maintenir Espace ≥ 400 ms → enregistrement micro 16 kHz mono ;
   relâcher → transcription whisper.cpp locale (voice-install.js)
   et insertion au curseur. Échap/blur → annule. Spec :
   docs/superpowers/specs/2026-07-10-voice-input-design.md
══════════════════════════════════════════════════════════ */

const HOLD_MS = 400;           // seuil appui long (spec)
const MAX_RECORD_MS = 120000;  // garde-fou durée (spec)
const WHISPER_TIMEOUT_MS = 60000;

/** État retourné par attach(ctx, textarea). */
export interface VoiceInputHandle {
	detach(): void;
}

export interface VoiceInputOptions {
	/** Vrai quand un autre consommateur (picker « @ ») possède le clavier. */
	isBlocked?: () => boolean;
}

/* WAV PCM16 mono : header RIFF 44 octets + échantillons clampés.
   16 kHz mono = l'entrée native de whisper.cpp — aucune conversion. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Buffer {
	let n = 0;
	for (const c of chunks) n += c.length;
	const buf = Buffer.alloc(44 + n * 2);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);        // taille du chunk fmt
	buf.writeUInt16LE(1, 20);         // PCM
	buf.writeUInt16LE(1, 22);         // mono
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (16 bits mono)
	buf.writeUInt16LE(2, 32);         // block align
	buf.writeUInt16LE(16, 34);        // bits/échantillon
	buf.write("data", 36);
	buf.writeUInt32LE(n * 2, 40);
	let o = 44;
	for (const c of chunks) {
		for (let i = 0; i < c.length; i++, o += 2) {
			const s = Math.max(-1, Math.min(1, c[i]));
			buf.writeInt16LE((s * 32767) | 0, o);
		}
	}
	return buf;
}

/* Espaces intelligents : la dictée se colle proprement au voisinage —
   espace avant si le curseur suit un caractère plein, espace après si
   un caractère plein suit (sauf ponctuation fermante). */
export function padDictation(value: string, pos: number, text: string): string {
	const before = value.slice(0, pos);
	const after = value.slice(pos);
	let t = text;
	if (before && !/\s$/.test(before)) t = " " + t;
	if (after && !/^[\s.,;:!?)\]}]/.test(after)) t = t + " ";
	return t;
}

type VoiceInputState = "idle" | "armed" | "recording" | "transcribing";

/* Machine d'états : idle → armed (Espace enfoncé < seuil) → recording
   → transcribing → idle. Tout chemin d'erreur/annulation retombe sur
   idle avec les ressources libérées. */
export function attach(
	ctx: DashboardCtx,
	textarea: HTMLTextAreaElement,
	opts: VoiceInputOptions = {}
): VoiceInputHandle {
	let state: VoiceInputState = "idle";
	let holdTimer = 0, maxTimer = 0, pillTick = 0;
	let armedPos = 0;
	let stream: MediaStream | null = null;
	let audioCtx: AudioContext | null = null;
	let srcNode: MediaStreamAudioSourceNode | null = null;
	let procNode: ScriptProcessorNode | null = null;
	let chunks: Float32Array[] | null = null;
	let startTs = 0;
	let pill: HTMLDivElement | null = null;
	let child: ChildProcess | null = null;

	const settings = () => ctx.plugin.settings;

	// ── Pill d'état (fixed au-dessus du composer, même verre que les tips) ──
	function showPill(busy: boolean): void {
		hidePillOnly();
		pill = document.body.createDiv({ cls: "qbd-voice-pill" + (busy ? " is-busy" : "") });
		pill.createDiv({ cls: "qbd-voice-pill-dot" });
		const label = pill.createSpan({
			text: busy ? t("ai.voice.transcribing") : t("ai.voice.recordHint", { time: "0:00" }),
		});
		const r = textarea.getBoundingClientRect();
		pill.style.visibility = "hidden";
		const pr = pill.getBoundingClientRect();
		pill.style.left = Math.max(8, r.left + r.width / 2 - pr.width / 2) + "px";
		pill.style.top = Math.max(8, r.top - pr.height - 10) + "px";
		pill.style.visibility = "";
		if (!busy) {
			pillTick = window.setInterval(() => {
				if (!textarea.isConnected) { cancelRecording(); return; }
				const s = Math.floor((Date.now() - startTs) / 1000);
				label.setText(t("ai.voice.recordHint", {
					time: Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
				}));
			}, 500);
		}
	}
	function hidePillOnly(): void {
		if (pillTick) { clearInterval(pillTick); pillTick = 0; }
		if (pill) { pill.remove(); pill = null; }
	}

	// ── Capture ──
	async function startRecording(): Promise<void> {
		state = "recording";
		let s: MediaStream;
		try {
			s = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
			});
		} catch (e) {
			state = "idle";
			new Notice(e instanceof DOMException && e.name === "NotAllowedError"
				? t("ai.voice.micDenied")
				: t("ai.voice.noMic"));
			return;
		}
		// Espace relâché (ou Échap) pendant l'attente de permission → abandon.
		if (state !== "recording") { s.getTracks().forEach(t => t.stop()); return; }
		stream = s;
		audioCtx = new AudioContext({ sampleRate: 16000 });
		srcNode = audioCtx.createMediaStreamSource(stream);
		// ScriptProcessor : déprécié mais universel et sans fichier module
		// séparé (AudioWorklet exigerait un asset) — suffisant pour 16 kHz.
		procNode = audioCtx.createScriptProcessor(4096, 1, 1);
		chunks = [];
		procNode.onaudioprocess = (e) => {
			if (!chunks) return;
			chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
		};
		srcNode.connect(procNode);
		procNode.connect(audioCtx.destination);
		startTs = Date.now();
		showPill(false);
		maxTimer = window.setTimeout(() => stopRecording(true), MAX_RECORD_MS);
	}

	function releaseMedia(): void {
		if (maxTimer) { clearTimeout(maxTimer); maxTimer = 0; }
		if (procNode) {
			try { procNode.disconnect(); } catch (e) { /* déjà */ }
			procNode.onaudioprocess = null;
			procNode = null;
		}
		if (srcNode) { try { srcNode.disconnect(); } catch (e) { /* déjà */ } srcNode = null; }
		if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
		if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
	}

	function cancelRecording(): void {
		releaseMedia();
		hidePillOnly();
		chunks = null;
		state = "idle";
	}

	function stopRecording(transcribeIt: boolean): void {
		if (state !== "recording") return;
		const data = chunks;
		releaseMedia();
		chunks = null;
		if (!transcribeIt || !data || !data.length) { hidePillOnly(); state = "idle"; return; }
		runTranscription(data);
	}

	// ── Transcription ──
	function runTranscription(data: Float32Array[]): void {
		const st = getStatus(settings());
		if (!st.ready || !st.cliPath || !st.modelFile) {
			// Installation disparue ENTRE l'armement et le relâchement
			// (modèle supprimé…) : prévenir plutôt qu'avaler la dictée.
			hidePillOnly();
			state = "idle";
			new Notice(t("ai.voice.missingInstall"));
			return;
		}
		state = "transcribing";
		showPill(true);
		const fs = require("fs") as typeof import("fs");
		const os = require("os") as typeof import("os");
		const pathMod = require("path") as typeof import("path");
		const wavPath = pathMod.join(os.tmpdir(), "qbd-voice-" + Date.now() + ".wav");
		try {
			fs.writeFileSync(wavPath, encodeWav(data, 16000));
		} catch (e) {
			hidePillOnly();
			state = "idle";
			new Notice(t("ai.voice.wavFailed"));
			return;
		}
		const cp = require("child_process") as typeof import("child_process");
		child = cp.execFile(st.cliPath,
			["-m", st.modelFile, "-f", wavPath, "-l", settings().voiceLang || "fr", "-nt", "-np"],
			{ windowsHide: true, timeout: WHISPER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
			(err, stdout) => {
				child = null;
				try { fs.rmSync(wavPath, { force: true }); } catch (e) { /* best effort */ }
				hidePillOnly();
				state = "idle";
				if (err) {
					console.error("[quiz-blocks] whisper:", err);
					new Notice(t("ai.voice.transcribeFailed"));
					return;
				}
				const text = String(stdout || "").trim();
				if (!text) { new Notice(t("ai.voice.noText")); return; }
				if (!textarea.isConnected) return;
				insertAtCursor(text);
			});
	}

	function insertAtCursor(text: string): void {
		const pos = textarea.selectionStart ?? 0;
		const t = padDictation(textarea.value, pos, text);
		textarea.setRangeText(t, pos, textarea.selectionEnd ?? pos, "end");
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		textarea.focus();
	}

	// ── Hold Espace ──
	function disarm(): void {
		if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
		if (state === "armed") state = "idle";
	}

	function beginHold(): void {
		holdTimer = 0;
		if (state !== "armed") return;
		const st = getStatus(settings());
		if (!st.supported) { state = "idle"; return; }
		if (!st.ready) {
			state = "idle";
			new Notice(t("ai.voice.missingInstall"));
			return;
		}
		// Retire l'espace inséré à l'armement : le hold n'est pas une frappe.
		if (textarea.value[armedPos] === " " && textarea.selectionStart === armedPos + 1) {
			textarea.setRangeText("", armedPos, armedPos + 1, "start");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		}
		startRecording();
	}

	function onKeyDown(e: KeyboardEvent): void {
		// Picker de mentions ouvert : la frappe lui appartient (un espace
		// dans « @Cours Java » ne doit pas armer la dictée).
		if (opts.isBlocked && opts.isBlocked()) return;
		if (e.key === "Escape" && (state === "recording" || state === "transcribing")) {
			if (state === "recording") cancelRecording();
			return;
		}
		if (e.code !== "Space") { disarm(); return; }
		if (!settings().voiceEnabled) return; // opt-in : aucun effet
		if (e.repeat) {
			// Avale l'auto-repeat pendant le hold/l'enregistrement — mais
			// PAS pendant la transcription (la frappe doit rester libre).
			if (state === "armed" || state === "recording") e.preventDefault();
			return;
		}
		if (state === "recording") { e.preventDefault(); return; }
		if (state === "transcribing") return; // espace normal ; pas de nouveau hold
		state = "armed";
		armedPos = textarea.selectionStart ?? 0; // l'espace de CE keydown s'insérera ici
		holdTimer = window.setTimeout(beginHold, HOLD_MS);
	}

	function onKeyUp(e: KeyboardEvent): void {
		if (e.code !== "Space") return;
		if (state === "armed") { disarm(); return; }    // appui bref = espace normal
		if (state === "recording") stopRecording(true); // relâcher = transcrire
	}

	function onBlur(): void {
		if (state === "armed") disarm();
		else if (state === "recording") cancelRecording();
	}

	textarea.addEventListener("keydown", onKeyDown);
	textarea.addEventListener("keyup", onKeyUp);
	textarea.addEventListener("blur", onBlur);

	return {
		detach() {
			textarea.removeEventListener("keydown", onKeyDown);
			textarea.removeEventListener("keyup", onKeyUp);
			textarea.removeEventListener("blur", onBlur);
			disarm();
			cancelRecording();
			if (child) { try { child.kill(); } catch (e) { /* déjà mort */ } child = null; }
		},
	};
}
