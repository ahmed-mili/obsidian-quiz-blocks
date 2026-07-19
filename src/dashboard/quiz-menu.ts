import { Notice, TFile } from "obsidian";
import { QbdModal } from "../modal-base";
import type { App } from "obsidian";
import { ShareModal, moduleShareSource, quizShareSource } from "./share";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import { ModuleEditModal } from "./module-edit";
import type { ActionMenuItem } from "./ui-select";
import { openQuizInEditor } from "./quiz-open";
import { QUIZ_BLOCK_RE } from "../quiz-utils";

/* ══════════════════════════════════════════════════════════
   QUIZ MENU — contenu du menu ⋯ des cartes de « Mes quiz ».
   Contrat = la capture StudySmarter d'Ahmed (Excalidraw, 2026-07-18) :
   Share / Edit / Pause study reminders / Archive / Delete (rouge),
   adaptés au plugin :
   - Share    → copie le bloc ```quiz-blocks``` dans le presse-papier ;
   - Pause    → sort le quiz du « To do » de l'accueil (toggle) ;
   - Archive  → masque le quiz partout, revient via la pilule « Archivés » ;
   - Delete   → supprime le bloc de la note (corbeille si la note ne
                contenait que lui) + ses stats, après confirmation.
══════════════════════════════════════════════════════════ */

/* ── Listes persistées — même canal que quizzesExpandedFolders (quizzes.ts) :
   l'échec d'écriture ne casse pas l'UI. La pause est PAR QUIZ (chemin de
   note) ; l'archivage est PAR DOSSIER (clé `folder` de module) — jamais de
   quiz archivé individuellement (décision Ahmed 2026-07-19). */

function togglePaused(ctx: DashboardCtx, path: string, on: boolean): void {
	const set = new Set(ctx.plugin.settings.quizzesPaused || []);
	if (on) set.add(path); else set.delete(path);
	ctx.plugin.settings.quizzesPaused = [...set];
	ctx.plugin.saveSettings().catch(() => {});
}

export function isPaused(ctx: DashboardCtx, path: string): boolean {
	return new Set(ctx.plugin.settings.quizzesPaused || []).has(path);
}

export function isFolderArchived(ctx: DashboardCtx, folder: string): boolean {
	return new Set(ctx.plugin.settings.quizzesArchivedFolders || []).has(folder);
}

export function setFolderArchived(ctx: DashboardCtx, folder: string, on: boolean): void {
	const set = new Set(ctx.plugin.settings.quizzesArchivedFolders || []);
	if (on) set.add(folder); else set.delete(folder);
	ctx.plugin.settings.quizzesArchivedFolders = [...set];
	ctx.plugin.saveSettings().catch(() => {});
}

/* ── Confirmations : la PAUSE confirme (contrat StudySmarter 2026-07-18),
   l'ARCHIVAGE est direct dans les deux sens (demande Ahmed 2026-07-19),
   Delete confirme en rouge. ── */

interface ConfirmSpec {
	title: string;
	body: string;
	cta: string;
	/** true = bouton rouge (mod-warning) : Delete uniquement. */
	warning?: boolean;
}

class ConfirmModal extends QbdModal {
	constructor(app: App, private spec: ConfirmSpec, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.spec.title);
		this.contentEl.createEl("p", { text: this.spec.body });
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: t("editor.action.cancel") });
		cancel.addEventListener("click", () => this.close());
		const ok = row.createEl("button", { cls: this.spec.warning ? "mod-warning" : "mod-cta", text: this.spec.cta });
		ok.addEventListener("click", () => { this.close(); this.onConfirm(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function confirmPause(app: App, name: string, onConfirm: () => void): void {
	new ConfirmModal(app, {
		title: t("dashboard.quizzes.pauseConfirmTitle"),
		body: t("dashboard.quizzes.pauseConfirmBody", { title: name }),
		cta: t("dashboard.quizzes.pauseConfirmCta"),
	}, onConfirm).open();
}

async function deleteQuiz(ctx: DashboardCtx, quiz: QuizIndexEntry): Promise<void> {
	const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	const content = await ctx.app.vault.read(file);
	await deleteQuizCore(ctx, quiz, file, content);
	new Notice(t("dashboard.quizzes.deleted"));
}

/** Cœur du delete, sans Notice (partagé quiz seul / module entier). */
async function deleteQuizCore(ctx: DashboardCtx, quiz: QuizIndexEntry, file: TFile, content: string): Promise<void> {
	const remaining = content.replace(QUIZ_BLOCK_RE, "");
	if (remaining.trim().length === 0) {
		// La note ne contenait que le quiz : corbeille (récupérable), jamais
		// de suppression définitive.
		await ctx.app.fileManager.trashFile(file);
	} else {
		await ctx.app.vault.modify(file, remaining);
	}
	ctx.statsStore?.deleteRecord(quiz.path);
	// Purge de la liste pause : un chemin mort n'a rien à y rester.
	togglePaused(ctx, quiz.path, false);
}

/** Delete d'un MODULE entier : chaque quiz passe par le même cœur. */
async function deleteModuleQuizzes(ctx: DashboardCtx, group: ModuleGroup): Promise<void> {
	for (const q of group.quizzes) {
		const file = ctx.app.vault.getAbstractFileByPath(q.path);
		if (file instanceof TFile) await deleteQuizCore(ctx, q, file, await ctx.app.vault.read(file));
	}
	new Notice(t("dashboard.quizzes.deleted"));
}

/* ── Menus ── */

/** Menu ⋯ d'une carte de quiz — l'ordre et la rangée rouge suivent la
    référence StudySmarter. Bâti AU CLIC (l'état pause bouge). AUCUNE entrée
    d'archivage : l'archivage n'existe qu'au niveau dossier (Ahmed 2026-07-19). */
export function buildQuizCardMenu(ctx: DashboardCtx, rerender: () => void): (quiz: QuizIndexEntry) => ActionMenuItem[] {
	return (quiz) => {
		const paused = isPaused(ctx, quiz.path);
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				// Même modal de partage que les dossiers (Discord / enregistrer),
				// avec le .md du quiz seul — remplace l'ancienne copie de bloc
				// texte, jugée insuffisante (demande Ahmed 2026-07-19).
				onClick: () => { new ShareModal(ctx, quizShareSource(ctx, quiz)).open(); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				onClick: () => { void openQuizInEditor(ctx.app, quiz); },
			},
			{
				icon: paused ? "circle-play" : "circle-pause",
				label: t(paused ? "dashboard.quizzes.menuResume" : "dashboard.quizzes.menuPause"),
				onClick: () => {
					const apply = () => { togglePaused(ctx, quiz.path, !paused); rerender(); };
					// Comme StudySmarter : la PAUSE confirme, la reprise est directe.
					if (paused) apply(); else confirmPause(ctx.app, quiz.title, apply);
				},
			},
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDelete"),
				danger: true,
				onClick: () => {
					new ConfirmModal(ctx.app, {
						title: t("dashboard.quizzes.deleteConfirmTitle"),
						body: t("dashboard.quizzes.deleteConfirmBody", { title: quiz.title }),
						cta: t("dashboard.quizzes.deleteConfirmCta"),
						warning: true,
					}, () => { void deleteQuiz(ctx, quiz).then(rerender); }).open();
				},
			},
		];
	};
}

/** Menu ⋯ d'une carte de module — mêmes 5 rangées que la carte de quiz
    (demande Excalidraw 2026-07-18), adaptées au niveau module :
    Share = zip des notes du module (envoyable sur Discord), Edit = la note
    de correspondance, Pause sur tous les quiz, Archive = LE DOSSIER (flag
    unique quizzesArchivedFolders — jamais par quiz), Delete = tous les
    quiz du module (confirmation avec le compte). */
export function buildModuleCardMenu(ctx: DashboardCtx, rerender: () => void, map: ModuleMap): (g: ModuleGroup) => ActionMenuItem[] {
	return (g) => {
		const allPaused = g.quizzes.every(q => isPaused(ctx, q.path));
		const archived = isFolderArchived(ctx, g.folder);
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				onClick: () => { new ShareModal(ctx, moduleShareSource(ctx, g)).open(); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				// Modal « Modifier dossier » calqué sur StudySmarter (nom / UE /
				// couleur, sans le toggle public) — remplace l'ancienne ouverture
				// de la note de correspondance, jugée non fonctionnelle.
				onClick: () => { new ModuleEditModal(ctx, g, map, rerender).open(); },
			},
			{
				icon: allPaused ? "circle-play" : "circle-pause",
				label: t(allPaused ? "dashboard.quizzes.menuResume" : "dashboard.quizzes.menuPause"),
				onClick: () => {
					const apply = () => {
						for (const q of g.quizzes) togglePaused(ctx, q.path, !allPaused);
						rerender();
					};
					if (allPaused) apply(); else confirmPause(ctx.app, g.name, apply);
				},
			},
			{
				icon: "archive",
				label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				// Direct dans les deux sens (demande Ahmed 2026-07-19 : plus
				// aucune confirmation d'archivage). Un seul flag par DOSSIER :
				// opérationnel même quand la grille ne montre aucun quiz du
				// module (l'ancien modèle par-quiz rendait « Unarchive »
				// inopérant sur un module entièrement archivé, g.quizzes filtré
				// étant vide).
				onClick: () => { setFolderArchived(ctx, g.folder, !archived); rerender(); },
			},
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDeleteModule"),
				danger: true,
				onClick: () => {
					new ConfirmModal(ctx.app, {
						title: t("dashboard.quizzes.deleteConfirmTitle"),
						body: t("dashboard.quizzes.deleteModuleConfirmBody", { count: g.quizzes.length, name: g.name }),
						cta: t("dashboard.quizzes.deleteConfirmCta"),
						warning: true,
					}, () => { void deleteModuleQuizzes(ctx, g).then(rerender); }).open();
				},
			},
		];
	};
}
