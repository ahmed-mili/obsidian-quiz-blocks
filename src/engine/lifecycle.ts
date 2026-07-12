import type { EngineCtx } from "../types/engine-ctx";

/**
 * Attente asynchrone annulable, liée au cycle de vie de l'instance de quiz.
 * `resolve(value)` est idempotent (garde `settled`), déclenche le cleanup une
 * seule fois puis retire le waiter de `ctx.__quizPendingAsyncWaiters`.
 * `value` est un booléen dans tous les appels réels du moteur
 * (isQuizInstanceAlive(epoch) ou `false` lors d'une annulation en masse).
 */
export interface PendingAsyncWaiter {
	settled: boolean;
	cleanup: (() => void) | null;
	promise: Promise<boolean>;
	resolve(value: boolean): void;
}

export interface LifecycleHandlers {
	restartAsyncLifecycle(): void;
	bumpSlideGeneration(index: number): void;
	bumpAllSlideGenerations(): void;
	createPendingAsyncWaiter(cleanup?: (() => void) | null): PendingAsyncWaiter;
	resolveAllPendingAsync(value?: boolean): void;
	sleep(ms: number, epoch?: number): Promise<boolean>;
	nextFrame(epoch?: number): Promise<boolean>;
	waitFrames(count?: number, epoch?: number): Promise<boolean>;
	requestQuizIdle(timeout?: number, epoch?: number): Promise<boolean>;
}

export function createLifecycleHandlers(ctx: EngineCtx): LifecycleHandlers {
	function restartAsyncLifecycle(): void {
		ctx.__quizAsyncEpoch++;
		ctx.resolveAllPendingAsync(false);
		ctx.clearBackgroundWarmIdleHandle();
		ctx.cancelEnsureTrackVisibleRaf();

		if (ctx.__quizBootstrapRaf1) {
			cancelAnimationFrame(ctx.__quizBootstrapRaf1);
			ctx.__quizBootstrapRaf1 = 0;
		}
		if (ctx.__quizBootstrapRaf2) {
			cancelAnimationFrame(ctx.__quizBootstrapRaf2);
			ctx.__quizBootstrapRaf2 = 0;
		}

		ctx.__quizBackgroundWarmStarted = false;
		ctx.__quizWarmSlidePromises.clear();
	}

	function bumpSlideGeneration(index: number): void {
		if (Number.isFinite(ctx.__quizSlideGeneration[index])) ctx.__quizSlideGeneration[index]++;
	}

	function bumpAllSlideGenerations(): void {
		for (let i = 0; i < ctx.__quizSlideGeneration.length; i++) ctx.__quizSlideGeneration[i]++;
	}

	function createPendingAsyncWaiter(cleanup: (() => void) | null = null): PendingAsyncWaiter {
		// Iso-fonctionnel avec la version JS (waiter.promise/_resolve en deux
		// temps) : l'executor du Promise s'exécute SYNCHRONE, donc `_resolve` est
		// affecté avant tout usage. `_resolve` était une propriété privée jamais
		// lue à l'extérieur — la transformer en variable de closure ne change rien
		// au comportement (même ordre, mêmes valeurs), et évite le pattern
		// `promise: null` puis réassignation refusé en strict null-checks.
		let _resolve!: (value: boolean) => void;
		const waiter: PendingAsyncWaiter = {
			settled: false,
			cleanup,
			promise: new Promise<boolean>(resolve => { _resolve = resolve; }),
			resolve(value: boolean): void {
				if (waiter.settled) return;
				waiter.settled = true;
				try { waiter.cleanup?.(); } catch (_) { /* le cleanup ne doit jamais faire échouer resolve */ }
				ctx.__quizPendingAsyncWaiters.delete(waiter);
				_resolve(value);
			}
		};
		ctx.__quizPendingAsyncWaiters.add(waiter);
		return waiter;
	}

	function resolveAllPendingAsync(value: boolean = false): void {
		for (const waiter of [...ctx.__quizPendingAsyncWaiters]) {
			try { waiter.resolve(value); } catch (_) { /* idempotent : une résolution déjà faite ne doit pas propager */ }
		}
	}

	async function sleep(ms: number, epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		let timer = 0;
		const waiter = createPendingAsyncWaiter(() => timer && clearTimeout(timer));
		timer = window.setTimeout(() => waiter.resolve(ctx.isQuizInstanceAlive(epoch)), Math.max(0, Number(ms) || 0));
		return waiter.promise;
	}

	function nextFrame(epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		let raf = 0;
		const waiter = createPendingAsyncWaiter(() => raf && cancelAnimationFrame(raf));
		raf = requestAnimationFrame(() => waiter.resolve(ctx.isQuizInstanceAlive(epoch)));
		return waiter.promise;
	}

	async function waitFrames(count: number = 1, epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		for (let i = 0; i < count; i++) {
			const alive = await nextFrame(epoch);
			if (!alive) return false;
		}
		return ctx.isQuizInstanceAlive(epoch);
	}

	function requestQuizIdle(timeout: number = 500, epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		const waiter = createPendingAsyncWaiter(() => ctx.clearBackgroundWarmIdleHandle());
		// `requestIdleCallback` est déclaré requis sur Window : le garde `'... ' in
		// window` réduirait la branche négative à `never` (plus de setTimeout). On
		// appelle donc les méthodes via un alias non narrowé (même objet `window`,
		// runtime strictement identique) tout en gardant le test de présence réel.
		const w: Window & typeof globalThis = window;
		if ('requestIdleCallback' in window) {
			ctx.__quizBackgroundWarmIdleType = 'idle';
			ctx.__quizBackgroundWarmIdleHandle = w.requestIdleCallback(() => {
				ctx.__quizBackgroundWarmIdleHandle = 0;
				ctx.__quizBackgroundWarmIdleType = '';
				waiter.resolve(ctx.isQuizInstanceAlive(epoch));
			}, { timeout });
			return waiter.promise;
		}
		ctx.__quizBackgroundWarmIdleType = 'timeout';
		ctx.__quizBackgroundWarmIdleHandle = w.setTimeout(() => {
			ctx.__quizBackgroundWarmIdleHandle = 0;
			ctx.__quizBackgroundWarmIdleType = '';
			waiter.resolve(ctx.isQuizInstanceAlive(epoch));
		}, Math.min(timeout, 80));
		return waiter.promise;
	}

	return {
		restartAsyncLifecycle,
		bumpSlideGeneration,
		bumpAllSlideGenerations,
		createPendingAsyncWaiter,
		resolveAllPendingAsync,
		sleep,
		nextFrame,
		waitFrames,
		requestQuizIdle
	};
}
