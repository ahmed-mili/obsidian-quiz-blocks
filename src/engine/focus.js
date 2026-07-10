'use strict';

module.exports = function createFocusHandlers(ctx) {
	function getQuestionFocusDescriptor(rootEl) {
		const active = document.activeElement;
		if (!rootEl || !active || !rootEl.contains(active)) return null;

		const descriptor = {
			selector: null,
			scrollX: window.scrollX || window.pageXOffset || 0,
			scrollY: window.scrollY || window.pageYOffset || 0
		};

		if (active.matches?.('.quiz-option[data-orig]')) {
			descriptor.selector = `.quiz-option[data-orig="${active.dataset.orig}"]`;
		}
		else if (active.matches?.('[data-order-item]')) {
			descriptor.selector = `[data-order-item="${active.dataset.orderItem}"]`;
		}
		else if (active.matches?.('[data-order-slot]')) {
			descriptor.selector = `[data-order-slot="${active.dataset.orderSlot}"]`;
		}
		else if (active.matches?.('[data-match-choice]')) {
			descriptor.selector = `[data-match-choice="${active.dataset.matchChoice}"]`;
		}
		else if (active.matches?.('[data-match-slot]')) {
			descriptor.selector = `[data-match-slot="${active.dataset.matchSlot}"]`;
		}
		else if (active.matches?.('.quiz-textarea[data-text-answer]')) {
			descriptor.selector = '.quiz-textarea[data-text-answer]';
		}
		else if (active.matches?.('.quiz-textonly-textarea[data-textonly-answer]')) {
			descriptor.selector = '.quiz-textonly-textarea[data-textonly-answer]';
		}
		else if (active.matches?.('.quiz-textonly-check-btn')) {
			descriptor.selector = '.quiz-textonly-check-btn';
		}
		else if (active.matches?.('.quiz-textonly-rating-btn[data-textonly-rating]')) {
			descriptor.selector = `.quiz-textonly-rating-btn[data-textonly-rating="${active.dataset.textonlyRating}"]`;
		}
		else if (active.matches?.('.quiz-hint-btn')) {
			descriptor.selector = '.quiz-hint-btn';
		}
		else if (active.matches?.('.quiz-prev-btn')) {
			descriptor.selector = '.quiz-prev-btn';
		}
		else if (active.matches?.('.quiz-next-btn')) {
			descriptor.selector = '.quiz-next-btn';
		}
		else if (active.matches?.('.quiz-results-btn')) {
			descriptor.selector = '.quiz-results-btn';
		}
		else if (active.matches?.('.quiz-resource-btn')) {
			descriptor.selector = '.quiz-resource-btn';
		}

		return descriptor.selector ? descriptor : null;
	}

	function restoreQuestionFocus(rootEl, descriptor) {
		if (!rootEl || !descriptor?.selector) return;
		requestAnimationFrame(() => {
			if (ctx.__quizDestroyed) return;
			const target = rootEl.querySelector(descriptor.selector);
			if (!target || typeof target.focus !== "function") return;
			try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
			try { window.scrollTo(descriptor.scrollX ?? 0, descriptor.scrollY ?? 0); } catch (_) {}
		});
	}

	function waitForManagedTransitions(entries, fallbackMs, epoch = ctx.currentAsyncEpoch()) {
		const normalized = (entries || []).map(entry => {
			if (!entry) return null;
			if (typeof Element !== "undefined" && entry instanceof Element) return { target: entry, properties: null };
			const target = entry.target || null;
			const properties = Array.isArray(entry.properties) && entry.properties.length > 0 ? new Set(entry.properties) : null;
			return target ? { target, properties } : null;
		}).filter(Boolean);
		if (normalized.length === 0) return Promise.resolve(ctx.isQuizInstanceAlive(epoch));

		let timer = 0;
		const waiter = ctx.createPendingAsyncWaiter(() => timer && clearTimeout(timer));
		const startTime = Date.now();

		const checkDone = () => {
			if (!ctx.isQuizInstanceAlive(epoch)) {
				waiter.resolve(false);
				return;
			}

			const pending = normalized.filter(({ target, properties }) => {
				if (!target || typeof target.getAnimations !== "function") return false;
				return target.getAnimations().some(anim => {
					if (properties && !properties.has(anim.propertyName)) return false;
					return anim.playState === "running";
				});
			});

			if (pending.length === 0) {
				waiter.resolve(true);
				return;
			}

			if (Date.now() - startTime > fallbackMs) {
				waiter.resolve(true);
				return;
			}

			requestAnimationFrame(checkDone);
		};

		timer = window.setTimeout(() => {
			waiter.resolve(ctx.isQuizInstanceAlive(epoch));
		}, fallbackMs);

		checkDone();
		return waiter.promise;
	}

	return {
		getQuestionFocusDescriptor,
		restoreQuestionFocus,
		waitForManagedTransitions
	};
};
