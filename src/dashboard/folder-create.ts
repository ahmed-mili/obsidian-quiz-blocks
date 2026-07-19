import { Modal, Notice, setIcon } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleMap } from "./quiz-modules";
import { NewFolderModal, commonModuleParent } from "./module-edit";
import { parseZip } from "./zip";

/* ══════════════════════════════════════════════════════════
   CREATE FOLDER — modal « Créer un dossier » calqué sur StudySmarter
   (capture Ahmed 2026-07-19) : trois cartes-options empilées (icône
   teintée + titre + description + chevron). Créer avec l'IA → page
   Générer ; Ensemble vide → NewFolderModal ; Importer → un zip partagé
   est dézippé et recréé dans le vault. Accents de la démo (vert/bleu/
   violet) posés inline, teinte dérivée en CSS.
══════════════════════════════════════════════════════════ */

export class CreateFolderModal extends Modal {
	constructor(
		private ctx: DashboardCtx,
		private map: ModuleMap,
		private quizzes: QuizIndexEntry[],
		private onDone: () => void
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-create-modal");
		this.titleEl.setText(t("dashboard.quizzes.createFolderTitle"));
		const c = this.contentEl;

		const option = (icon: string, accent: string, title: string, desc: string, onPick: () => void) => {
			const card = c.createEl("button", { cls: "qbd-create-option" });
			card.type = "button";
			card.style.setProperty("--accent", accent);
			const ic = card.createDiv({ cls: "qbd-create-option-icon" });
			setIcon(ic, icon);
			const txt = card.createDiv({ cls: "qbd-create-option-text" });
			txt.createDiv({ cls: "qbd-create-option-title", text: title });
			txt.createDiv({ cls: "qbd-create-option-desc", text: desc });
			const chev = card.createDiv({ cls: "qbd-create-option-chevron" });
			setIcon(chev, "chevron-right");
			card.addEventListener("click", () => { this.close(); onPick(); });
		};

		option("sparkles", "#3ddc84", t("dashboard.quizzes.createAiTitle"), t("dashboard.quizzes.createAiDesc"),
			() => this.ctx.navigate("ai"));
		option("folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => new NewFolderModal(this.ctx, this.map, this.quizzes, this.onDone).open());
		option("download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(this.ctx, this.map, this.quizzes, this.onDone));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ── Import d'un dossier partagé (.zip) : sélection cross-platform via un
   <input type=file> (desktop ET mobile, pas de dépendance Node), parseZip
   (store), puis recréation du dossier + de ses notes dans le vault. ── */

function pickZipFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".zip,application/zip";
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) { resolve(null); return; }
			resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}

export async function importSharedFolder(
	ctx: DashboardCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onDone: () => void
): Promise<void> {
	const picked = await pickZipFile();
	if (!picked) return;
	const entries = parseZip(picked.bytes);
	if (entries.length === 0) {
		new Notice(t("dashboard.quizzes.importEmpty"));
		return;
	}
	// Dossier cible : base du zip, assainie, sous le parent commun des modules ;
	// suffixe (2), (3)… si un dossier du même nom existe déjà.
	const base = picked.name.replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim() || "Import";
	const parent = commonModuleParent(quizzes, map);
	const root = parent ? `${parent}/${base}` : base;
	let folderPath = root;
	for (let n = 2; ctx.app.vault.getAbstractFileByPath(folderPath); n++) folderPath = `${root} (${n})`;

	try {
		await ctx.app.vault.createFolder(folderPath);
		for (const e of entries) {
			// Aplatir : on n'écrit que le nom de note (pas de sous-chemins d'archive).
			const noteName = (e.name.split("/").pop() || e.name).replace(/[\\/:*?"<>|]/g, "-");
			if (!noteName) continue;
			await ctx.app.vault.create(`${folderPath}/${noteName}`, e.content);
		}
	} catch {
		new Notice(t("dashboard.quizzes.importError"));
		return;
	}

	// Déclaré en override : la carte du module apparaît tout de suite.
	const folderKey = folderPath.split("/").pop() as string;
	const overrides = { ...(ctx.plugin.settings.quizzesModuleOverrides || {}) };
	if (!overrides[folderKey]) overrides[folderKey] = { name: base };
	ctx.plugin.settings.quizzesModuleOverrides = overrides;
	ctx.plugin.saveSettings().catch(() => {});
	new Notice(t("dashboard.quizzes.importDone", { name: base, count: entries.length }));
	onDone();
}
