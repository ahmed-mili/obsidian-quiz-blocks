import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { QuizStatRecord } from "./stats-store";

/* Tag de type de quiz (calculé au scan) → clé de traduction, résolue au rendu.
   Table explicite plutôt qu'une clé construite par concaténation : `t()` n'accepte
   qu'une TransKey littérale, donc un tag orphelin est une erreur de compilation. */
const QUIZ_TYPE_KEYS: Record<QuizTypeTag, TransKey> = {
	mixed: "dashboard.quizType.mixed",
	single: "dashboard.quizType.single",
	multiple: "dashboard.quizType.multiple",
	text: "dashboard.quizType.text",
	ordering: "dashboard.quizType.ordering",
	matching: "dashboard.quizType.matching"
};

/** Libellé traduit du type d'un quiz (partagé par la carte et la vue Détail). */
export function quizTypeLabel(tag: QuizTypeTag): string {
	return t(QUIZ_TYPE_KEYS[tag]);
}

/* ══════════════════════════════════════════════════════════
   QUIZ CARD — composant carte partagé (home + quizzes)
   État lisible (pastille couleur + icône), accent coloré par état,
   progression affichée seulement en cours, chevron d'ouverture au survol.
   `onOpen(quiz)` est appelé au clic (navigation laissée à l'appelant).
══════════════════════════════════════════════════════════ */

export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-quiz-card" });
	card.dataset.path = quiz.path;

	// ── État du quiz (source unique de vérité pour pastille + couleurs) ──
	const total = quiz.questions || (stats && stats.totalQuestions) || 0;
	const done = stats ? stats.questionsDone : 0;
	const best = stats ? stats.bestScore : 0;
	const pct = total > 0 ? Math.round(done / total * 100) : 0;

	// `state` reste un identifiant (suffixe de classe CSS) ; seul `stateLabel`
	// est traduit — et il l'est ici, à chaque rendu de carte.
	let state: string, stateLabel: string, stateIcon: string;
	if (stats && total > 0 && done >= total) {
		if (best >= 80) { state = "mastered"; stateLabel = t("dashboard.card.mastered"); stateIcon = "circle-check"; }
		else { state = "review"; stateLabel = t("dashboard.card.review"); stateIcon = "rotate-ccw"; }
	} else if (done > 0) {
		state = "progress"; stateLabel = t("dashboard.card.progress", { pct }); stateIcon = "rotate-cw";
	} else {
		state = "fresh"; stateLabel = t("dashboard.card.fresh"); stateIcon = "circle-play";
	}

	// Barre d'accent colorée par état
	card.createDiv({ cls: `qbd-quiz-card-accent qbd-quiz-card-accent--${state}` });

	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// En-tête : pastille d'état + chevron d'ouverture (au survol)
	const head = body.createDiv({ cls: "qbd-quiz-card-head" });
	const pill = head.createDiv({ cls: `qbd-quiz-card-status qbd-quiz-card-status--${state}` });
	const sIcon = pill.createSpan({ cls: "qbd-quiz-card-status-icon" });
	setIcon(sIcon, stateIcon);
	pill.createSpan({ text: stateLabel });
	const openEl = head.createSpan({ cls: "qbd-quiz-card-open" });
	setIcon(openEl, "chevron-right");

	// Titre
	body.createEl("p", { cls: "qbd-quiz-card-title", text: quiz.title });

	// Chemin
	const pathEl = body.createEl("p", { cls: "qbd-quiz-card-path" });
	pathEl.createSpan({ text: quiz.path });

	// Barre de progression — seulement quand c'est en cours (sinon bruit)
	if (state === "progress") {
		const progressWrapper = body.createDiv({ cls: "qbd-quiz-card-progress-wrap" });
		const progressBg = progressWrapper.createDiv({ cls: "qbd-quiz-card-progress-bg" });
		const progressFill = progressBg.createDiv({ cls: "qbd-quiz-card-progress-fill" });
		progressFill.style.width = `${pct}%`;
	}

	// Meta : nombre de questions + type + meilleur score (si joué)
	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: quiz.questions })
	});
	const badge = meta.createEl("span", { cls: "qbd-quiz-card-badge" });
	badge.textContent = quizTypeLabel(quiz.quizType);

	if (stats && best > 0) {
		const scoreColor = best >= 80 ? "var(--color-green, #4ade80)"
			: best >= 60 ? "var(--color-yellow, #facc15)"
			: "var(--color-red, #f87171)";
		const scoreSpan = meta.createEl("span", { cls: "qbd-quiz-card-score-value" });
		scoreSpan.style.color = scoreColor;
		scoreSpan.textContent = t("dashboard.card.best", { score: best });
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}
