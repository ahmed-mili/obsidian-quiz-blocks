'use strict';

module.exports = function createCardRenderers(ctx) {
	// Variables locales
	let __quizSubmitSlideSignature = "";
	let __quizResultsSlideSignature = "";

	function tabClass(i) {
		const cur = ctx.quizState.current;
		const isActive = ctx.isQuestionSlideIndex(cur) && ctx.slideMap[cur]?.questionIndex === i;
		const active = isActive ? "active" : "";
		if (!ctx.hasAnyAnswer(i)) return active;
		if (!ctx.quizState.locked) return `${active} answered`.trim();
		return `${active} ${ctx.isCorrect(i) ? "correct" : "wrong"}`.trim();
	}

	function navHtml() {
		const resultsActive = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
		return `<div class="quiz-nav">${ctx.quiz.map((_, i) => `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}">Q${i + 1}</a>`).join("")}<a class="quiz-tab is-result ${resultsActive}" href="#" data-nav-results="1">Résultats</a></div>`;
	}

	function optionClass(qi, oi) {
		const q = ctx.quiz[qi];
		const sel = ctx.quizState.selections[qi];
		if (q.multiSelect) {
			const selected = sel instanceof Set && sel.has(oi);
			if (!ctx.quizState.locked) return selected ? "selected" : "";
			const correct = q.correctIndices.includes(oi);
			if (selected && correct) return "correct";
			if (selected && !correct) return "wrong";
			if (!selected && correct) return "missed";
			return "";
		}
		const selected = sel === oi;
		if (!ctx.quizState.locked) return selected ? "selected" : "";
		const correct = oi === q.correctIndex;
		if (selected && correct) return "correct";
		if (selected && !correct) return "wrong";
		if (!selected && correct) return "missed";
		return "";
	}

	function explanationHtml(qi) {
		const q = ctx.quiz[qi];
		if (!q) return "";
		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)}</div>`;
		}
		if (q.explain) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.renderTextWithEmbeds(q.explain)}</div>`;
		}
		return "";
	}

	function renderQuizPromptHtml(q) {
		const promptHtml = q.promptHtml || q._promptHtml;
		if (promptHtml) {
			return ctx.sanitize.replaceObsidianEmbedsInHtml(promptHtml);
		}
		if (q.prompt) {
			return ctx.sanitize.renderTextWithEmbeds(q.prompt);
		}
		return "";
	}

	function orderingCardHtml(q, qi) {
		const items = ctx.getOrderingItems(q);
		const sel = ctx.quizState.selections[qi];
		const slotLabels = ctx.getOrderingSlotLabels(q);
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		const shuffled = ctx.quizState.shuffleMap[qi] || [];
		const pick = ctx.quizState.orderingPick[qi];

		const slots = items.map((_, si) => {
			const oi = Array.isArray(sel) ? sel[si] : null;
			const filled = oi !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled) cls += oi === correctOrder[si] ? " correct" : " wrong";

			return `<div class="${cls}" data-order-slot="${si}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-item="${oi}"` : ""}>
				<div class="quiz-slot-label">${slotLabels[si] ?? String(si + 1)}</div>
				<div class="quiz-slot-value">${filled ? ctx.escapeHtmlText(items[oi]) : "Glissez un élément ici"}</div>
			</div>`;
		}).join("");

		const possibilities = shuffled.map(oi => {
			const used = ctx.orderingSelectionIncludes(qi, oi);
			const picked = !used && pick === oi && !ctx.quizState.locked;
			let cls = "quiz-possibility";
			if (used) cls += " used";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-order-item="${oi}" role="button" tabindex="0" ${(!used && !ctx.quizState.locked) ? `draggable="true"` : ""}>
				${ctx.escapeHtmlText(items[oi])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">Classez les éléments dans le bon ordre (glisser-déposer). Déposez un élément sur un emplacement déjà rempli pour échanger automatiquement les positions.</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">Éléments à placer</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	function matchingCardHtml(q, qi) {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		const correctMap = ctx.getMatchCorrectMap(q);
		const sel = ctx.quizState.selections[qi];
		const shuffleData = ctx.quizState.shuffleMap[qi] || {};
		const shuffledRows = Array.isArray(shuffleData.rows) ? shuffleData.rows : [...Array(rows.length).keys()];
		const shuffledChoices = Array.isArray(shuffleData.choices) ? shuffleData.choices : [...Array(choices.length).keys()];
		const pick = ctx.quizState.matchPick[qi];

		const slots = shuffledRows.map(rowIndex => {
			const chosen = Array.isArray(sel) ? sel[rowIndex] : null;
			const filled = chosen !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled && Array.isArray(correctMap) && correctMap.length === rows.length) {
				cls += chosen === correctMap[rowIndex] ? " correct" : " wrong";
			}

			return `<div class="${cls}" data-match-slot="${rowIndex}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-choice="${chosen}"` : ""}>
				<div class="quiz-slot-label">${ctx.escapeHtmlText(rows[rowIndex])}</div>
				<div class="quiz-slot-value">${filled ? ctx.escapeHtmlText(choices[chosen] ?? "Support inconnu") : "Déposez un support ici"}</div>
			</div>`;
		}).join("");

		const possibilities = shuffledChoices.map(ci => {
			const picked = !ctx.quizState.locked && pick === ci;
			let cls = "quiz-possibility";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-match-choice="${ci}" role="button" tabindex="0" ${!ctx.quizState.locked ? `draggable="true"` : ""}>
				${ctx.escapeHtmlText(choices[ci])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">Associez chaque situation à un support (glisser-déposer). Un même support peut être utilisé plusieurs fois.</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">Supports disponibles</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	function submitSlideHtml() {
		const missing = ctx.getMissingIndices();
		const mc = missing.length;
		return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${mc > 0 ? `<div class="quiz-warn">Il manque ${mc} réponse${mc > 1 ? "s" : ""}.</div><div class="quiz-submit-sub">Questions sans réponse :</div>` : `<div class="quiz-submit-sub">Revenir sur une question :</div>`}<div class="quiz-chip-row">${(mc > 0 ? missing : ctx.quiz.map((_, i) => i)).map(i => `<button class="quiz-chip ${mc > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${i + 1}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">Retour</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">Voir le score</button></div></div></div></div>`;
	}

	function resultsSlideHtml() {
		const { pct, correct, total } = ctx.computeScorePercent();
		// Mode learn : bouton "Passer l'examen"
		const learnExamBtn = (ctx.quizMode === "learn" && ctx.learnExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">Passer l'examen</button>`
			: "";
		// Mode examen issu du mode learn : bouton "Repasser l'examen"
		const retakeExamBtn = (ctx.quizMode === "exam" && ctx.originalQuizMode === "learn" && ctx.originalLearnExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">Repasser l'examen</button>`
			: "";
		return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result"><h2 class="quiz-result-title" style="font-weight:900;">Résultats</h2><p style="font-size:48px;font-weight:900;margin:18px 0 6px;">${pct}%</p><p>Bonnes réponses : <strong>${correct}/${total}</strong></p><div class="quiz-actions"><button class="quiz-action-btn success quiz-retry-btn" type="button">Recommencer</button>${learnExamBtn}${retakeExamBtn}</div></section></div>`;
	}


	function refreshMetaSlides({ force = false } = {}) {
		const nextSubmitSignature = ctx.getSubmitSlideSignature();
		const nextResultsSignature = ctx.getResultsSlideSignature();
		const shouldRefreshSubmit = force || nextSubmitSignature !== __quizSubmitSlideSignature;
		const shouldRefreshResults = force || nextResultsSignature !== __quizResultsSlideSignature;
		if (!shouldRefreshSubmit && !shouldRefreshResults) return;

		const refreshMetaSlide = ({ selector, index, html, binder }) => {
			const oldNode = ctx.container.querySelector(selector);
			if (!oldNode) return;
			ctx.viewport.unobserveTrackItemInAllSlidesResizeObserver(oldNode);
			ctx.bumpSlideGeneration(index);
			const tmp = document.createElement("div");
			tmp.innerHTML = html().trim();
			const newNode = tmp.firstElementChild;
			if (!newNode) return;
			oldNode.replaceWith(newNode);
			ctx.viewport.observeTrackItemInAllSlidesResizeObserver(newNode);
			binder(newNode);
		};

		if (shouldRefreshSubmit) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="submit"]',
				index: ctx.SLIDE_SUBMIT_INDEX,
				html: submitSlideHtml,
				binder: ctx.interactions.bindSubmitSlideControls
			});
			__quizSubmitSlideSignature = nextSubmitSignature;
		}
		if (shouldRefreshResults) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="results"]',
				index: ctx.SLIDE_RESULTS_INDEX,
				html: resultsSlideHtml,
				binder: ctx.interactions.bindResultsSlideControls
			});
			__quizResultsSlideSignature = nextResultsSignature;
		}

		ctx.viewport.applyTrackGeometry({ refreshWidth: false });
		ctx.viewport.syncTrackViewportIsolation();
		const { track } = ctx.viewport.getTrackElements();
		if (track && (ctx.quizState.current === ctx.SLIDE_SUBMIT_INDEX || ctx.quizState.current === ctx.SLIDE_RESULTS_INDEX)) {
			track.style.transition = "none";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current));
			ctx.viewport.__quizSlideHeightCache?.delete(ctx.quizState.current);
			ctx.viewport.scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
		}
	}

	function questionCardHtml(qi) {
		const q = ctx.quiz[qi];
		const isTxt = ctx.isTextQuestion(q);
		const isOrd = ctx.isOrderingQuestion(q);
		const isMatch = ctx.isMatchingQuestion(q);
		const isMulti = !!q.multiSelect;

		let body = "";

		if (isTxt) {
			body = ctx.terminal.textQuestionCardHtml(q, qi);
		}
		else if (isOrd) {
			body = orderingCardHtml(q, qi);
		}
		else if (isMatch) {
			body = matchingCardHtml(q, qi);
		}
		else {
			const smap = ctx.quizState.shuffleMap[qi] || [];
			const mi = isMulti ? `<div class="quiz-multi-indicator">Sélectionnez une ou plusieurs réponses</div>` : "";
			const optionsHtml = smap.map((oi) => {
				let optionContentHtml = "";
				if (q.optionHtml?.[oi]) {
					optionContentHtml = q.optionHtml[oi];
					if (typeof ctx.app?.vault?.adapter?.getResourcePath === "function") {
						optionContentHtml = optionContentHtml.replace(/src="([^"]+)"/g, (match, src) => {
							if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("app://")) {
								return match;
							}
							try {
								const resolved = ctx.app.vault.adapter.getResourcePath(src);
								return `src="${ctx.escapeHtmlAttr(resolved)}"`;
							} catch {
								return match;
							}
						});
					}
				} else {
					optionContentHtml = ctx.sanitize.renderRawHtmlWithEmbeds(q.options[oi], { wrapClass: "quiz-option-embed-wrap", imgClass: "quiz-option-embed" });
				}
				return `<div class="quiz-option ${isMulti ? "multi" : ""} ${optionClass(qi, oi)}" role="button" tabindex="0" data-orig="${oi}">${optionContentHtml}</div>`;
			}).join("");
			const hasImg = /<img[\s>]/i.test(optionsHtml);
			body = mi + `<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${optionsHtml}</div>`;
		}

		const hintBtn = (q.hint && String(q.hint).trim()) ? `<button class="quiz-hint-btn" type="button">Indice</button>` : "";
		const learnSection = (ctx.quizMode === "learn" && (q.learn || q.learnHtml || q._learnHtml) && !ctx.quizState.locked)
			? (() => {
				const learnHtml = q.learnHtml || q._learnHtml;
				const learnContent = learnHtml
					? ctx.sanitize.replaceObsidianEmbedsInHtml(learnHtml)
					: ctx.sanitize.renderTextWithEmbeds(q.learn || "");
				return `<div class="quiz-learn-section"><div class="quiz-learn-label">Leçon</div><div class="quiz-learn-content">${learnContent}</div></div>`;
			})()
			: "";
		const sectionIdAttr = (typeof q?.id === "string" && q.id.trim().length > 0)
			? ` id="${ctx.escapeHtmlAttr(q.id)}"`
			: "";

		return `<div class="quiz-track-item" data-slide-kind="question" data-qi="${qi}">
			<section class="quiz-card"${sectionIdAttr}>
				<h2>${ctx.escapeHtmlText(q.title)}</h2>
				${ctx.sanitize.resourceButtonHtml(q)}
				<div class="quiz-question">${renderQuizPromptHtml(q)}</div>
				${body}
				${learnSection}
				${hintBtn}
				${ctx.quizState.locked ? explanationHtml(qi) : ""}
			</section>
		</div>`;
	}

	return {
		tabClass,
		navHtml,
		optionClass,
		explanationHtml,
		renderQuizPromptHtml,
		orderingCardHtml,
		matchingCardHtml,
		submitSlideHtml,
		resultsSlideHtml,
		refreshMetaSlides,
		questionCardHtml
	};
};
