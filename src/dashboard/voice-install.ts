import * as path from "path";
import * as fs from "fs";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   VOICE INSTALL — Dictée locale (whisper.cpp)
   Chemins, détection d'installation, téléchargement streamé et
   dézippage. Aucune UI ici (réglages : plugin.js ; usage :
   voice-input.js). Windows uniquement (v1).
   Assets vérifiés le 2026-07-10 (spec 2026-07-10-voice-input).
══════════════════════════════════════════════════════════ */

/** Backend d'accélération whisper.cpp (dropdown réglages, plugin.js DEFAULT_SETTINGS). */
export type VoiceBackend = "cpu" | "cuda";
/** Langue de transcription (dropdown réglages). */
export type VoiceLang = "fr" | "auto" | "en";
/** Identifiant de modèle whisper.cpp (clés de MODELS ci-dessous). */
export type VoiceModelId = "small-q5_1" | "large-v3-turbo-q5_0";

/**
 * Sous-ensemble "dictée" des réglages du plugin (src/plugin.js DEFAULT_SETTINGS,
 * encore .js — la forme complète sera étoffée par la conversion du lot IA et de
 * plugin.js lui-même). Seuls les champs réellement lus par voice-install.ts /
 * voice-input.ts sont typés ici.
 */
export interface VoiceSettings {
	voiceEnabled?: boolean;
	voiceBackend?: VoiceBackend;
	voiceModel?: VoiceModelId;
	voiceLang?: VoiceLang;
}

/** Retour de getStatus(settings) — état d'installation courant. */
export interface VoiceStatus {
	supported: boolean;
	cliPath: string | null;
	modelFile: string | null;
	ready: boolean;
}

export type VoiceProgressCallback = (done: number, total: number) => void;

interface VoiceModelAsset {
	file: string;
	size: number;
	label: string;
}

interface VoiceBinAsset {
	url: string;
	size: number;
}

// Version ÉPINGLÉE (jamais « latest ») : bump volontaire uniquement,
// en re-vérifiant les noms d'assets de la release.
export const WHISPER_TAG = "v1.9.1";
const GH_BASE = "https://github.com/ggml-org/whisper.cpp/releases/download/" + WHISPER_TAG + "/";
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

export const BIN_ASSETS: Record<VoiceBackend, VoiceBinAsset> = {
	cpu: { url: GH_BASE + "whisper-bin-x64.zip", size: 8.0e6 },
	cuda: { url: GH_BASE + "whisper-cublas-12.4.0-bin-x64.zip", size: 677.9e6 },
};

/* `label` est un GETTER : cette table est évaluée au CHARGEMENT du module, un
   t() posé directement dedans figerait le libellé dans la langue du démarrage.
   Le getter traduit à l'accès (donc au rendu des réglages) sans toucher aux
   appelants — plugin.ts lit `m.label` tel quel. */
export const MODELS: Record<VoiceModelId, VoiceModelAsset> = {
	"small-q5_1": {
		file: "ggml-small-q5_1.bin", size: 190.1e6,
		get label() { return t("ai.voice.modelSmall"); },
	},
	"large-v3-turbo-q5_0": {
		file: "ggml-large-v3-turbo-q5_0.bin", size: 574.0e6,
		get label() { return t("ai.voice.modelLarge"); },
	},
};

export function isSupported(): boolean {
	return process.platform === "win32" && !!process.env.LOCALAPPDATA;
}

// Hors vault : jamais synchronisé, partagé entre tous les vaults.
export function voiceDir(): string {
	// isSupported() (vérifié par tout appelant réel — settings tab, getStatus)
	// garantit LOCALAPPDATA défini avant tout appel ; non-null assertion plutôt
	// que dupliquer la garde ici (comportement runtime inchangé : path.join
	// lèverait de toute façon sur undefined).
	return path.join(process.env.LOCALAPPDATA!, "quiz-blocks", "whisper");
}

export function binDir(backend: VoiceBackend): string {
	return path.join(voiceDir(), "bin-" + backend);
}

export function modelPath(model: VoiceModelId): string | null {
	const m = MODELS[model];
	return m ? path.join(voiceDir(), "models", m.file) : null;
}

/* whisper-cli.exe vit à une profondeur variable selon le zip (CPU :
   Release\ ; CUDA : à plat ou autre) → scan récursif tolérant. */
export function findCli(dir: string): string | null {
	if (!fs.existsSync(dir)) return null;
	const stack: string[] = [dir];
	while (stack.length) {
		const d = stack.pop();
		if (!d) continue; // stack.length garantit un élément ; garde TS strict
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
		for (const en of entries) {
			const p = path.join(d, en.name);
			if (en.isDirectory()) stack.push(p);
			else if (en.name.toLowerCase() === "whisper-cli.exe") return p;
		}
	}
	return null;
}

export function getStatus(settings: VoiceSettings): VoiceStatus {
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
export async function downloadFile(url: string, dest: string, onProgress?: VoiceProgressCallback): Promise<void> {
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
			const chunk = await reader.read();
			if (chunk.done) break;
			if (!out.write(Buffer.from(chunk.value))) {
				await new Promise<void>(ok => out.once("drain", ok));
			}
			done += chunk.value.byteLength;
			if (onProgress) onProgress(done, total);
		}
		await new Promise<void>((ok, ko) => out.end((err?: Error | null) => (err ? ko(err) : ok())));
		fs.renameSync(part, dest);
	} catch (e) {
		out.destroy();
		try { fs.rmSync(part, { force: true }); } catch (e2) { /* best effort */ }
		throw e;
	}
}

/* Expand-Archive : natif Windows, pas de dépendance zip dans le plugin.
   Apostrophes doublées (quoting PowerShell single-quote). */
export function expandZip(zip: string, destDir: string): Promise<void> {
	const q = (s: string) => s.replace(/'/g, "''");
	return new Promise((ok, ko) => {
		const cp = require("child_process") as typeof import("child_process");
		cp.execFile("powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command",
				"Expand-Archive -LiteralPath '" + q(zip) + "' -DestinationPath '" + q(destDir) + "' -Force"],
			{ windowsHide: true, timeout: 180000 },
			(err) => (err ? ko(err) : ok()));
	});
}

export async function installBinary(backend: VoiceBackend, onProgress?: VoiceProgressCallback): Promise<string> {
	const asset = BIN_ASSETS[backend];
	if (!asset) throw new Error(t("ai.voice.errUnknownBackend", { backend }));
	const dir = binDir(backend);
	const zip = path.join(voiceDir(), "bin-" + backend + ".zip");
	await downloadFile(asset.url, zip, onProgress);
	fs.rmSync(dir, { recursive: true, force: true }); // réinstall propre
	await expandZip(zip, dir);
	fs.rmSync(zip, { force: true });
	const cli = findCli(dir);
	if (!cli) throw new Error(t("ai.voice.errCliNotFound"));
	return cli;
}

export async function installModel(model: VoiceModelId, onProgress?: VoiceProgressCallback): Promise<string> {
	const m = MODELS[model];
	if (!m) throw new Error(t("ai.voice.errUnknownModel", { model }));
	const dest = modelPath(model);
	// dest n'est jamais null pour un VoiceModelId valide (voir modelPath) —
	// narrowing pour TS strict, pas un nouveau chemin d'erreur runtime.
	if (!dest) throw new Error(t("ai.voice.errUnknownModel", { model }));
	await downloadFile(HF_BASE + m.file, dest, onProgress);
	return dest;
}
