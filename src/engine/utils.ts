/**
 * Utilitaires généraux pour le moteur de quiz
 * Fonctions pures sans dépendances au contexte
 */

function firstArray<T = unknown>(...candidates: unknown[]): T[] {
	for (const c of candidates) if (Array.isArray(c)) return c as T[];
	return [];
}

function sleep(ms?: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function nextFrame(): Promise<number> {
	return new Promise(resolve => requestAnimationFrame(resolve));
}

async function waitFrames(count = 1): Promise<boolean> {
	for (let i = 0; i < count; i++) await nextFrame();
	return true;
}

export { firstArray, sleep, nextFrame, waitFrames };
