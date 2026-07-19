import { Notice, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../editor";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import { QUIZ_BLOCK_RE } from "../quiz-utils";

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

/** Accès à `openQuizFile`, greffé au runtime sur QuizBuilderView (editor.ts:239)
 * mais non déclaré sur la classe elle-même — même pattern que detail.ts. */
type QuizEditorViewLike = {
	openQuizFile?: (file: TFile, source: string) => Promise<void>;
};

/** Ouvre un quiz dans l'éditeur visuel (vue onglet, réutilisée si déjà ouverte).
    Extrait de detail.ts (openInEditor) pour être partagé avec le menu ⋯ des
    cartes de « Mes quiz » — un seul chemin d'édition, jamais deux copies. */
export async function openQuizInEditor(app: App, quiz: QuizIndexEntry): Promise<void> {
	return openQuizPathInEditor(app, quiz.path);
}

/** Même ouverture, par chemin de note — pour un quiz qui vient d'être créé et
    que le scanner n'a pas encore indexé (bouton « New quiz » du drill-down). */
export async function openQuizPathInEditor(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	try {
		const content = await app.vault.read(file);
		const match = content.match(QUIZ_BLOCK_RE);
		if (!match) {
			new Notice(t("dashboard.detail.noBlockInNote"));
			return;
		}
		const existing = app.workspace.getLeavesOfType(VIEW_TYPE);
		let leaf: WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0];
			app.workspace.revealLeaf(leaf);
		} else {
			leaf = app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
			app.workspace.revealLeaf(leaf);
		}
		const view = leaf.view as QuizEditorViewLike;
		if (view && view.openQuizFile) {
			await view.openQuizFile(file, match[1]);
			new Notice(t("dashboard.detail.opened", { name: file.basename }));
		}
	} catch {
		new Notice(t("dashboard.detail.openError"));
	}
}
