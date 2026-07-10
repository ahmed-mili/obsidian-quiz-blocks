# Saisie vocale Whisper local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dictée push-to-talk (maintenir Espace) dans le composer IA du dashboard, transcrite localement par whisper.cpp, opt-in avec téléchargement à la demande.

**Architecture:** Deux nouveaux modules factory-style dans `src/dashboard/` — `voice-install.js` (chemins, détection, téléchargement streamé, unzip ; zéro UI) et `voice-input.js` (hold Espace, capture 16 kHz, WAV, spawn whisper-cli, insertion, pill) — branchés par un appel dans `ai.js` et une section réglages dans `plugin.js`. Stockage binaire+modèles dans `%LOCALAPPDATA%\quiz-blocks\whisper\` (hors vault, partagé entre vaults).

**Tech Stack:** JS CommonJS (pattern du repo), APIs web (getUserMedia, AudioContext, fetch), Node `fs`/`path`/`child_process` (dispo dans Obsidian desktop), whisper.cpp v1.9.1 (binaires officiels), PowerShell `Expand-Archive`.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-10-voice-input-design.md` (source de vérité).
- Windows uniquement en v1 : garde `process.platform === "win32"`.
- Release GitHub inchangé : rien de nouveau dans `main.js`/`styles.css` hors code ; aucun binaire/modèle versionné.
- Opt-in réel : `voiceEnabled` `false` par défaut → aucun effet observable (la garde se lit à chaque keydown pour permettre le toggle à chaud — micro-déviation assumée vs la spec qui disait « listener non attaché », comportement observable identique).
- Version whisper.cpp épinglée `v1.9.1` — jamais `latest`.
- Pas de test framework dans ce repo : parties pures testées par scripts Node jetables dans le scratchpad de session ; UI vérifiée dans Obsidian réel (checklist d'états de la spec).
- Style : commentaires français, tabs, `'use strict';`, modules CommonJS `module.exports`.
- Après chaque task : `npm run build` doit passer (il déploie dans les vaults).

---

### Task 1: voice-install.js — chemins, détection, téléchargement, unzip

**Files:**
- Create: `src/dashboard/voice-install.js`

**Interfaces:**
- Produces (consommé par Tasks 3/4/5) :
  - `isSupported() → boolean`
  - `getStatus(settings) → { supported, cliPath: string|null, modelFile: string|null, ready: boolean }`
  - `installBinary(backend: "cpu"|"cuda", onProgress?: (done, total) => void) → Promise<string /* cliPath */>`
  - `installModel(model: "small-q5_1"|"large-v3-turbo-q5_0", onProgress?) → Promise<string /* modelPath */>`
  - `MODELS` : `{ [id]: { file, size, label } }`, `BIN_ASSETS` : `{ [backend]: { url, size } }`

- [ ] **Step 1 : écrire le module complet**

```js
'use strict';

/* ══════════════════════════════════════════════════════════
   VOICE INSTALL — Dictée locale (whisper.cpp)
   Chemins, détection d'installation, téléchargement streamé et
   dézippage. Aucune UI ici (réglages : plugin.js ; usage :
   voice-input.js). Windows uniquement (v1).
   Assets vérifiés le 2026-07-10 (spec 2026-07-10-voice-input).
══════════════════════════════════════════════════════════ */

const path = require("path");
const fs = require("fs");

// Version ÉPINGLÉE (jamais « latest ») : bump volontaire uniquement,
// en re-vérifiant les noms d'assets de la release.
const WHISPER_TAG = "v1.9.1";
const GH_BASE = "https://github.com/ggml-org/whisper.cpp/releases/download/" + WHISPER_TAG + "/";
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

const BIN_ASSETS = {
	cpu: { url: GH_BASE + "whisper-bin-x64.zip", size: 8.0e6 },
	cuda: { url: GH_BASE + "whisper-cublas-12.4.0-bin-x64.zip", size: 677.9e6 },
};

const MODELS = {
	"small-q5_1": {
		file: "ggml-small-q5_1.bin", size: 190.1e6,
		label: "Rapide — small (190 Mo)",
	},
	"large-v3-turbo-q5_0": {
		file: "ggml-large-v3-turbo-q5_0.bin", size: 574.0e6,
		label: "Max — large-v3-turbo (574 Mo)",
	},
};

function isSupported() {
	return process.platform === "win32" && !!process.env.LOCALAPPDATA;
}

// Hors vault : jamais synchronisé, partagé entre tous les vaults.
function voiceDir() {
	return path.join(process.env.LOCALAPPDATA, "quiz-blocks", "whisper");
}

function binDir(backend) {
	return path.join(voiceDir(), "bin-" + backend);
}

function modelPath(model) {
	const m = MODELS[model];
	return m ? path.join(voiceDir(), "models", m.file) : null;
}

/* whisper-cli.exe vit à une profondeur variable selon le zip (CPU :
   Release\ ; CUDA : à plat ou autre) → scan récursif tolérant. */
function findCli(dir) {
	if (!fs.existsSync(dir)) return null;
	const stack = [dir];
	while (stack.length) {
		const d = stack.pop();
		let entries;
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
		for (const en of entries) {
			const p = path.join(d, en.name);
			if (en.isDirectory()) stack.push(p);
			else if (en.name.toLowerCase() === "whisper-cli.exe") return p;
		}
	}
	return null;
}

function getStatus(settings) {
	if (!isSupported()) return { supported: false, cliPath: null, modelFile: null, ready: false };
	const cliPath = findCli(binDir(settings.voiceBackend || "cpu"));
	const mp = modelPath(settings.voiceModel || "small-q5_1");
	const modelFile = mp && fs.existsSync(mp) ? mp : null;
	return { supported: true, cliPath, modelFile, ready: !!(cliPath && modelFile) };
}

/* Téléchargement STREAMÉ (jamais le fichier en mémoire — le binaire CUDA
   fait ~678 Mo) : fetch (suit les redirects GitHub/HuggingFace) →
   chunks → WriteStream sur <dest>.part → rename à la fin (jamais
   d'install à moitié). */
async function downloadFile(url, dest, onProgress) {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const part = dest + ".part";
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error("HTTP " + res.status + " — " + url);
	const total = Number(res.headers.get("content-length")) || 0;
	const out = fs.createWriteStream(part);
	const reader = res.body.getReader();
	let done = 0;
	try {
		for (;;) {
			const { value, done: end } = await reader.read();
			if (end) break;
			if (!out.write(Buffer.from(value))) {
				await new Promise(ok => out.once("drain", ok));
			}
			done += value.byteLength;
			if (onProgress) onProgress(done, total);
		}
		await new Promise((ok, ko) => out.end(err => (err ? ko(err) : ok())));
		fs.renameSync(part, dest);
	} catch (e) {
		out.destroy();
		try { fs.rmSync(part, { force: true }); } catch (e2) { /* best effort */ }
		throw e;
	}
}

/* Expand-Archive : natif Windows, pas de dépendance zip dans le plugin.
   Apostrophes doublées (quoting PowerShell single-quote). */
function expandZip(zip, destDir) {
	const q = (s) => s.replace(/'/g, "''");
	return new Promise((ok, ko) => {
		const cp = require("child_process");
		cp.execFile("powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command",
				"Expand-Archive -LiteralPath '" + q(zip) + "' -DestinationPath '" + q(destDir) + "' -Force"],
			{ windowsHide: true, timeout: 180000 },
			(err) => (err ? ko(err) : ok()));
	});
}

async function installBinary(backend, onProgress) {
	const asset = BIN_ASSETS[backend];
	if (!asset) throw new Error("Backend inconnu : " + backend);
	const dir = binDir(backend);
	const zip = path.join(voiceDir(), "bin-" + backend + ".zip");
	await downloadFile(asset.url, zip, onProgress);
	fs.rmSync(dir, { recursive: true, force: true }); // réinstall propre
	await expandZip(zip, dir);
	fs.rmSync(zip, { force: true });
	const cli = findCli(dir);
	if (!cli) throw new Error("whisper-cli.exe introuvable après extraction");
	return cli;
}

async function installModel(model, onProgress) {
	const m = MODELS[model];
	if (!m) throw new Error("Modèle inconnu : " + model);
	const dest = modelPath(model);
	await downloadFile(HF_BASE + m.file, dest, onProgress);
	return dest;
}

module.exports = {
	isSupported, voiceDir, binDir, modelPath, findCli, getStatus,
	downloadFile, expandZip, installBinary, installModel,
	MODELS, BIN_ASSETS, WHISPER_TAG,
};
```

- [ ] **Step 2 : test Node réel (chemins + détection + install binaire CPU 8 Mo)**

Écrire `<scratchpad>/test-voice-install.js` :

```js
const vi = require("C:/dev/obsidian-quiz-blocks/src/dashboard/voice-install.js");
const assert = require("assert");
const fs = require("fs");

assert.strictEqual(vi.isSupported(), true);
assert.ok(vi.voiceDir().endsWith("\\quiz-blocks\\whisper"));
assert.ok(vi.modelPath("small-q5_1").endsWith("ggml-small-q5_1.bin"));
assert.strictEqual(vi.modelPath("inconnu"), null);
assert.strictEqual(vi.findCli("C:\\dossier-inexistant-qbd"), null);

(async () => {
	// Install binaire CPU réel (8 Mo) — exactement ce que fera le bouton.
	const cli = await vi.installBinary("cpu", (d, t) => process.stdout.write("\r" + d + "/" + t));
	console.log("\ncli:", cli);
	assert.ok(fs.existsSync(cli));
	const st = vi.getStatus({ voiceBackend: "cpu", voiceModel: "small-q5_1" });
	assert.strictEqual(!!st.cliPath, true);
	assert.strictEqual(st.ready, false); // modèle pas encore téléchargé
	console.log("OK");
})();
```

Run : `node <scratchpad>/test-voice-install.js`
Expected : progression puis chemin `...\bin-cpu\Release\whisper-cli.exe`, `OK`.

- [ ] **Step 3 : `npm run build` passe (le module n'est pas encore requis — sanity)**

- [ ] **Step 4 : commit**

```bash
git add src/dashboard/voice-install.js
git commit -m "feat(voice): module d'installation whisper.cpp (chemins, download streamé, unzip)"
```

---

### Task 2: voice-input.js — utilitaires purs (WAV + espaces intelligents)

**Files:**
- Create: `src/dashboard/voice-input.js` (partiel : utilitaires + squelette exports)

**Interfaces:**
- Produces : `encodeWav(chunks: Float32Array[], sampleRate: number) → Buffer` ; `padDictation(value: string, pos: number, text: string) → string` (le texte à insérer, espaces ajustés) ; `attach(ctx, textarea)` (implémenté Task 3).

- [ ] **Step 1 : créer le module avec les deux fonctions pures**

```js
'use strict';

/* ══════════════════════════════════════════════════════════
   VOICE INPUT — Dictée push-to-talk (composer IA)
   Maintenir Espace ≥ 400 ms → enregistrement micro 16 kHz mono ;
   relâcher → transcription whisper.cpp locale (voice-install.js)
   et insertion au curseur. Échap/blur → annule. Spec :
   docs/superpowers/specs/2026-07-10-voice-input-design.md
══════════════════════════════════════════════════════════ */

const voiceInstall = require("./voice-install");

const HOLD_MS = 400;           // seuil appui long (spec)
const MAX_RECORD_MS = 120000;  // garde-fou durée (spec)
const WHISPER_TIMEOUT_MS = 60000;

/* WAV PCM16 mono : header RIFF 44 octets + échantillons clampés.
   16 kHz mono = l'entrée native de whisper.cpp — aucune conversion. */
function encodeWav(chunks, sampleRate) {
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
function padDictation(value, pos, text) {
	const before = value.slice(0, pos);
	const after = value.slice(pos);
	let t = text;
	if (before && !/\s$/.test(before)) t = " " + t;
	if (after && !/^[\s.,;:!?)\]}]/.test(after)) t = t + " ";
	return t;
}

function attach(ctx, textarea) {
	// Implémenté en Task 3.
	return { detach() {} };
}

module.exports = { attach, encodeWav, padDictation, HOLD_MS, MAX_RECORD_MS };
```

- [ ] **Step 2 : test Node des deux fonctions (+ transcription réelle du WAV généré)**

Écrire `<scratchpad>/test-voice-utils.js` :

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const v = require("C:/dev/obsidian-quiz-blocks/src/dashboard/voice-input.js");
const vi = require("C:/dev/obsidian-quiz-blocks/src/dashboard/voice-install.js");

// — encodeWav : 1 s de sinus 440 Hz à 16 kHz —
const sr = 16000;
const c = new Float32Array(sr);
for (let i = 0; i < sr; i++) c[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.4;
const wav = v.encodeWav([c], sr);
assert.strictEqual(wav.length, 44 + sr * 2);
assert.strictEqual(wav.toString("ascii", 0, 4), "RIFF");
assert.strictEqual(wav.readUInt32LE(24), 16000);
assert.strictEqual(wav.readUInt16LE(22), 1);

// — padDictation : les 5 voisinages —
assert.strictEqual(v.padDictation("", 0, "bonjour"), "bonjour");
assert.strictEqual(v.padDictation("abc", 3, "x"), " x");
assert.strictEqual(v.padDictation("abc ", 4, "x"), "x");
assert.strictEqual(v.padDictation("a c", 1, "b"), " b ");
assert.strictEqual(v.padDictation("mot.", 3, "x"), " x"); // ponctuation après : pas d'espace suffixe

// — le WAV généré est accepté par whisper-cli (binaire de la Task 1) —
const wavPath = path.join(os.tmpdir(), "qbd-test-voice.wav");
fs.writeFileSync(wavPath, wav);
const st = vi.getStatus({ voiceBackend: "cpu", voiceModel: "small-q5_1" });
assert.ok(st.cliPath, "binaire CPU requis (Task 1 step 2)");
console.log("wav + pad OK ; cli:", st.cliPath);
```

Run : `node <scratchpad>/test-voice-utils.js` — Expected : `wav + pad OK ; cli: ...whisper-cli.exe`.

- [ ] **Step 3 : `npm run build` passe, commit**

```bash
git add src/dashboard/voice-input.js
git commit -m "feat(voice): encodage WAV 16k mono + insertion à espaces intelligents"
```

---

### Task 3: voice-input.js — attach() complet (hold Espace, capture, pill, transcription, insertion)

**Files:**
- Modify: `src/dashboard/voice-input.js` (remplacer le stub `attach`)

**Interfaces:**
- Consumes : `voiceInstall.getStatus(settings)` (Task 1), `encodeWav`/`padDictation` (Task 2).
- Produces : `attach(ctx, textarea) → { detach() }` — `ctx.plugin.settings.{voiceEnabled, voiceBackend, voiceModel, voiceLang}` lus dynamiquement.

- [ ] **Step 1 : remplacer le stub par l'implémentation complète**

Ajouter `const obsidian = require("obsidian");` en tête (après `'use strict';`), puis :

```js
/* Machine d'états : idle → armed (Espace enfoncé < seuil) → recording
   → transcribing → idle. Tout chemin d'erreur/annulation retombe sur
   idle avec les ressources libérées. */
function attach(ctx, textarea) {
	let state = "idle";
	let holdTimer = 0, maxTimer = 0, pillTick = 0;
	let armedPos = 0;
	let stream = null, audioCtx = null, srcNode = null, procNode = null;
	let chunks = null, startTs = 0;
	let pill = null, child = null;

	const settings = () => ctx.plugin.settings;

	// ── Pill d'état (fixed au-dessus du composer, même verre que les tips) ──
	function showPill(busy) {
		hidePillOnly();
		pill = document.body.createDiv({ cls: "qbd-voice-pill" + (busy ? " is-busy" : "") });
		pill.createDiv({ cls: "qbd-voice-pill-dot" });
		const label = pill.createSpan({
			text: busy ? "Transcription…" : "0:00 — relâche Espace pour transcrire",
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
				label.setText(Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") +
					" — relâche Espace pour transcrire");
			}, 500);
		}
	}
	function hidePillOnly() {
		if (pillTick) { clearInterval(pillTick); pillTick = 0; }
		if (pill) { pill.remove(); pill = null; }
	}

	// ── Capture ──
	async function startRecording() {
		state = "recording";
		let s;
		try {
			s = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
			});
		} catch (e) {
			state = "idle";
			new obsidian.Notice(e && e.name === "NotAllowedError"
				? "Dictée : permission micro refusée."
				: "Dictée : aucun micro accessible.");
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
			chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
		};
		srcNode.connect(procNode);
		procNode.connect(audioCtx.destination);
		startTs = Date.now();
		showPill(false);
		maxTimer = window.setTimeout(() => stopRecording(true), MAX_RECORD_MS);
	}

	function releaseMedia() {
		if (maxTimer) { clearTimeout(maxTimer); maxTimer = 0; }
		if (procNode) { try { procNode.disconnect(); } catch (e) { /* déjà */ } procNode.onaudioprocess = null; procNode = null; }
		if (srcNode) { try { srcNode.disconnect(); } catch (e) { /* déjà */ } srcNode = null; }
		if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
		if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
	}

	function cancelRecording() {
		releaseMedia();
		hidePillOnly();
		chunks = null;
		state = "idle";
	}

	function stopRecording(transcribeIt) {
		if (state !== "recording") return;
		const data = chunks;
		releaseMedia();
		chunks = null;
		if (!transcribeIt || !data || !data.length) { hidePillOnly(); state = "idle"; return; }
		runTranscription(data);
	}

	// ── Transcription ──
	function runTranscription(data) {
		const st = voiceInstall.getStatus(settings());
		if (!st.ready) { hidePillOnly(); state = "idle"; return; }
		state = "transcribing";
		showPill(true);
		const fs = require("fs");
		const os = require("os");
		const pathMod = require("path");
		const wavPath = pathMod.join(os.tmpdir(), "qbd-voice-" + Date.now() + ".wav");
		try {
			fs.writeFileSync(wavPath, encodeWav(data, 16000));
		} catch (e) {
			hidePillOnly(); state = "idle";
			new obsidian.Notice("Dictée : écriture du fichier audio impossible.");
			return;
		}
		const cp = require("child_process");
		child = cp.execFile(st.cliPath,
			["-m", st.modelFile, "-f", wavPath, "-l", settings().voiceLang || "fr", "-nt", "-np"],
			{ windowsHide: true, timeout: WHISPER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
			(err, stdout) => {
				child = null;
				try { fs.rmSync(wavPath, { force: true }); } catch (e) { /* best effort */ }
				hidePillOnly();
				state = "idle";
				if (err) {
					ctx.log.error("whisper:", err);
					new obsidian.Notice("Dictée : transcription échouée (voir console).");
					return;
				}
				const text = String(stdout || "").trim();
				if (!text) { new obsidian.Notice("Dictée : aucun texte reconnu."); return; }
				if (!textarea.isConnected) return;
				insertAtCursor(text);
			});
	}

	function insertAtCursor(text) {
		const pos = textarea.selectionStart;
		const t = padDictation(textarea.value, pos, text);
		textarea.setRangeText(t, pos, textarea.selectionEnd, "end");
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		textarea.focus();
	}

	// ── Hold Espace ──
	function disarm() {
		if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
		if (state === "armed") state = "idle";
	}

	function beginHold() {
		holdTimer = 0;
		if (state !== "armed") return;
		const st = voiceInstall.getStatus(settings());
		if (!st.supported) { state = "idle"; return; }
		if (!st.ready) {
			state = "idle";
			new obsidian.Notice("Dictée : binaire ou modèle manquant — réglages de Quiz Blocks.");
			return;
		}
		// Retire l'espace inséré à l'armement : le hold n'est pas une frappe.
		if (textarea.value[armedPos] === " " && textarea.selectionStart === armedPos + 1) {
			textarea.setRangeText("", armedPos, armedPos + 1, "start");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		}
		startRecording();
	}

	function onKeyDown(e) {
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
		armedPos = textarea.selectionStart; // l'espace de CE keydown s'insérera ici
		holdTimer = window.setTimeout(beginHold, HOLD_MS);
	}

	function onKeyUp(e) {
		if (e.code !== "Space") return;
		if (state === "armed") { disarm(); return; }        // appui bref = espace normal
		if (state === "recording") stopRecording(true);      // relâcher = transcrire
	}

	function onBlur() {
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
```

Note : `ctx.log` est le logger du plugin (`createLogger()` de plugin.js) — vérifier à l'implémentation que `ctx.log` est bien le nom exposé (grep `log` dans un module dashboard existant) ; sinon utiliser `console.error("[quiz-blocks]", ...)`.

- [ ] **Step 2 : `npm run build` passe (aucun consommateur encore), commit**

```bash
git add src/dashboard/voice-input.js
git commit -m "feat(voice): push-to-talk Espace — capture 16k, pill, transcription, insertion"
```

---

### Task 4: CSS de la pill

**Files:**
- Create: `src/assets/css/components/voice-input.css`
- Modify: `src/assets/css/index.css` (ajouter l'@import à la fin du bloc components, après la ligne `effort-slider.css`)

- [ ] **Step 1 : créer le CSS**

```css
/* ═════════════════════════════════════════════════════════
   VOICE INPUT — pill d'état de la dictée (voice-input.js)
   Fixed au-dessus du composer, même verre que .qbd-hover-tip.
   ═════════════════════════════════════════════════════════ */

.qbd-voice-pill {
	position: fixed;
	z-index: 1200;
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 6px 11px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--background-primary) 96%, transparent);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	border: 1px solid var(--background-modifier-border);
	box-shadow: 0 8px 20px -6px rgba(0, 0, 0, 0.45);
	font-size: 12px;
	font-weight: 500;
	color: var(--text-normal);
	pointer-events: none;
	animation: qbd-select-in 0.12s ease-out;
}

.qbd-voice-pill-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #e5484d;
	animation: qbd-voice-pulse 1.2s ease-in-out infinite;
}

/* Transcription : point neutre fixe (l'attente, pas l'écoute). */
.qbd-voice-pill.is-busy .qbd-voice-pill-dot {
	background: var(--text-muted);
	animation: none;
}

@keyframes qbd-voice-pulse {
	0%, 100% { opacity: 1; transform: scale(1); }
	50% { opacity: 0.45; transform: scale(0.8); }
}

@media (prefers-reduced-motion: reduce) {
	.qbd-voice-pill-dot { animation: none; }
	.qbd-voice-pill { animation: none; }
}
```

- [ ] **Step 2 : @import dans index.css** — ligne `@import url('./components/voice-input.css');` à la suite des autres components.

- [ ] **Step 3 : `npm run build` (vérifier « styles.css bundlé »), commit**

```bash
git add src/assets/css/components/voice-input.css src/assets/css/index.css
git commit -m "style(voice): pill d'état de la dictée"
```

---

### Task 5: réglages (plugin.js) — settings + section « Saisie vocale »

**Files:**
- Modify: `src/plugin.js` — `DEFAULT_SETTINGS` (ligne ~14) + `QuizBlocksSettingTab.display()` (fin de la méthode)

**Interfaces:**
- Consumes : `voiceInstall.isSupported/getStatus/installBinary/installModel/MODELS` (Task 1).
- Produces : `settings.voiceEnabled|voiceBackend|voiceModel|voiceLang` (lus par voice-input.js).

- [ ] **Step 1 : DEFAULT_SETTINGS**

Ajouter à la fin de l'objet `DEFAULT_SETTINGS` :

```js
	// ── Saisie vocale (dictée locale whisper.cpp) — opt-in complet.
	// Spec : docs/superpowers/specs/2026-07-10-voice-input-design.md
	voiceEnabled: false,
	voiceBackend: "cpu",      // "cpu" | "cuda"
	voiceModel: "small-q5_1", // cf. voice-install.js MODELS
	voiceLang: "fr",          // "fr" | "auto" | "en"
```

- [ ] **Step 2 : require en tête de plugin.js** (à côté des autres requires) :

```js
const voiceInstall = require("./dashboard/voice-install");
```

- [ ] **Step 3 : section réglages à la fin de `display()`**

```js
		// ── Saisie vocale (dictée) ──
		containerEl.createEl("h3", { text: "Saisie vocale (dictée)" });
		if (!voiceInstall.isSupported()) {
			containerEl.createEl("p", {
				text: "Disponible sur Windows uniquement pour l'instant.",
				cls: "setting-item-description",
			});
		} else {
			new obsidian.Setting(containerEl)
				.setName("Activer la dictée")
				.setDesc("Maintenir Espace dans le composer IA pour dicter (transcription 100 % locale, whisper.cpp).")
				.addToggle(t => t
					.setValue(this.plugin.settings.voiceEnabled)
					.onChange(async (v) => {
						this.plugin.settings.voiceEnabled = v;
						await this.plugin.saveSettings();
						this.display();
					}));

			if (this.plugin.settings.voiceEnabled) {
				new obsidian.Setting(containerEl)
					.setName("Accélération")
					.setDesc("CPU : léger (8 Mo), universel. GPU NVIDIA : téléchargement ~680 Mo, transcription quasi instantanée. (Pas de build AMD/Intel en v1.)")
					.addDropdown(d => d
						.addOption("cpu", "CPU")
						.addOption("cuda", "GPU NVIDIA (CUDA)")
						.setValue(this.plugin.settings.voiceBackend)
						.onChange(async (v) => {
							this.plugin.settings.voiceBackend = v;
							await this.plugin.saveSettings();
							this.display();
						}));

				new obsidian.Setting(containerEl)
					.setName("Modèle")
					.setDesc("Rapide suffit pour une dictée propre ; Max gagne sur le bruit/les accents.")
					.addDropdown(d => {
						for (const [id, m] of Object.entries(voiceInstall.MODELS)) d.addOption(id, m.label);
						d.setValue(this.plugin.settings.voiceModel)
							.onChange(async (v) => {
								this.plugin.settings.voiceModel = v;
								await this.plugin.saveSettings();
								this.display();
							});
					});

				new obsidian.Setting(containerEl)
					.setName("Langue")
					.addDropdown(d => d
						.addOption("fr", "Français")
						.addOption("auto", "Détection automatique")
						.addOption("en", "Anglais")
						.setValue(this.plugin.settings.voiceLang)
						.onChange(async (v) => {
							this.plugin.settings.voiceLang = v;
							await this.plugin.saveSettings();
						}));

				// État d'installation + téléchargements (rien sans clic explicite).
				const st = voiceInstall.getStatus(this.plugin.settings);
				const fmtPct = (d, t) => (t ? Math.round((d / t) * 100) + " %" : Math.round(d / 1e6) + " Mo");

				const binRow = new obsidian.Setting(containerEl)
					.setName("Binaire whisper.cpp (" + this.plugin.settings.voiceBackend + ")")
					.setDesc(st.cliPath ? "Installé — " + st.cliPath : "Non installé.");
				if (!st.cliPath) binRow.addButton(b => b
					.setButtonText("Télécharger")
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installBinary(this.plugin.settings.voiceBackend,
								(d, t) => b.setButtonText(fmtPct(d, t)));
							new obsidian.Notice("Binaire whisper.cpp installé.");
						} catch (e) {
							console.error("[quiz-blocks] install binaire:", e);
							new obsidian.Notice("Téléchargement échoué : " + e.message);
						}
						this.display();
					}));

				const mdlRow = new obsidian.Setting(containerEl)
					.setName("Modèle " + (voiceInstall.MODELS[this.plugin.settings.voiceModel] || {}).label)
					.setDesc(st.modelFile ? "Installé — " + st.modelFile : "Non installé.");
				if (!st.modelFile) mdlRow.addButton(b => b
					.setButtonText("Télécharger")
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installModel(this.plugin.settings.voiceModel,
								(d, t) => b.setButtonText(fmtPct(d, t)));
							new obsidian.Notice("Modèle installé.");
						} catch (e) {
							console.error("[quiz-blocks] install modèle:", e);
							new obsidian.Notice("Téléchargement échoué : " + e.message);
						}
						this.display();
					}));
			}
		}
```

Note : vérifier en tête de `display()` comment `obsidian` est référencé dans plugin.js (`const obsidian = require("obsidian")` global au fichier — adapter si le fichier utilise des imports destructurés).

- [ ] **Step 4 : `npm run build`, test manuel réglages**

Ouvrir Obsidian → réglages Quiz Blocks : section visible, toggle → sous-réglages apparaissent, bouton binaire télécharge réellement (8 Mo, progression), `display()` rafraîchi → « Installé ».

- [ ] **Step 5 : commit**

```bash
git add src/plugin.js
git commit -m "feat(voice): réglages dictée (opt-in, backend, modèle, langue, téléchargements)"
```

---

### Task 6: branchement composer (ai.js) + vérification d'états complète

**Files:**
- Modify: `src/dashboard/ai.js` — require en tête (~ligne 11) + après la création de `composerInput` (~ligne 352)

- [ ] **Step 1 : require + attach**

En tête (après le require de ui-select) :

```js
const voiceInput = require("./voice-input");
```

Après `const composerInput = composer.createEl("textarea", { cls: "qbd-ai-composer-input" });` :

```js
		// Dictée vocale push-to-talk (opt-in — réglages « Saisie vocale »).
		voiceInput.attach(ctx, composerInput);
```

(Les listeners meurent avec l'élément au re-render ; les chemins async internes se protègent par `textarea.isConnected` — pas de detach explicite nécessaire ici, YAGNI.)

- [ ] **Step 2 : `npm run build`, redémarrer Obsidian**

- [ ] **Step 3 : vérification d'états (checklist de la spec — TOUTES les lignes)**

Dans Obsidian, page IA du dashboard, avec le modèle « Rapide » téléchargé :

1. `voiceEnabled` false → maintenir Espace : rien (espaces normaux).
2. Activer + appui bref → un espace normal, aucune pill.
3. Appui long composer vide → pill rouge + chrono ; parler ; relâcher → « Transcription… » → texte inséré, sans espace parasite en tête.
4. Appui long au milieu d'un mot existant → texte inséré avec espaces intelligents autour.
5. Échap pendant l'enregistrement → pill disparaît, rien d'inséré.
6. Dictée silencieuse → notice « aucun texte reconnu ».
7. Supprimer le modèle du disque → appui long → notice « binaire ou modèle manquant ».
8. Permission micro refusée (réglages Windows → confidentialité micro off) → notice claire, état revenu à idle (re-testable).
9. Auto-repeat : maintenir Espace 10 s → aucun espace ne s'accumule dans le textarea.
10. Fermer/rouvrir la vue pendant un enregistrement → pas d'erreur console, micro relâché (icône micro Windows éteinte).
11. Modèle Max + backend cuda (machine d'Ahmed) : télécharger, dicter → latence quasi nulle.
12. `prefers-reduced-motion` (réglage OS) → pas de pulsation du point.

- [ ] **Step 4 : commit final**

```bash
git add src/dashboard/ai.js
git commit -m "feat(voice): dictée branchée sur le composer IA"
```
