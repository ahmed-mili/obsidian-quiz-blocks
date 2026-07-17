# Organisation par dossiers de « Mes quiz » — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Spec :** `docs/superpowers/specs/2026-07-17-quizzes-folders-design.md` — la lire en cas de doute sur le *pourquoi*.

**Goal :** remplacer la grille plate de « Mes quiz » par une arborescence de dossiers à chaînes compactées, chaque nœud portant son avancement, l'état de repli étant mémorisé.

**Architecture :** un module **pur** (`quiz-tree.ts`) construit l'arbre à partir des `QuizIndexEntry` déjà filtrés et des stats — aucune dépendance à Obsidian, donc vérifiable seul sous Node. `quizzes.ts` ne fait que le rendre. Le scanner n'est pas touché : `QuizIndexEntry.path` suffit.

**Tech Stack :** TypeScript strict (ESM), esbuild, API Obsidian (`setIcon`), i18n maison (`t()`).

## Contraintes globales

Elles s'appliquent à **toutes** les tâches.

- **Ce projet n'a AUCUN framework de test et ne doit PAS en gagner un.** Vérification = `npm run check` (`tsc --noEmit`) **plus** un test manuel mesuré dans le vault **Efrei**. Ne jamais ajouter jest/vitest/mocha, ni un dossier `tests/`.
- **RÈGLE ABSOLUE — le plugin ne doit JAMAIS devenir desktop-only.** `isDesktopOnly` reste `false`. Cette fonctionnalité est du DOM pur : **aucun** `require`, aucun `fs`, aucun `process`.
- **Aucune chaîne visible en dur** : tout passe par `t("<clé>")`. L'anglais (`src/i18n/en/`) est la référence ; le français est typé derrière (`Record<keyof typeof EN_DASHBOARD, string>`) → une clé FR manquante est une **erreur de compilation**. `t()` doit être appelé **au rendu**, jamais mis en cache dans une constante de module.
- **CSS thémable** : variables Obsidian (`var(--…)`) uniquement, lisible en thème clair **et** sombre. Aucune couleur en dur.
- **Commentaires en français.** Modules < ~350 lignes.
- **`ui-select.ts` est le seul dropdown autorisé** (aucun `<select>` natif). Sans objet ici, mais la règle tient.
- **Seuil de maîtrise = 80**, celui du filtre `mastered` existant. **Ne jamais en introduire un second** : il est exporté une fois par `quiz-tree.ts` et importé partout ailleurs.
- **Ordre alphabétique** des nœuds, jamais par nombre : les comptes dépendent du filtre actif, un tri par nombre ferait sauter les nœuds de place à chaque clic.
- **Les comptes affichent ce qui est réellement visible** (filtre + recherche appliqués), jamais le total du dossier.
- Commits en français, atomiques. **JAMAIS `git push`** — le contrôleur s'en charge.

## Pièges vérifiés de cet environnement

Ne pas les redécouvrir (payés sur `feat/mention-picker`) :

- Avant toute commande `obsidian …`, **invoquer le skill `obsidian:cli`**. Plusieurs vaults sont ouverts : omettre `vault=` vise le mauvais, et `plugin:reload` affiche « Reloaded » même dans ce cas — ce n'est **jamais** une preuve.
- Le **CSS ne se recharge pas** avec `plugin:reload` : il faut un disable/enable.
- Le type de vue du dashboard est **`quiz-blocks-dashboard`** (pas `quiz-dashboard` : un mauvais type crée un onglet mort dans le workspace d'Ahmed).
- Recharger le plugin **ne redessine pas** une vue déjà ouverte ; un leaf en onglet **inactif** renvoie des `getBoundingClientRect()` à **0** — ce n'est pas un bug de layout.
- **Une capture d'écran seule ne prouve rien** : Chromium suspend le repaint en arrière-plan et resert un frame périmé. Croiser **toujours** capture ET DOM.
- **Un test qui pilote des listeners ne prouve jamais le rendu.** Tout état visuel se vérifie à l'écran.
- Efrei a un vrai fournisseur IA : **ne déclencher aucune génération réelle**.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/dashboard/quiz-tree.ts` *(créé)* | **Pur.** Construit l'arbre, compacte les chaînes, agrège comptes et maîtrise. Aucune dépendance Obsidian → testable seul. |
| `src/dashboard/quizzes.ts` *(modifié)* | Rend l'arbre, gère chevrons, repli et recherche. |
| `src/dashboard/quiz-card.ts` *(modifié)* | Gagne `opts.showPath`. |
| `src/plugin.ts` *(modifié)* | Réglage `quizzesCollapsedFolders`. |
| `src/i18n/{en,fr}/dashboard.ts` *(modifiés)* | 6 clés. |
| `src/types/dashboard-ctx.ts` *(modifié)* | Déclare `quizzesCollapsedFolders` dans le type des settings vus par le dashboard. |
| `src/assets/css/dashboard/dashboard-quizzes.css` *(modifié)* | Style des nœuds. C'est bien ce fichier : il porte déjà toutes les règles `.qbd-quizzes-*` (vérifié au `grep -rln`). |

---

### Task 1 : `quiz-tree.ts` — construction pure de l'arbre

**Files:**
- Create: `src/dashboard/quiz-tree.ts`

**Interfaces:**
- Consomme : `QuizIndexEntry` (`./scanner` — champs utilisés : `path`, `title`), `QuizStatRecord` (`./stats-store` — champ utilisé : `bestScore`).
- Produit : `MASTERY_THRESHOLD`, `QuizTreeNode`, `buildQuizTree(quizzes, stats): QuizTreeNode[]`. Les tâches 3 et 4 en dépendent.

- [ ] **Step 1 : créer le module**

```ts
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
```

- [ ] **Step 2 : typecheck**

Run : `npm run check`
Attendu : exit 0, aucune sortie.

- [ ] **Step 3 : vérifier le module SEUL, sous Node**

Le module est pur : on le bundle et on l'exécute. **Rien de tout ceci n'est committé** — ni le bundle, ni le script — donc le projet ne gagne aucun framework de test. Écrire le script avec l'outil **Write**, jamais par heredoc bash (les heredocs avalent les antislashes sur cette machine, y compris dans les regex — piège vécu).

Répertoire de travail : le scratchpad de session.

```bash
npx esbuild src/dashboard/quiz-tree.ts --bundle --format=cjs --outfile=<SCRATCHPAD>/quiz-tree.cjs --log-level=warning
```

Script de vérification (Write, `<SCRATCHPAD>/check-tree.js`) — la fixture reproduit **les vrais chemins d'Efrei** :

```js
const { buildQuizTree, MASTERY_THRESHOLD } = require("./quiz-tree.cjs");

const B = "Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)";
const q = (path) => ({ path, basename: "x", title: "x", mtime: 0, questions: 1, types: [], quizType: "single" });

const quizzes = [
	...Array.from({ length: 19 }, (_, i) => q(`${B}/XTI201 - CCNA 1/a${i}.md`)),
	...Array.from({ length: 19 }, (_, i) => q(`${B}/syncthing/XTI201 - CCNA 1/b${i}.md`)),
	...Array.from({ length: 11 }, (_, i) => q(`${B}/c${i}.md`)),
	...Array.from({ length: 4 }, (_, i) => q(`${B}/XTI207 - Gestion du parc informatique 1/d${i}.md`)),
	q("Sans titre.md"),
];
const stats = { [`${B}/XTI201 - CCNA 1/a0.md`]: { bestScore: 90 }, [`${B}/XTI201 - CCNA 1/a1.md`]: { bestScore: 50 } };

const tree = buildQuizTree(quizzes, stats);
const show = (n, d = 0) => {
	console.log("  ".repeat(d) + `[${n.label || "(racine du vault)"}] total=${n.total} maîtrisés=${n.mastered} directs=${n.quizzes.length} path="${n.path}"`);
	n.children.forEach(c => show(c, d + 1));
};
tree.forEach(n => show(n));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
ok(tree.length === 2, `2 nœuds racine attendus, reçu ${tree.length}`);
ok(tree[0].label === B, `chaîne compactée attendue "${B}", reçu "${tree[0].label}"`);
ok(tree[0].path === B, `identité = chemin du dossier le plus profond, reçu "${tree[0].path}"`);
ok(tree[0].total === 53, `total 53 attendu, reçu ${tree[0].total}`);
ok(tree[0].quizzes.length === 11, `11 quiz directs attendus, reçu ${tree[0].quizzes.length}`);
ok(tree[0].children.length === 3, `3 enfants attendus, reçu ${tree[0].children.length}`);
ok(tree[0].mastered === 1, `1 maîtrisé attendu (90 ≥ ${MASTERY_THRESHOLD}, 50 non), reçu ${tree[0].mastered}`);
const sync = tree[0].children.find(c => c.label.startsWith("syncthing"));
ok(!!sync && sync.label === "syncthing/XTI201 - CCNA 1", `"syncthing/XTI201 - CCNA 1" attendu, reçu "${sync && sync.label}"`);
ok(tree[1].path === "" && tree[1].total === 1, `nœud racine du vault en dernier, total 1`);
const labels = tree[0].children.map(c => c.label);
ok(JSON.stringify(labels) === JSON.stringify([...labels].sort((a, b) => a.localeCompare(b))), `enfants non triés alphabétiquement : ${labels}`);

console.log(fails.length ? "\nÉCHECS :\n- " + fails.join("\n- ") : "\nTout passe.");
process.exit(fails.length ? 1 : 0);
```

Run : `node <SCRATCHPAD>/check-tree.js`
Attendu : l'arbre imprimé, puis `Tout passe.`, exit 0. En particulier `[Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)] total=53 … directs=11` sur **une seule ligne** (chaîne compactée) et un enfant `[syncthing/XTI201 - CCNA 1] total=19`.

- [ ] **Step 4 : commit**

```bash
git add src/dashboard/quiz-tree.ts
git commit -m "feat(quizzes): arbre des dossiers à chaînes compactées (module pur)"
```

---

### Task 2 : `quiz-card.ts` — chemin conditionnel

**Files:**
- Modify: `src/dashboard/quiz-card.ts` (signature vers la ligne 31, ligne de chemin vers 76-77)

**Interfaces:**
- Produit : `renderQuizCard(container, quiz, stats, onOpen?, opts?)` avec `opts?: { showPath?: boolean }`, défaut `true`. La tâche 3 passe `{ showPath: false }`.

**Contexte :** `renderQuizCard` a **deux** appelants — `quizzes.ts:123` et `home.ts:265` (via un wrapper local, `home.ts:264`). Sur l'accueil les cartes ne sont **pas** regroupées : le chemin y reste la seule indication d'où sort un quiz. D'où un paramètre, pas un retrait sec. **Relocaliser au `grep -n`**, les lignes bougent.

- [ ] **Step 1 : ajouter le paramètre**

Remplacer la signature :

```ts
export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void,
	/* showPath: false quand l'appelant affiche DÉJÀ le dossier au-dessus des
	   cartes (arbre de « Mes quiz ») — la ligne serait une redondance pure.
	   L'accueil, lui, rend une grille plate : le chemin y est la seule
	   indication d'où sort un quiz, d'où le défaut à true. */
	opts?: { showPath?: boolean }
): HTMLDivElement {
```

- [ ] **Step 2 : rendre la ligne conditionnelle**

Remplacer le bloc « Chemin » :

```ts
	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà.
	if (opts?.showPath !== false) {
		const pathEl = body.createEl("p", { cls: "qbd-quiz-card-path" });
		pathEl.createSpan({ text: quiz.path });
	}
```

- [ ] **Step 3 : typecheck**

Run : `npm run check`
Attendu : exit 0. `home.ts` ne passe pas `opts` → garde le chemin, sans modification.

- [ ] **Step 4 : commit**

```bash
git add src/dashboard/quiz-card.ts
git commit -m "feat(quizzes): rend le chemin de la carte conditionnel (showPath)"
```

---

### Task 3 : rendu de l'arbre dans « Mes quiz »

**Files:**
- Modify: `src/dashboard/quizzes.ts`
- Modify: `src/i18n/en/dashboard.ts`, `src/i18n/fr/dashboard.ts`
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css` — c'est le fichier qui porte déjà toutes les règles `.qbd-quizzes-*`. Ne pas en créer un concurrent.

**Interfaces:**
- Consomme : `buildQuizTree`, `QuizTreeNode`, `MASTERY_THRESHOLD` (Task 1) ; `renderQuizCard(..., { showPath: false })` (Task 2).
- Produit : le rendu. La tâche 4 y greffera la persistance.

- [ ] **Step 1 : les 6 clés i18n**

Dans `src/i18n/en/dashboard.ts`, après `"dashboard.quizzes.empty"` :

```ts
	"dashboard.quizzes.noFolder": "No folder",
	"dashboard.quizzes.folderCountOne": "{count} quiz",
	"dashboard.quizzes.folderCountOther": "{count} quizzes",
	"dashboard.quizzes.folderMasteredOne": "{count} mastered",
	"dashboard.quizzes.folderMasteredOther": "{count} mastered",
	"dashboard.quizzes.folderToggle": "Collapse or expand this folder",
```

Dans `src/i18n/fr/dashboard.ts`, au même endroit :

```ts
	"dashboard.quizzes.noFolder": "Sans dossier",
	"dashboard.quizzes.folderCountOne": "{count} quiz",
	"dashboard.quizzes.folderCountOther": "{count} quiz",
	"dashboard.quizzes.folderMasteredOne": "{count} maîtrisé",
	"dashboard.quizzes.folderMasteredOther": "{count} maîtrisés",
	"dashboard.quizzes.folderToggle": "Replier ou déplier ce dossier",
```

Les formes One/Other suivent le patron `dashboard.common.questionsOne` / `questionsOther` déjà en place (`en/dashboard.ts:9-10`). Le français a un pluriel invariable pour « quiz » mais pas pour « maîtrisé » : d'où quatre clés et non deux.

- [ ] **Step 2 : imports, seuil unique et référence de conteneur**

En tête de `quizzes.ts`, ajouter :

```ts
import { buildQuizTree, MASTERY_THRESHOLD } from "./quiz-tree";
import type { QuizTreeNode } from "./quiz-tree";
```

Dans `createQuizzesHandlers`, à côté de `let searchQuery = ""` :

```ts
	/* Le conteneur du dernier rendu. `renderNode` est défini HORS de
	   `render`, donc `container` n'y est pas dans sa portée : sans cette
	   référence, le clic d'un chevron ne pourrait pas re-rendre. Même
	   patron qu'ai.ts:179/215. Réassigné à chaque rendu — ne JAMAIS
	   capturer un nœud DOM d'un rendu précédent, `render` fait
	   `container.empty()`. */
	let containerRef: HTMLElement | null = null;
```

et, en première ligne de `render(container)` :

```ts
		containerRef = container;
```

Puis, dans `renderQuizGrid`, remplacer le `80` en dur du filtre `mastered` par la constante :

```ts
			if (currentFilter === "mastered") return s && s.bestScore >= MASTERY_THRESHOLD;
```

C'est le point de la contrainte « un seul seuil » : `quiz-tree.ts` en est désormais la source.

- [ ] **Step 3 : remplacer la grille plate par l'arbre**

Dans `render`, remplacer la création du conteneur :

```ts
		// ── Arbre ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		renderQuizGrid(treeEl, quizzes, stats);
```

Puis remplacer entièrement `renderQuizGrid` :

```ts
	/* Indentation : la compaction des chaînes supprime déjà les niveaux
	   creux, mais une hiérarchie réellement profonde ne doit pas écraser
	   les cartes à 360 px de large (Obsidian Android). D'où le plafond. */
	const INDENT_PX = 16;
	const MAX_INDENT_LEVELS = 4;

	function renderQuizGrid(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		treeEl.empty();

		const filtered = quizzes.filter(q => {
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) {
				return false;
			}
			const s = stats[q.path];
			if (currentFilter === "progress") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "mastered") return s && s.bestScore >= MASTERY_THRESHOLD;
			if (currentFilter === "fresh") return !s || s.questionsDone === 0;
			return true;
		});

		if (filtered.length === 0) {
			treeEl.createDiv({ cls: "qbd-empty-state" }, el => {
				el.createEl("p", { text: t("dashboard.quizzes.empty") });
			});
			return;
		}

		// L'arbre est construit sur les quiz RETENUS : un dossier vide après
		// filtrage n'existe pas, et les comptes affichés sont donc honnêtes.
		for (const node of buildQuizTree(filtered, stats)) {
			renderNode(treeEl, node, stats, 0);
		}
	}

	function renderNode(parent: HTMLElement, node: QuizTreeNode, stats: Record<string, QuizStatRecord>, depth: number): void {
		const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });

		// Un bouton, pas un div : focusable et actionnable au clavier sans
		// réimplémenter le rôle.
		const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
		head.type = "button";
		head.style.paddingLeft = (Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX) + "px";
		head.setAttribute("aria-label", t("dashboard.quizzes.folderToggle"));

		const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
		// « path: "" » = les quiz posés à la racine du vault ; le libellé est
		// traduit ICI (au rendu), jamais figé dans la donnée.
		head.createSpan({
			cls: "qbd-quizzes-node-label",
			text: node.path === "" ? t("dashboard.quizzes.noFolder") : node.label,
		});
		head.createSpan({
			cls: "qbd-quizzes-node-count",
			text: t(node.total === 1 ? "dashboard.quizzes.folderCountOne" : "dashboard.quizzes.folderCountOther", { count: node.total }),
		});
		head.createSpan({
			cls: "qbd-quizzes-node-mastered",
			text: t(node.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: node.mastered }),
		});

		// Barre d'avancement : c'est elle qui rend un nœud REPLIÉ encore
		// informatif — sinon replier reviendrait à cacher.
		const bar = head.createDiv({ cls: "qbd-quizzes-node-bar" });
		const fill = bar.createDiv({ cls: "qbd-quizzes-node-bar-fill" });
		fill.style.width = (node.total > 0 ? Math.round(node.mastered / node.total * 100) : 0) + "%";

		// Repli : câblé en Task 4. Pour l'instant tout est déplié.
		const collapsed = false;
		setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
		head.setAttribute("aria-expanded", String(!collapsed));
		if (collapsed) return;

		const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
		// Sous-dossiers d'abord, cartes ensuite : convention de tout
		// explorateur de fichiers, y compris celui d'Obsidian.
		for (const child of node.children) renderNode(body, child, stats, depth + 1);
		if (node.quizzes.length > 0) {
			const grid = body.createDiv({ cls: "qbd-home-grid" });
			grid.style.paddingLeft = (Math.min(depth + 1, MAX_INDENT_LEVELS) * INDENT_PX) + "px";
			for (const quiz of node.quizzes) {
				// showPath: false — le dossier est écrit juste au-dessus.
				renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), { showPath: false });
			}
		}
	}
```

- [ ] **Step 4 : CSS**

Dans `src/assets/css/dashboard/dashboard-quizzes.css`, à la suite des règles `.qbd-quizzes-*` existantes :

```css
/* Arbre des dossiers de « Mes quiz ». Les nœuds restent DISCRETS : ce sont
   les cartes qui portent le poids visuel (référence StudySmarter, maquettes
   SS_UI_2/SS_UI_3 analysées le 2026-07-17). */
.qbd-quizzes-node-head {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 6px 8px;
	background: transparent;
	border: none;
	box-shadow: none;
	cursor: pointer;
	color: var(--text-muted);
	font-size: 12.5px;
	text-align: left;
}

.qbd-quizzes-node-head:hover {
	background: var(--background-modifier-hover);
	color: var(--text-normal);
}

.qbd-quizzes-node-chevron {
	display: flex;
	flex-shrink: 0;
	color: var(--text-faint);
}

.qbd-quizzes-node-label {
	font-weight: 600;
	color: var(--text-normal);
	/* Un libellé de chaîne compactée peut être long : il s'élide, il ne
	   pousse jamais le compte hors de la ligne. */
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.qbd-quizzes-node-count,
.qbd-quizzes-node-mastered {
	flex-shrink: 0;
	color: var(--text-faint);
}

.qbd-quizzes-node-bar {
	flex-shrink: 0;
	width: 64px;
	height: 4px;
	margin-left: auto;
	border-radius: 2px;
	background: var(--background-modifier-border);
	overflow: hidden;
}

.qbd-quizzes-node-bar-fill {
	height: 100%;
	border-radius: 2px;
	background: var(--interactive-accent);
}
```

- [ ] **Step 5 : typecheck, build, rechargement**

```bash
npm run check
npm run build
obsidian vault="Efrei" eval code="(async()=>{await app.plugins.disablePlugin('quiz-blocks');await app.plugins.enablePlugin('quiz-blocks');return 'ok'})()"
```
Attendu : `check` exit 0 ; `Build terminé.` ; `ok`.

- [ ] **Step 6 : PROUVER le rendu à l'écran**

Ouvrir « Mes quiz » (vue `quiz-blocks-dashboard` — la révéler et l'activer, sinon les mesures valent 0), puis **dans un seul eval** relever l'arbre rendu :

```js
[...document.querySelectorAll('.qbd-quizzes-node-head')].map(h => ({
  label: h.querySelector('.qbd-quizzes-node-label').textContent,
  count: h.querySelector('.qbd-quizzes-node-count').textContent,
  indent: h.style.paddingLeft
}))
```

Attendu, sur Efrei :
1. `Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)` — **une seule ligne** (chaîne compactée), `53 quiz` (le 54ᵉ est à la racine du vault), `indent: 0px`.
2. Trois enfants à `indent: 16px` : `XTI201 - CCNA 1` (19), `XTI207 - Gestion du parc informatique 1` (4), `syncthing/XTI201 - CCNA 1` (19) — **triés alphabétiquement**.
3. `Sans dossier` (1) en **dernier**.
4. Les 11 quiz directs de `B1` rendus **après** les trois sous-dossiers.
5. Aucun `.qbd-quiz-card-path` dans l'arbre : `document.querySelectorAll('.qbd-quizzes-tree .qbd-quiz-card-path').length === 0`.

Puis **capture d'écran** (`dev:screenshot`, avec le rituel `setBackgroundThrottling(false)` → ~2 s → capture → `true`) et la **lire** : le DOM ne prouve pas le rendu. Vérifier aussi le thème clair (`app.vault.setConfig('theme','moonstone')` + `app.workspace.trigger('css-change')`) puis **restaurer** l'état d'Ahmed (schéma `obsidian`, thème communautaire `AnuPpuccin` — ce sont deux réglages distincts, ne pas les confondre).

- [ ] **Step 7 : commit**

```bash
git add src/dashboard/quizzes.ts src/i18n/en/dashboard.ts src/i18n/fr/dashboard.ts src/assets/css/
git commit -m "feat(quizzes): rend les quiz en arbre de dossiers avec avancement"
```

---

### Task 4 : repli mémorisé et dépliage de recherche

**Files:**
- Modify: `src/plugin.ts` (interface `QuizBlocksSettings` vers la ligne 49-62 ; `DEFAULT_SETTINGS` vers 80)
- Modify: `src/types/dashboard-ctx.ts` (interface `AiSettings`, vers la ligne 70)
- Modify: `src/dashboard/quizzes.ts`

**Interfaces:**
- Consomme : `QuizTreeNode.path` comme identité de nœud (Task 1) ; le rendu et `containerRef` de la Task 3.
- Produit : rien pour la suite.

- [ ] **Step 1 : le réglage, des DEUX côtés**

**Piège de typage, vérifié :** `ctx.plugin.settings` n'est pas typé avec la forme complète des réglages du plugin, mais avec `AiSettings` (`types/dashboard-ctx.ts:57-71`), un sous-ensemble. Déclarer le champ uniquement dans `plugin.ts` **ne compilerait pas** au point d'usage. Il faut les deux.

Dans `AiSettings` (`src/types/dashboard-ctx.ts`), à côté de `aiMentionExtraFolders` :

```ts
	/* NB : cette interface s'appelle « AiSettings » mais elle est en réalité
	   le sous-ensemble des réglages du plugin que le DASHBOARD lit — le nom
	   ne suit plus. Le champ ci-dessous n'a rien d'IA ; le renommage est un
	   travail à part (plugin.js n'est pas encore converti), à signaler au
	   rapport plutôt qu'à faire ici. */
	quizzesCollapsedFolders?: string[];
```

Dans `QuizBlocksSettings` (`src/plugin.ts`), à côté de `aiMentionExtraFolders`, ajouter :

```ts
	/** Chemins COMPLETS des dossiers repliés dans « Mes quiz ». État
	    d'interface, pas une préférence : aucune section dans l'onglet de
	    réglages. Seuls les REPLIÉS sont listés (déplié = défaut). */
	quizzesCollapsedFolders: string[];
```

Dans `DEFAULT_SETTINGS`, à côté de `aiMentionExtraFolders: []` :

```ts
	// Vide : au premier usage, tout est déplié — l'utilisateur voit ce qu'il a.
	quizzesCollapsedFolders: [],
```

- [ ] **Step 2 : lire et écrire l'état**

Dans `createQuizzesHandlers`, à côté de `let searchQuery = ""` :

```ts
	/* L'accès réel aux réglages est `ctx.plugin.settings.<clé>` (même patron
	   qu'ai.ts). Lu à CHAQUE rendu : le réglage peut changer sous nos pieds
	   (autre appareil, rechargement). */
	function collapsedSet(): Set<string> {
		return new Set(ctx.plugin.settings.quizzesCollapsedFolders || []);
	}

	function toggleCollapsed(path: string): void {
		const set = collapsedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.plugin.settings.quizzesCollapsedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.plugin.saveSettings().catch(() => {});
	}
```

`DashboardPlugin` (`types/dashboard-ctx.ts:84-89`) porte bien `settings` et `saveSettings()` — vérifié, rien à étendre de ce côté ; seul le champ manquait dans `AiSettings` (Step 1).

- [ ] **Step 3 : câbler le chevron**

Dans `renderNode`, remplacer `const collapsed = false;` par :

```ts
		// Une recherche déplie TEMPORAIREMENT tout ce qui a des résultats,
		// sans toucher à l'état mémorisé : une recherche ne doit pas
		// reconfigurer la page dans le dos de l'utilisateur. L'arbre étant
		// déjà construit sur les quiz filtrés, un nœud présent A des
		// résultats — d'où la condition sur la seule recherche.
		const collapsed = !searchQuery && collapsedSet().has(node.path);
```

et ajouter le gestionnaire juste après la création de `head` (`containerRef` a été posé en Task 3, Step 2) :

```ts
		head.addEventListener("click", () => {
			toggleCollapsed(node.path);
			if (containerRef) render(containerRef);
		});
```

- [ ] **Step 4 : typecheck, build, rechargement complet**

```bash
npm run check
npm run build
obsidian vault="Efrei" eval code="(async()=>{await app.plugins.disablePlugin('quiz-blocks');await app.plugins.enablePlugin('quiz-blocks');return 'ok'})()"
```

Le disable/enable (et non `plugin:reload`) est **obligatoire** ici : lui seul relit `data.json`, donc le réglage.

- [ ] **Step 5 : PROUVER la persistance et la recherche**

1. **Persistance** — replier `XTI201 - CCNA 1` (clic réel sur `.qbd-quizzes-node-head`), lire `app.plugins.plugins['quiz-blocks'].settings.quizzesCollapsedFolders` → doit contenir le chemin **complet** `Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)/XTI201 - CCNA 1`. Puis **disable/enable**, rouvrir la vue : le nœud est **toujours** replié. C'est LA preuve attendue.
2. **Recherche** — le nœud restant replié, taper une recherche qui matche un de ses quiz : il se déplie **et ses ancêtres aussi**. Vider la recherche → il est de nouveau replié, et `quizzesCollapsedFolders` **n'a pas changé**.
3. **Filtres** — relever l'ordre des libellés sous chaque filtre (`all`, `progress`, `mastered`, `fresh`) : l'ordre **ne doit pas changer**.
4. **Nœud replié informatif** — un nœud replié affiche toujours son compte, son agrégat et sa barre.

- [ ] **Step 6 : commit**

```bash
git add src/plugin.ts src/dashboard/quizzes.ts
git commit -m "feat(quizzes): mémorise les dossiers repliés, dépliage temporaire à la recherche"
```

---

### Task 5 : couverture d'états et vérification finale

**Files:**
- Modify: selon les défauts trouvés.

- [ ] **Step 1 : couverture des états frères (skill `senior-dev:state-coverage`)**

Énumérer et **statuer sur chacun**, pas seulement le chemin heureux :

| État | Attendu |
|---|---|
| Dossier avec sous-dossiers **et** quiz directs (`B1` : 11 + 3) | Pas de compaction ; cartes après les sous-dossiers |
| Quiz à la racine du vault | Nœud `Sans dossier`, **en dernier** |
| Filtre ne laissant qu'un seul quiz | Un seul nœud, compacté jusqu'à lui |
| Aucun quiz nulle part | État vide, aucun nœud |
| Recherche sans résultat | État vide, aucun nœud fantôme |
| Nœud replié | Compte + agrégat + barre toujours lisibles |
| Thème clair / sombre | Nœuds lisibles, barre visible dans les deux |
| Largeur 360 px (Android) | Indentation n'écrase pas les cartes ; libellé s'élide |
| Chevron au clavier | `Tab` l'atteint, `Entrée`/`Espace` replie (c'est un `<button>`) |
| Accueil | Garde ses chemins sur les cartes (non régressé) |

- [ ] **Step 2 : vérifier le mobile (règle absolue)**

```bash
grep -n "isDesktopOnly" src/assets/manifest.json
grep -rn "require(\|process\.\|from \"fs\"\|from \"path\"" src/dashboard/quiz-tree.ts src/dashboard/quizzes.ts
```
Attendu : `"isDesktopOnly": false` ; **aucun** résultat au second grep (cette fonctionnalité est du DOM pur).

Largeur réelle : CDP `setDeviceMetricsOverride` à 360 px (cf. mémoire `dashboard-android-pass` : l'émulation garde un viewport large, il faut forcer la largeur), capture, lecture, **restauration**.

- [ ] **Step 3 : vérification finale**

```bash
npm run check
git log --oneline main..feat/quizzes-folders
git diff --stat main..feat/quizzes-folders
git status --short
```
Attendu : typecheck vert, commits lisibles, aucun fichier hors périmètre, **aucun artefact** (le bundle et le script de la Task 1 vivent dans le scratchpad, pas dans le dépôt).

- [ ] **Step 4 : confirmer le déploiement**

```bash
grep -c "qbd-quizzes-node" C:/obsidian-vaults/Efrei/.obsidian/plugins/quiz-blocks/main.js
```
Attendu : au moins 1.

- [ ] **Step 5 : rapport à Ahmed**

Résumer ce qui marche **avec la preuve**, et les écarts assumés. Le merge et le push sont faits par le contrôleur, pas par toi.

---

## Notes d'exécution

- **`quizzes.ts` va grossir** (128 lignes + ~90). Il reste sous 350 : ne pas extraire `quiz-tree.ts` une seconde fois, il existe déjà. Si le fichier dépassait 350, extraire le **rendu** des nœuds, pas la logique.
- **Les numéros de ligne bougent.** Relocaliser au `grep -n` avant chaque greffe.
- **`render()` reconstruit tout** (`container.empty()`) : ne garder aucune référence DOM entre deux rendus.
- Les **19 doublons `syncthing/`** du vault d'Ahmed sont **hors périmètre** : ils vont apparaître comme un nœud à part, c'est voulu et c'est même l'intérêt.
