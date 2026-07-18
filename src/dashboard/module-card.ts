import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz), nommé
   et rattaché à son UE depuis la note de correspondance. Cliquer
   entre dans le module (drill-down géré par l'appelant). Pas de
   bouton lecture : un module contient N quiz, pas un seul.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void,
	/* menu (opt-in, même patron que quiz-card.ts) : items du menu ⋯, bâtis
	   par l'appelant au clic. Non fourni = pas de bouton ⋯. */
	menu?: (group: ModuleGroup) => ActionMenuItem[]
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-module-card" });
	// Liseré : couleur choisie dans « Modifier dossier » si définie, sinon
	// selon l'avancement (vert si tout maîtrisé, accent sinon).
	const done = group.total > 0 && group.mastered >= group.total;
	const accent = card.createDiv({ cls: `qbd-quiz-card-accent qbd-module-card-accent--${done ? "done" : "partial"}` });
	if (group.color) accent.style.background = group.color;
	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// Nom du module en TITRE. Fallback : un quiz sans ancêtre reconnu (ex. à la
	// racine du vault) donne un nom vide (moduleForQuiz) — jamais de titre blanc.
	body.createEl("p", { cls: "qbd-quiz-card-title", text: group.name || t("dashboard.quizzes.noFolder") });

	// UE en SOUS-TITRE, sous le nom — façon StudySmarter (« math » / « Mathématiques »,
	// demande d'Ahmed 2026-07-17). Affichée dans TOUS les modes, y compris sous un
	// en-tête d'UE : Ahmed veut l'UE sur la carte (comme StudySmarter garde le
	// sous-titre même dans une section groupée). Omise seulement si non résolue.
	if (group.ue) body.createEl("p", { cls: "qbd-module-card-ue", text: group.ue });

	// Barre d'avancement — omise si rien n'est maîtrisé (une piste vide
	// n'apprend rien de plus que le « 0 » du compte, cf. quizzes.ts).
	if (group.mastered > 0) {
		const wrap = body.createDiv({ cls: "qbd-quiz-card-progress-wrap" });
		const bg = wrap.createDiv({ cls: "qbd-quiz-card-progress-bg" });
		const fill = bg.createDiv({ cls: "qbd-quiz-card-progress-fill" });
		fill.style.width = Math.round(group.mastered / group.total * 100) + "%";
	}

	// Compteurs dans le CORPS, sous le titre, chiffre en gras + « • » entre
	// les deux — la ligne « 12 Subsets • 96 Flashcards » de StudySmarter
	// (capture Ahmed 2026-07-18 : nos cartes étaient creuses, compteurs
	// relégués au footer). Le footer ne garde que le ⋯.
	const counts = body.createDiv({ cls: "qbd-module-card-counts" });
	const addCount = (n: number, key: "dashboard.quizzes.moduleQuizzesOne" | "dashboard.quizzes.moduleQuizzesOther" | "dashboard.quizzes.folderMasteredOne" | "dashboard.quizzes.folderMasteredOther") => {
		const item = counts.createSpan({ cls: "qbd-module-card-count" });
		item.createEl("strong", { text: String(n) });
		// La clé produit « {count} quizzes » : on retire le chiffre de tête,
		// déjà rendu en gras juste avant — seul le libellé reste.
		item.appendText(" " + t(key, { count: n }).replace(/^\s*\d+\s*/, ""));
	};
	addCount(group.total, group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther");
	counts.createSpan({ cls: "qbd-module-card-count-sep", text: "•" });
	addCount(group.mastered, group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther");

	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });

	// Bouton ⋯ en bout de ligne meta (position StudySmarter : coin bas droit).
	if (menu) {
		const moreBtn = meta.createEl("button", { cls: "qbd-card-more" });
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openActionMenu(moreBtn, menu(group));
		});
	}

	card.addEventListener("click", () => onOpen(group));
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
