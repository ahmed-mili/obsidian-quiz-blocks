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

/** État de progression d'un quiz (4 valeurs, identifiants stables — jamais
    traduits ici, cf. quiz-card.ts pour le libellé/icône par état). */
export type QuizStateKey = "mastered" | "review" | "progress" | "fresh";

export interface QuizStateInfo {
	state: QuizStateKey;
	/** % de complétion (questionsDone/total), pertinent surtout pour "progress". */
	pct: number;
}

/** Calcule l'état d'un quiz (mastered/review/progress/fresh) + son % de
    complétion — SOURCE UNIQUE, partagée par la pastille d'état de la carte
    (quiz-card.ts) et l'agrégat « Progrès » du drill-down (quizzes-render.ts) :
    mêmes seuils partout, jamais deux implémentations qui pourraient diverger. */
export function computeQuizState(quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined): QuizStateInfo {
	const total = quiz.questions || (stats && stats.totalQuestions) || 0;
	const done = stats ? stats.questionsDone : 0;
	const best = stats ? stats.bestScore : 0;
	const pct = total > 0 ? Math.round(done / total * 100) : 0;

	if (stats && total > 0 && done >= total) {
		return { state: best >= MASTERY_THRESHOLD ? "mastered" : "review", pct };
	}
	if (done > 0) return { state: "progress", pct };
	return { state: "fresh", pct };
}
