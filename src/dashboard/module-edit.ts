import { Modal, Notice, setIcon } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { moduleForQuiz } from "./quiz-modules";
import type { ModuleGroup, ModuleMap, ModuleOverride } from "./quiz-modules";
import { openActionMenu } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   MODULE EDIT — modal « Modifier dossier », calqué sur celui de
   StudySmarter (capture Excalidraw 2026-07-18) : nom du dossier,
   UE (leur « Matière »), pastilles de couleur, bouton Enregistrer
   pleine largeur. SANS le toggle « Rendre ce dossier publique »
   (exclu explicitement par Ahmed). Persistance : override réglages
   (quizzesModuleOverrides) — la note de correspondance n'est JAMAIS
   réécrite par le plugin.
══════════════════════════════════════════════════════════ */

/** Palette de la référence StudySmarter (8 pastilles, ordre identique). */
const COLORS = [
	"#4573ff", "#14b8a6", "#10b981", "#84cc16",
	"#f59e0b", "#ef4466", "#d946ef", "#8b5cf6",
];

export class ModuleEditModal extends Modal {
	private name: string;
	private ue: string | null;
	private color: string | undefined;

	constructor(
		private ctx: DashboardCtx,
		private group: ModuleGroup,
		private map: ModuleMap,
		private onSaved: () => void
	) {
		super(ctx.app);
		this.name = group.name || group.folder;
		this.ue = group.ue;
		this.color = group.color;
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-medit-modal");
		this.titleEl.setText(t("dashboard.quizzes.moduleEditTitle"));
		const c = this.contentEl;

		// ── Nom du dossier ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditName") });
		const nameInput = c.createEl("input", { type: "text", cls: "qbd-medit-input" });
		nameInput.value = this.name;
		nameInput.addEventListener("input", () => { this.name = nameInput.value; });

		// ── UE (la « Matière » de StudySmarter) ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditUe") });
		const ueBtn = c.createEl("button", { cls: "qbd-select qbd-medit-select" });
		ueBtn.type = "button";
		const ueLabel = ueBtn.createSpan({ cls: "qbd-select-label" });
		const ueChev = ueBtn.createSpan({ cls: "qbd-select-chevron" });
		setIcon(ueChev, "chevron-down");
		const paintUe = () => ueLabel.setText(this.ue ?? t("dashboard.quizzes.noUe"));
		paintUe();
		ueBtn.addEventListener("click", () => {
			// UE connues (note + overrides) + « Sans UE ». Le menu est portalé au
			// body (ui-select) : il flotte par-dessus le modal sans le refermer.
			const options: Array<string | null> = [...this.map.ueOrder, null];
			openActionMenu(ueBtn, options.map(ue => ({
				icon: ue === this.ue ? "check" : undefined,
				label: ue ?? t("dashboard.quizzes.noUe"),
				onClick: () => { this.ue = ue; paintUe(); },
			})));
		});

		// ── Couleur (8 pastilles ; re-cliquer la pastille active la retire →
		// retour au liseré par avancement) ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditColor") });
		const row = c.createDiv({ cls: "qbd-medit-colors" });
		const paintDots = () => {
			row.empty();
			for (const col of COLORS) {
				const dot = row.createEl("button", { cls: "qbd-medit-dot" });
				dot.type = "button";
				dot.style.background = col;
				if (col === this.color) setIcon(dot, "check");
				dot.addEventListener("click", () => {
					this.color = this.color === col ? undefined : col;
					paintDots();
				});
			}
		};
		paintDots();

		// ── Enregistrer ──
		const save = c.createEl("button", { cls: "qbd-medit-save", text: t("dashboard.quizzes.moduleEditSave") });
		save.addEventListener("click", () => {
			const overrides = { ...(this.ctx.plugin.settings.quizzesModuleOverrides || {}) };
			const ov: ModuleOverride = {};
			if (this.name.trim() && this.name.trim() !== this.group.folder) ov.name = this.name.trim();
			// null (Sans UE) ne se stocke que si la note, elle, donnait une UE.
			ov.ue = this.ue;
			if (this.color) ov.color = this.color;
			overrides[this.group.folder] = ov;
			this.ctx.plugin.settings.quizzesModuleOverrides = overrides;
			this.ctx.plugin.saveSettings().catch(() => {});
			this.close();
			this.onSaved();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ── « New folder » — le bouton pilule du header (l'équivalent de « Create
   Study Set » chez StudySmarter, libellé adapté). Crée un VRAI dossier du
   vault sous le parent commun des modules existants, et le déclare dans les
   overrides pour que sa carte (vide) apparaisse immédiatement. ── */

/** Parent le plus fréquent des dossiers de module (déduit des chemins de
    quiz) ; "" = racine du vault si rien n'est déductible. */
function commonModuleParent(quizzes: QuizIndexEntry[], map: ModuleMap): string {
	const counts = new Map<string, number>();
	for (const q of quizzes) {
		const folder = moduleForQuiz(q.path, map).folder;
		const segs = q.path.split("/").filter(Boolean);
		const idx = segs.indexOf(folder);
		if (idx < 0) continue;
		const prefix = segs.slice(0, idx).join("/");
		counts.set(prefix, (counts.get(prefix) || 0) + 1);
	}
	let best = "", bestN = 0;
	for (const [prefix, n] of counts) if (n > bestN) { best = prefix; bestN = n; }
	return best;
}

export class NewFolderModal extends Modal {
	private name = "";

	constructor(
		private ctx: DashboardCtx,
		private map: ModuleMap,
		private quizzes: QuizIndexEntry[],
		private onCreated: () => void
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-medit-modal");
		this.titleEl.setText(t("dashboard.quizzes.newFolderTitle"));
		const c = this.contentEl;
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditName") });
		const input = c.createEl("input", { type: "text", cls: "qbd-medit-input" });
		input.addEventListener("input", () => { this.name = input.value; });
		window.setTimeout(() => input.focus(), 0);

		const save = c.createEl("button", { cls: "qbd-medit-save", text: t("dashboard.quizzes.newFolderCta") });
		save.addEventListener("click", () => { void this.create(); });
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.create(); });
	}

	private async create(): Promise<void> {
		const name = this.name.trim().replace(/[\\/:*?"<>|]/g, "-");
		if (!name) return;
		const parent = commonModuleParent(this.quizzes, this.map);
		const path = parent ? `${parent}/${name}` : name;
		try {
			if (!this.ctx.app.vault.getAbstractFileByPath(path)) {
				await this.ctx.app.vault.createFolder(path);
			}
		} catch {
			new Notice(t("dashboard.quizzes.newFolderError"));
			return;
		}
		// Déclaré en override : la carte du dossier (0 quiz) apparaît tout de
		// suite, sans attendre qu'un premier quiz y soit créé.
		const overrides = { ...(this.ctx.plugin.settings.quizzesModuleOverrides || {}) };
		if (!overrides[name]) overrides[name] = { name };
		this.ctx.plugin.settings.quizzesModuleOverrides = overrides;
		this.ctx.plugin.saveSettings().catch(() => {});
		this.close();
		this.onCreated();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
