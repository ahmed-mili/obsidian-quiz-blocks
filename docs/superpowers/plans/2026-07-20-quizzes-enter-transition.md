# Quizzes Enter Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rejouer la transition d'entrée du drill-down (hero + cascade de cartes) à chaque entrée dans une vue de « Mes quiz » — navigation entrante, retour « All quizzes », bascule UE↔Récent — et jamais sur un re-render interne.

**Architecture:** Le contrôleur (`quizzes.ts`) compare la vue peinte à la précédente (`lastPaintedView`) et pose la classe `qbd-quizzes-enter` sur le contenant uniquement quand la vue change. Toutes les animations d'apparition (drill existant + nouvelles règles racine) sont scoped sous cette classe. Le peintre (`quizzes-render.ts`) pose un cran de cascade `--qbd-card-delay` sur chaque en-tête de section et chaque carte de dossier via un compteur global.

**Tech Stack:** TypeScript strict, CSS natif, script de contrat Node.js (`scripts/check-folder-drill-design.mjs`), build esbuild du plugin Obsidian.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-20-quizzes-enter-transition-design.md`.
- Aucune nouvelle chaîne visible (pas d'i18n), aucun changement de données persistées.
- Commentaires en français ; `npm run check` doit passer après chaque task.
- Formule de cascade IDENTIQUE au drill : `120 + i × 60 ms` (`quiz-card.ts:74`).
- Les contrats EXISTANTS de `scripts/check-folder-drill-design.mjs` doivent rester PASS à chaque task (leurs regex non ancrées survivent au déplacement des règles).
- Aucun `!important`, aucun changement de `.qbd-content` hors pose/retrait de classe.

---

### Task 1: Contrôleur — classe d'entrée `qbd-quizzes-enter`

**Files:**
- Modify: `src/dashboard/quizzes.ts` (état ~l.84, `setGrouping` ~l.63, `loadModuleMap` ~l.109, `render` ~l.164, `resetDrilldown` ~l.304)
- Modify: `src/dashboard.ts:190-193` (`renderCurrentView`)
- Test: `scripts/check-folder-drill-design.mjs`

**Interfaces:**
- Consumes: `openModuleFolder: string | null` (état existant de `createQuizzesHandlers`).
- Produces: la classe CSS `qbd-quizzes-enter` sur le contenant de la page (consommée par la Task 3) ; sémantique : présente = ce rendu est une ENTRÉE.

- [ ] **Step 1: Écrire les contrats en échec**

Ajouter en tête de `scripts/check-folder-drill-design.mjs` (après la lecture de `card`) :

```js
const dashboard = readFileSync("src/dashboard.ts", "utf8");
```

et ajouter à la fin du tableau `checks` :

```js
	["le contrôleur distingue l'entrée du re-render interne", /const viewKey = openModuleFolder \?\? "root";[\s\S]*?const entering = viewKey !== lastPaintedView;[\s\S]*?classList\.toggle\("qbd-quizzes-enter", entering\)/, quizzes],
	["nav entrante, bascule d'axe et note de correspondance ré-arment l'entrée", /(?:[\s\S]*?lastPaintedView = null\b){3}/, quizzes],
	["une autre page ne garde jamais la classe d'entrée", /removeClass\("qbd-quizzes-enter"\)/, dashboard],
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`
Expected: `FAIL` pour les trois nouveaux contrats, aucun autre FAIL.

- [ ] **Step 3: Implémenter l'armement dans `quizzes.ts`**

Sous la déclaration de `openModuleFolder` (~l.84), ajouter :

```ts
	/* Dernière vue PEINTE ("root" ou chemin du dossier ouvert) : render() la
	   compare à la vue courante pour distinguer une ENTRÉE (navigation, drill
	   in/out, bascule d'axe — la transition d'entrée joue) d'un re-render
	   interne (renommage, archivage, icône — aucun replay). null = la
	   prochaine peinture est une entrée. */
	let lastPaintedView: string | null = null;
```

Dans `render()`, juste après `container.empty();` (~l.164), ajouter :

```ts
		// Transition d'entrée (spec 2026-07-20) : classe posée SEULEMENT quand
		// la vue change. toggle(force) la retire sur un re-render interne —
		// jamais de replay, jamais de classe résiduelle.
		const viewKey = openModuleFolder ?? "root";
		const entering = viewKey !== lastPaintedView;
		lastPaintedView = viewKey;
		container.classList.toggle("qbd-quizzes-enter", entering);
```

Dans `setGrouping()` (~l.63), avant `ctx.plugin.saveSettings()` :

```ts
		// La bascule d'axe reconstruit toute la grille : la cascade d'entrée
		// accompagne le changement (décision Ahmed, spec 2026-07-20).
		lastPaintedView = null;
```

Dans `loadModuleMap()` (~l.109), juste avant `if (containerRef) render(containerRef);` :

```ts
		// Le premier rendu (map absente) est repeint ici quelques ms plus
		// tard : sans ré-armement, ce second rendu couperait net la transition
		// d'entrée à peine commencée (cartes soudain opaques).
		lastPaintedView = null;
```

Dans le `return` final, remplacer :

```ts
		resetDrilldown() { openModuleFolder = null; },
```

par :

```ts
		resetDrilldown() { openModuleFolder = null; lastPaintedView = null; },
```

- [ ] **Step 4: Implémenter le nettoyage dans `dashboard.ts`**

Dans `renderCurrentView()`, juste après `contentEl.empty();` (l.193), ajouter :

```ts
		// La classe d'entrée de « Mes quiz » ne doit pas survivre sur une
		// autre page (le contentEl est partagé par toutes les vues).
		contentEl.removeClass("qbd-quizzes-enter");
```

- [ ] **Step 5: Vérifier contrats + typecheck**

Run: `node scripts/check-folder-drill-design.mjs && npm run check`
Expected: `PASS: contrat visuel du dossier ouvert`, tsc code de sortie 0.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/quizzes.ts src/dashboard.ts scripts/check-folder-drill-design.mjs
git commit -m "feat(quizzes): classe d'entrée qbd-quizzes-enter armée par vue peinte"
```

---

### Task 2: Peintre — cascade racine (compteur global)

**Files:**
- Modify: `src/dashboard/quizzes-render.ts` (`renderCollapsibleSection` l.116, `renderModuleGrid` l.132, `renderUeGroup` l.152, `renderQuizGrid` l.159-208)
- Test: `scripts/check-folder-drill-design.mjs`

**Interfaces:**
- Consumes: `renderModuleCard(...): HTMLDivElement` (module-card.ts, retourne la carte).
- Produces: `--qbd-card-delay` inline sur chaque `.qbd-quizzes-node` (hérité par son head) et chaque `.qbd-module-card` — consommé par les règles CSS de la Task 3. Signatures internes modifiées : `renderCollapsibleSection(deps, parent, key, label, total, entryDelay: () => string, defaultOpen = true)`, `renderModuleGrid(deps, parent, groups, map, entryDelay: () => string)`, `renderUeGroup(deps, parent, ue, map, entryDelay: () => string)`.

- [ ] **Step 1: Écrire les contrats en échec**

Ajouter à la fin du tableau `checks` :

```js
	["la cascade racine traverse toutes les sections avec la formule du drill", /let entryIndex = 0;\s*\n\s*const entryDelay = \(\): string => `\$\{120 \+ entryIndex\+\+ \* 60\}ms`;/, render],
	["chaque en-tête de section et chaque carte de dossier prend son cran", /nodeEl\.style\.setProperty\("--qbd-card-delay", entryDelay\(\)\)[\s\S]*card\.style\.setProperty\("--qbd-card-delay", entryDelay\(\)\)/, render],
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`
Expected: `FAIL` pour les deux nouveaux contrats, aucun autre FAIL.

- [ ] **Step 3: Threader le compteur dans `quizzes-render.ts`**

Dans `renderQuizGrid`, juste après `treeEl.empty();` (l.171), ajouter :

```ts
	// Cascade d'ENTRÉE globale : un seul compteur traverse toutes les
	// sections (en-têtes ET cartes de dossier) — même formule que les cartes
	// du drill (quiz-card.ts). Les délais sont posés à chaque rendu mais
	// restent inertes hors .qbd-quizzes-enter (aucune animation à consommer).
	let entryIndex = 0;
	const entryDelay = (): string => `${120 + entryIndex++ * 60}ms`;
```

Modifier `renderCollapsibleSection` — nouvelle signature et pose du délai :

```ts
function renderCollapsibleSection(deps: GridDeps, parent: HTMLElement, key: string, label: string, total: number, entryDelay: () => string, defaultOpen = true): HTMLElement {
	const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
	// Cran de cascade d'entrée : la variable vit sur le nœud (héritée par le
	// head qui porte l'animation, cf. dashboard-quizzes.css).
	nodeEl.style.setProperty("--qbd-card-delay", entryDelay());
```

(le reste du corps est inchangé).

Modifier `renderModuleGrid` — nouvelle signature et pose du délai sur la carte (la boucle `for` finale remplace l'existante) :

```ts
function renderModuleGrid(deps: GridDeps, parent: HTMLElement, groups: ModuleGroup[], map: ModuleMap, entryDelay: () => string): void {
```

```ts
	for (const g of groups) {
		const card = renderModuleCard(grid, g, (m) => deps.openModule(m.folder), menu, pickIcon);
		card.style.setProperty("--qbd-card-delay", entryDelay());
	}
```

Modifier `renderUeGroup` :

```ts
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup, map: ModuleMap, entryDelay: () => string): void {
	const body = renderCollapsibleSection(deps, parent, ue.key, ue.ue ?? t("dashboard.quizzes.noUe"), ue.modules.length, entryDelay);
	renderModuleGrid(deps, body, ue.modules, map, entryDelay);
}
```

Mettre à jour les TROIS sites d'appel dans `renderQuizGrid` :

```ts
			const body = renderCollapsibleSection(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.modules.length, entryDelay);
			renderModuleGrid(deps, body, g.modules, map, entryDelay);
```

```ts
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue, map, entryDelay);
```

```ts
		const body = renderCollapsibleSection(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archivedModules.length, entryDelay, false);
		renderModuleGrid(deps, body, archivedModules, map, entryDelay);
```

- [ ] **Step 4: Vérifier contrats + typecheck**

Run: `node scripts/check-folder-drill-design.mjs && npm run check`
Expected: `PASS: contrat visuel du dossier ouvert`, tsc code de sortie 0.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/quizzes-render.ts scripts/check-folder-drill-design.mjs
git commit -m "feat(quizzes): cascade d'entrée globale sur sections et cartes de dossier"
```

---

### Task 3: CSS — scoping sous `.qbd-quizzes-enter` + règles racine

**Files:**
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css` (bloc hero l.467-471, bloc `.qbd-progress-panel` l.667-684, bloc reduced-motion l.860-870, nouvelles règles après les @keyframes l.455-463)
- Modify: `src/assets/css/dashboard/dashboard-components.css` (bloc `.qbd-quiz-card--folder` l.804-817)
- Test: `scripts/check-folder-drill-design.mjs`

**Interfaces:**
- Consumes: la classe `qbd-quizzes-enter` (Task 1) et `--qbd-card-delay` (Task 2 pour la racine, `quiz-card.ts:74` pour le drill).
- Produces: le contrat visuel final — animations d'apparition UNIQUEMENT sous `.qbd-quizzes-enter`.

- [ ] **Step 1: Écrire les contrats en échec**

Ajouter à la fin du tableau `checks` :

```js
	["hero, header racine et sélecteur d'axe entrent ensemble", /\.qbd-quizzes-enter \.qbd-quizzes-folder-hero,\s*\.qbd-quizzes-enter > \.qbd-quizzes-header,\s*\.qbd-quizzes-enter > \.qbd-quizzes-group\s*\{[^}]*animation:\s*qbd-folder-hero-in 0\.45s ease both;/s, css],
	["hors entrée le hero n'a plus d'animation propre", /\.qbd-quizzes-folder-hero\s*\{(?=[^}]*position:\s*relative)(?![^}]*animation)[^}]*\}/s, css],
	["en-têtes de section et cartes de dossier entrent en cascade", /\.qbd-quizzes-enter \.qbd-quizzes-node-head,\s*\.qbd-quizzes-enter \.qbd-module-card\s*\{[^}]*animation:\s*qbd-folder-card-in 0\.5s cubic-bezier\(0\.2, 0\.7, 0\.3, 1\) both;[^}]*animation-delay:\s*var\(--qbd-card-delay, 120ms\);/s, css],
	["le panneau Progrès n'entre que sous la classe d'entrée", /\.qbd-quizzes-enter \.qbd-progress-panel\s*\{[^}]*animation:\s*qbd-folder-card-in[^}]*animation-delay:\s*220ms;/s, css],
	["les cartes quiz du drill n'animent qu'à l'entrée", /\.qbd-quizzes-enter \.qbd-quiz-card\.qbd-quiz-card--folder\s*\{[^}]*animation:\s*qbd-folder-card-in[^}]*animation-delay:\s*var\(--qbd-card-delay, 120ms\);/s, components],
	["hors entrée la carte dossier n'a plus d'animation propre", /\.qbd-quiz-card\.qbd-quiz-card--folder\s*\{(?=[^}]*backdrop-filter)(?![^}]*animation)[^}]*\}/s, components],
	["reduced-motion neutralise toute la transition d'entrée", /prefers-reduced-motion[\s\S]*\.qbd-quizzes-enter \.qbd-module-card,[\s\S]*animation:\s*none/, css],
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`
Expected: `FAIL` pour les sept nouveaux contrats, aucun autre FAIL.

- [ ] **Step 3: Scoper et compléter `dashboard-quizzes.css`**

Retirer la ligne `animation: qbd-folder-hero-in 0.45s ease both;` du bloc `.qbd-quizzes-folder-hero` (l.470).

Retirer les lignes `animation: qbd-folder-card-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;` et `animation-delay: 220ms;` du bloc `.qbd-progress-panel` (l.682-683).

Ajouter juste après le `@keyframes qbd-folder-card-in` (l.463) :

```css
/* ── Transition d'ENTRÉE — classe posée par quizzes.ts sur le contenant
   quand on ARRIVE (navigation, drill in/out, bascule d'axe), jamais sur un
   re-render interne : hors de cette classe, aucun de ces éléments n'a
   d'animation — renommer/archiver ne fait pas clignoter la page.
   `>` : le header et le sélecteur RACINE seulement — en drill le header vit
   dans le hero déjà animé, l'animer aussi doublerait fondu et translation. */
.qbd-quizzes-enter .qbd-quizzes-folder-hero,
.qbd-quizzes-enter > .qbd-quizzes-header,
.qbd-quizzes-enter > .qbd-quizzes-group {
	animation: qbd-folder-hero-in 0.45s ease both;
}

/* Cascade racine : le cran (--qbd-card-delay) est posé par
   quizzes-render.ts — sur le nœud de section (hérité par le head) et sur
   chaque carte de dossier. */
.qbd-quizzes-enter .qbd-quizzes-node-head,
.qbd-quizzes-enter .qbd-module-card {
	animation: qbd-folder-card-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
	animation-delay: var(--qbd-card-delay, 120ms);
}

.qbd-quizzes-enter .qbd-progress-panel {
	animation: qbd-folder-card-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
	animation-delay: 220ms;
}
```

Remplacer le bloc reduced-motion (l.860-870) par :

```css
@media (prefers-reduced-motion: reduce) {
	.qbd-quizzes-enter .qbd-quizzes-folder-hero,
	.qbd-quizzes-enter > .qbd-quizzes-header,
	.qbd-quizzes-enter > .qbd-quizzes-group,
	.qbd-quizzes-enter .qbd-quizzes-node-head,
	.qbd-quizzes-enter .qbd-module-card,
	.qbd-quizzes-enter .qbd-quiz-card.qbd-quiz-card--folder,
	.qbd-quizzes-enter .qbd-progress-panel {
		animation: none;
	}

	.qbd-quiz-card.qbd-quiz-card--folder {
		transition: none;
	}
}
```

- [ ] **Step 4: Scoper `dashboard-components.css`**

Dans le bloc `.qbd-quiz-card.qbd-quiz-card--folder` (l.804-817), retirer les deux lignes :

```css
	animation: qbd-folder-card-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
	animation-delay: var(--qbd-card-delay, 120ms);
```

et ajouter, juste après ce bloc :

```css
/* L'apparition ne joue qu'à l'ENTRÉE de la vue (classe posée par
   quizzes.ts) : un re-render interne du drill (reset de stats) ne fait plus
   clignoter les cartes. Keyframes définis dans dashboard-quizzes.css. */
.qbd-quizzes-enter .qbd-quiz-card.qbd-quiz-card--folder {
	animation: qbd-folder-card-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
	animation-delay: var(--qbd-card-delay, 120ms);
}
```

- [ ] **Step 5: Vérifier contrats + absence de doublons**

Run: `node scripts/check-folder-drill-design.mjs && npm run check`
Expected: `PASS: contrat visuel du dossier ouvert`, tsc code de sortie 0.

Run: `grep -n "animation: qbd-folder" src/assets/css/dashboard/*.css`
Expected: chaque occurrence est dans une règle dont le sélecteur contient `.qbd-quizzes-enter` (3 dans dashboard-quizzes.css : hero/header/groupe, cascade, panneau Progrès ; 1 dans dashboard-components.css) — aucune règle non scoped restante.

- [ ] **Step 6: Commit**

```bash
git add src/assets/css/dashboard/dashboard-quizzes.css src/assets/css/dashboard/dashboard-components.css scripts/check-folder-drill-design.mjs
git commit -m "feat(quizzes): transition d'entrée scoped .qbd-quizzes-enter + cascade racine"
```

---

### Task 4: Build, reload et vérification dans Obsidian

**Files:**
- Aucune modification attendue (vérification seulement ; corriger sur place si un point échoue).

**Interfaces:**
- Consumes: le plugin déployé (`npm run build` copie dans les vaults) et le CLI Obsidian (invoquer le skill `obsidian:cli` avant toute commande `obsidian ...` ; TOUJOURS `vault="Efrei"`).

- [ ] **Step 1: Build et déploiement**

Run: `npm run build`
Expected: code de sortie 0, déploiement auto dans les vaults (dont `Efrei`).

- [ ] **Step 2: Recharger le plugin**

Run: `obsidian vault="Efrei" plugin:reload id=quiz-blocks`
Expected: sortie de succès du CLI.

- [ ] **Step 3: Vérifier l'armement dans le DOM réel**

Via `obsidian vault="Efrei" eval` (ou dev:dom), après avoir ouvert le dashboard :
1. Naviguer Generate → My quizzes (clic rail) puis lire immédiatement : `document.querySelector(".qbd-content")?.classList.contains("qbd-quizzes-enter")` → `true`, et `getComputedStyle(document.querySelector(".qbd-module-card")).animationName` → `qbd-folder-card-in`.
2. Entrer dans un dossier puis cliquer « All quizzes » : la classe est encore `true` et les `.qbd-module-card` portent des `--qbd-card-delay` croissants de 60 ms en 60 ms (en-têtes de section compris).
3. Déclencher un re-render interne (changer l'icône d'un dossier via sa pastille) : la classe repasse à `false`, `animationName` → `none`.

- [ ] **Step 4: Vérification visuelle réelle**

Avec le skill `obsidian:screenshot` : capturer pendant la cascade (navigation rail → capture immédiate) — les cartes du bas encore en fondu pendant que les premières sont posées ; vérifier aussi le retour « All quizzes » et la bascule UE↔Récent. Comparer l'ambiance à la transition drill validée (capture Ahmed 2026-07-20 191822).

- [ ] **Step 5: Rapport**

Consigner le résultat des vérifications (classe, délais, captures) dans le rapport de task — aucun commit si rien n'a dû être corrigé.
