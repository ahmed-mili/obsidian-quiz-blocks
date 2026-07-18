import { Modal, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import type { ActionMenuItem } from "./ui-select";
import { openQuizInEditor } from "./quiz-open";

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

/* ── Listes persistées (chemins de notes) — même canal que
   quizzesExpandedFolders (quizzes.ts) : l'échec d'écriture ne casse pas l'UI. */

function readList(ctx: DashboardCtx, key: "quizzesPaused" | "quizzesArchived"): Set<string> {
	return new Set(ctx.plugin.settings[key] || []);
}

function toggleList(ctx: DashboardCtx, key: "quizzesPaused" | "quizzesArchived", path: string, on: boolean): void {
	const set = readList(ctx, key);
	if (on) set.add(path); else set.delete(path);
	ctx.plugin.settings[key] = [...set];
	ctx.plugin.saveSettings().catch(() => {});
}

export function isPaused(ctx: DashboardCtx, path: string): boolean {
	return readList(ctx, "quizzesPaused").has(path);
}

export function isArchived(ctx: DashboardCtx, path: string): boolean {
	return readList(ctx, "quizzesArchived").has(path);
}

/* ── Share : copier le bloc quiz complet (délimiteurs compris) ── */

async function copyQuizBlock(app: App, quiz: QuizIndexEntry): Promise<void> {
	const file = app.vault.getAbstractFileByPath(quiz.path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	const content = await app.vault.read(file);
	const match = content.match(/```quiz-blocks\n[\s\S]*?\n```/);
	if (!match) {
		new Notice(t("dashboard.detail.noBlockInNote"));
		return;
	}
	await navigator.clipboard.writeText(match[0]);
	new Notice(t("dashboard.quizzes.blockCopied"));
}

/* ── Delete : confirmation puis retrait du bloc (ou corbeille) ── */

class ConfirmDeleteModal extends Modal {
	constructor(app: App, private quizTitle: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("dashboard.quizzes.deleteConfirmTitle"));
		this.contentEl.createEl("p", { text: t("dashboard.quizzes.deleteConfirmBody", { title: this.quizTitle }) });
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: t("editor.action.cancel") });
		cancel.addEventListener("click", () => this.close());
		const del = row.createEl("button", { cls: "mod-warning", text: t("dashboard.quizzes.deleteConfirmCta") });
		del.addEventListener("click", () => { this.close(); this.onConfirm(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function deleteQuiz(ctx: DashboardCtx, quiz: QuizIndexEntry): Promise<void> {
	const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	const content = await ctx.app.vault.read(file);
	const remaining = content.replace(/```quiz-blocks\n[\s\S]*?\n```/, "");
	if (remaining.trim().length === 0) {
		// La note ne contenait que le quiz : corbeille (récupérable), jamais
		// de suppression définitive.
		await ctx.app.fileManager.trashFile(file);
	} else {
		await ctx.app.vault.modify(file, remaining);
	}
	ctx.statsStore?.deleteRecord(quiz.path);
	// Purge des listes pause/archive : un chemin mort n'a rien à y rester.
	toggleList(ctx, "quizzesPaused", quiz.path, false);
	toggleList(ctx, "quizzesArchived", quiz.path, false);
	new Notice(t("dashboard.quizzes.deleted"));
}

/* ── Menus ── */

/** Menu ⋯ d'une carte de quiz — l'ordre et la rangée rouge suivent la
    référence StudySmarter. Bâti AU CLIC (l'état pause/archive bouge). */
export function buildQuizCardMenu(ctx: DashboardCtx, rerender: () => void): (quiz: QuizIndexEntry) => ActionMenuItem[] {
	return (quiz) => {
		const paused = isPaused(ctx, quiz.path);
		const archived = isArchived(ctx, quiz.path);
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				onClick: () => { void copyQuizBlock(ctx.app, quiz); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				onClick: () => { void openQuizInEditor(ctx.app, quiz); },
			},
			{
				icon: paused ? "circle-play" : "circle-pause",
				label: t(paused ? "dashboard.quizzes.menuResume" : "dashboard.quizzes.menuPause"),
				onClick: () => { toggleList(ctx, "quizzesPaused", quiz.path, !paused); rerender(); },
			},
			{
				icon: "archive",
				label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				onClick: () => { toggleList(ctx, "quizzesArchived", quiz.path, !archived); rerender(); },
			},
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDelete"),
				danger: true,
				onClick: () => {
					new ConfirmDeleteModal(ctx.app, quiz.title, () => {
						void deleteQuiz(ctx, quiz).then(rerender);
					}).open();
				},
			},
		];
	};
}

/** Menu ⋯ d'une carte de module : les mêmes toggles Pause/Archive, appliqués
    à TOUS les quiz du module (pas de Share/Edit/Delete : un module = N notes). */
export function buildModuleCardMenu(ctx: DashboardCtx, rerender: () => void): (g: ModuleGroup) => ActionMenuItem[] {
	return (g) => {
		const allPaused = g.quizzes.every(q => isPaused(ctx, q.path));
		const allArchived = g.quizzes.every(q => isArchived(ctx, q.path));
		return [
			{
				icon: allPaused ? "circle-play" : "circle-pause",
				label: t(allPaused ? "dashboard.quizzes.menuResume" : "dashboard.quizzes.menuPause"),
				onClick: () => {
					for (const q of g.quizzes) toggleList(ctx, "quizzesPaused", q.path, !allPaused);
					rerender();
				},
			},
			{
				icon: "archive",
				label: t(allArchived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				onClick: () => {
					for (const q of g.quizzes) toggleList(ctx, "quizzesArchived", q.path, !allArchived);
					rerender();
				},
			},
		];
	};
}
