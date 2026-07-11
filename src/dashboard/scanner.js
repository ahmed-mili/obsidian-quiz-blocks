'use strict';

/* ══════════════════════════════════════════════════════════
   QUIZ SCANNER — Indexeur de vault
   Scanne les fichiers markdown pour trouver les blocs quiz-blocks,
   extrait les métadonnées (titre, nombre de questions, types),
   et maintient un cache à jour via les events vault.
══════════════════════════════════════════════════════════ */

const JSON5 = require("json5");

const QUIZ_FENCE_START = "```quiz-blocks";
const QUIZ_FENCE_END = "```";

function createScanner(app) {
	const cache = new Map(); // path → { title, questions, types, mtime }
	const listeners = [];
	const vaultEventRefs = []; // EventRef des app.vault.on(...) pour les retirer au destroy
	let scanning = false;

	/* ── Parse un bloc quiz-blocks pour extraire les métadonnées ── */
	function parseQuizMeta(source) {
		try {
			const parsed = JSON5.parse(source);
			if (!Array.isArray(parsed)) return null;

			// Ignorer l'objet examMode final s'il existe
			const questions = parsed.filter(q =>
				q && typeof q === "object" && !q.examMode
			);

			if (questions.length === 0) return null;

			// Détecter les types de questions
			const typeSet = new Set();
			for (const q of questions) {
				if (q.multiSelect) typeSet.add("multiple");
				else if (q.type === "text") typeSet.add("text");
				else if (q.type === "ordering") typeSet.add("ordering");
				else if (q.type === "matching") typeSet.add("matching");
				else typeSet.add("single");
			}

			// Déterminer le type global du quiz
			let quizType;
			if (typeSet.size > 1) quizType = "Mixte";
			else if (typeSet.has("single")) quizType = "Choix unique";
			else if (typeSet.has("multiple")) quizType = "Choix multiple";
			else if (typeSet.has("text")) quizType = "Texte libre";
			else if (typeSet.has("ordering")) quizType = "Ordonnancement";
			else if (typeSet.has("matching")) quizType = "Association";
			else quizType = "Mixte";

			// Le titre affiché vient du nom de la note (défini au niveau du cache),
			// pas de la 1re question (qui vaut souvent « Question 1 »).
			return {
				questions: questions.length,
				types: Array.from(typeSet),
				quizType
			};
		} catch {
			return null;
		}
	}

	/* ── Extrait le premier bloc quiz-blocks d'un contenu markdown ── */
	function extractQuizSource(content) {
		const startIdx = content.indexOf(QUIZ_FENCE_START);
		if (startIdx === -1) return null;

		const afterStart = startIdx + QUIZ_FENCE_START.length;
		// Le contenu commence après le saut de ligne suivant
		const contentStart = content.indexOf('\n', afterStart);
		if (contentStart === -1) return null;

		// Trouver la fermeture
		const closingFence = content.indexOf('\n' + QUIZ_FENCE_END, contentStart + 1);
		if (closingFence === -1) return null;

		return content.substring(contentStart + 1, closingFence).trim();
	}

	/* ── Scan complet du vault ── */
	async function scanVault() {
		scanning = true;
		cache.clear();

		const markdownFiles = app.vault.getMarkdownFiles();

		for (const file of markdownFiles) {
			try {
				const content = await app.vault.cachedRead(file);
				const quizSource = extractQuizSource(content);
				if (!quizSource) continue;

				const meta = parseQuizMeta(quizSource);
				if (!meta) continue;

				cache.set(file.path, {
					path: file.path,
					basename: file.basename,
					title: file.basename,
					...meta,
					mtime: file.stat?.mtime || 0
				});
			} catch {
				// Ignorer les erreurs de lecture
			}
		}

		scanning = false;
		notifyListeners();
	}

	/* ── Scan incrémental d'un seul fichier ── */
	async function scanFile(file) {
		try {
			const content = await app.vault.cachedRead(file);
			const quizSource = extractQuizSource(content);

			if (!quizSource) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const meta = parseQuizMeta(quizSource);
			if (!meta) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const entry = {
				path: file.path,
				basename: file.basename,
				...meta,
				mtime: file.stat?.mtime || 0
			};
			// L'autosave d'Obsidian déclenche `modify` toutes les ~2 s
			// pendant la frappe : ne notifier (→ re-render sidebar + vue)
			// que si les données AFFICHÉES ont changé — mtime exclu.
			const prev = cache.get(file.path);
			cache.set(file.path, entry);
			const changed = !prev || JSON.stringify({ ...prev, mtime: 0 }) !== JSON.stringify({ ...entry, mtime: 0 });
			if (changed) notifyListeners();
		} catch {
			// Fichier inaccessible, on l'enlève du cache
			const removed = cache.delete(file.path);
			if (removed) notifyListeners();
		}
	}

	/* ── Récupérer les quiz indexés ── */
	function getQuizzes() {
		return Array.from(cache.values());
	}

	/* ── Récupérer un quiz par chemin ── */
	function getQuiz(path) {
		return cache.get(path) || null;
	}

	/* ── Récupérer le nombre total de questions ── */
	function getTotalQuestions() {
		let total = 0;
		for (const quiz of cache.values()) {
			total += quiz.questions;
		}
		return total;
	}

	/* ── Écouteurs de changements ── */
	function onChange(callback) {
		listeners.push(callback);
		return () => {
			const idx = listeners.indexOf(callback);
			if (idx >= 0) listeners.splice(idx, 1);
		};
	}

	function notifyListeners() {
		for (const cb of listeners) {
			try { cb(getQuizzes()); } catch { /* ignore */ }
		}
	}

	/* ── Setup des events vault ── */
	function setupVaultListeners() {
		vaultEventRefs.push(app.vault.on("create", (file) => {
			if (file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));

		vaultEventRefs.push(app.vault.on("modify", (file) => {
			if (file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));

		vaultEventRefs.push(app.vault.on("delete", (file) => {
			if (cache.has(file.path)) {
				cache.delete(file.path);
				notifyListeners();
			}
		}));

		vaultEventRefs.push(app.vault.on("rename", (file, oldPath) => {
			if (cache.has(oldPath)) {
				cache.delete(oldPath);
				scanFile(file);
			} else if (file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));
	}

	/* ── Initialisation ── */
	async function init() {
		setupVaultListeners();
		await scanVault();
	}

	function destroy() {
		for (const ref of vaultEventRefs) {
			try { app.vault.offref(ref); } catch (_) { /* ignore */ }
		}
		vaultEventRefs.length = 0;
		listeners.length = 0;
		cache.clear();
	}

	return {
		init,
		destroy,
		scanVault,
		scanFile,
		getQuizzes,
		getQuiz,
		getTotalQuestions,
		onChange
	};
}

module.exports = createScanner;