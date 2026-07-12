import type { Plugin } from "obsidian";
import type { StatsRecord } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   STATS STORE — Stockage persistant des scores et progression
   Utilise plugin.settings.quizStats pour la persistance.
   Mises à jour en mémoire synchrones, sauvegarde debouncée.
══════════════════════════════════════════════════════════ */

/**
 * Enregistrement de stats persisté par quiz (data[path] ci-dessous) —
 * sur-ensemble de `StatsRecord` (types/quiz.ts, la forme d'entrée de
 * updateRecord) avec les 2 champs de suivi propres au store.
 */
export interface QuizStatRecord extends StatsRecord {
	lastPlayed: number;
	attempts: number;
}

/**
 * Plugin hôte tel que réellement passé par plugin.js (`this._statsStore =
 * createStatsStore(this)`, plugin.js:766) : un `obsidian.Plugin` plus les 2
 * membres custom de InteractiveQuizPlugin lus/écrits ici. plugin.js reste en
 * .js (hors périmètre Task 8a) : ce type n'est donc vérifié qu'ici et côté
 * consommateurs .ts du store, pas au call-site réel (non typé, checkJs off).
 */
export interface StatsStorePlugin extends Plugin {
	settings: { quizStats?: Record<string, QuizStatRecord> };
	saveSettings(): Promise<void>;
}

export interface StatsStore {
	load(): void;
	updateRecord(path: string, update: StatsRecord): QuizStatRecord;
	getRecord(path: string): QuizStatRecord | null;
	getAll(): Record<string, QuizStatRecord>;
	deleteRecord(path: string): void;
	formatRelativeTime(timestamp: number): string;
	destroy(): void;
}

export function createStatsStore(plugin: StatsStorePlugin): StatsStore {
	const DEBOUNCE_MS = 500;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let data: Record<string, QuizStatRecord> = {}; // path → { bestScore, questionsDone, totalQuestions, lastPlayed, attempts }

	/* ── Charger les stats depuis les settings ── */
	function load(): void {
		data = plugin.settings.quizStats || {};
	}

	/* ── Debounced save ── */
	function scheduleSave(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			plugin.settings.quizStats = data;
			plugin.saveSettings().catch(() => {});
			saveTimer = null;
		}, DEBOUNCE_MS);
	}

	/* ── Mettre à jour un enregistrement ── */
	function updateRecord(path: string, update: StatsRecord): QuizStatRecord {
		const existing: QuizStatRecord = data[path] || {
			bestScore: 0,
			questionsDone: 0,
			totalQuestions: 0,
			lastPlayed: 0,
			attempts: 0
		};

		data[path] = {
			bestScore: Math.max(existing.bestScore, update.bestScore || 0),
			questionsDone: Math.max(existing.questionsDone, update.questionsDone || 0),
			totalQuestions: update.totalQuestions || existing.totalQuestions,
			lastPlayed: Date.now(),
			attempts: existing.attempts + 1
		};

		scheduleSave();
		return data[path];
	}

	/* ── Récupérer les stats d'un quiz ── */
	function getRecord(path: string): QuizStatRecord | null {
		return data[path] || null;
	}

	/* ── Récupérer toutes les stats ── */
	function getAll(): Record<string, QuizStatRecord> {
		return { ...data };
	}

	/* ── Supprimer les stats d'un quiz ── */
	function deleteRecord(path: string): void {
		if (data[path]) {
			delete data[path];
			scheduleSave();
		}
	}

	/* ── Formater un timestamp en temps relatif ── */
	function formatRelativeTime(timestamp: number): string {
		if (!timestamp) return "—";
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return "À l'instant";
		if (minutes < 60) return `il y a ${minutes} min`;
		if (hours < 24) return `il y a ${hours}h`;
		if (days < 30) return `il y a ${days}j`;
		if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
		return "il y a plus d'un an";
	}

	function destroy(): void {
		if (saveTimer) {
			clearTimeout(saveTimer);
			// Sauvegarde immédiate des données en attente
			plugin.settings.quizStats = data;
			plugin.saveSettings().catch(() => {});
		}
	}

	return {
		load,
		updateRecord,
		getRecord,
		getAll,
		deleteRecord,
		formatRelativeTime,
		destroy
	};
}
