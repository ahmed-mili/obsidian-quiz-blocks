import { Modal, setIcon } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
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
