import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";
import { DEFAULT_MODULE_ICON } from "./icon-picker";
import { moduleAccent } from "./module-color";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz). Design
   « folder card 6a » (handoff claude design validé Ahmed 2026-07-18) :
   halo radial coloré dans l'angle HAUT-GAUCHE (dans le fond), carré
   d'icône + titre colorés de l'accent du dossier, stats, ligne
   séparatrice, bouton ••• en pied ; hover = élévation + lueur colorée.
   L'accent (var --accent, posé inline) vient du modal ou du hash du nom
   (module-color.ts) ; tout le reste se dérive en CSS via color-mix.
   Cliquer entre dans le module.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void,
	/* menu (opt-in) : items du menu ⋯, bâtis par l'appelant au clic. */
	menu?: (group: ModuleGroup) => ActionMenuItem[],
	/* onPickIcon (opt-in) : clic sur la pastille d'icône → change l'icône
	   directement (raccourci, sans ouvrir « Modifier dossier »). L'appelant
	   fournit le comportement (picker + persistance) car la carte n'a pas
	   accès aux settings. */
	onPickIcon?: (group: ModuleGroup, anchor: HTMLElement) => void
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-module-card" });
	// Accent du dossier (couleur choisie, sinon dérivée du nom) → toute la
	// teinte de la carte se dérive de --accent en CSS.
	card.style.setProperty("--accent", moduleAccent(group));

	// ── En-tête : pastille d'icône + titre coloré / sous-titre UE ──
	const header = card.createDiv({ cls: "qbd-module-card__header" });
	const iconBox = header.createDiv({ cls: "qbd-module-card__icon" });
	setIcon(iconBox, group.icon || DEFAULT_MODULE_ICON);
	if (onPickIcon) {
		// La pastille devient un raccourci « changer l'icône » ; le clic ne doit
		// PAS aussi entrer dans le module.
		// Pas de `title` : Obsidian en ferait une infobulle native flottante
		// parasite (cf. plugin-dev §0 bis) ; le highlight au survol suffit d'indice.
		iconBox.addClass("qbd-module-card__icon--editable");
		iconBox.addEventListener("click", (e) => {
			e.stopPropagation();
			onPickIcon(group, iconBox);
		});
	}
	const titles = header.createDiv({ cls: "qbd-module-card__titles" });
	// Titre = nom du module. Fallback : un quiz sans ancêtre reconnu donne un
	// nom vide (moduleForQuiz) — jamais de titre blanc.
	titles.createDiv({ cls: "qbd-module-card__title", text: group.name || t("dashboard.quizzes.noFolder") });
	// Sous-titre = UE, omis si non résolu (l'en-tête garde son alignement haut).
	if (group.ue) titles.createDiv({ cls: "qbd-module-card__subtitle", text: group.ue });

	// ── Stats : « N quiz • N maîtrisés » (nombres en gras, séparateur discret) ──
	const stats = card.createDiv({ cls: "qbd-module-card__stats" });
	const addStat = (n: number, key: "dashboard.quizzes.moduleQuizzesOne" | "dashboard.quizzes.moduleQuizzesOther" | "dashboard.quizzes.folderMasteredOne" | "dashboard.quizzes.folderMasteredOther") => {
		const span = stats.createSpan();
		span.createEl("strong", { text: String(n) });
		// La clé produit « {count} quizzes » : on retire le chiffre de tête (déjà
		// en gras) — seul le libellé traduit reste.
		span.appendText(" " + t(key, { count: n }).replace(/^\s*\d+\s*/, ""));
	};
	addStat(group.total, group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther");
	stats.createSpan({ cls: "sep", text: "•" });
	addStat(group.mastered, group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther");

	// ── Spacer + ligne séparatrice + pied (bouton ••• = menu existant) ──
	card.createDiv({ cls: "qbd-module-card__spacer" });
	card.createDiv({ cls: "qbd-module-card__divider" });
	const footer = card.createDiv({ cls: "qbd-module-card__footer" });
	if (menu) {
		const moreBtn = footer.createEl("button", { cls: "qbd-card-more qbd-module-card__menu" });
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			// Ouvrir le menu ne doit PAS aussi entrer dans le module.
			e.stopPropagation();
			openActionMenu(moreBtn, menu(group));
		});
	}

	card.addEventListener("click", () => onOpen(group));
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
