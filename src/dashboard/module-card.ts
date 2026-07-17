import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz), nommé
   et rattaché à son UE depuis la note de correspondance. Cliquer
   entre dans le module (drill-down géré par l'appelant). Pas de
   bouton lecture : un module contient N quiz, pas un seul.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-module-card" });
	// Liseré coloré selon l'avancement (vert si tout maîtrisé, accent sinon).
	const done = group.total > 0 && group.mastered >= group.total;
	card.createDiv({ cls: `qbd-quiz-card-accent qbd-module-card-accent--${done ? "done" : "partial"}` });
	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// UE en petite étiquette (au-dessus du nom, discrète). Omise si non résolue.
	if (group.ue) body.createEl("p", { cls: "qbd-module-card-ue", text: group.ue });

	// Fallback : un quiz sans ancêtre reconnu (ex. à la racine du vault) donne
	// un nom vide (moduleForQuiz) — jamais de carte au titre blanc.
	body.createEl("p", { cls: "qbd-quiz-card-title", text: group.name || t("dashboard.quizzes.noFolder") });

	// Barre d'avancement — omise si rien n'est maîtrisé (une piste vide
	// n'apprend rien de plus que le « 0 » du compte, cf. quizzes.ts).
	if (group.mastered > 0) {
		const wrap = body.createDiv({ cls: "qbd-quiz-card-progress-wrap" });
		const bg = wrap.createDiv({ cls: "qbd-quiz-card-progress-bg" });
		const fill = bg.createDiv({ cls: "qbd-quiz-card-progress-fill" });
		fill.style.width = Math.round(group.mastered / group.total * 100) + "%";
	}

	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther", { count: group.total }),
	});
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: group.mastered }),
	});

	card.addEventListener("click", () => onOpen(group));
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
