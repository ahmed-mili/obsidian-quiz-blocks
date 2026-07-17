# « Mes quiz » par module et par UE — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`. Étapes en cases à cocher (`- [ ]`).

**Spec :** `docs/superpowers/specs/2026-07-17-quizzes-modules-ue-design.md` — la lire pour le *pourquoi*.

**Goal :** remplacer l'arbre à chemins bruts de « Mes quiz » par une grille de **cartes de module** (nom + UE tirés de `Dashboard.md`), avec un axe « Par UE » et un drill-down module → quiz.

**Architecture :** un module **pur** `quiz-modules.ts` parse la note de correspondance (texte) → table module, et regroupe les quiz par module / par UE. `quizzes.ts` lit la note (async, mis en cache), rend la grille de cartes de module, gère l'axe UE et le drill-down. L'arbre `quiz-tree.ts` est retiré.

**Tech Stack :** TypeScript strict (ESM), esbuild, API Obsidian (`setIcon`, `vault`), i18n maison.

## Contraintes globales

S'appliquent à **toutes** les tâches.

- **Ce projet n'a AUCUN framework de test et ne doit PAS en gagner un.** Vérification = `npm run check` (`tsc --noEmit`) **plus** un test manuel mesuré dans le vault **Efrei**, prouvé à l'écran (croiser **capture ET DOM** — un test DOM ne prouve jamais le rendu, une capture seule peut être un frame périmé).
- **`isDesktopOnly` reste `false`.** Cette fonctionnalité est du DOM pur + lecture `vault` : **aucun** `require`, `fs`, `process`.
- **Aucune chaîne visible en dur** : `t("<clé>")`. Anglais de référence (`src/i18n/en/dashboard.ts`), français typé derrière (`Record<keyof typeof EN_DASHBOARD, string>`) → une clé FR manquante est une **erreur de compilation**. `t()` appelé **au rendu**, jamais figé dans une constante de module.
- **Un seul seuil de maîtrise** (`MASTERY_THRESHOLD = 80`) : après la Task 1 il vit dans `quiz-mastery.ts`. Ne jamais réécrire `80` en dur.
- **Ordre stable, jamais par nombre** : modules triés alphabétiquement par nom ; UE dans l'ordre d'apparition dans `Dashboard.md`, « Sans UE » en dernier. (Les comptes dépendent du filtre — trier par nombre ferait sauter les groupes à chaque clic.)
- **Les comptes reflètent les quiz réellement affichés** (filtre + recherche appliqués avant le regroupement), jamais le total du module.
- **CSS thémable** : variables Obsidian (`var(--…)`), lisible en thème clair **et** sombre. Aucune couleur en dur. **Préfixer de `.qbd-root`** toute règle sur un élément que le chrome d'Obsidian peut écraser (piège vérifié : `button:not(.clickable-icon)` en spécificité 0,1,1 grise les boutons ; `justify-content:center` centre leur contenu).
- **`ui-select.ts` est le seul dropdown autorisé.** Commentaires en français. Modules < ~350 lignes.
- **`ctx.plugin.settings` est typé `AiSettings`** (`src/types/dashboard-ctx.ts`), un sous-ensemble : tout nouveau réglage se déclare **des deux côtés** (là ET `QuizBlocksSettings`/`DEFAULT_SETTINGS` dans `plugin.ts`), sinon `tsc` échoue au point d'usage.
- Travail **directement sur `main`** (règle d'Ahmed : pas de branche). Commits en français, atomiques. **JAMAIS `git push`** — Ahmed décide.

## Pièges vérifiés de l'environnement

- Avant toute commande `obsidian …`, **invoquer le skill `obsidian:cli`**. Plusieurs vaults ouverts : omettre `vault=` vise le mauvais, et `plugin:reload` affiche « Reloaded » même alors — jamais une preuve.
- Le **CSS et les réglages** exigent un **disable/enable**, pas un `plugin:reload`.
- La vue est **`quiz-blocks-dashboard`** (un mauvais type crée un onglet mort chez Ahmed) ; recharger le plugin **ne redessine pas** une vue ouverte → la rouvrir (`setViewState` vers `empty` puis retour).
- **Atteindre la vue** : cliquer le **dernier** `.qbd-nav-item` dont le texte commence par « My quizzes », ~1,4 s.
- Un leaf en onglet **inactif** renvoie des `getBoundingClientRect()` à **0** — pas un bug de layout.
- **`dev:screenshot`, `dev:cdp`, `dev:mobile`, `dev:dom` sortent tous en exit 127.** Capture : `C:\Users\Ahmed\.claude\tools\obsidian-screenshot\obsidian_tools.cmd -Vault Efrei -Capture -Output "<png>"`. PNG dans le scratchpad de session, **jamais dans le dépôt**. Frame périmé : `eval code="require('electron').remote.getCurrentWebContents().setBackgroundThrottling(false)"`, ~3 s, capture, puis `true`.
- Écrire tout script Node avec l'outil **Write**, jamais un heredoc bash (il avale les antislashes, y compris dans les regex).
- **Ahmed utilise Obsidian.** Efrei a un vrai fournisseur IA : **ne déclencher aucune génération réelle**. Laisser en partant : réglages remis à leur défaut de test, **un seul** leaf dashboard, thèmes intacts (schéma `obsidian` + thème communautaire `AnuPpuccin` = deux réglages distincts), `git status --short` vierge à part `CLAUDE.md`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/dashboard/quiz-mastery.ts` *(créé)* | **Pur.** `MASTERY_THRESHOLD` + `isMastered(quiz, stats)`. Nouveau foyer neutre du seuil (avant : `quiz-tree.ts`). |
| `src/dashboard/quiz-modules.ts` *(créé)* | **Pur.** Parse le texte de la note de correspondance → table module ; regroupe les quiz par module et par UE. Testable seul sous Node. |
| `src/dashboard/module-card.ts` *(créé)* | Rend une carte de module (nom, UE, compte, avancement). |
| `src/dashboard/quizzes.ts` *(modifié)* | Lecture+cache de la note, grille de modules, axe UE, drill-down, sélecteur 4 axes. Retrait de l'arbre. **Doit finir < 350 lignes.** |
| `src/dashboard/quiz-tree.ts` *(supprimé)* | L'arbre à chemins bruts n'est plus utilisé. |
| `src/dashboard/quiz-recent.ts`, `quiz-type.ts` *(modifiés)* | Repointer l'import de `MASTERY_THRESHOLD` vers `quiz-mastery.ts`. |
| `src/plugin.ts`, `src/types/dashboard-ctx.ts` *(modifiés)* | Réglages `quizzesGrouping` (valeurs + migration) et `quizzesModuleMapNote`. |
| `src/assets/css/dashboard/dashboard-quizzes.css` *(modifié)* | Carte de module, en-tête d'UE, fil d'Ariane. |
| `src/i18n/{en,fr}/dashboard.ts` *(modifiés)* | Libellés (axes, fil d'Ariane, « Sans UE », badge). |

---

### Task 1 : `quiz-mastery.ts` + `quiz-modules.ts` (modules purs)

**Files:**
- Create: `src/dashboard/quiz-mastery.ts`
- Create: `src/dashboard/quiz-modules.ts`
- Modify: `src/dashboard/quiz-recent.ts` (import), `src/dashboard/quiz-type.ts` (import)

**Interfaces:**
- Consomme : `QuizIndexEntry` (`./scanner` — `path`, `title`, `mtime`, `quizType`), `QuizStatRecord` (`./stats-store` — `bestScore`).
- Produit : `MASTERY_THRESHOLD`, `isMastered` ; `ModuleMap`, `parseModuleMap`, `moduleForQuiz`, `ModuleGroup`, `buildModuleGroups`, `UeGroup`, `buildUeGroups`. Tasks 3 et 4 en dépendent.

- [ ] **Step 1 : `quiz-mastery.ts`**

```ts
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";

/* ══════════════════════════════════════════════════════════
   QUIZ MASTERY — seuil de maîtrise, foyer NEUTRE et unique.
   Autrefois dans quiz-tree.ts ; déplacé ici quand l'arbre a été
   retiré, pour que recent/type/modules puissent le partager sans
   dépendre d'un module mort. Ne jamais réécrire « 80 » ailleurs.
══════════════════════════════════════════════════════════ */

/** Seuil de maîtrise, en % du meilleur score. Source unique. */
export const MASTERY_THRESHOLD = 80;

/** Un quiz est maîtrisé si son meilleur score atteint le seuil.
    Indexation défensive : une entrée peut manquer (jamais joué). */
export function isMastered(quiz: QuizIndexEntry, stats: Record<string, QuizStatRecord>): boolean {
	const s = stats[quiz.path];
	return !!s && s.bestScore >= MASTERY_THRESHOLD;
}
```

- [ ] **Step 2 : repointer recent/type vers `quiz-mastery.ts`**

Dans `src/dashboard/quiz-recent.ts` **et** `src/dashboard/quiz-type.ts`, remplacer
`import { MASTERY_THRESHOLD } from "./quiz-tree";` par
`import { MASTERY_THRESHOLD } from "./quiz-mastery";`.
**Relocaliser au `grep -n "quiz-tree"`** ; ne rien changer d'autre à ces fichiers.

- [ ] **Step 3 : `quiz-modules.ts`**

```ts
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isMastered } from "./quiz-mastery";

/* ══════════════════════════════════════════════════════════
   QUIZ MODULES — regroupement des quiz par MODULE et par UE.
   Module PUR : aucune dépendance à Obsidian ni au DOM (le texte
   de la note de correspondance est lu par l'appelant et passé en
   argument). La hiérarchie UE → module → quiz vient d'une note
   « Dashboard » : des encadrés `> [!portals] <UE>` suivis de liens
   wiki vers les dossiers de module.
══════════════════════════════════════════════════════════ */

/** Un module tel que déclaré dans la note : dossier, nom affiché, UE. */
export interface ModuleInfo {
	/** Dossier de module = 1er segment sous le dossier d'année. Sert de clé. */
	folder: string;
	/** Nom affiché (alias du lien, ou le dossier faute d'alias). */
	name: string;
	/** Titre de l'UE parente, ou null si le module n'est dans aucun encadré. */
	ue: string | null;
}

/** Table issue de la note : dossier → info, + ordre d'apparition des UE. */
export interface ModuleMap {
	byFolder: Map<string, ModuleInfo>;
	/** Titres d'UE dans l'ordre du document (pour l'axe « Par UE »). */
	ueOrder: string[];
}

const CALLOUT_RE = /^>\s*\[!portals\]\s*(.+?)\s*$/;
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;

/* Extrait le SEGMENT de dossier de module d'un chemin de lien : le premier
   segment situé après un dossier « année » (repéré par « B1 (…) », « B2 (…) »,
   etc.). Si aucun dossier année n'est reconnu, on prend le dernier segment de
   dossier (le lien pointe soit vers le dossier, soit vers une note dedans —
   dans les deux cas le dossier de module est l'avant-dernier ou le dernier
   segment ; on retient le segment sous l'année pour être robuste aux deux). */
function moduleFolderFromLinkPath(linkPath: string): string {
	const segs = linkPath.split("/").filter(Boolean);
	const yearIdx = segs.findIndex(s => /\bB\d+\s*\(/.test(s));
	if (yearIdx >= 0 && yearIdx + 1 < segs.length) return segs[yearIdx + 1];
	// Repli : avant-dernier segment si le lien finit par une note homonyme,
	// sinon le dernier. On ne peut pas distinguer note/dossier depuis le texte ;
	// le 1er segment sous l'année couvre le vault réel d'Ahmed.
	return segs.length >= 2 ? segs[segs.length - 2] : segs[segs.length - 1] || "";
}

/** Parse le texte de la note de correspondance. Tolérant : lignes hors
    encadré ignorées ; note sans encadré → map vide (dégradation propre). */
export function parseModuleMap(noteText: string): ModuleMap {
	const byFolder = new Map<string, ModuleInfo>();
	const ueOrder: string[] = [];
	let currentUe: string | null = null;
	for (const raw of noteText.split(/\r?\n/)) {
		const co = raw.match(CALLOUT_RE);
		if (co) {
			currentUe = co[1];
			if (!ueOrder.includes(currentUe)) ueOrder.push(currentUe);
			continue;
		}
		// Une ligne de lien n'appartient à une UE que sous un encadré ; une
		// ligne « > » vide ou du texte libre ne remet pas currentUe à null
		// (les encadrés Obsidian sont des blocs de lignes « > … » contiguës,
		// mais une ligne blanche entre deux encadrés suffit à séparer —
		// gérée par le fait qu'un nouvel encadré réassigne currentUe).
		const lk = raw.match(LINK_RE);
		if (!lk || currentUe === null) continue;
		const folder = moduleFolderFromLinkPath(lk[1]);
		if (!folder) continue;
		const name = (lk[2] || folder).trim();
		if (!byFolder.has(folder)) byFolder.set(folder, { folder, name, ue: currentUe });
	}
	return { byFolder, ueOrder };
}

/** Module d'un quiz : plus proche dossier ANCÊTRE reconnu dans la table.
    Fallback : dossier parent immédiat, UE null (jamais de disparition). */
export function moduleForQuiz(quizPath: string, map: ModuleMap): ModuleInfo {
	const segs = quizPath.split("/").filter(Boolean);
	// segs sans le fichier : on remonte du plus profond vers la racine.
	for (let i = segs.length - 2; i >= 0; i--) {
		const hit = map.byFolder.get(segs[i]);
		if (hit) return hit;
	}
	const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
	return { folder: parent, name: parent, ue: null };
}

/** Un module affiché : ses quiz + agrégats. */
export interface ModuleGroup {
	folder: string;
	name: string;
	ue: string | null;
	quizzes: QuizIndexEntry[];
	total: number;
	mastered: number;
}

/** Regroupe les quiz DÉJÀ FILTRÉS par module. Un module sans quiz n'existe
    pas. Tri alphabétique par nom (jamais par nombre). */
export function buildModuleGroups(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap
): ModuleGroup[] {
	const acc = new Map<string, ModuleGroup>();
	for (const q of quizzes) {
		const m = moduleForQuiz(q.path, map);
		let g = acc.get(m.folder);
		if (!g) { g = { folder: m.folder, name: m.name, ue: m.ue, quizzes: [], total: 0, mastered: 0 }; acc.set(m.folder, g); }
		g.quizzes.push(q);
	}
	const groups = [...acc.values()];
	for (const g of groups) {
		g.total = g.quizzes.length;
		g.mastered = g.quizzes.filter(q => isMastered(q, stats)).length;
	}
	groups.sort((a, b) => a.name.localeCompare(b.name));
	return groups;
}

/** Un groupe d'UE : ses modules + agrégats. */
export interface UeGroup {
	/** Titre d'UE, ou null pour les modules sans UE. */
	ue: string | null;
	/** Clé de repli stable : « ue:<titre> » (le « : » est interdit dans un
	    chemin Obsidian → aucune collision avec une vraie clé de dossier). */
	key: string;
	modules: ModuleGroup[];
	total: number;
	mastered: number;
}

/** Regroupe des modules par UE. UE dans l'ordre du document (map.ueOrder) ;
    « Sans UE » (modules non résolus) toujours en DERNIER. */
export function buildUeGroups(modules: ModuleGroup[], map: ModuleMap): UeGroup[] {
	const byUe = new Map<string, ModuleGroup[]>();
	for (const m of modules) {
		const k = m.ue ?? "";
		if (!byUe.has(k)) byUe.set(k, []);
		byUe.get(k)!.push(m);
	}
	const groups: UeGroup[] = [];
	const push = (ue: string | null) => {
		const list = byUe.get(ue ?? "");
		if (!list || !list.length) return;
		groups.push({
			ue,
			key: ue === null ? "ue:__none__" : "ue:" + ue,
			modules: list,
			total: list.reduce((s, m) => s + m.total, 0),
			mastered: list.reduce((s, m) => s + m.mastered, 0),
		});
	};
	for (const ue of map.ueOrder) push(ue);
	push(null); // « Sans UE » en dernier
	return groups;
}
```

- [ ] **Step 4 : typecheck**

Run : `npm run check`
Attendu : exit 0, aucune sortie.

- [ ] **Step 5 : vérifier les modules purs sous Node**

Bundler (jetable, hors dépôt) : `npx esbuild src/dashboard/quiz-modules.ts --bundle --format=cjs --outfile=<SCRATCHPAD>/qm.cjs --log-level=warning`

Écrire `<SCRATCHPAD>/check-modules.js` (outil **Write**), fixture calquée sur le vrai `Dashboard.md` d'Efrei :

```js
const { parseModuleMap, moduleForQuiz, buildModuleGroups, buildUeGroups } = require("./qm.cjs");
const P = "Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)";
const note = [
	"> [!portals] UE22CS - Infrastructure réseau et Solutions cloud",
	`> - [[${P}/XTI201 - CCNA 1/XTI201 - CCNA 1|XTI201 - CCNA 1]]`,
	"> [!portals] UE21CS - Systèmes d'exploitation et Virtualisation",
	`> - [[${P}/XTI207 - Gestion du parc informatique 1/XTI207 - Gestion du parc informatique 1|XTI207 - Gestion du parc informatique 1]]`,
	`> - [[${P}/XTI204 - Administration Système|XTI204-CS - Administration système]]`,
].join("\n");

const q = (path) => ({ path, basename: "x", title: "x", mtime: 0, questions: 1, types: [], quizType: "single" });
const quizzes = [
	...Array.from({ length: 19 }, (_, i) => q(`${P}/XTI201 - CCNA 1/a${i}.md`)),
	...Array.from({ length: 19 }, (_, i) => q(`${P}/syncthing/XTI201 - CCNA 1/b${i}.md`)), // doublon → doit rejoindre XTI201
	...Array.from({ length: 4 }, (_, i) => q(`${P}/XTI207 - Gestion du parc informatique 1/d${i}.md`)),
	q(`${P}/Révision - CM1.md`), // hors module → fallback dossier « B1 (2025-2026) », UE null
];
const stats = { [`${P}/XTI201 - CCNA 1/a0.md`]: { bestScore: 90 } };

const map = parseModuleMap(note);
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
ok(map.byFolder.get("XTI201 - CCNA 1")?.ue === "UE22CS - Infrastructure réseau et Solutions cloud", "UE de XTI201");
ok(map.byFolder.get("XTI204 - Administration Système")?.name === "XTI204-CS - Administration système", "alias XTI204");
ok(map.ueOrder.length === 2, "2 UE");

ok(moduleForQuiz(`${P}/syncthing/XTI201 - CCNA 1/b0.md`, map).folder === "XTI201 - CCNA 1", "syncthing → XTI201");

const mg = buildModuleGroups(quizzes, stats, map);
const xti201 = mg.find(g => g.folder === "XTI201 - CCNA 1");
ok(xti201 && xti201.total === 38, `XTI201 total 38 (19+19 syncthing), reçu ${xti201 && xti201.total}`);
ok(xti201 && xti201.mastered === 1, "XTI201 1 maîtrisé");
ok(mg.some(g => g.ue === null && g.total === 1), "1 module sans UE (le hors-module)");
const names = mg.map(g => g.name);
ok(JSON.stringify(names) === JSON.stringify([...names].sort((a,b)=>a.localeCompare(b))), "modules triés alpha");

const ue = buildUeGroups(mg, map);
ok(ue[ue.length - 1].ue === null, "Sans UE en dernier");
ok(ue[0].ue === map.ueOrder[0], "UE dans l'ordre du document");

console.log(fails.length ? "ÉCHECS:\n- " + fails.join("\n- ") : "Tout passe.");
process.exit(fails.length ? 1 : 0);
```

Run : `node <SCRATCHPAD>/check-modules.js`
Attendu : `Tout passe.`, exit 0. En particulier `syncthing → XTI201` et `XTI201 total 38` (le doublon rejoint le module, « syncthing » n'est jamais une clé).

- [ ] **Step 6 : commit**

```bash
git add src/dashboard/quiz-mastery.ts src/dashboard/quiz-modules.ts src/dashboard/quiz-recent.ts src/dashboard/quiz-type.ts
git commit -m "feat(quizzes): modules purs — seuil de maîtrise et regroupement par module/UE"
```

---

### Task 2 : réglages (`quizzesGrouping` étendu + note de correspondance)

**Files:**
- Modify: `src/plugin.ts` (interface `QuizBlocksSettings` ~l.62-73 ; `DEFAULT_SETTINGS` ~l.116-120)
- Modify: `src/types/dashboard-ctx.ts` (interface `AiSettings` ~l.76-79)

**Interfaces:**
- Produit : `settings.quizzesGrouping: "module" | "ue" | "recent" | "type"` ; `settings.quizzesModuleMapNote: string`. Task 4 les lit.

- [ ] **Step 1 : `plugin.ts`**

Dans `QuizBlocksSettings`, remplacer la ligne
`quizzesGrouping: "folder" | "recent" | "type";` par :

```ts
	quizzesGrouping: "module" | "ue" | "recent" | "type";
	/* Note de correspondance UE → module (encadrés `[!portals]`). Nom de
	   linkpath (résolu comme un lien Obsidian), défaut « Dashboard ». Absente
	   ou sans encadré → cartes au nom de dossier, sans UE (dégradation propre). */
	quizzesModuleMapNote: string;
```

Dans `DEFAULT_SETTINGS`, remplacer `quizzesGrouping: "folder",` par :

```ts
	// « module » : le défaut prévisible — une carte par module, cf. spec.
	quizzesGrouping: "module",
	quizzesModuleMapNote: "Dashboard",
```

- [ ] **Step 2 : `dashboard-ctx.ts`**

Dans `AiSettings`, remplacer
`quizzesGrouping?: "folder" | "recent" | "type";` par :

```ts
	quizzesGrouping?: "module" | "ue" | "recent" | "type";
	quizzesModuleMapNote?: string;
```

- [ ] **Step 3 : garder `tsc` vert (mini-ajustement de `quizzes.ts`)**

Changer l'union de `quizzesGrouping` casse le point d'usage de `quizzes.ts` :
`"folder"` n'existe plus. Chaque task doit finir avec `tsc` vert (le reviewer le
gate). Appliquer donc **le minimum** dans `quizzes.ts` (relocaliser au `grep -n`) :

- déclaration `type GroupingKey = "folder" | "recent" | "type";`
  → `type GroupingKey = "module" | "ue" | "recent" | "type";`
- ligne `return g === "recent" || g === "type" ? g : "folder";`
  → `return g === "recent" || g === "type" || g === "ue" || g === "module" ? g : "module";`

Ne rien changer d'autre : le reste de `quizzes.ts` compile toujours, et `"module"`
tombe dans le `else` de l'arbre (rend l'arbre **provisoirement** — remplacé en
Task 4). Ne PAS toucher au sélecteur ni aux constantes ici, c'est le travail de
la Task 4.

Run : `npm run check`
Attendu : exit 0.

- [ ] **Step 4 : commit**

```bash
git add src/plugin.ts src/types/dashboard-ctx.ts src/dashboard/quizzes.ts
git commit -m "feat(quizzes): réglages module/ue + note de correspondance (défaut Dashboard)"
```

---

### Task 3 : `module-card.ts` (carte de module)

**Files:**
- Create: `src/dashboard/module-card.ts`
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css`
- Modify: `src/i18n/en/dashboard.ts`, `src/i18n/fr/dashboard.ts`

**Interfaces:**
- Consomme : `ModuleGroup` (Task 1), `MASTERY_THRESHOLD` non requis ici (agrégats déjà calculés).
- Produit : `renderModuleCard(container, group, onOpen): HTMLDivElement`. Task 4 l'appelle.

- [ ] **Step 1 : clés i18n**

Dans `src/i18n/en/dashboard.ts`, après le bloc `groupBy…` existant :

```ts
	"dashboard.quizzes.groupByModule": "By module",
	"dashboard.quizzes.groupByUe": "By course unit",
	"dashboard.quizzes.noUe": "No course unit",
	"dashboard.quizzes.moduleQuizzesOne": "{count} quiz",
	"dashboard.quizzes.moduleQuizzesOther": "{count} quizzes",
	"dashboard.quizzes.backToModules": "All quizzes",
```

Dans `src/i18n/fr/dashboard.ts`, au même endroit :

```ts
	"dashboard.quizzes.groupByModule": "Par module",
	"dashboard.quizzes.groupByUe": "Par UE",
	"dashboard.quizzes.noUe": "Sans UE",
	"dashboard.quizzes.moduleQuizzesOne": "{count} quiz",
	"dashboard.quizzes.moduleQuizzesOther": "{count} quiz",
	"dashboard.quizzes.backToModules": "Tous les quiz",
```

- [ ] **Step 2 : `module-card.ts`**

```ts
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz), nommé
   et rattaché à son UE depuis la note de correspondance. Cliquer
   entre dans le module (drill-down géré par l'appelant). Pas de
   bouton lecture : un module contient N quiz, pas un seul.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-module-card" });
	// Liseré coloré selon l'avancement (vert si tout maîtrisé, accent sinon).
	const done = group.total > 0 && group.mastered >= group.total;
	card.createDiv({ cls: `qbd-quiz-card-accent qbd-module-card-accent--${done ? "done" : "partial"}` });
	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// UE en petite étiquette (au-dessus du nom, discrète). Omise si non résolue.
	if (group.ue) body.createEl("p", { cls: "qbd-module-card-ue", text: group.ue });

	body.createEl("p", { cls: "qbd-quiz-card-title", text: group.name });

	// Barre d'avancement — omise si rien n'est maîtrisé (une piste vide
	// n'apprend rien de plus que le « 0 » du compte, cf. quizzes.ts).
	if (group.mastered > 0) {
		const wrap = body.createDiv({ cls: "qbd-quiz-card-progress-wrap" });
		const bg = wrap.createDiv({ cls: "qbd-quiz-card-progress-bg" });
		const fill = bg.createDiv({ cls: "qbd-quiz-card-progress-fill" });
		fill.style.width = Math.round(group.mastered / group.total * 100) + "%";
	}

	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther", { count: group.total }),
	});
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: group.mastered }),
	});

	card.addEventListener("click", () => onOpen(group));
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
```

- [ ] **Step 3 : CSS**

Dans `src/assets/css/dashboard/dashboard-quizzes.css`, à la suite des règles `.qbd-quiz-card*` (réutilisées ici) :

```css
/* Carte de MODULE — réutilise le châssis de .qbd-quiz-card (liseré, filet,
   coins) ; seuls le liseré coloré par avancement et l'étiquette UE lui sont
   propres. */
.qbd-module-card {
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: var(--radius-l, 12px);
	padding: 16px;
	cursor: pointer;
	transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.2s ease, transform 0.08s ease;
	position: relative;
	overflow: hidden;
}

.qbd-module-card:hover {
	background: var(--background-secondary);
	border-color: var(--background-modifier-border-hover);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
	transform: translateY(-1px);
}

.qbd-module-card-accent--done { background: var(--color-green, #4ade80); }
.qbd-module-card-accent--partial { background: var(--interactive-accent); }

.qbd-module-card-ue {
	font-size: 10px;
	font-weight: 600;
	color: var(--text-faint);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin: 0 0 4px;
}
```

- [ ] **Step 4 : typecheck**

Run : `npm run check`
Attendu : exit 0. (`renderModuleCard` pas encore appelé — normal, Task 4 le branche. Pas de code mort au sens fautif : c'est une dépendance de la task suivante, comme un module livré avant son consommateur.)

- [ ] **Step 5 : commit**

```bash
git add src/dashboard/module-card.ts src/assets/css/dashboard/dashboard-quizzes.css src/i18n/en/dashboard.ts src/i18n/fr/dashboard.ts
git commit -m "feat(quizzes): carte de module (nom, UE, compte, avancement)"
```

---

### Task 4 : intégration dans `quizzes.ts` (grille modules, axe UE, drill-down, sélecteur 4 axes)

**Files:**
- Modify: `src/dashboard/quizzes.ts`
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css` (grille + fil d'Ariane)

**Interfaces:**
- Consomme : `parseModuleMap`, `moduleForQuiz`, `buildModuleGroups`, `buildUeGroups`, `ModuleMap`, `ModuleGroup`, `UeGroup` (Task 1) ; `renderModuleCard` (Task 3) ; `MASTERY_THRESHOLD`, `isMastered` (`quiz-mastery`) ; `renderQuizCard`, `openQuizForPlay` existants.

**Contexte :** c'est la grosse task. Elle (a) lit la note de correspondance en async et la met en cache ; (b) remplace le mode « arbre » par la **grille de cartes de module** ; (c) ajoute l'**axe UE** (en-têtes d'UE repliables + cartes de module) ; (d) ajoute le **drill-down** (état `openModuleFolder`, fil d'Ariane) ; (e) passe le **sélecteur à 4 axes** ; (f) **retire** `buildQuizTree`/`QuizTreeNode`/`renderNode` et l'indentation. Le fichier doit finir **< 350 lignes** — le retrait de l'arbre (~55 lignes) et l'externalisation compensent les ajouts.

- [ ] **Step 1 : imports**

Remplacer les lignes d'import de l'arbre :

```ts
import { buildQuizTree, MASTERY_THRESHOLD } from "./quiz-tree";
import type { QuizTreeNode } from "./quiz-tree";
```

par :

```ts
import { MASTERY_THRESHOLD, isMastered } from "./quiz-mastery";
import {
	parseModuleMap, buildModuleGroups, buildUeGroups,
} from "./quiz-modules";
import type { ModuleMap, ModuleGroup } from "./quiz-modules";
import { renderModuleCard } from "./module-card";
```

- [ ] **Step 2 : état module (cache de la note) + état drill-down**

Dans `createQuizzesHandlers`, à côté de `let containerRef`, ajouter :

```ts
	/* Table module lue depuis la note de correspondance, mise en cache : la
	   lecture est ASYNC (vault.read) alors que render() est synchrone. null
	   tant que non chargée → dégradation (moduleForQuiz retombe sur le dossier
	   parent, sans UE). loadModuleMap() la peuple à l'ouverture de la vue puis
	   re-rend. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;
	/* Module ouvert (drill-down) : null = grille ; sinon on affiche les quiz de
	   ce module + un fil d'Ariane. État d'INTERFACE, non persisté. */
	let openModuleFolder: string | null = null;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		try {
			const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
			const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
			if (file) {
				const text = await ctx.app.vault.cachedRead(file);
				moduleMap = parseModuleMap(text);
			} else {
				moduleMap = { byFolder: new Map(), ueOrder: [] };
			}
		} catch (e) {
			moduleMap = { byFolder: new Map(), ueOrder: [] };
		}
		if (containerRef) render(containerRef);
	}

	/** Map effective au rendu : la vraie si chargée, sinon une map vide (les
	    quiz retombent sur leur dossier parent, sans UE). */
	function effectiveMap(): ModuleMap {
		return moduleMap ?? { byFolder: new Map(), ueOrder: [] };
	}
```

- [ ] **Step 3 : sélecteur 4 axes**

Remplacer la déclaration et les constantes de regroupement (`type GroupingKey`, `currentGrouping`, `GROUPING_ORDER`, `GROUPING_LABEL_KEYS`) par :

```ts
	type GroupingKey = "module" | "ue" | "recent" | "type";

	function currentGrouping(): GroupingKey {
		const g = ctx.plugin.settings.quizzesGrouping;
		// « folder » (ancienne valeur) migre vers « module ».
		return g === "ue" || g === "recent" || g === "type" ? g : "module";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.plugin.settings.quizzesGrouping = g;
		ctx.plugin.saveSettings().catch(() => {});
	}

	// Ordre FIXE du menu : « module » en tête (défaut prévisible).
	const GROUPING_ORDER: GroupingKey[] = ["module", "ue", "recent", "type"];
	const GROUPING_LABEL_KEYS: Record<GroupingKey, TransKey> = {
		module: "dashboard.quizzes.groupByModule",
		ue: "dashboard.quizzes.groupByUe",
		recent: "dashboard.quizzes.groupByActivity",
		type: "dashboard.quizzes.groupByType",
	};
```

- [ ] **Step 4 : déclencher le chargement + fil d'Ariane dans `render`**

Au début de `render`, juste après `container.empty();` et la récupération de `quizzes`/`stats`, ajouter le déclenchement paresseux **une fois** :

```ts
		if (!moduleMapLoaded) { void loadModuleMap(); }
```

Puis, en mode drill-down, afficher un fil d'Ariane à la place du sélecteur. Le plus simple : **après** la barre de filtres, brancher sur `openModuleFolder`. Remplacer le bloc `// ── Arbre ──` par :

```ts
		// ── Contenu ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		if (openModuleFolder !== null) {
			renderModuleDrill(treeEl, quizzes, stats);
		} else {
			renderQuizGrid(treeEl, quizzes, stats);
		}
```

Et masquer le sélecteur de regroupement en drill-down (il n'a pas de sens dans un module). Entourer la création de `groupWrap`/`groupBtn` d'un `if (openModuleFolder === null) { … }`.

- [ ] **Step 5 : filtrage partagé**

Extraire le filtre (aujourd'hui inline dans `renderQuizGrid`) en une fonction, réutilisée par la grille ET le drill-down :

```ts
	function applyFilters(quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): QuizIndexEntry[] {
		return quizzes.filter(q => {
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
			const s = stats[q.path];
			if (currentFilter === "progress") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "mastered") return s && s.bestScore >= MASTERY_THRESHOLD;
			if (currentFilter === "fresh") return !s || s.questionsDone === 0;
			return true;
		});
	}
```

- [ ] **Step 6 : remplacer `renderQuizGrid`**

Remplacer entièrement `renderQuizGrid` (et **supprimer** `renderNode`, les constantes `INDENT_PX`/`MAX_INDENT_LEVELS`) par :

```ts
	function renderQuizGrid(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		treeEl.empty();
		const filtered = applyFilters(quizzes, stats);
		if (filtered.length === 0) {
			treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
			return;
		}
		const mode = currentGrouping();
		if (mode === "recent") {
			for (const g of buildRecentGroups(filtered, stats)) {
				renderFlatGroup(treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.total, g.mastered, g.quizzes, stats);
			}
		} else if (mode === "type") {
			for (const g of buildTypeGroups(filtered, stats)) {
				renderFlatGroup(treeEl, `type:${g.type}`, quizTypeLabel(g.type), g.total, g.mastered, g.quizzes, stats);
			}
		} else if (mode === "ue") {
			const modules = buildModuleGroups(filtered, stats, effectiveMap());
			for (const ue of buildUeGroups(modules, effectiveMap())) {
				renderUeGroup(treeEl, ue, stats);
			}
		} else {
			// mode « module » : grille plate de cartes de module.
			const grid = treeEl.createDiv({ cls: "qbd-module-grid" });
			for (const m of buildModuleGroups(filtered, stats, effectiveMap())) {
				renderModuleCard(grid, m, (g) => { openModuleFolder = g.folder; if (containerRef) render(containerRef); });
			}
		}
	}

	/* Axe UE : en-tête d'UE repliable (même mécanique que renderFlatGroup),
	   puis une grille de cartes de MODULE dessous. */
	function renderUeGroup(parent: HTMLElement, ue: UeGroupT, stats: Record<string, QuizStatRecord>): void {
		const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
		const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
		head.type = "button";
		const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
		head.createSpan({ cls: "qbd-quizzes-node-label", text: ue.ue ?? t("dashboard.quizzes.noUe") });
		fillNodeHeadStats(head, ue.total, ue.mastered);
		const collapsed = wireCollapseToggle(head, chev, ue.key);
		if (collapsed) return;
		const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
		const grid = body.createDiv({ cls: "qbd-module-grid" });
		for (const m of ue.modules) {
			renderModuleCard(grid, m, (g) => { openModuleFolder = g.folder; if (containerRef) render(containerRef); });
		}
	}
```

Ajouter en tête du fichier l'import de type manquant (aliasé pour éviter la collision de nom locale) :
`import type { UeGroup as UeGroupT } from "./quiz-modules";` (ou inclure `UeGroup` dans l'import de type du Step 1 et utiliser `UeGroup` directement — au choix de l'implémenteur, tant que le type est importé).

- [ ] **Step 7 : le drill-down**

Ajouter la fonction de drill-down (grille de quiz du module ouvert + fil d'Ariane) :

```ts
	function renderModuleDrill(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		treeEl.empty();
		const map = effectiveMap();
		// Fil d'Ariane : « ‹ Tous les quiz » → nom du module.
		const crumb = treeEl.createDiv({ cls: "qbd-quizzes-breadcrumb" });
		const back = crumb.createEl("button", { cls: "qbd-quizzes-crumb-back" });
		back.type = "button";
		const backIcon = back.createSpan({ cls: "qbd-quizzes-crumb-icon" });
		setIcon(backIcon, "chevron-left");
		back.createSpan({ text: t("dashboard.quizzes.backToModules") });
		back.addEventListener("click", () => { openModuleFolder = null; if (containerRef) render(containerRef); });

		// Nom du module ouvert (depuis la table ; fallback = le dossier).
		const info = map.byFolder.get(openModuleFolder!);
		crumb.createSpan({ cls: "qbd-quizzes-crumb-current", text: info ? info.name : openModuleFolder! });

		// Quiz du module = ceux dont le module résolu == openModuleFolder, filtrés.
		const inModule = applyFilters(quizzes, stats).filter(q =>
			buildModuleGroups([q], stats, map)[0]?.folder === openModuleFolder
		);
		if (inModule.length === 0) {
			treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
			return;
		}
		const grid = treeEl.createDiv({ cls: "qbd-home-grid" });
		for (const quiz of inModule) {
			renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
				onPlay: (q) => openQuizForPlay(ctx.app, q),
			});
		}
	}
```

> Note perf : `buildModuleGroups([q], …)` par quiz est O(n) sur un module (n ≤ quelques dizaines chez Ahmed), acceptable. Si l'implémenteur préfère, exposer `moduleForQuiz` (déjà exporté en Task 1) et filtrer via `moduleForQuiz(q.path, map).folder === openModuleFolder` — plus direct. **Recommandé : utiliser `moduleForQuiz`** (l'importer). Le corriger ainsi si `moduleForQuiz` est importé.

- [ ] **Step 8 : typecheck + build + reload**

```bash
npm run check
npm run build
obsidian vault="Efrei" eval code="(async()=>{await app.plugins.disablePlugin('quiz-blocks');await app.plugins.enablePlugin('quiz-blocks');return 'ok'})()"
```
Attendu : `check` exit 0 ; `Build terminé.` ; `ok`.

- [ ] **Step 9 : CSS grille de modules + fil d'Ariane**

Dans `dashboard-quizzes.css` :

```css
/* Grille de cartes de module : mêmes colonnes responsives que .qbd-home-grid. */
.qbd-module-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 12px;
}

.qbd-quizzes-breadcrumb {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
	font-size: 13px;
}

.qbd-root .qbd-quizzes-crumb-back {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	background: transparent;
	border: none;
	box-shadow: none;
	padding: 4px 6px;
	border-radius: var(--radius-s, 6px);
	color: var(--text-muted);
	cursor: pointer;
}

.qbd-root .qbd-quizzes-crumb-back:hover {
	background: var(--background-modifier-hover);
	color: var(--text-normal);
}

.qbd-quizzes-crumb-current {
	font-weight: 600;
	color: var(--text-normal);
}
```

- [ ] **Step 10 : PROUVER à l'écran** (rituel throttling + capture lue, croisé DOM). Le réglage `quizzesModuleMapNote` vaut `Dashboard` ; Efrei a bien `Dashboard.md`.

Mesures attendues :
1. Mode « module » : une carte par module à quiz — au minimum `XTI201 - CCNA 1` et `XTI207 …` ; **aucun** `.qbd-quizzes-node-label` contenant « Bachelor » ou « syncthing », **aucun** chemin brut.
2. La carte `XTI201` compte **38** quiz (19 + 19 syncthing rejoints) — DOM : le compte de la carte.
3. Mode « UE » : en-têtes d'UE (`UE22CS …`, `UE21CS …`), cartes de module dessous ; module sans UE → groupe « Sans UE » en dernier.
4. Clic sur `XTI201` → fil d'Ariane « Tous les quiz › XTI201 - CCNA 1 » + les quiz du module ; clic « Tous les quiz » → retour à la grille.
5. Recherche + filtres actifs dans les deux vues.
6. Modes activité/type inchangés.

- [ ] **Step 11 : commit**

```bash
git add src/dashboard/quizzes.ts src/assets/css/dashboard/dashboard-quizzes.css
git commit -m "feat(quizzes): grille de modules, axe UE et drill-down; retrait de l'arbre"
```

---

### Task 5 : retrait de `quiz-tree.ts` + couverture d'états + vérification finale

**Files:**
- Delete: `src/dashboard/quiz-tree.ts`
- Modify: selon défauts trouvés.

- [ ] **Step 1 : vérifier que `quiz-tree.ts` est orphelin, puis le supprimer**

```bash
grep -rn "quiz-tree" src/
```
Attendu après Tasks 1-4 : **aucune** référence (recent/type repointés en Task 1, quizzes.ts en Task 4). Si une référence subsiste, la repointer vers `quiz-mastery.ts` **avant** de supprimer. Puis :
```bash
git rm src/dashboard/quiz-tree.ts
npm run check
```
Attendu : `check` exit 0.

- [ ] **Step 2 : couverture des états frères (skill `senior-dev:state-coverage`)**

| État | Attendu |
|---|---|
| `Dashboard.md` présent | cartes nommées + UE (mesuré Task 4) |
| Réglage `quizzesModuleMapNote` pointant une note **absente** | dégradation : cartes au nom de dossier, **sans UE**, pas de plantage |
| Note présente mais **sans** encadré `[!portals]` | idem : map vide, noms de dossier |
| Quiz hors module (les orphelins, tant qu'Ahmed n'a pas rangé) | carte au nom du dossier parent, groupe « Sans UE » en mode UE |
| Filtre ne laissant aucun quiz | état vide, aucune carte |
| Recherche dans un module (drill-down) | filtre les quiz du module, le fil d'Ariane reste |
| Repli d'un en-tête d'UE, recharger | l'état de repli survit (clé `ue:…` dans `quizzesExpandedFolders`) |
| Thème clair / sombre | cartes lisibles, liseré visible dans les deux |
| 360 px | grille repasse en 1 colonne, cartes non écrasées |

- [ ] **Step 3 : mobile (règle absolue)**

```bash
grep -n "isDesktopOnly" src/assets/manifest.json
grep -rn "require(\|process\.\|from \"fs\"\|from \"path\"" src/dashboard/quiz-modules.ts src/dashboard/quiz-mastery.ts src/dashboard/module-card.ts
```
Attendu : `"isDesktopOnly": false` ; **aucun** résultat au second grep (DOM pur + `vault` côté quizzes.ts uniquement, pas d'accès Node).

- [ ] **Step 4 : vérification finale**

```bash
npm run check
git log --oneline main~6..HEAD
wc -l src/dashboard/quizzes.ts
grep -c "qbd-module-card" C:/obsidian-vaults/Efrei/.obsidian/plugins/quiz-blocks/main.js
git status --short
```
Attendu : typecheck vert ; **`quizzes.ts` < 350 lignes** ; `main.js` contient `qbd-module-card` (≥ 1) ; dépôt propre (hors `CLAUDE.md`).

- [ ] **Step 5 : rapport à Ahmed** — ce qui marche (preuves), les écarts assumés (orphelins non rangés → « Sans UE » ; syncthing rejoint XTI201). Le push est fait par le contrôleur/Ahmed.

---

## Notes d'exécution

- **Les numéros de ligne bougent** : relocaliser au `grep -n` avant chaque greffe.
- **`render()` fait `container.empty()`** : ne garder aucune référence DOM entre deux rendus ; `containerRef` est réassigné à chaque rendu.
- **`quizzes.ts` doit finir < 350 lignes** : c'est un critère de la Task 5. Si l'ajout du drill-down le fait déborder, extraire `renderModuleDrill` (ou le rendu des groupes) dans un module dédié plutôt que de rogner la lisibilité.
- **`Date.now()` est autorisé** dans le code plugin (runtime Obsidian) — la restriction ne vise que les scripts de workflow, hors sujet ici.
- Les **12 quiz orphelins** et le **doublon syncthing** restent côté vault d'Ahmed ; le plugin les gère (fallback « Sans UE » / rattachement à XTI201), il ne les déplace pas.
