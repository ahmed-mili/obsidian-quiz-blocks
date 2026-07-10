'use strict';

const { parseQuizSource, extractExamOptions, renderParagraph } = require("./quiz-utils");
const createTerminalHandlers = require("./engine/terminal");
const createFocusHandlers = require("./engine/focus");
const createLifecycleHandlers = require("./engine/lifecycle");
const createWarmingHandlers = require("./engine/warming");
const createSanitizer = require("./engine/sanitizer");
const createResourceHandlers = require("./engine/resources");
const createExamHandlers = require("./engine/exam");
const createCardRenderers = require("./engine/cards");
const createViewportHandlers = require("./engine/viewport");
const createTrackHandlers = require("./engine/track");
const createZoomHandlers = require("./engine/zoom");
const createInteractionHandlers = require("./engine/interactions");
const createStateHandlers = require("./engine/state");
const createHintHandlers = require("./engine/hint");
const createQuestionHandlers = require("./engine/questions");
const createTextOnlyHandlers = require("./engine/text-only");
const createResultsSaver = require("./engine/results-save");
const { mathifyElement } = require("./engine/mathjax");

async function renderInteractiveQuiz(context) {

	const {
		app,
		plugin,
		container,
		quiz: rawQuiz,
		sourcePath,
		Notice
	} = context;

	container.empty();

	if (!Array.isArray(rawQuiz) || rawQuiz.length === 0) {
		renderParagraph(container, "⚠️ Aucune question fournie au moteur de quiz.");
		return;
	}

	const { questions: quiz, quizMode, examOptions, learnExamOptions } = extractExamOptions(rawQuiz);

	if (!Array.isArray(quiz) || quiz.length === 0) {
		renderParagraph(container, "⚠️ Aucune question fournie au moteur de quiz.");
		return;
	}

	// Compat : d'anciens quiz générés par l'IA portent la clé `correctIndexes`
	// (au lieu de `correctIndices` lu partout ailleurs). Normaliser à l'ingestion
	// répare le scoring (state.js) et le rendu verrouillé (cards.js) sans réécrire la note.
	for (const q of quiz) {
		if (q && q.correctIndices == null && Array.isArray(q.correctIndexes)) {
			q.correctIndices = q.correctIndexes;
		}
	}

	const isExamMode = examOptions !== null;
	const examDurationMs = isExamMode ? examOptions.durationMinutes * 60 * 1000 : 0;
	let examStartTime = 0;
	let examTimerId = null;
	let examTimeRemaining = examDurationMs;
	let examEnded = false;
	let examStarted = false;

	const QUIZ_INSTANCE_ID = (
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2) + Date.now().toString(36)
	).slice(0, 8);

	const HINT_OVERLAY_ID = `quizHintOverlay_${QUIZ_INSTANCE_ID}`;
	const HINT_TITLE_ID = `quizHintTitle_${QUIZ_INSTANCE_ID}`;
	const __quizGlobalCleanups = [];

	const shuffleArray = arr => {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
	const isOrderingQuestion = q => !!(q && (q.ordering === true || typeof q.ordering === "object"));
	const isMatchingQuestion = q => !!(q && (q.matching === true || typeof q.matching === "object"));
	const isTextQuestion = q => !!(q && (q.type === "text" || q.text === true));

	// Créer le contexte partagé (ctx) pour injection de dépendances
	const originalQuizMode = quizMode;
	const originalLearnExamOptions = learnExamOptions ? { ...learnExamOptions } : null;

	const ctx = {
		app,
		plugin,
		container,
		sourcePath,
		Notice,
		quiz,
		quizMode,
		isExamMode,
		trainingSession: false,
		examOptions,
		examDurationMs,
		learnExamOptions,
		originalQuizMode,
		originalLearnExamOptions,
		get examTimeRemaining() { return examTimeRemaining; },
		set examTimeRemaining(v) { examTimeRemaining = v; },
		get examStarted() { return examStarted; },
		set examStarted(v) { examStarted = v; },
		get examEnded() { return examEnded; },
		set examEnded(v) { examEnded = v; },
		get examStartTime() { return examStartTime; },
		set examStartTime(v) { examStartTime = v; },
		QUIZ_INSTANCE_ID,
		HINT_OVERLAY_ID,
		HINT_TITLE_ID,
		__quizGlobalCleanups,
		shuffleArray,
		clamp,
		isOrderingQuestion,
		isMatchingQuestion,
		isTextQuestion
	};

	// Instancier tous les modules avec ctx injecté
	const sanitizer = createSanitizer(ctx);
	const resources = createResourceHandlers(ctx);
	const exam = createExamHandlers(ctx);
	const textOnly = createTextOnlyHandlers(ctx);
	const cards = createCardRenderers(ctx);
	const viewport = createViewportHandlers(ctx);
	const track = createTrackHandlers(ctx);
	const zoom = createZoomHandlers(ctx);
	const interactions = createInteractionHandlers(ctx);
	const terminal = createTerminalHandlers(ctx);
	const focus = createFocusHandlers(ctx);
	const lifecycle = createLifecycleHandlers(ctx);
	const warming = createWarmingHandlers(ctx);
	const state = createStateHandlers(ctx);
	const hint = createHintHandlers(ctx);
	const questions = createQuestionHandlers(ctx);
	const resultsSaver = createResultsSaver(ctx);

	// Fonctions utilitaires seront définies après les constantes SLIDE_* pour éviter TDZ

	// Attacher les modules à ctx pour référence croisée
	Object.assign(ctx, {
		sanitize: sanitizer,
		resources,
		exam,
		textOnly,
		cards,
		viewport,
		clearNavTabPressState: state.clearNavTabPressState,
		refreshMetaSlides: cards.refreshMetaSlides,
		track,
		zoom,
		interactions,
		terminal,
		focus,
		lifecycle,
		warming,
		state,
		hint,
		questions,
		resultsSaver,
		// Fonctions exposées directement
		escapeHtmlText: sanitizer.escapeHtmlText,
		escapeHtmlAttr: sanitizer.escapeHtmlAttr,
		createPendingAsyncWaiter: lifecycle.createPendingAsyncWaiter,
		resolveAllPendingAsync: lifecycle.resolveAllPendingAsync,
		sleep: lifecycle.sleep,
		nextFrame: lifecycle.nextFrame,
		waitFrames: lifecycle.waitFrames,
		requestQuizIdle: lifecycle.requestQuizIdle,
		restartAsyncLifecycle: lifecycle.restartAsyncLifecycle,
		bumpSlideGeneration: lifecycle.bumpSlideGeneration,
		bumpAllSlideGenerations: lifecycle.bumpAllSlideGenerations,
		warmSlideForAccurateHeight: warming.warmSlideForAccurateHeight,
		warmSlidesAroundIndex: warming.warmSlidesAroundIndex,
		startFullBackgroundWarm: warming.startFullBackgroundWarm,
		bindTrackItemImages: warming.bindTrackItemImages,
		bindAllTrackImages: warming.bindAllTrackImages,
		bindCurrentSlideMediaHeightSync: warming.bindCurrentSlideMediaHeightSync,
		getMaxRenderedSlideHeight: viewport.getMaxRenderedSlideHeight,
		openHintModal: hint.openHintModal,
		closeHintModal: hint.closeHintModal,
		getOrderingItems: questions.getOrderingItems,
		getOrderingCorrectOrder: questions.getOrderingCorrectOrder,
		getOrderingSlotLabels: questions.getOrderingSlotLabels,
		getMatchRows: questions.getMatchRows,
		getMatchChoices: questions.getMatchChoices,
		getMatchCorrectMap: questions.getMatchCorrectMap,
		orderingSelectionIncludes: questions.orderingSelectionIncludes,
		removeOrderingItemFromSlot: questions.removeOrderingItemFromSlot,
		placeOrderingItemInSlot: questions.placeOrderingItemInSlot,
		matchingSelectionIncludes: questions.matchingSelectionIncludes,
		hasAnyAnswer: state.hasAnyAnswer,
		isComplete: state.isComplete,
		getMissingIndices: state.getMissingIndices,
		isCorrect: state.isCorrect,
		computeScorePercent: state.computeScorePercent,
		getSubmitSlideSignature: state.getSubmitSlideSignature,
		getResultsSlideSignature: state.getResultsSlideSignature,
		goToQuestion: state.goToQuestion,
		goToSubmit: state.goToSubmit,
		goToResults: state.goToResults,
		resetQuiz: state.resetQuiz,
		setPracticeMode: state.setPracticeMode,
		goToSlide: state.goToSlide,
		redirectSlide: state.redirectSlide,
		updateNavHighlight: state.updateNavHighlight,
		setSlidingClass: state.setSlidingClass,
		playNavTabPressAndNavigate: state.playNavTabPressAndNavigate,
		clearAllNavTabPressStates: state.clearAllNavTabPressStates,
		setNavTabPressState: state.setNavTabPressState,
		buildNavTabClass: state.buildNavTabClass,
		// Fonction render principale (sera assignée après sa définition pour éviter TDZ)
		render: null
	});


function buildShuffleMap() {
	return quiz.map(q => {
		if (isTextQuestion(q)) return null;

		if (isOrderingQuestion(q)) {
			return shuffleArray([...Array(questions.getOrderingItems(q).length).keys()]);
		}

		if (isMatchingQuestion(q)) {
			return {
				rows: shuffleArray([...Array(questions.getMatchRows(q).length).keys()]),
				choices: shuffleArray([...Array(questions.getMatchChoices(q).length).keys()])
			};
		}

		return shuffleArray([...Array((q.options || []).length).keys()]);
	});
}

function initSelections() {
	return quiz.map(q => {
		if (isTextQuestion(q)) return "";
		if (isOrderingQuestion(q)) return Array(questions.getOrderingItems(q).length).fill(null);
		if (isMatchingQuestion(q)) return Array(questions.getMatchRows(q).length).fill(null);
		if (q.multiSelect) return new Set();
		return null;
	});
}
const initTextOnlyAnswers = () => quiz.map(() => "");
const initTextOnlyChecked = () => quiz.map(() => false);
const initTextOnlyRatings = () => quiz.map(() => null);
const initOrderingPicks = () => quiz.map(() => null);
const initMatchPicks = () => quiz.map(() => null);

// ── Slide Map : index dynamique basé sur le mode ──
function buildSlideMap() {
	const map = [];
	for (let i = 0; i < quiz.length; i++) {
		map.push({ type: "question", questionIndex: i });
	}
	map.push({ type: "submit" });
	map.push({ type: "results" });
	return map;
}

let slideMap = buildSlideMap();
const SLIDE_SUBMIT_INDEX = slideMap.length - 2;
const SLIDE_RESULTS_INDEX = slideMap.length - 1;
const TOTAL_SLIDES = slideMap.length;

const quizState = {
	practiceMode: "qcm",
	selections: initSelections(),
	textOnlyAnswers: initTextOnlyAnswers(),
	textOnlyChecked: initTextOnlyChecked(),
	textOnlyRatings: initTextOnlyRatings(),
	current: 0,
	prevCurrent: 0,
	lastQuestionIndex: 0,
	locked: false,
	pendingResultsLock: false,
	savedResultsPath: null,
	shuffleMap: buildShuffleMap(),
	orderingPick: initOrderingPicks(),
	matchPick: initMatchPicks(),
	isSliding: false,
	slideToken: 0
};

// Ajouter quizState, les constantes et les fonctions utilitaires au contexte AVANT de créer les modules qui en dépendent
ctx.quizState = quizState;
ctx.slideMap = slideMap;
ctx.SLIDE_SUBMIT_INDEX = SLIDE_SUBMIT_INDEX;
ctx.SLIDE_RESULTS_INDEX = SLIDE_RESULTS_INDEX;
ctx.TOTAL_SLIDES = TOTAL_SLIDES;
ctx.initSelections = initSelections;
ctx.initTextOnlyAnswers = initTextOnlyAnswers;
ctx.initTextOnlyChecked = initTextOnlyChecked;
ctx.initTextOnlyRatings = initTextOnlyRatings;
ctx.buildShuffleMap = buildShuffleMap;
ctx.initOrderingPicks = initOrderingPicks;
ctx.initMatchPicks = initMatchPicks;

// Définir les fonctions utilitaires APRÈS les constantes SLIDE_* pour éviter TDZ
const isQuestionSlideIndex = i => slideMap[i]?.type === "question";
const isSubmitSlideIndex = i => slideMap[i]?.type === "submit";
const isResultsSlideIndex = i => slideMap[i]?.type === "results";
const clampSlideIndex = i => Math.max(0, Math.min(TOTAL_SLIDES - 1, i));
const getSlidingWindow = () => ({ from: Math.max(0, Math.min(quizState.prevCurrent, quizState.current)), to: Math.min(TOTAL_SLIDES - 1, Math.max(quizState.prevCurrent, quizState.current)) });
const getSlideIndexForQuestion = qi => {
	for (let si = 0; si < slideMap.length; si++) {
		if (slideMap[si].type === "question" && slideMap[si].questionIndex === qi) return si;
	}
	return -1;
};

// Exposer les fonctions utilitaires dans ctx
ctx.isQuestionSlideIndex = isQuestionSlideIndex;
ctx.isSubmitSlideIndex = isSubmitSlideIndex;
ctx.isResultsSlideIndex = isResultsSlideIndex;
ctx.clampSlideIndex = clampSlideIndex;
ctx.getSlidingWindow = getSlidingWindow;
ctx.getSlideIndexForQuestion = getSlideIndexForQuestion;
ctx.invalidateSavedResults = () => {
	quizState.savedResultsPath = null;
};

if (typeof container.__quizDestroy === "function") {
	try { container.__quizDestroy(); } catch (_) {}
}

let __quizTrackFixBound = false;
let __quizHeightRaf = 0;
let __quizHeightResyncTimer = 0;
let __quizMediaSyncToken = 0;
let __quizPrimeHeightsRaf = 0;
let __quizTrackTransitionFallbackTimer = 0;
let __quizActiveSlideResizeObserver = null;
let __quizAllSlidesResizeObserver = null;
let __quizViewportSettleTimer = 0;
let __quizBackgroundWarmStarted = false;
let __quizViewportResizeObserver = null;
let __quizViewportResizeRaf = 0;
let __quizViewportResizeSettleTimer = 0;
let __quizDestroyed = false;
let __quizAsyncEpoch = 0;
let __quizBackgroundWarmIdleHandle = 0;
let __quizBackgroundWarmIdleType = "";
let __quizBootstrapRaf1 = 0;
let __quizBootstrapRaf2 = 0;
let __quizHintCloseTimer = 0;
let __quizHintOpenRaf1 = 0;
let __quizHintOpenRaf2 = 0;
let __quizHintFocusTimer = 0;
let __quizEnsureVisibleRaf = 0;
let __quizTrackViewportWidth = 0;
let __quizTrackAppliedWidth = 0;
let __quizTrackAppliedSlideCount = 0;
let __quizSubmitSlideSignature = "";
let __quizResultsSlideSignature = "";

const __quizSlideGeneration = Array.from({ length: TOTAL_SLIDES }, () => 0);
const __quizPendingAsyncWaiters = new Set();

// Utiliser les caches du module viewport pour éviter la duplication
const __quizSlideHeightCache = ctx.viewport.__quizSlideHeightCache;
const __quizWarmSlidePromises = ctx.viewport.__quizWarmSlidePromises;



const currentAsyncEpoch = () => __quizAsyncEpoch;
const isQuizInstanceAlive = (epoch = __quizAsyncEpoch) => !__quizDestroyed && epoch === __quizAsyncEpoch;
const getSlideGeneration = index => Number.isFinite(__quizSlideGeneration[index]) ? __quizSlideGeneration[index] : 0;
const isSlideGenerationCurrent = (index, generation) => getSlideGeneration(index) === generation;

function cancelEnsureTrackVisibleRaf() {
	if (__quizEnsureVisibleRaf) {
		cancelAnimationFrame(__quizEnsureVisibleRaf);
		__quizEnsureVisibleRaf = 0;
	}
}

function clearBackgroundWarmIdleHandle() {
	if (!__quizBackgroundWarmIdleHandle) return;
	if (__quizBackgroundWarmIdleType === "idle" && "cancelIdleCallback" in window) {
		try { window.cancelIdleCallback(__quizBackgroundWarmIdleHandle); } catch (_) {}
	} else clearTimeout(__quizBackgroundWarmIdleHandle);
	__quizBackgroundWarmIdleHandle = 0;
	__quizBackgroundWarmIdleType = "";
}

// Exposer les variables et fonctions internes aux modules via ctx
Object.assign(ctx, {
	__quizPendingAsyncWaiters,
	__quizSlideHeightCache,
	__quizWarmSlidePromises,
	__quizSlideGeneration,
	__quizDestroyed,
	__quizAsyncEpoch,
	__quizBackgroundWarmIdleHandle,
	__quizBackgroundWarmIdleType,
	__quizBackgroundWarmStarted,
	__quizBootstrapRaf1,
	__quizBootstrapRaf2,
	__quizMediaSyncToken,
	__quizEnsureVisibleRaf,
	__quizTrackTransitionFallbackTimer,
	__quizHeightRaf,
	__quizHeightResyncTimer,
	__quizPrimeHeightsRaf,
	__quizActiveSlideResizeObserver,
	__quizAllSlidesResizeObserver,
	__quizViewportResizeObserver,
	__quizViewportResizeRaf,
	__quizViewportResizeSettleTimer,
	__quizViewportSettleTimer,
	__quizTrackFixBound,
	clearBackgroundWarmIdleHandle,
	cancelEnsureTrackVisibleRaf,
	currentAsyncEpoch,
	isQuizInstanceAlive,
	isDestroyed: () => !__quizDestroyed,
	getSlideGeneration,
	isSlideGenerationCurrent
});


const alignToDevicePixel = value => {
	const dpr = window.devicePixelRatio || 1;
	return Math.round((Number(value) || 0) * dpr) / dpr;
};

function settleViewportHeightToIndex(index, { animate = true, refresh = true } = {}) {
	const { viewport: vpElement } = viewport.getTrackElements();
	if (!vpElement) return;
	const targetHeight = Math.max(1, viewport.getSlideStableHeight(index, { refresh }) || 0);
	if (!targetHeight) return;
	const currentHeight = Math.max(
		1,
		Math.ceil(parseFloat(vpElement.style.height || "0") || 0),
		Math.ceil(vpElement.getBoundingClientRect().height || 0),
		Math.ceil(vpElement.clientHeight || 0)
	);
	if (Math.abs(currentHeight - targetHeight) <= 1) {
		vpElement.style.transition = "none";
		vpElement.style.height = `${targetHeight}px`;
		vpElement.dataset.quizHeightReady = "1";
		return;
	}
	vpElement.style.transition = animate ? "height 240ms cubic-bezier(0.16, 1, 0.3, 1)" : "none";
	vpElement.style.height = `${targetHeight}px`;
	vpElement.dataset.quizHeightReady = "1";
	if (animate) {
		__quizViewportSettleTimer = window.setTimeout(() => {
			const { viewport: vp } = viewport.getTrackElements();
			if (vp) vp.style.transition = "none";
		}, 280);
	}
}
ctx.settleViewportHeightToIndex = settleViewportHeightToIndex;

function scheduleViewportHeightSync({ delay = 0, index = quizState.current, animate = false, refresh = false } = {}) {
	if (__quizHeightRaf) {
		cancelAnimationFrame(__quizHeightRaf);
		__quizHeightRaf = 0;
	}
	if (__quizHeightResyncTimer) {
		clearTimeout(__quizHeightResyncTimer);
		__quizHeightResyncTimer = 0;
	}
	const run = () => {
		__quizHeightRaf = requestAnimationFrame(() => {
			__quizHeightRaf = 0;
			viewport.syncViewportHeight({ index, animate, refresh });
			if (index === quizState.current) {
				ctx.warming.bindCurrentSlideMediaHeightSync();
				ctx.viewport.bindActiveSlideResizeObserver();
			}
		});
	};
	if (delay > 0) {
		__quizHeightResyncTimer = window.setTimeout(() => {
			__quizHeightResyncTimer = 0;
			run();
		}, delay);
	} else run();
}
ctx.scheduleViewportHeightSync = scheduleViewportHeightSync;

function primeAllSlideHeights({ retries = 8, syncCurrent = true } = {}) {
	const items = viewport.getTrackItems();
	if (items.length === 0) return;
	let zeroCount = 0;
	items.forEach((item, index) => {
		const h = viewport.getElementStableHeight(item);
		if (h > 0) __quizSlideHeightCache.set(index, h);
		else zeroCount++;
	});
	if (syncCurrent) viewport.syncViewportHeight({ index: quizState.current, animate: false, refresh: true });
	if (zeroCount > 0 && retries > 0) {
		__quizPrimeHeightsRaf = requestAnimationFrame(() => {
			__quizPrimeHeightsRaf = 0;
			primeAllSlideHeights({ retries: retries - 1, syncCurrent });
		});
	}
}
ctx.primeAllSlideHeights = primeAllSlideHeights;

function applyTrackPositionAndHeightInstant() {
	const { track } = viewport.getTrackElements();
	if (!track) return false;
	ctx.viewport.syncTrackViewportIsolation();
	viewport.applyTrackGeometry({ refreshWidth: true });
	track.style.transition = "none";
	track.style.willChange = "";
	ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
	const ok = viewport.syncViewportHeight({ index: quizState.current, animate: false, refresh: true });
	ctx.warming.bindCurrentSlideMediaHeightSync();
	ctx.viewport.bindActiveSlideResizeObserver();
	ctx.viewport.syncTrackViewportIsolation();
	return ok;
}
ctx.applyTrackPositionAndHeightInstant = applyTrackPositionAndHeightInstant;

function ensureTrackVisibleAfterLayout(retries = 24, epoch = currentAsyncEpoch()) {
	cancelEnsureTrackVisibleRaf();
	if (!isQuizInstanceAlive(epoch)) return;
	const { track } = viewport.getTrackElements();
	if (!track) return;
	ctx.viewport.syncTrackViewportIsolation();
	viewport.applyTrackGeometry({ refreshWidth: true });
	track.style.transition = "none";
	track.style.willChange = "";
	ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
	const h = viewport.getSlideStableHeight(quizState.current, { refresh: true });
	if (h > 0) {
		viewport.setViewportHeight(h, { animate: false });
		ctx.warming.bindCurrentSlideMediaHeightSync();
		ctx.viewport.bindActiveSlideResizeObserver();
		ctx.viewport.syncTrackViewportIsolation();
		return;
	}
	if (retries <= 0) {
		ctx.viewport.scheduleViewportHeightSync({ index: quizState.current, animate: false, refresh: true });
		return;
	}
	__quizEnsureVisibleRaf = requestAnimationFrame(() => {
		__quizEnsureVisibleRaf = 0;
		ensureTrackVisibleAfterLayout(retries - 1, epoch);
	});
}

// Expose ensureTrackVisibleAfterLayout to ctx for use in bootstrap callbacks
ctx.ensureTrackVisibleAfterLayout = ensureTrackVisibleAfterLayout;

function bindTrackFirstLoadFix() {
	if (__quizTrackFixBound) return;
	__quizTrackFixBound = true;
	const resyncLayout = () => requestAnimationFrame(() => {
		if (__quizDestroyed) return;
		const { track } = viewport.getTrackElements();
		if (track) {
			track.style.transition = "none";
			track.style.willChange = "";
			track.style.backfaceVisibility = "hidden";
			track.style.transformStyle = "preserve-3d";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
		}
		__quizSlideHeightCache.delete(quizState.current);
		primeAllSlideHeights({ retries: 3, syncCurrent: true });
		ctx.viewport.scheduleViewportHeightSync({ index: quizState.current, animate: false, refresh: true });
	});
	if (document.fonts?.ready) {
		const epoch = currentAsyncEpoch();
		document.fonts.ready.then(() => {
			if (!isQuizInstanceAlive(epoch)) return;
			resyncLayout();
			primeAllSlideHeights({ retries: 3, syncCurrent: true });
		}).catch(() => {});
	}
}
ctx.bindTrackFirstLoadFix = bindTrackFirstLoadFix;

// Navigation functions (goToSlide, redirectSlide, goToQuestion, goToSubmit, goToResults, resetQuiz)
// sont fournies par le module state via ctx.state.*

function destroyQuiz() {
	__quizDestroyed = true;
	__quizAsyncEpoch++;

	container.querySelectorAll('.quiz-track-item[data-slide-kind="question"]').forEach(item => {
		if (typeof item.__quizTextQuestionCleanup === "function") {
			try { item.__quizTextQuestionCleanup(); } catch (_) {}
		}
	});

	ctx.hint.closeHintModal();
	ctx.track.clearTrackTransitionFallback();
	ctx.viewport.destroyActiveSlideResizeObserver();
	ctx.viewport.destroyAllSlidesResizeObserver();
	ctx.viewport.destroyViewportResizeObserver();
	clearBackgroundWarmIdleHandle();
	cancelEnsureTrackVisibleRaf();
	ctx.lifecycle.resolveAllPendingAsync(false);

	if (__quizHeightRaf) { cancelAnimationFrame(__quizHeightRaf); __quizHeightRaf = 0; }
	if (__quizHeightResyncTimer) { clearTimeout(__quizHeightResyncTimer); __quizHeightResyncTimer = 0; }
	if (__quizHintCloseTimer) { clearTimeout(__quizHintCloseTimer); __quizHintCloseTimer = 0; }
	if (__quizHintOpenRaf1) { cancelAnimationFrame(__quizHintOpenRaf1); __quizHintOpenRaf1 = 0; }
	if (__quizHintOpenRaf2) { cancelAnimationFrame(__quizHintOpenRaf2); __quizHintOpenRaf2 = 0; }
	if (__quizHintFocusTimer) { clearTimeout(__quizHintFocusTimer); __quizHintFocusTimer = 0; }
	if (__quizBootstrapRaf1) { cancelAnimationFrame(__quizBootstrapRaf1); __quizBootstrapRaf1 = 0; }
	if (__quizBootstrapRaf2) { cancelAnimationFrame(__quizBootstrapRaf2); __quizBootstrapRaf2 = 0; }
	exam.stopExamTimer();

	const hintOverlay = document.getElementById(HINT_OVERLAY_ID);
	if (hintOverlay) {
		try { hintOverlay.remove(); } catch (_) {}
	}

	for (const fn of __quizGlobalCleanups) {
		try { fn(); } catch (_) {}
	}
	__quizGlobalCleanups.length = 0;

	ctx.viewport.__quizSlideHeightCache?.clear();
	ctx.viewport.__quizWarmSlidePromises?.clear();
	__quizBackgroundWarmStarted = false;
	__quizTrackFixBound = false;
	__quizTrackViewportWidth = 0;
	__quizTrackAppliedWidth = 0;
	__quizTrackAppliedSlideCount = 0;
	__quizSubmitSlideSignature = "";
	__quizResultsSlideSignature = "";

	if (container.__quizDestroy === destroyQuiz) delete container.__quizDestroy;
	ctx.interactions.destroyZoomFixHandlers();
}

container.__quizDestroy = destroyQuiz;
ctx.destroyQuiz = destroyQuiz;

function refreshQuestionSlide(qi, { syncHeight = true } = {}) {
	const oldItem = container.querySelector(`.quiz-track-item[data-slide-kind="question"][data-qi="${qi}"]`);
	if (!oldItem) return null;

	if (typeof oldItem.__quizTextQuestionCleanup === "function") {
		try { oldItem.__quizTextQuestionCleanup(); } catch (_) {}
	}

	const focusDescriptor = ctx.focus.getQuestionFocusDescriptor(oldItem);
	const slideIdx = getSlideIndexForQuestion(qi);
	ctx.viewport.unobserveTrackItemInAllSlidesResizeObserver(oldItem);
	if (slideIdx >= 0) ctx.lifecycle.bumpSlideGeneration(slideIdx);

	const tmp = document.createElement("div");
		tmp.innerHTML = ctx.cards.questionCardHtml(qi).trim();
	const newItem = tmp.firstElementChild;
	if (!newItem) return null;

	oldItem.replaceWith(newItem);
	// LaTeX $...$ / $$...$$ : rendu MathJax natif Obsidian (fire-and-forget
	// — les ResizeObservers recalent la hauteur quand la formule arrive).
	mathifyElement(newItem);
	ctx.viewport.applyTrackGeometry({ refreshWidth: false });
	ctx.resources.bindQuizResourceButtons(newItem);
	ctx.warming.bindTrackItemImages(newItem, qi);
	ctx.interactions.bindQuestionTrackItem(newItem);
	ctx.viewport.observeTrackItemInAllSlidesResizeObserver(newItem);
	ctx.state.updateNavHighlight();
	ctx.viewport.syncTrackViewportIsolation();

	const { track } = viewport.getTrackElements();
	if (track) {
		track.style.transition = "none";
		ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
	}

	ctx.focus.restoreQuestionFocus(newItem, focusDescriptor);

	if (syncHeight && slideIdx === quizState.current) {
		requestAnimationFrame(() => {
			if (__quizDestroyed) return;
			__quizSlideHeightCache.delete(slideIdx);
			ctx.warming.bindCurrentSlideMediaHeightSync();
			ctx.viewport.bindActiveSlideResizeObserver();
			ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
		});
	}

	return newItem;
}
ctx.refreshQuestionSlide = refreshQuestionSlide;

function commitQuestionInteraction(qi, { syncHeight = true } = {}) {
	ctx.invalidateSavedResults?.();
	const slideIdx = getSlideIndexForQuestion(qi);
	if (slideIdx >= 0) __quizSlideHeightCache.delete(slideIdx);
	refreshQuestionSlide(qi, { syncHeight });
	refreshMetaSlides();
}
ctx.commitQuestionInteraction = commitQuestionInteraction;

let __quizZoomFixBound = false;
let __quizZoomFixRaf = 0;
let __quizZoomFixSettleTimer = 0;
let __quizZoomLastDpr = window.devicePixelRatio || 1;
let __quizZoomFixHandler = null;

function render() {
    ctx.lifecycle.restartAsyncLifecycle();
    cancelEnsureTrackVisibleRaf();
    container.classList.toggle("quiz-mode-text-only", quizState.practiceMode === "text");
    container.classList.toggle("quiz-mode-qcm", quizState.practiceMode !== "text");
    container.classList.toggle("quiz-is-locked", quizState.locked && quizState.practiceMode !== "text");

    container.querySelectorAll('.quiz-track-item[data-slide-kind="question"]').forEach(item => {
        if (typeof item.__quizTextQuestionCleanup === "function") {
            try { item.__quizTextQuestionCleanup(); } catch (_) {}
        }
    });

    ctx.lifecycle.bumpAllSlideGenerations();
    ctx.viewport.destroyActiveSlideResizeObserver();
    ctx.viewport.destroyAllSlidesResizeObserver();
    ctx.viewport.destroyViewportResizeObserver();
    ctx.track.clearTrackTransitionFallback();

    if (ctx.isExamMode && !ctx.examStarted) {
        // L'examen reste QCM chronométré ; l'entraînement est un mode séparé.
        container.innerHTML = ctx.exam.examTimerHtml();
        ctx.interactions.bindStartModeControls(container);
        ctx.exam.bindExamStartButton();
        return;
    }

    const examChromeHtml = ctx.exam.examTimerHtml();
    const modeToggleHtml = (ctx.isExamMode || ctx.trainingSession) ? "" : ctx.cards.modeToggleHtml();

    // Construire le HTML des slides à partir du slideMap
    const slidesHtml = slideMap.map(entry => {
        if (entry.type === "question") return ctx.cards.questionCardHtml(entry.questionIndex);
        if (entry.type === "submit") return ctx.cards.submitSlideHtml();
        if (entry.type === "results") return ctx.cards.resultsSlideHtml();
        return "";
    }).join("");

    container.innerHTML = `${examChromeHtml}${ctx.cards.navHtml()}${modeToggleHtml}<div class="quiz-track-viewport" data-quiz-height-ready="0"><div class="quiz-track">${slidesHtml}</div></div>`;
    // LaTeX $...$ / $$...$$ de toutes les slides (prompts, options,
    // explications, résultats) : rendu MathJax natif Obsidian.
    mathifyElement(container);
    __quizSubmitSlideSignature = ctx.state.getSubmitSlideSignature();
    __quizResultsSlideSignature = ctx.state.getResultsSlideSignature();

    const { viewport: vp, track } = viewport.getTrackElements();
    bindTrackFirstLoadFix();
    ctx.viewport.bindViewportResizeObserver();
    ctx.interactions.bindZoomFixHandlers();

    if (!track || !vp) return;

    track.style.transition = "none";
    track.style.willChange = "";
    track.style.backfaceVisibility = "hidden";
    track.style.transformStyle = "preserve-3d";

    viewport.applyTrackGeometry({ refreshWidth: true });
    ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));

    vp.style.willChange = "";
    vp.style.transform = "";
    vp.style.opacity = "";

    if (!applyTrackPositionAndHeightInstant()) {
        ensureTrackVisibleAfterLayout(24, currentAsyncEpoch());
    }

    ctx.viewport.bindAllSlidesResizeObserver();
    ctx.warming.bindAllTrackImages();
    ctx.resources.bindQuizResourceButtons(container);
    container.querySelectorAll('.quiz-track-item[data-slide-kind="question"]').forEach(ctx.interactions.bindQuestionTrackItem);
    ctx.interactions.bindStaticControls();

    primeAllSlideHeights({ retries: 6, syncCurrent: true });
    ctx.warming.warmSlidesAroundIndex(quizState.current, 3);
    ctx.warming.startFullBackgroundWarm();
    ctx.state.updateNavHighlight();
    ctx.state.setSlidingClass(quizState.isSliding);

    if (ctx.isExamMode) {
        ctx.exam.startExamTimer();
    }
}

// Assign render function to ctx AFTER it's defined to avoid TDZ
ctx.render = render;

// ── Mode Apprentissage → Examen : transition ──
function switchToExamMode() {
	if (quizMode !== "learn" || !learnExamOptions) return;

	// Changer les flags de mode (le slideMap ne change pas, les learn sections
	// sont intégrées dans les question cards et seront masquées au render)
	ctx.quizMode = "exam";
	ctx.isExamMode = true;
	ctx.trainingSession = false;
	ctx.examOptions = learnExamOptions;
	ctx.examDurationMs = learnExamOptions.durationMinutes * 60 * 1000;
	ctx.examTimeRemaining = ctx.examDurationMs;

	// Reset complet du quiz en mode examen
	ctx.state.resetQuiz();
}

ctx.switchToExamMode = switchToExamMode;

// Assign remaining local functions to ctx
// Navigation functions use ctx.state.*
ctx.clearBackgroundWarmIdleHandle = clearBackgroundWarmIdleHandle;
ctx.cancelEnsureTrackVisibleRaf = cancelEnsureTrackVisibleRaf;
ctx.stopExamTimer = exam.stopExamTimer;
ctx.updateExamTimerDisplay = exam.updateExamTimerDisplay;

render();

const __quizBootstrapEpoch = currentAsyncEpoch();
__quizBootstrapRaf1 = requestAnimationFrame(() => {
	__quizBootstrapRaf1 = 0;
	if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

	__quizBootstrapRaf2 = requestAnimationFrame(async () => {
		__quizBootstrapRaf2 = 0;
		if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

		ctx.viewport.primeAllSlideHeights({ retries: 6, syncCurrent: true });
		ctx.ensureTrackVisibleAfterLayout(24, __quizBootstrapEpoch);
		await ctx.warming.warmSlideForAccurateHeight(quizState.current).catch(() => {});
		if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

		ctx.warming.warmSlidesAroundIndex(quizState.current, 3);
		ctx.warming.startFullBackgroundWarm();
	});
});

}

module.exports = { renderInteractiveQuiz, parseQuizSource, extractExamOptions, renderParagraph };
