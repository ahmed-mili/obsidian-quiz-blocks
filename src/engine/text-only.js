'use strict';

module.exports = function createTextOnlyHandlers(ctx) {
	const RATINGS = {
		understood: { label: "Compris", className: "understood" },
		partial: { label: "Partiel", className: "partial" },
		review: { label: "À revoir", className: "review" }
	};

	function isTextOnlyMode() {
		return ctx.quizState?.practiceMode === "text";
	}

	function isExamAnswerPhase() {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examStarted && !ctx.examEnded;
	}

	function isExamReviewPhase() {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examEnded;
	}

	function normalizeRating(value) {
		return Object.prototype.hasOwnProperty.call(RATINGS, value) ? value : null;
	}

	function getRatingMeta(value) {
		const normalized = normalizeRating(value);
		return normalized ? RATINGS[normalized] : null;
	}

	function hasAnyAnswer(qi) {
		const answer = ctx.quizState.textOnlyAnswers?.[qi];
		return typeof answer === "string" && answer.trim().length > 0;
	}

	function isChecked(qi) {
		return !!ctx.quizState.textOnlyChecked?.[qi] || isExamReviewPhase();
	}

	function isRated(qi) {
		return !!normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
	}

	function computeResults() {
		const counts = { understood: 0, partial: 0, review: 0, pending: 0 };
		for (let i = 0; i < ctx.quiz.length; i++) {
			const rating = normalizeRating(ctx.quizState.textOnlyRatings?.[i]);
			if (rating) counts[rating]++;
			else counts.pending++;
		}
		return { ...counts, total: ctx.quiz.length, rated: ctx.quiz.length - counts.pending };
	}

	function getCorrectOptionIndices(q) {
		if (!q) return [];
		if (q.multiSelect && Array.isArray(q.correctIndices)) {
			return q.correctIndices
				.map(Number)
				.filter(i => Number.isInteger(i) && i >= 0 && i < (q.options || []).length);
		}
		const correctIndex = Number(q.correctIndex);
		if (Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < (q.options || []).length) {
			return [correctIndex];
		}
		return [];
	}

	function expectedAnswerHtml(q) {
		const indices = getCorrectOptionIndices(q);
		if (indices.length > 0) {
			const items = indices.map(oi => {
				const content = ctx.cards.optionContentHtml(q, oi);
				return `<div class="quiz-textonly-expected-item">${content}</div>`;
			}).join("");
			return `<div class="quiz-textonly-expected-list">${items}</div>`;
		}

		const accepted = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
		if (accepted.length > 0) {
			return `<div class="quiz-textonly-expected-item">${ctx.escapeHtmlText(accepted[0])}</div>`;
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			const order = ctx.getOrderingCorrectOrder(q);
			const answer = order.map(i => items[i]).filter(v => v !== undefined).join(" -> ");
			if (answer) return `<div class="quiz-textonly-expected-item">${ctx.escapeHtmlText(answer)}</div>`;
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const map = ctx.getMatchCorrectMap(q);
			if (Array.isArray(map) && map.length === rows.length) {
				const rowsHtml = rows.map((row, i) => {
					const choice = choices[map[i]] ?? "";
					return `<div class="quiz-textonly-expected-pair"><strong>${ctx.escapeHtmlText(row)}</strong><span>${ctx.escapeHtmlText(choice)}</span></div>`;
				}).join("");
				return `<div class="quiz-textonly-expected-list">${rowsHtml}</div>`;
			}
		}

		return `<div class="quiz-textonly-expected-item">Réponse attendue non renseignée.</div>`;
	}

	function learningHtml(q) {
		const chunks = [];
		const learnHtml = q.learnHtml || q._learnHtml;
		if (learnHtml || q.learn) {
			const content = learnHtml
				? ctx.sanitize.replaceObsidianEmbedsInHtml(learnHtml)
				: ctx.sanitize.renderTextWithEmbeds(q.learn || "");
			chunks.push(`<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">Leçon</div><div class="quiz-textonly-explain-content">${content}</div></div>`);
		}

		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml || q.explain) {
			const content = explainHtml
				? ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)
				: ctx.sanitize.renderTextWithEmbeds(q.explain || "");
			chunks.push(`<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">Explication</div><div class="quiz-textonly-explain-content">${content}</div></div>`);
		}

		return chunks.join("");
	}

	function comparisonOptionsHtml(q, qi) {
		if (!Array.isArray(q.options) || q.options.length === 0) return "";
		const correct = new Set(getCorrectOptionIndices(q));
		const order = Array.isArray(ctx.quizState.shuffleMap?.[qi])
			? ctx.quizState.shuffleMap[qi]
			: [...Array(q.options.length).keys()];

		const options = order.map(oi => {
			const cls = correct.has(oi) ? "correct" : "";
			return `<div class="quiz-option quiz-textonly-option ${cls}" data-textonly-orig="${oi}">${ctx.cards.optionContentHtml(q, oi)}</div>`;
		}).join("");

		const hasImg = /<img[\s>]/i.test(options);
		return `<div class="quiz-textonly-comparison">
			<div class="quiz-textonly-label">Options QCM</div>
			<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${options}</div>
		</div>`;
	}

	function ratingButtonsHtml(qi) {
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		return `<div class="quiz-textonly-self">
			<div class="quiz-textonly-label">Auto-évaluation</div>
			<div class="quiz-textonly-rating-row">
				${Object.entries(RATINGS).map(([value, meta]) => {
					const selected = current === value ? " selected" : "";
					return `<button class="quiz-action-btn quiz-textonly-rating-btn ${meta.className}${selected}" type="button" data-textonly-rating="${value}" aria-pressed="${current === value ? "true" : "false"}">${meta.label}</button>`;
				}).join("")}
			</div>
		</div>`;
	}

	function questionCardBodyHtml(q, qi) {
		const checked = isChecked(qi);
		const examAnswerPhase = isExamAnswerPhase();
		const revealed = checked && !examAnswerPhase;
		const value = typeof ctx.quizState.textOnlyAnswers?.[qi] === "string" ? ctx.quizState.textOnlyAnswers[qi] : "";
		const textareaName = ctx.escapeHtmlAttr(q?.id || `q${qi + 1}`);
		const readOnlyAttr = revealed ? `readonly aria-readonly="true"` : "";

		const reviewHtml = revealed ? `<div class="quiz-textonly-review">
			${ratingButtonsHtml(qi)}
			${comparisonOptionsHtml(q, qi)}
			${learningHtml(q)}
		</div>` : "";

		return `<div class="quiz-textonly">
			<div class="quiz-textonly-answer">
				<label class="quiz-textonly-label" for="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}">Votre réponse libre</label>
				<textarea
					id="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}"
					class="quiz-textarea quiz-textonly-textarea"
					data-textonly-answer="1"
					name="${textareaName}"
					placeholder="Écrivez votre réponse avec vos mots..."
					spellcheck="true"
					autocapitalize="off"
					autocomplete="off"
					autocorrect="off"
					${readOnlyAttr}
				>${ctx.escapeHtmlText(value)}</textarea>
				${(!revealed && !examAnswerPhase) ? `<div class="quiz-actions quiz-textonly-check-actions"><button class="quiz-action-btn success quiz-textonly-check-btn" type="button">Vérifier</button></div>` : ""}
			</div>
			${reviewHtml}
		</div>`;
	}

	function questionActionsHtml(qi) {
		const isFirst = qi <= 0;
		const isLast = qi >= ctx.quiz.length - 1;
		const lastLabel = isExamAnswerPhase() ? "Terminer l'examen" : "Résultats";
		return `<div class="quiz-actions quiz-textonly-nav-actions">
			<button class="quiz-action-btn quiz-prev-btn" type="button"${isFirst ? " disabled" : ""}>Question précédente</button>
			${isLast
				? `<button class="quiz-action-btn success quiz-results-btn" type="button">${lastLabel}</button>`
				: `<button class="quiz-action-btn quiz-next-btn" type="button">Question suivante</button>`}
		</div>`;
	}

	function syncTextAreaHeight(textarea) {
		if (ctx.terminal?.syncTextAreaHeight) {
			ctx.terminal.syncTextAreaHeight(textarea);
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
	}

	function bindTextOnlyQuestion(trackItem, qi) {
		const textarea = trackItem.querySelector(".quiz-textonly-textarea[data-textonly-answer]");
		if (textarea) {
			const syncLayout = () => {
				syncTextAreaHeight(textarea);
				const slideIdx = ctx.getSlideIndexForQuestion(qi);
				if (slideIdx >= 0) ctx.viewport.__quizSlideHeightCache?.delete(slideIdx);
				if (slideIdx === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
				}
			};

			const persistAnswer = () => {
				if (isChecked(qi)) return;
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(textarea.value ?? "");
			};

			const commitAnswer = () => {
				if (isChecked(qi)) return;
				// Persister l'état même pendant un slide (sinon la frappe de fin est perdue) ;
				// le re-render (nav + meta) n'est fait qu'hors slide pour ne pas casser l'animation.
				persistAnswer();
				if (ctx.quizState.isSliding) return;
				ctx.updateNavHighlight();
				ctx.cards.refreshMetaSlides();
				syncLayout();
			};

			textarea.addEventListener("input", commitAnswer);
			textarea.addEventListener("paste", () => requestAnimationFrame(commitAnswer));
			textarea.addEventListener("focus", syncLayout);
			textarea.addEventListener("blur", () => { persistAnswer(); syncLayout(); });
			textarea.addEventListener("keydown", e => {
				if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
					e.preventDefault();
					const checkBtn = trackItem.querySelector(".quiz-textonly-check-btn");
					if (checkBtn) checkBtn.click();
				}
			});
			syncLayout();
		}

		const checkBtn = trackItem.querySelector(".quiz-textonly-check-btn");
		if (checkBtn) {
			checkBtn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const liveTextarea = trackItem.querySelector(".quiz-textonly-textarea[data-textonly-answer]");
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(liveTextarea?.value ?? ctx.quizState.textOnlyAnswers[qi] ?? "");
				ctx.quizState.textOnlyChecked[qi] = true;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		}

		trackItem.querySelectorAll(".quiz-textonly-rating-btn[data-textonly-rating]").forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const rating = normalizeRating(btn.dataset.textonlyRating);
				if (!rating) return;
				ctx.quizState.textOnlyRatings[qi] = rating;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		});
	}

	return {
		RATINGS,
		isTextOnlyMode,
		isExamAnswerPhase,
		isExamReviewPhase,
		normalizeRating,
		getRatingMeta,
		hasAnyAnswer,
		isChecked,
		isRated,
		computeResults,
		getCorrectOptionIndices,
		expectedAnswerHtml,
		learningHtml,
		comparisonOptionsHtml,
		ratingButtonsHtml,
		questionCardBodyHtml,
		questionActionsHtml,
		bindTextOnlyQuestion
	};
};
