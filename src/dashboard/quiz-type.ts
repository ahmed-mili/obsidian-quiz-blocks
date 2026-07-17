import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { MASTERY_THRESHOLD } from "./quiz-mastery";

/* ══════════════════════════════════════════════════════════
   QUIZ TYPE — regroupement des quiz par TYPE
   Troisième axe de « Mes quiz » (à côté de quiz-modules.ts, par
   module/UE, et quiz-recent.ts, par activité) : un groupe par
   QuizTypeTag, dans l'ORDRE FIXE de déclaration du type — JAMAIS
   trié par nombre : les comptes dépendent du filtre actif, un tri
   par volume ferait sauter l'ordre à chaque clic de pastille.
   Module PUR comme les deux autres : pas de DOM, pas de t()
   (les libellés sont ceux, déjà existants, de quiz-card.ts).
══════════════════════════════════════════════════════════ */

/** Ordre fixe = ordre de déclaration de QuizTypeTag (scanner.ts). */
const TYPE_ORDER: QuizTypeTag[] = ["mixed", "single", "multiple", "text", "ordering", "matching"];

export interface TypeGroup {
	type: QuizTypeTag;
	/** Quiz du groupe — un quiz n'a qu'un seul quizType, aucun doublon possible
	 *  entre groupes : la somme des groupes égale toujours quizzes.length. */
	quizzes: QuizIndexEntry[];
	total: number;
	/** Quiz du groupe dont bestScore >= MASTERY_THRESHOLD. */
	mastered: number;
}

function isMastered(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): boolean {
	const s = stats[quiz.path];
	return !!s && s.bestScore >= MASTERY_THRESHOLD;
}

/**
 * Construit les groupes de type à partir des quiz DÉJÀ FILTRÉS (recherche +
 * pastille appliquées par l'appelant, même contrat que buildQuizTree). Un
 * type absent des quiz affichés est omis (jamais un groupe à 0).
 */
export function buildTypeGroups(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>
): TypeGroup[] {
	const groups: TypeGroup[] = [];
	for (const type of TYPE_ORDER) {
		const list = quizzes.filter(q => q.quizType === type);
		if (list.length === 0) continue;
		groups.push({
			type,
			quizzes: list,
			total: list.length,
			mastered: list.filter(q => isMastered(q, stats)).length
		});
	}
	return groups;
}
