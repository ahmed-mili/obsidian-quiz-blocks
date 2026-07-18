import { Modal, Notice, Platform, TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { buildZip } from "./zip";
import type { ZipEntry } from "./zip";
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

/* ── Share (module) : zip des notes du module, prêt à envoyer (Discord…) ──
   Desktop : écrit dans Téléchargements puis révèle le fichier dans
   l'Explorateur. Mobile : à la racine du vault (pas de Node) — la feature
   DÉGRADE, elle ne bloque jamais (règle « jamais desktop-only »). */

async function shareModuleZip(ctx: DashboardCtx, group: ModuleGroup): Promise<void> {
	const entries: ZipEntry[] = [];
	for (const q of group.quizzes) {
		const file = ctx.app.vault.getAbstractFileByPath(q.path);
		if (file instanceof TFile) entries.push({ name: file.name, content: await ctx.app.vault.read(file) });
	}
	if (entries.length === 0) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	const zip = buildZip(entries);
	// Nom de fichier depuis le nom du module, débarrassé des caractères interdits.
	const base = (group.name || "quizzes").replace(/[\\/:*?"<>|]/g, "-").trim() || "quizzes";
	if (Platform.isDesktopApp) {
		// require paresseux : ces modules n'existent pas sur mobile.
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const dest = path.join(os.homedir(), "Downloads", `${base}.zip`);
		fs.writeFileSync(dest, zip);
		(require("electron") as { shell: { showItemInFolder(p: string): void } }).shell.showItemInFolder(dest);
		new Notice(t("dashboard.quizzes.zipSaved", { path: dest }));
	} else {
		const dest = normalizePath(`${base}.zip`);
		await ctx.app.vault.adapter.writeBinary(dest, zip.buffer as ArrayBuffer);
		new Notice(t("dashboard.quizzes.zipSaved", { path: dest }));
	}
}

/* ── Delete : confirmation puis retrait du bloc (ou corbeille) ── */

class ConfirmDeleteModal extends Modal {
	constructor(app: App, private body: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("dashboard.quizzes.deleteConfirmTitle"));
		this.contentEl.createEl("p", { text: this.body });
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

/** Edit d'un module = ouvrir la note de correspondance (noms + UE s'y éditent). */
async function openModuleMapNote(ctx: DashboardCtx): Promise<void> {
	const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
	const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
	if (!file) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	await ctx.app.workspace.getLeaf(false).openFile(file);
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
					new ConfirmDeleteModal(ctx.app, t("dashboard.quizzes.deleteConfirmBody", { title: quiz.title }), () => {
						void deleteQuiz(ctx, quiz).then(rerender);
					}).open();
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
export function buildModuleCardMenu(ctx: DashboardCtx, rerender: () => void): (g: ModuleGroup) => ActionMenuItem[] {
	return (g) => {
		const allPaused = g.quizzes.every(q => isPaused(ctx, q.path));
		const allArchived = g.quizzes.every(q => isArchived(ctx, q.path));
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				onClick: () => { void shareModuleZip(ctx, g); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				onClick: () => { void openModuleMapNote(ctx); },
			},
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
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDeleteModule"),
				danger: true,
				onClick: () => {
					new ConfirmDeleteModal(
						ctx.app,
						t("dashboard.quizzes.deleteModuleConfirmBody", { count: g.quizzes.length, name: g.name }),
						() => { void deleteModuleQuizzes(ctx, g).then(rerender); }
					).open();
				},
			},
		];
	};
}
