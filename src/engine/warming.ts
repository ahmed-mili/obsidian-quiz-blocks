import type { EngineCtx } from "../types/engine-ctx";

export interface WarmingHandlers {
	decodeImageSafe(img: HTMLImageElement | null): Promise<void>;
	warmSlideForAccurateHeight(index: number, opts?: { timeoutMs?: number; stableFramesRequired?: number; maxFrames?: number }): Promise<unknown>;
	warmSlidesAroundIndex(center: number, radius?: number): void;
	startFullBackgroundWarm(): Promise<void>;
	bindTrackItemImages(slide: Element | null, slideIndex: number): void;
	bindAllTrackImages(): void;
	bindCurrentSlideMediaHeightSync(): void;
}

export function createWarmingHandlers(ctx: EngineCtx): WarmingHandlers {
	async function decodeImageSafe(img: HTMLImageElement | null): Promise<void> {
		if (!img) return;
		try { img.loading = 'eager'; img.decoding = 'async'; } catch (_) {}
		if (img.complete) {
			if (typeof img.decode === 'function') {
				try { await img.decode(); } catch (_) {}
			}
			return;
		}
		await new Promise<void>(resolve => {
			const done = () => resolve();
			img.addEventListener('load', done, { once: true });
			img.addEventListener('error', done, { once: true });
		});
	}

	async function warmSlideForAccurateHeight(index: number, { timeoutMs = 1200, stableFramesRequired = 3, maxFrames = 32 }: { timeoutMs?: number; stableFramesRequired?: number; maxFrames?: number } = {}): Promise<unknown> {
		if (index < 0 || index >= ctx.TOTAL_SLIDES) return;
		const existing = ctx.__quizWarmSlidePromises.get(index);
		if (existing) return existing;
		const epoch = ctx.currentAsyncEpoch();
		const generation = ctx.getSlideGeneration(index);

		const p = (async () => {
			if (!ctx.isQuizInstanceAlive(epoch) || !ctx.isSlideGenerationCurrent(index, generation)) return;
			const item = ctx.viewport.getTrackItem(index);
			if (!item) return;
			const imgs = Array.from(item.querySelectorAll<HTMLImageElement>('img'));
			for (const img of imgs) {
				try {
					img.loading = 'eager';
					img.decoding = 'async';
					img.fetchPriority = 'high';
				} catch (_) {}
			}
			await Promise.race([
				Promise.allSettled(imgs.map(img => decodeImageSafe(img))),
				ctx.lifecycle.sleep(timeoutMs, epoch)
			]);
			if (!ctx.isQuizInstanceAlive(epoch) || !ctx.isSlideGenerationCurrent(index, generation)) return;
			let last = 0;
			let stableCount = 0;
			for (let frame = 0; frame < maxFrames; frame++) {
				const alive = await ctx.lifecycle.nextFrame(epoch);
				if (!alive || !ctx.isQuizInstanceAlive(epoch) || !ctx.isSlideGenerationCurrent(index, generation)) return;
				const h = ctx.viewport.getElementStableHeight(item);
				if (h > 0 && ctx.isSlideGenerationCurrent(index, generation)) ctx.__quizSlideHeightCache.set(index, h);
				if (h > 0 && Math.abs(h - last) <= 1) stableCount++;
				else stableCount = 0;
				last = h;
				if (stableCount >= stableFramesRequired) break;
			}
			if (!ctx.isQuizInstanceAlive(epoch) || !ctx.isSlideGenerationCurrent(index, generation)) return;
			if (index === ctx.quizState.current) ctx.viewport.scheduleViewportHeightSync({ index, animate: false, refresh: true });
		})();

		ctx.__quizWarmSlidePromises.set(index, p);
		try { await p; } finally {
			if (ctx.__quizWarmSlidePromises.get(index) === p) ctx.__quizWarmSlidePromises.delete(index);
		}
	}

	function warmSlidesAroundIndex(center: number, radius: number = 2): void {
		for (let offset = 0; offset <= radius; offset++) {
			const left = center - offset;
			const right = center + offset;
			if (left >= 0) warmSlideForAccurateHeight(left).catch(() => {});
			if (right < ctx.TOTAL_SLIDES && right !== left) warmSlideForAccurateHeight(right).catch(() => {});
		}
	}

	async function startFullBackgroundWarm(): Promise<void> {
		if (ctx.__quizBackgroundWarmStarted) return;
		ctx.__quizBackgroundWarmStarted = true;
		const epoch = ctx.currentAsyncEpoch();
		const run = async () => {
			await ctx.lifecycle.waitFrames(2);
			if (!ctx.isQuizInstanceAlive(epoch)) return;
			const total = ctx.TOTAL_SLIDES;
			const center = ctx.clamp(ctx.quizState.current, 0, total - 1);
			const nearRadius = Math.min(4, Math.max(2, total - 1));
			const seen = new Set<number>();
			const near: number[] = [];
			for (let offset = 0; offset <= nearRadius; offset++) {
				const right = center + offset;
				const left = center - offset;
				if (right >= 0 && right < total && !seen.has(right)) { seen.add(right); near.push(right); }
				if (left >= 0 && left < total && !seen.has(left)) { seen.add(left); near.push(left); }
			}
			const rest = [...Array(total).keys()].filter(i => !seen.has(i)).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
			for (const i of near) {
				if (!ctx.isQuizInstanceAlive(epoch)) return;
				await warmSlideForAccurateHeight(i, { timeoutMs: 700, stableFramesRequired: 2, maxFrames: 12 }).catch(() => {});
			}
			for (const i of rest) {
				if (!ctx.isQuizInstanceAlive(epoch)) return;
				const idleOk = await ctx.lifecycle.requestQuizIdle(600, epoch);
				if (!idleOk || !ctx.isQuizInstanceAlive(epoch)) return;
				await warmSlideForAccurateHeight(i, { timeoutMs: 500, stableFramesRequired: 2, maxFrames: 8 }).catch(() => {});
			}
			if (!ctx.isQuizInstanceAlive(epoch)) return;
			ctx.viewport.primeAllSlideHeights({ retries: 2, syncCurrent: true });
		};
		run();
	}

	function bindTrackItemImages(slide: Element | null, slideIndex: number): void {
		if (!slide) return;
		const generation = ctx.getSlideGeneration(slideIndex);
		slide.querySelectorAll<HTMLImageElement>('img').forEach(img => {
			if (img.dataset.quizPrimeBound === '1') return;
			img.dataset.quizPrimeBound = '1';
			try {
				img.loading = 'eager';
				img.decoding = 'async';
				img.fetchPriority = 'high';
			} catch (_) {}
			const onAssetSettled = () => {
				if (ctx.__quizDestroyed || !ctx.isSlideGenerationCurrent(slideIndex, generation)) return;
				ctx.__quizSlideHeightCache.delete(slideIndex);
				ctx.viewport.primeAllSlideHeights({ retries: 2, syncCurrent: slideIndex === ctx.quizState.current });
				if (slideIndex === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIndex, animate: false, refresh: true });
				}
			};
			img.addEventListener('load', onAssetSettled, { passive: true });
			img.addEventListener('error', onAssetSettled, { passive: true });
			if (img.complete) {
				if (typeof img.decode === 'function') img.decode().then(onAssetSettled).catch(onAssetSettled);
				else onAssetSettled();
			}
		});
	}

	function bindAllTrackImages(): void {
		const { track } = ctx.viewport.getTrackElements();
		if (!track) return;
		Array.from(track.children || []).forEach((slide, slideIndex) => bindTrackItemImages(slide, slideIndex));
	}

	function bindCurrentSlideMediaHeightSync(): void {
		const index = ctx.quizState.current;
		const item = ctx.viewport.getTrackItem(index);
		if (!item) return;
		const token = ++ctx.__quizMediaSyncToken;
		const generation = ctx.getSlideGeneration(index);
		item.querySelectorAll<HTMLImageElement>('img').forEach(img => {
			if (img.dataset.quizHeightBound === '1') return;
			img.dataset.quizHeightBound = '1';
			const resync = () => {
				if (token !== ctx.__quizMediaSyncToken || !ctx.isSlideGenerationCurrent(index, generation)) return;
				ctx.__quizSlideHeightCache.delete(index);
				ctx.viewport.scheduleViewportHeightSync({ index, animate: false, refresh: true });
			};
			img.addEventListener('load', resync, { once: true });
			img.addEventListener('error', resync, { once: true });
			if (img.complete) {
				if (typeof img.decode === 'function') img.decode().then(resync).catch(resync);
				else resync();
			}
		});
	}

	return {
		decodeImageSafe,
		warmSlideForAccurateHeight,
		warmSlidesAroundIndex,
		startFullBackgroundWarm,
		bindTrackItemImages,
		bindAllTrackImages,
		bindCurrentSlideMediaHeightSync
	};
}
