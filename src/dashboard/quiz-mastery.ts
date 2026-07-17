import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";

/* ══════════════════════════════════════════════════════════
   QUIZ MASTERY — seuil de maîtrise, foyer NEUTRE et unique.
   Autrefois dans l'ancien arbre à chemins bruts ; déplacé ici lors
   de son retrait, pour que recent/type/modules puissent le partager
   sans dépendre d'un module mort. Ne jamais réécrire « 80 » ailleurs.
══════════════════════════════════════════════════════════ */

/** Seuil de maîtrise, en % du meilleur score. Source unique. */
export const MASTERY_THRESHOLD = 80;

/** Un quiz est maîtrisé si son meilleur score atteint le seuil.
    Indexation défensive : une entrée peut manquer (jamais joué). */
export function isMastered(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): boolean {
	const s = stats[quiz.path];
	return !!s && s.bestScore >= MASTERY_THRESHOLD;
}
