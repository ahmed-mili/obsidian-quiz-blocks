import { Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";

/* ══════════════════════════════════════════════════════════
   QUIZ OPEN — lancement direct d'un quiz (ouverture de sa note)
   Extrait de detail.ts (openForPlay, fermé dans createDetailHandlers)
   pour être partagé avec quiz-card.ts (bouton lecture rond de la
   carte) : un seul chemin de lancement, jamais deux copies qui
   divergeraient. Corps repris À L'IDENTIQUE — même résolution de
   fichier, même garde, même Notice, même leaf.
══════════════════════════════════════════════════════════ */

/** Ouvre la note d'un quiz pour le lancer directement (leaf actif). */
export async function openQuizForPlay(app: App, quiz: QuizIndexEntry): Promise<void> {
	const file = app.vault.getAbstractFileByPath(quiz.path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file);
}
