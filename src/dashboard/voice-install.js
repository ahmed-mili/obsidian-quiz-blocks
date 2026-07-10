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
