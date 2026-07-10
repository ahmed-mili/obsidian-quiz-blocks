'use strict';

module.exports = function createResultsSaver(ctx) {
	const RESULTS_DIR = ".obsidian/quiz-blocks-results";

	function normalizeSpace(value) {
		return String(value ?? "").replace(/\s+/g, " ").trim();
	}

	function htmlToText(html) {
		if (!html) return "";
		if (typeof document !== "undefined" && document.createElement) {
			const el = document.createElement("div");
			el.innerHTML = String(html);
			return normalizeSpace(el.textContent || "");
		}
		return normalizeSpace(String(html).replace(/<[^>]*>/g, " "));
	}

	function markdownLikeToText(value) {
		return normalizeSpace(String(value ?? "")
			.replace(/!\[\[([^\]]+)\]\]/g, "$1")
			.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, page, label) => label || page)
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[`*_>#-]+/g, " "));
	}

	function firstText(...values) {
		for (const value of values) {
			if (value === null || value === undefined) continue;
			const text = typeof value === "string" && /<[^>]+>/.test(value)
				? htmlToText(value)
				: markdownLikeToText(value);
			if (text) return text;
		}
		return "";
	}

	function slugify(value) {
		const slug = String(value ?? "quiz")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80);
		return slug || "quiz";
	}

	function pad(n) {
		return String(n).padStart(2, "0");
	}

	function formatLocalTimestamp(date = new Date()) {
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
	}

	function sourceBaseName() {
		const sourcePath = String(ctx.sourcePath || "quiz");
		const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
		return fileName.replace(/\.[^.]+$/, "") || "quiz";
	}

	function getQuestionKind(q) {
		if (ctx.isTextQuestion(q)) return "text";
		if (ctx.isOrderingQuestion(q)) return "ordering";
		if (ctx.isMatchingQuestion(q)) return "matching";
		if (q?.multiSelect) return "multiple-choice";
		return "single-choice";
	}

	function getQuestionPromptText(q) {
		return firstText(q?.prompt, q?.promptHtml, q?._promptHtml);
	}

	function getLearnText(q) {
		return firstText(q?.learn, q?.learnHtml, q?._learnHtml);
	}

	function getExplanationText(q) {
		return firstText(q?.explain, q?.explainHtml, q?._explainHtml);
	}

	function optionEntry(q, index) {
		const options = Array.isArray(q?.options) ? q.options : [];
		const optionHtml = Array.isArray(q?.optionHtml) ? q.optionHtml[index] : null;
		const text = firstText(options[index], optionHtml);
		return {
			index,
			text: text || `Option ${index + 1}`
		};
	}

	function optionEntries(q, indices) {
		return indices
			.filter(index => Number.isInteger(index) && index >= 0)
			.map(index => optionEntry(q, index));
	}

	function getCorrectOptionIndices(q) {
		if (ctx.textOnly?.getCorrectOptionIndices) return ctx.textOnly.getCorrectOptionIndices(q);
		if (q?.multiSelect && Array.isArray(q.correctIndices)) return q.correctIndices.map(Number).filter(Number.isInteger);
		const index = Number(q?.correctIndex);
		return Number.isInteger(index) ? [index] : [];
	}

	function buildTextQuestionResult(q, qi) {
		const userAnswer = typeof ctx.quizState.selections?.[qi] === "string" ? ctx.quizState.selections[qi] : "";
		const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
		return {
			userAnswer,
			acceptedAnswers,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildOrderingResult(q, qi) {
		const items = ctx.getOrderingItems(q);
		const selected = Array.isArray(ctx.quizState.selections?.[qi]) ? ctx.quizState.selections[qi] : [];
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		return {
			userOrder: selected.map(index => ({
				index,
				text: Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			correctOrder: correctOrder.map(index => ({
				index,
				text: Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildMatchingResult(q, qi) {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		const selected = Array.isArray(ctx.quizState.selections?.[qi]) ? ctx.quizState.selections[qi] : [];
		const correctMap = ctx.getMatchCorrectMap(q);
		return {
			userMatches: rows.map((row, i) => {
				const choiceIndex = selected[i];
				return {
					row,
					choiceIndex,
					choice: Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			correctMatches: rows.map((row, i) => {
				const choiceIndex = Array.isArray(correctMap) ? correctMap[i] : null;
				return {
					row,
					choiceIndex,
					choice: Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildChoiceResult(q, qi) {
		const selected = ctx.quizState.selections?.[qi];
		const correctIndices = getCorrectOptionIndices(q);
		if (q?.multiSelect) {
			const selectedIndices = selected instanceof Set ? Array.from(selected) : [];
			return {
				selectedAnswers: optionEntries(q, selectedIndices),
				correctAnswers: optionEntries(q, correctIndices),
				isCorrect: !!ctx.isCorrect?.(qi)
			};
		}

		const selectedIndex = Number.isInteger(selected) ? selected : null;
		return {
			selectedAnswer: selectedIndex === null ? null : optionEntry(q, selectedIndex),
			correctAnswer: correctIndices.length ? optionEntry(q, correctIndices[0]) : null,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildQcmAnswer(q, qi) {
		if (ctx.isTextQuestion(q)) return buildTextQuestionResult(q, qi);
		if (ctx.isOrderingQuestion(q)) return buildOrderingResult(q, qi);
		if (ctx.isMatchingQuestion(q)) return buildMatchingResult(q, qi);
		return buildChoiceResult(q, qi);
	}

	function buildTextOnlyAnswer(q, qi) {
		const rating = ctx.textOnly?.normalizeRating?.(ctx.quizState.textOnlyRatings?.[qi]) || null;
		const ratingMeta = ctx.textOnly?.getRatingMeta?.(rating);
		return {
			freeTextAnswer: String(ctx.quizState.textOnlyAnswers?.[qi] ?? ""),
			checked: !!ctx.textOnly?.isChecked?.(qi),
			selfEvaluation: rating ? {
				value: rating,
				label: ratingMeta?.label || rating
			} : null,
			expectedAnswers: buildExpectedAnswers(q)
		};
	}

	function buildExpectedAnswers(q) {
		if (ctx.isTextQuestion(q)) {
			const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
			return acceptedAnswers.map((text, index) => ({ index, text: String(text) }));
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			return ctx.getOrderingCorrectOrder(q).map((index, orderIndex) => ({
				orderIndex,
				index,
				text: String(items[index] ?? "")
			}));
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const correctMap = ctx.getMatchCorrectMap(q);
			return rows.map((row, index) => {
				const choiceIndex = Array.isArray(correctMap) ? correctMap[index] : null;
				return {
					row,
					choiceIndex,
					text: Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			});
		}

		return optionEntries(q, getCorrectOptionIndices(q));
	}

	function buildQuestionResult(q, qi, mode) {
		return {
			index: qi + 1,
			id: q?.id || null,
			title: q?.title || `Question ${qi + 1}`,
			kind: getQuestionKind(q),
			promptText: getQuestionPromptText(q),
			answer: mode === "training" ? buildTextOnlyAnswer(q, qi) : buildQcmAnswer(q, qi),
			learnText: getLearnText(q),
			explanationText: getExplanationText(q)
		};
	}

	function buildSummary(mode) {
		if (mode === "training") {
			return {
				mode,
				...ctx.textOnly.computeResults()
			};
		}

		const score = ctx.computeScorePercent();
		let answered = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (ctx.hasAnyAnswer(i)) answered++;
		}
		return {
			mode,
			...score,
			answered
		};
	}

	function buildPayload() {
		const mode = ctx.textOnly?.isTextOnlyMode?.() ? "training" : "qcm";
		const now = new Date();
		const elapsedMs = ctx.examStartTime ? Math.max(0, Date.now() - ctx.examStartTime) : null;

		return {
			schemaVersion: 1,
			plugin: "quiz-blocks",
			savedAt: now.toISOString(),
			sourcePath: ctx.sourcePath || null,
			quizMode: ctx.quizMode,
			practiceMode: mode,
			quizTitle: sourceBaseName(),
			exam: {
				enabled: !!ctx.isExamMode,
				started: !!ctx.examStarted,
				ended: !!ctx.examEnded,
				durationMinutes: ctx.examOptions?.durationMinutes ?? null,
				elapsedSeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000),
				remainingSeconds: Number.isFinite(ctx.examTimeRemaining) ? Math.round(ctx.examTimeRemaining / 1000) : null
			},
			summary: buildSummary(mode),
			questions: ctx.quiz.map((q, i) => buildQuestionResult(q, i, mode))
		};
	}

	async function ensureFolder(adapter, folderPath) {
		const parts = folderPath.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	async function uniquePath(adapter, basePath, ext) {
		let path = `${basePath}.${ext}`;
		let counter = 2;
		while (await adapter.exists(path)) {
			path = `${basePath}-${counter}.${ext}`;
			counter++;
		}
		return path;
	}

	async function saveCurrentResults() {
		const adapter = ctx.app?.vault?.adapter;
		if (!adapter || typeof adapter.write !== "function") {
			throw new Error("Impossible d'accéder au stockage du vault.");
		}

		await ensureFolder(adapter, RESULTS_DIR);

		const payload = buildPayload();
		const timestamp = formatLocalTimestamp(new Date());
		const fileBase = `${RESULTS_DIR}/${timestamp}_${slugify(sourceBaseName())}_${payload.practiceMode}`;
		const path = await uniquePath(adapter, fileBase, "json");
		const json = `${JSON.stringify(payload, null, 2)}\n`;

		await adapter.write(path, json);
		try {
			await adapter.write(`${RESULTS_DIR}/latest.json`, `${JSON.stringify({ ...payload, savedResultPath: path }, null, 2)}\n`);
		} catch (_) {}

		return {
			path,
			absolutePath: ctx.app?.vault?.adapter?.basePath ? `${ctx.app.vault.adapter.basePath}\\${path.replace(/\//g, "\\")}` : path
		};
	}

	return {
		RESULTS_DIR,
		buildPayload,
		saveCurrentResults
	};
};
