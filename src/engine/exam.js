'use strict';

module.exports = function createExamHandlers(ctx) {
	// Variables locales pour le timer
	let examTimerId = null;
	let examStartTime = 0;

	function examTimerHtml() {
    if (!ctx.isExamMode) return "";
    if (!ctx.examStarted) {
        const isTraining = ctx.quizState?.practiceMode === "text";
        const modeSelectorHtml = typeof ctx.cards?.startModeSelectorHtml === "function" ? ctx.cards.startModeSelectorHtml() : "";
        const primaryLabel = isTraining ? "Commencer l'entraînement" : "Commencer l'examen";
        const summaryLabel = isTraining ? "Sans chrono" : `Durée : ${ctx.examOptions.durationMinutes} minutes`;
        return `<div class="quiz-exam-start-screen" data-exam-start-screen="1">
            <div class="quiz-exam-start-content">
                <div class="quiz-exam-start-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="10" x2="14" y1="2" y2="2"></line>
                        <line x1="12" x2="15" y1="14" y2="11"></line>
                        <circle cx="12" cy="14" r="8"></circle>
                    </svg>
                </div>
                <div class="quiz-exam-start-title">Choisir le mode</div>
                <div class="quiz-exam-start-duration">${summaryLabel}</div>
                <div class="quiz-exam-start-question-count">${ctx.quiz.length} questions</div>
                ${modeSelectorHtml}
                <button class="quiz-exam-start-btn" type="button">${primaryLabel}</button>
            </div>
        </div>`;
    }

    if (!ctx.examOptions.showTimer) return "";

    const minutes = Math.floor(ctx.examTimeRemaining / 60000);
    const seconds = Math.floor((ctx.examTimeRemaining % 60000) / 1000);
    const timerDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const pct = Math.max(0, Math.min(100, (ctx.examTimeRemaining / ctx.examDurationMs) * 100));

    return `<div class="quiz-exam-timer" data-exam-timer="1">
        <div class="quiz-exam-timer-bar">
            <div class="quiz-exam-timer-progress" data-exam-progress="1" style="width: ${pct}%"> </div>
        </div>
        <div class="quiz-exam-timer-text" data-exam-text="1">${timerDisplay}</div>
    </div>`;
}


	function startExamTimer() {
		if (!ctx.isExamMode || examTimerId || !ctx.examStarted || ctx.examEnded) return;

		stopExamTimer();

		examStartTime = Date.now();
		ctx.examTimeRemaining = ctx.examDurationMs;
		updateExamTimerDisplay();

		// setInterval (et non requestAnimationFrame) : rAF est suspendu quand la fenêtre
		// Obsidian est masquée/minimisée → le chrono gèlerait et l'auto-submit ne partirait
		// pas à l'échéance. setInterval continue de tourner en arrière-plan (throttlé à ~1 s
		// au pire), et examTimeRemaining est toujours recalculé depuis Date.now(), donc
		// handleExamTimeUp part bien à l'heure même fenêtre au premier plan ou non.
		const tick = () => {
			if (ctx.examEnded) return;

			const elapsed = Date.now() - examStartTime;
			ctx.examTimeRemaining = Math.max(0, ctx.examDurationMs - elapsed);

			updateExamTimerDisplay();

			if (ctx.examTimeRemaining <= 0) {
				handleExamTimeUp(); // appelle stopExamTimer() → clearInterval
			}
		};

		examTimerId = setInterval(tick, 250);
	}

	function startExam() {
    if (!ctx.isExamMode || ctx.examStarted) return;
    if (ctx.quizState?.practiceMode === "text") {
        startTrainingMode();
        return;
    }

    ctx.trainingSession = false;
    ctx.quizState.practiceMode = "qcm";

    // Apply out-focus transition to current content
    const currentSlide = ctx.container.querySelector('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
    if (currentSlide) {
        ctx.zoom.applyOutFocusTransition(currentSlide, {
            duration: 400,
            scale: 0.95,
            blur: 10,
            onComplete: () => {
                ctx.examStarted = true;
                // Start the timer before rendering
                startExamTimer();
                // Render the quiz
                ctx.render();

                // Apply in-focus transition to new content
                requestAnimationFrame(() => {
                    const newSlide = ctx.container.querySelector('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
                    if (newSlide) {
                        ctx.zoom.applyInFocusTransition(newSlide, {
                            duration: 500,
                            scaleStart: 1.05,
                            scaleEnd: 1,
                            blurStart: 10,
                            blurEnd: 0,
                            opacityStart: 0,
                            opacityEnd: 1
                        });
                    }
                });
            }
        });
    } else {
        ctx.examStarted = true;
        startExamTimer();
        ctx.render();
    }
}

    function startTrainingMode() {
        if (!ctx.isExamMode || ctx.examStarted) return;

        ctx.trainingSession = true;
        ctx.quizMode = "training";
        ctx.isExamMode = false;
        ctx.examStarted = false;
        ctx.examEnded = false;
        ctx.examStartTime = 0;
        ctx.examTimeRemaining = 0;
        ctx.quizState.practiceMode = "text";
        ctx.quizState.current = 0;
        ctx.quizState.prevCurrent = 0;
        ctx.quizState.lastQuestionIndex = 0;
        ctx.quizState.pendingResultsLock = false;
        ctx.quizState.savedResultsPath = null;
        ctx.container?.classList?.remove("quiz-is-locked");
        stopExamTimer();
        ctx.render();
    }

			function updateExamTimerDisplay() {
			const progressEl = ctx.container?.querySelector('[data-exam-progress="1"]');
			const textEl = ctx.container?.querySelector('[data-exam-text="1"]');

			if (!progressEl || !textEl) return;

			const pct = Math.max(0, Math.min(100, (ctx.examTimeRemaining / ctx.examDurationMs) * 100));
			progressEl.style.width = `${pct}%`;

			const minutes = Math.floor(ctx.examTimeRemaining / 60000);
			const seconds = Math.floor((ctx.examTimeRemaining % 60000) / 1000);
			textEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

			const timerContainer = ctx.container?.querySelector('[data-exam-timer="1"]');
			if (timerContainer) {
				timerContainer.classList.remove('quiz-exam-timer-warning', 'quiz-exam-timer-danger');
				if (pct <= 20) timerContainer.classList.add('quiz-exam-timer-danger');
				else if (pct <= 50) timerContainer.classList.add('quiz-exam-timer-warning');
			}
		}


	function handleExamTimeUp() {
    if (ctx.examEnded) return;

    // 1. Forcer l'état final du timer avant tout rendu
    ctx.examTimeRemaining = 0;
    stopExamTimer();
    updateExamTimerDisplay();

    // Sans soumission auto (examAutoSubmit: false) : le chrono s'arrête à 0 et on
    // prévient, mais on laisse l'examen OUVERT pour une validation manuelle. On ne
    // marque pas examEnded (sinon bascule en phase review) ni locked.
    if (ctx.examOptions && ctx.examOptions.autoSubmit === false) {
        if (typeof ctx.Notice === 'function') {
            new ctx.Notice('Temps écoulé ! Terminez et validez votre examen.', 6000);
        }
        return;
    }

    ctx.examEnded = true;

    // 2. Verrouiller le quiz
    ctx.quizState.locked = true;
    ctx.container?.classList?.add("quiz-is-locked");

    // 3. Transition vers les résultats (même action que "voir le score")
    ctx.goToResults();

    if (typeof ctx.Notice === 'function') {
        new ctx.Notice('Temps écoulé ! Le quiz a été verrouillé.', 5000);
    }
}


	function stopExamTimer() {
		if (examTimerId) {
			clearInterval(examTimerId);
			examTimerId = null;
		}
	}

	function bindExamStartButton() {
		const btn = ctx.container?.querySelector('[data-exam-start-screen="1"] .quiz-exam-start-btn');
		if (btn) {
			btn.addEventListener('click', () => {
				if (ctx.quizState?.practiceMode === "text") startTrainingMode();
				else startExam();
			});
		}
	}

	return {
		examTimerHtml,
		startExamTimer,
		startExam,
		startTrainingMode,
		updateExamTimerDisplay,
		handleExamTimeUp,
		stopExamTimer,
		bindExamStartButton
	};
};
