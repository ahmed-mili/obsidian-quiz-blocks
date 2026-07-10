'use strict';

/* ══════════════════════════════════════════════════════════
   QUIZ CARD — composant carte partagé (home + quizzes)
   État lisible (pastille couleur + icône), accent coloré par état,
   progression affichée seulement en cours, chevron d'ouverture au survol.
   `onOpen(quiz)` est appelé au clic (navigation laissée à l'appelant).
══════════════════════════════════════════════════════════ */

const obsidian = require("obsidian");

function renderQuizCard(container, quiz, stats, onOpen) {
	const card = container.createDiv({ cls: "qbd-quiz-card" });
	card.dataset.path = quiz.path;

	// ── État du quiz (source unique de vérité pour pastille + couleurs) ──
	const total = quiz.questions || (stats && stats.totalQuestions) || 0;
	const done = stats ? stats.questionsDone : 0;
	const best = stats ? stats.bestScore : 0;
	const pct = total > 0 ? Math.round(done / total * 100) : 0;

	let state, stateLabel, stateIcon;
	if (stats && total > 0 && done >= total) {
		if (best >= 80) { state = "mastered"; stateLabel = "Maîtrisé"; stateIcon = "circle-check"; }
		else { state = "review"; stateLabel = "À revoir"; stateIcon = "rotate-ccw"; }
	} else if (done > 0) {
		state = "progress"; stateLabel = `En cours · ${pct}%`; stateIcon = "rotate-cw";
	} else {
		state = "fresh"; stateLabel = "À commencer"; stateIcon = "circle-play";
	}

	// Barre d'accent colorée par état
	card.createDiv({ cls: `qbd-quiz-card-accent qbd-quiz-card-accent--${state}` });

	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// En-tête : pastille d'état + chevron d'ouverture (au survol)
	const head = body.createDiv({ cls: "qbd-quiz-card-head" });
	const pill = head.createDiv({ cls: `qbd-quiz-card-status qbd-quiz-card-status--${state}` });
	const sIcon = pill.createSpan({ cls: "qbd-quiz-card-status-icon" });
	obsidian.setIcon(sIcon, stateIcon);
	pill.createSpan({ text: stateLabel });
	const openEl = head.createSpan({ cls: "qbd-quiz-card-open" });
	obsidian.setIcon(openEl, "chevron-right");

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
	meta.createEl("span", { cls: "qbd-quiz-card-meta-item", text: `${quiz.questions} questions` });
	const badge = meta.createEl("span", { cls: "qbd-quiz-card-badge" });
	badge.textContent = quiz.quizType;

	if (stats && best > 0) {
		const scoreColor = best >= 80 ? "var(--color-green, #4ade80)"
			: best >= 60 ? "var(--color-yellow, #facc15)"
			: "var(--color-red, #f87171)";
		const scoreSpan = meta.createEl("span", { cls: "qbd-quiz-card-score-value" });
		scoreSpan.style.color = scoreColor;
		scoreSpan.textContent = `Meilleur ${best}%`;
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}

module.exports = renderQuizCard;
