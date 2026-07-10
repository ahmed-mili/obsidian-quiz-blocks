'use strict';

module.exports = function createTrackHandlers(ctx) {
	// Variables locales
	let __quizTrackTransitionFallbackTimer = 0;

	const alignToDevicePixel = (value) => {
		const dpr = window.devicePixelRatio || 1;
		return Math.round((Number(value) || 0) * dpr) / dpr;
	};

	function getSlideTranslateX(index = ctx.quizState.current) {
		const { viewport, track } = ctx.viewport.getTrackElements();
		if (!viewport || !track) return 0;
		return alignToDevicePixel(-(ctx.viewport.getViewportStableWidth() * index));
	}

	function setTrackTransformPx(x) {
		const { track } = ctx.viewport.getTrackElements();
		if (track) track.style.transform = `translate3d(${alignToDevicePixel(x)}px, 0, 0)`;
	}

	function readCurrentTrackTranslateX() {
		const { track } = ctx.viewport.getTrackElements();
		if (!track) return getSlideTranslateX(ctx.quizState.current);
		try {
			const computed = getComputedStyle(track).transform;
			if (!computed || computed === "none") return getSlideTranslateX(ctx.quizState.current);
			const matrix = new DOMMatrix(computed);
			return Number.isFinite(matrix.m41) ? alignToDevicePixel(matrix.m41) : getSlideTranslateX(ctx.quizState.current);
		} catch (_) {
			return getSlideTranslateX(ctx.quizState.current);
		}
	}

	function primeTrackAndViewportForSlideStart(startX, lockedHeight) {
		const { track, viewport } = ctx.viewport.getTrackElements();
		if (!track || !viewport) return;
		ctx.viewport.applyTrackGeometry({ refreshWidth: true });
		const safeHeight = Math.max(1, Math.ceil(lockedHeight));
		track.style.transition = "none";
		track.style.willChange = "transform";
		setTrackTransformPx(startX);
		viewport.style.transition = "none";
		viewport.style.willChange = "height";
		viewport.style.height = `${safeHeight}px`;
		viewport.style.minHeight = `${safeHeight}px`;
		viewport.dataset.quizHeightReady = "1";
		viewport.__quizLockedHeight = safeHeight;
		void track.offsetWidth;
		void viewport.offsetHeight;
	}

	function clearTrackTransitionFallback() {
		if (__quizTrackTransitionFallbackTimer) {
			clearTimeout(__quizTrackTransitionFallbackTimer);
			__quizTrackTransitionFallbackTimer = 0;
		}
	}

	function cancelRunningTrackAnimation() {
		const { track, viewport } = ctx.viewport.getTrackElements();
		clearTrackTransitionFallback();
		const currentX = readCurrentTrackTranslateX();
		const currentHeight = Math.max(
			1,
			Math.ceil(parseFloat(getComputedStyle(viewport || document.body).height) || 0),
			Math.ceil(viewport?.getBoundingClientRect?.().height || 0),
			Math.ceil(viewport?.clientHeight || 0)
		);

		if (track) {
			if (track.__quizTransitionEndHandler) {
				track.removeEventListener("transitionend", track.__quizTransitionEndHandler);
				track.__quizTransitionEndHandler = null;
			}
			try { track.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
			track.style.transition = "none";
			track.style.willChange = "";
			setTrackTransformPx(currentX);
		}
		if (viewport) {
			try { viewport.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
			viewport.style.transition = "none";
			viewport.style.willChange = "";
			viewport.style.height = `${currentHeight}px`;
			viewport.style.minHeight = "";
			viewport.dataset.quizHeightReady = "1";
			delete viewport.dataset.quizGrowDuringSlide;
		}
		ctx.quizState.isSliding = false;
		ctx.setSlidingClass(false);
		return { x: currentX, height: currentHeight };
	}

	function slideDuration(dist) {
		// DEBUG: temporarily disable prefers-reduced-motion check
		// if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
		const d = Math.max(1, Number(dist) || 1);
		return Math.min(1200, 860 + (d - 3) * 90);
	}

	function getTrackEaseForDistance(hops) {
		if (hops <= 1) return "cubic-bezier(0.22, 0.88, 0.24, 1)";
		if (hops <= 3) return "cubic-bezier(0.24, 0.84, 0.22, 1)";
		return "cubic-bezier(0.26, 0.80, 0.20, 1)";
	}

	function finishTrackSlideAnimation(token, targetIndex) {
		if (token !== ctx.quizState.slideToken) return;
		const { track, viewport } = ctx.viewport.getTrackElements();
		const shouldLockResultsNow = ctx.isResultsSlideIndex(targetIndex) && ctx.quizState.pendingResultsLock && !ctx.textOnly?.isTextOnlyMode?.();
		const grewDuringSlide = viewport?.dataset.quizGrowDuringSlide === "1";
		clearTrackTransitionFallback();
		if (track && track.__quizTransitionEndHandler) {
			track.removeEventListener("transitionend", track.__quizTransitionEndHandler);
			track.__quizTransitionEndHandler = null;
		}
		try { track?.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
		try { viewport?.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}

		const finalX = Number.isFinite(track?.__quizTargetX) ? track.__quizTargetX : getSlideTranslateX(targetIndex);
		const refreshedTargetHeight = Math.max(
			1,
			Number(viewport?.__quizTargetHeight) || 0,
			ctx.viewport.getSlideStableHeight(targetIndex, { refresh: true }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(targetIndex)) || 0
		);
		const finalHeight = Math.max(1, Math.ceil(refreshedTargetHeight + 4));

		if (track) {
			track.style.transition = "none";
			track.style.willChange = "";
			setTrackTransformPx(finalX);
		}
		if (viewport) {
			viewport.style.transition = "none";
			viewport.style.willChange = "";
			viewport.style.height = `${finalHeight}px`;
			viewport.style.minHeight = "";
			viewport.dataset.quizHeightReady = "1";
			delete viewport.dataset.quizGrowDuringSlide;
		}
		if (!shouldLockResultsNow) {
			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);
		}
		if (shouldLockResultsNow) {
				ctx.quizState.locked = true;
				ctx.container?.classList?.add("quiz-is-locked");
			}
		if (!ctx.isResultsSlideIndex(targetIndex)) ctx.quizState.pendingResultsLock = false;
		ctx.updateNavHighlight();

		requestAnimationFrame(() => requestAnimationFrame(() => {
			if (token !== ctx.quizState.slideToken || ctx.__quizDestroyed) return;
			ctx.viewport.syncTrackViewportIsolation();
			ctx.settleViewportHeightToIndex(targetIndex, { animate: false, refresh: true });
			ctx.viewport.scheduleViewportHeightSync({ delay: grewDuringSlide ? 180 : 320, index: targetIndex, animate: false, refresh: true });
			ctx.viewport.primeAllSlideHeights({ retries: 2, syncCurrent: false });
			if (shouldLockResultsNow) {
				ctx.quizState.pendingResultsLock = false;
				requestAnimationFrame(() => {
					if (token !== ctx.quizState.slideToken || ctx.__quizDestroyed) return;
					ctx.quizState.isSliding = false;
					ctx.setSlidingClass(false);
					ctx.render();
				});
				return;
			}
			ctx.viewport.bindCurrentSlideMediaHeightSync();
			ctx.viewport.bindActiveSlideResizeObserver();
			ctx.viewport.resyncCommandTextareasOnSlide(targetIndex);
		}));
	}

	function animateTrackToIndex(targetIndex, { fromX = null, fromHeight = null, refreshTargetHeight = true } = {}) {
		const { track, viewport } = ctx.viewport.getTrackElements();
		if (!track || !viewport) {
			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);
			return;
		}
		clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		ctx.viewport.syncTrackViewportIsolation();
		ctx.viewport.applyTrackGeometry({ refreshWidth: true });
		const token = ctx.quizState.slideToken;
		const targetX = getSlideTranslateX(targetIndex);
		const startX = Number.isFinite(fromX) ? alignToDevicePixel(fromX) : readCurrentTrackTranslateX();
		const startHeight = Math.max(
			1,
			Number(fromHeight) || 0,
			ctx.viewport.getSlideStableHeight(ctx.quizState.prevCurrent, { refresh: true }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(ctx.quizState.prevCurrent)) || 0,
			Math.ceil(viewport.getBoundingClientRect().height || 0),
			Math.ceil(viewport.clientHeight || 0)
		);
		const targetHeight = Math.max(
			1,
			ctx.viewport.getSlideStableHeight(targetIndex, { refresh: refreshTargetHeight }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(targetIndex)) || 0,
			startHeight
		);
		const lockedHeight = Math.max(1, Math.ceil(startHeight), Math.ceil(targetHeight), Math.ceil(ctx.getMaxRenderedSlideHeight({ refresh: true, padding: 24 })));
		const deltaPx = Math.abs(targetX - startX);
		const viewportWidth = Math.max(1, viewport.clientWidth || Math.ceil(viewport.getBoundingClientRect().width) || 1);
		const dist = Math.max(1, deltaPx / viewportWidth);
		const dur = slideDuration(dist);
		const trackEase = getTrackEaseForDistance(dist);

		track.__quizTargetX = targetX;
		track.__quizTargetIndex = targetIndex;
		viewport.__quizTargetHeight = targetHeight;
		viewport.__quizLockedHeight = lockedHeight;
		viewport.dataset.quizGrowDuringSlide = "0";

		if (dur <= 0) {
			setTrackTransformPx(targetX);
			ctx.viewport.setViewportHeight(targetHeight, { animate: false });
			viewport.style.minHeight = "";
			finishTrackSlideAnimation(token, targetIndex);
			return;
		}

		primeTrackAndViewportForSlideStart(startX, lockedHeight);
		requestAnimationFrame(() => {
			if (token !== ctx.quizState.slideToken) return;
			const { track: liveTrack, viewport: liveViewport } = ctx.viewport.getTrackElements();
			if (!liveTrack || !liveViewport) return;
			liveViewport.style.transition = "none";
			liveViewport.style.willChange = "height";
			liveViewport.style.height = `${lockedHeight}px`;
			liveViewport.style.minHeight = `${lockedHeight}px`;
			liveViewport.dataset.quizHeightReady = "1";
			liveViewport.__quizLockedHeight = lockedHeight;
			liveTrack.style.transition = `transform ${dur}ms ${trackEase}`;
			setTrackTransformPx(targetX);
		});

		const onEnd = e => {
			if (token !== ctx.quizState.slideToken || e.target !== track || e.propertyName !== "transform") return;
			finishTrackSlideAnimation(token, targetIndex);
		};
		track.__quizTransitionEndHandler = onEnd;
		track.addEventListener("transitionend", onEnd);
		__quizTrackTransitionFallbackTimer = window.setTimeout(() => finishTrackSlideAnimation(token, targetIndex), dur + 160);
	}

	return {
		getSlideTranslateX,
		setTrackTransformPx,
		readCurrentTrackTranslateX,
		primeTrackAndViewportForSlideStart,
		clearTrackTransitionFallback,
		cancelRunningTrackAnimation,
		slideDuration,
		getTrackEaseForDistance,
		finishTrackSlideAnimation,
		animateTrackToIndex
	};
};
