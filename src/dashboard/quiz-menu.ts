import { Modal, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { ShareModal } from "./share";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import { ModuleEditModal } from "./module-edit";
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

/* ── Confirmations — même contrat que StudySmarter (vérifié en live le
   2026-07-18) : Pause et Archive CONFIRMENT avant d'agir, Resume et
   Unarchive sont directs, Delete confirme en rouge. ── */

interface ConfirmSpec {
	title: string;
	body: string;
	cta: string;
	/** true = bouton rouge (mod-warning) : Delete uniquement. */
	warning?: boolean;
}

class ConfirmModal extends Modal {
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

function confirmArchive(app: App, name: string, onConfirm: () => void): void {
	new ConfirmModal(app, {
		title: t("dashboard.quizzes.archiveConfirmTitle"),
		body: t("dashboard.quizzes.archiveConfirmBody", { title: name }),
		cta: t("dashboard.quizzes.archiveConfirmCta"),
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
				onClick: () => {
					const apply = () => { toggleList(ctx, "quizzesPaused", quiz.path, !paused); rerender(); };
					// Comme StudySmarter : la PAUSE confirme, la reprise est directe.
					if (paused) apply(); else confirmPause(ctx.app, quiz.title, apply);
				},
			},
			{
				icon: "archive",
				label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				onClick: () => {
					const apply = () => { toggleList(ctx, "quizzesArchived", quiz.path, !archived); rerender(); };
					// Comme StudySmarter : ARCHIVER confirme, désarchiver est direct.
					if (archived) apply(); else confirmArchive(ctx.app, quiz.title, apply);
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
    de correspondance, Pause/Archive sur tous les quiz, Delete = tous les
    quiz du module (confirmation avec le compte). */
export function buildModuleCardMenu(ctx: DashboardCtx, rerender: () => void, map: ModuleMap): (g: ModuleGroup) => ActionMenuItem[] {
	return (g) => {
		const allPaused = g.quizzes.every(q => isPaused(ctx, q.path));
		const allArchived = g.quizzes.every(q => isArchived(ctx, q.path));
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				onClick: () => { new ShareModal(ctx, g).open(); },
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
						for (const q of g.quizzes) toggleList(ctx, "quizzesPaused", q.path, !allPaused);
						rerender();
					};
					if (allPaused) apply(); else confirmPause(ctx.app, g.name, apply);
				},
			},
			{
				icon: "archive",
				label: t(allArchived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				onClick: () => {
					const apply = () => {
						for (const q of g.quizzes) toggleList(ctx, "quizzesArchived", q.path, !allArchived);
						rerender();
					};
					if (allArchived) apply(); else confirmArchive(ctx.app, g.name, apply);
				},
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
