import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";

/* ══════════════════════════════════════════════════════════
   QUIZ TREE — regroupement des quiz par dossier du vault
   Module PUR : aucune dépendance à Obsidian ni au DOM, pour
   rester vérifiable seul (le projet n'a pas de framework de
   test : cf. le plan, on le bundle et on l'exécute sous Node).
══════════════════════════════════════════════════════════ */

/** Seuil de maîtrise, en pourcentage du meilleur score.
    SOURCE UNIQUE : c'est le seuil du filtre « mastered » de quizzes.ts.
    Ne jamais en écrire un second en dur ailleurs. */
export const MASTERY_THRESHOLD = 80;

export interface QuizTreeNode {
	/** Chemin COMPLET du dossier le plus profond de la chaîne compactée.
	    C'est l'identité stable du nœud (clé de l'état de repli) : elle
	    survit à l'apparition d'un frère qui romprait la compaction.
	    Chaîne vide = les quiz posés à la racine du vault. */
	path: string;
	/** Libellé affiché : segments compactés joints par « / ». Vide pour la
	    racine du vault — c'est le rendu qui traduit (t() au rendu, jamais
	    figé dans une donnée). */
	label: string;
	children: QuizTreeNode[];
	/** Quiz posés DIRECTEMENT dans ce dossier (hors descendants). */
	quizzes: QuizIndexEntry[];
	/** Quiz du sous-arbre entier : ce nœud + tous ses descendants. */
	total: number;
	/** Quiz du sous-arbre dont bestScore >= MASTERY_THRESHOLD. */
	mastered: number;
}

/** Nœud mutable interne (Map pour l'insertion, tableau au rendu). */
interface MutNode {
	seg: string;
	path: string;
	children: Map<string, MutNode>;
	quizzes: QuizIndexEntry[];
}

function isMastered(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): boolean {
	// Indexation défensive (même style que quizzes.ts) : une entrée peut
	// manquer pour un quiz jamais joué.
	const s = stats[quiz.path];
	return !!s && s.bestScore >= MASTERY_THRESHOLD;
}

/* Compacte les chaînes à enfant unique puis agrège, façon VS Code : un
   dossier dont le seul contenu est UN sous-dossier fusionne avec lui sur
   une même ligne (« Bachelor…/B1 (2025-2026) »). Sans ça, le vault
   d'Ahmed ferait déplier un préfixe commun à tout, qui n'apprend rien.
   La compaction s'arrête dès qu'un nœud a des quiz DIRECTS : « B1 » a 11
   quiz et 3 sous-dossiers, il doit rester un niveau à part entière. */
function finalize(node: MutNode, stats: Record<string, QuizStatRecord>): QuizTreeNode {
	let label = node.seg;
	let cur = node;
	while (cur.children.size === 1 && cur.quizzes.length === 0) {
		const only: MutNode = cur.children.values().next().value as MutNode;
		label += "/" + only.seg;
		cur = only;
	}
	const children = [...cur.children.values()]
		.map(c => finalize(c, stats))
		.sort((a, b) => a.label.localeCompare(b.label));
	const direct = cur.quizzes;
	const total = direct.length + children.reduce((sum, c) => sum + c.total, 0);
	const mastered = direct.filter(q => isMastered(q, stats)).length
		+ children.reduce((sum, c) => sum + c.mastered, 0);
	return { path: cur.path, label, children, quizzes: direct, total, mastered };
}

/**
 * Construit l'arbre des dossiers à partir des quiz DÉJÀ FILTRÉS (recherche
 * + pastille appliquées par l'appelant) : un dossier vide après filtrage
 * n'existe pas, et les comptes reflètent donc ce qui est réellement affiché.
 * Retour : nœuds de premier niveau, alphabétiques, « racine du vault »
 * (path: "") toujours en DERNIER s'il existe.
 */
export function buildQuizTree(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>
): QuizTreeNode[] {
	const root: MutNode = { seg: "", path: "", children: new Map(), quizzes: [] };
	for (const q of quizzes) {
		// Le dernier segment est le fichier : on ne garde que les dossiers.
		// filter(Boolean) absorbe les séparateurs doubles éventuels.
		const segs = q.path.split("/").slice(0, -1).filter(Boolean);
		let cur = root;
		for (const seg of segs) {
			let next = cur.children.get(seg);
			if (!next) {
				next = { seg, path: cur.path ? cur.path + "/" + seg : seg, children: new Map(), quizzes: [] };
				cur.children.set(seg, next);
			}
			cur = next;
		}
		cur.quizzes.push(q);
	}
	// La racine virtuelle ne se compacte JAMAIS : elle n'est pas affichée.
	const tops = [...root.children.values()]
		.map(n => finalize(n, stats))
		.sort((a, b) => a.label.localeCompare(b.label));
	if (root.quizzes.length > 0) {
		tops.push({
			path: "",
			label: "",
			children: [],
			quizzes: root.quizzes,
			total: root.quizzes.length,
			mastered: root.quizzes.filter(q => isMastered(q, stats)).length,
		});
	}
	return tops;
}
