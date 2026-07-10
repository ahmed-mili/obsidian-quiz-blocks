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
	// Implémenté en Task 3 du plan (2026-07-10-voice-input).
	return { detach() {} };
}

module.exports = { attach, encodeWav, padDictation, HOLD_MS, MAX_RECORD_MS };
