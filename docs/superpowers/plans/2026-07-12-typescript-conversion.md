# Conversion TypeScript de quiz-blocks — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir les 50 fichiers `src/*.js` du plugin quiz-blocks en TypeScript strict, à iso-fonctionnalité runtime.

**Architecture:** ESM idiomatique (`import`/`export`), `strict` sans `any` implicite, conversion par lots testables (socle → types métier → editor → dashboard → engine+plugin). Les 3 god-objects `ctx` sont typés par des interfaces écrites à la main. esbuild reste le bundler (sortie CommonJS inchangée) ; `tsc --noEmit` est ajouté comme typechecker séparé car esbuild ne vérifie pas les types.

**Tech Stack:** TypeScript, esbuild, API Obsidian (package `obsidian`), json5, mathlive, Node core (fs/path/child_process), electron (external).

## Global Constraints

Ces contraintes s'appliquent implicitement à CHAQUE tâche.

- `tsconfig.json` en `strict: true`, `noImplicitAny: true`. Aucun `any` implicite. Les cas irréductibles sont des `// @ts-expect-error <raison>` documentés, jamais des `any` silencieux.
- ESM : tout `require(...)` devient `import`, tout `module.exports` devient `export`.
- Iso-fonctionnalité runtime : aucun changement de comportement. La conversion ne modifie pas la logique.
- Sortie de build : `format: "cjs"` inchangé (Obsidian charge le plugin en CommonJS). `obsidian` et `electron` restent `external`.
- Le typecheck de référence est `npm run check` (`tsc --noEmit`). Un build esbuild vert ne prouve rien sur les types.
- Cible mobile supportée (`manifest.json`: `isDesktopOnly: false`). Ne jamais transformer un accès Node conditionnel (`Platform.isDesktopApp`, `require` lazy de `child_process`/`fs`) en import statique de haut niveau : cela chargerait le module Node sur mobile. Voir convention C4.
- Tester dans Obsidian = **quitter puis rouvrir Obsidian entièrement**. Un simple « Reload app without saving » ne recharge pas toujours le JS d'un plugin déjà chargé (comportement connu de ce projet).
- Commits locaux uniquement. Ne jamais `git push`. Branche de travail : `feat/ts-conversion`.

---

## Note de méthode : granularité et « tests »

Ce projet n'a aucun test automatisé (décision de la spec, §12). La conversion est mécanique et guidée par le typecheur. Par conséquent :

- **Gate par tâche** = `npm run check` (`tsc --noEmit`) VERT. C'est le « test qui doit passer ». Grâce à `allowJs: true`, les fichiers `.js` pas encore convertis coexistent : un `.ts` qui importe un `.js` non typé reçoit des types `any` de module (toléré transitoirement, sans erreur `noImplicitAny`).
- **Gate par lot** = en plus : `npm run build` réussi + scénario de test manuel Obsidian du lot + commit.
- Le plan ne réécrit pas ligne à ligne le TS de chaque fichier converti (16 311 lignes) : ce serait de la fiction. Il fournit (a) des **conventions de conversion** concrètes et réutilisables, appliquées à chaque fichier, et (b) le **code complet des artefacts nouveaux** (tsconfig, types transverses, interfaces ctx, entrée esbuild), qui sont les vraies décisions.

---

## Conventions de conversion (référence — appliquées par toutes les tâches)

Ces patterns sont le contrat de conversion. Chaque tâche de conversion de fichier applique C1–C6.

### C1. Factory CommonJS → module ESM typé

Avant (`src/engine/state.js`) :
```js
'use strict';
module.exports = function createStateHandlers(ctx) {
    function isComplete(i) { /* ... */ }
    return { isComplete, /* ... */ };
};
```
Après (`src/engine/state.ts`) :
```ts
import type { EngineCtx } from "../types/engine-ctx";

export interface StateHandlers {
    isComplete(i: number): boolean;
    // ... une entrée par méthode retournée
}

export function createStateHandlers(ctx: EngineCtx): StateHandlers {
    function isComplete(i: number): boolean { /* ... */ }
    return { isComplete, /* ... */ };
}
```
Règles : retirer `'use strict'` (implicite en module ESM). Déclarer un type de retour explicite (`XxxHandlers`) pour la lisibilité et pour alimenter l'interface `ctx`. Importer `EngineCtx`/`DashboardCtx`/`EditorCtx` en `import type`.

### C2. Objet namespace (fonctions pures) → export d'objet typé

Avant (`src/quiz-utils.js`) : `module.exports = { parseQuizSource, ... };`
Après : exporter des fonctions nommées (`export function parseQuizSource(...) {}`) et, si des consommateurs importent l'objet entier, garder aussi `export default { parseQuizSource, ... }`. Préférer les exports nommés ; ne conserver l'objet que si le site d'appel l'exige.

### C3. Classe étendant Obsidian

Avant : `const obsidian = require("obsidian"); module.exports = class X extends obsidian.Plugin {}`
Après :
```ts
import { Plugin, PluginSettingTab, ItemView, Modal } from "obsidian";
export default class InteractiveQuizPlugin extends Plugin { /* ... */ }
```
Le point d'entrée `main.ts` ré-exporte le default (voir Task 2). Les classes non-default (ex. `QuizDashboardView`) restent en `export class`.

### C4. `require` lazy / inline → conserver le lazy

Beaucoup de `require` sont volontairement lazy (anti-cycle, perf, ou garde mobile pour les modules Node). NE PAS les hisser en import statique de haut niveau.
- `require` Node conditionnel (mobile) → `await import()` dynamique à l'endroit d'origine, OU `import type` pour les types + `require` conservé via `import { ... }` dynamique. Préserver la condition `Platform.isDesktopApp` qui l'entoure.
- `require` lazy anti-cycle → `await import()` dynamique si le module est déjà dans une fonction async ; sinon import statique seulement si aucun cycle n'est introduit (vérifier via `npm run check` après).

Exemple (`src/dashboard/ai-client.js`) :
```ts
// avant : const { spawn } = require("child_process");  (dans une fonction, après check Platform)
const { spawn } = await import("node:child_process");
```

### C5. Expando DOM → augmentation globale

Toute propriété greffée sur un élément DOM (`el.__quizXxx`) est déclarée une fois dans `src/global.d.ts` (Task 2), jamais castée en `any` au site d'usage.

### C6. Import de l'API Obsidian

`const obsidian = require("obsidian")` + usages `obsidian.Notice` → soit `import { Notice, setIcon } from "obsidian"`, soit `import * as obsidian from "obsidian"` si le fichier utilise beaucoup de symboles. Les destructurations inline (`const { requestUrl } = require("obsidian")`) deviennent des imports nommés en tête de fichier.

---

## Fichiers de types transverses (créés dans les tâches, complétés au fil de l'eau)

- `src/types/quiz.ts` — types de données métier (Task 3).
- `src/types/engine-ctx.ts`, `src/types/dashboard-ctx.ts`, `src/types/editor-ctx.ts` — les 3 interfaces `ctx` (créées vides au début de leur lot, complétées à mesure).
- `src/global.d.ts` — augmentations DOM et déclarations globales (Task 2).

---

## Task 1 : Lot 0 — Dépendances, tsconfig, scripts

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `tsconfig.json`

**Interfaces:**
- Produces: le script `npm run check` (= `tsc --noEmit`) utilisé comme gate par toutes les tâches suivantes ; un `tsconfig.json` en strict avec `allowJs`.

- [ ] **Step 1 : Installer les dépendances de dev**

Run :
```bash
npm i -D typescript obsidian @types/node
```
Expected : `package.json` gagne `typescript`, `obsidian`, `@types/node` en devDependencies ; installation sans erreur.

- [ ] **Step 2 : Créer `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.js"]
}
```
Note : `allowJs: true` + `checkJs: false` permettent la coexistence `.js`/`.ts` pendant la migration ; les `.js` sont inclus dans le programme (résolution des imports `.ts`→`.js`) mais non vérifiés. Inclure `src/**/*.js` évite aussi l'erreur `TS18003 No inputs were found` tant qu'aucun `.ts` n'existe (Task 1). `module`/`moduleResolution` = `ESNext`/`Bundler` collent au comportement d'esbuild (pas d'extensions `.js` forcées). Le glob `src/**/*.js` est retiré de `include` à la finalisation (Task 10).

- [ ] **Step 3 : Ajouter les scripts npm**

Dans `package.json`, ajouter à `"scripts"` :
```json
"check": "tsc --noEmit",
"check:watch": "tsc --noEmit --watch"
```

- [ ] **Step 4 : Vérifier que tsc tourne**

Run : `npm run check`
Expected : PASS (0 fichier `.ts` encore, donc aucune erreur). Si erreur de config, corriger le `tsconfig.json`.

- [ ] **Step 5 : Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "build(ts): socle TypeScript — deps, tsconfig strict, script check"
```

---

## Task 2 : Lot 0 — Entrée esbuild, `main.ts`, `global.d.ts`, test loader

**Files:**
- Modify: `esbuild.config.mjs:68` (entryPoint)
- Delete/replace: `src/main.js` → Create: `src/main.ts`
- Create: `src/global.d.ts`

**Interfaces:**
- Consumes: la classe Plugin par défaut de `./plugin` (encore `.js`, exports CommonJS résolus via `esModuleInterop`).
- Produces: point d'entrée `.ts` fonctionnel ; `src/global.d.ts` où toutes les tâches suivantes déclarent leurs expandos DOM.

- [ ] **Step 1 : Pointer esbuild sur `src/main.ts`**

Dans `esbuild.config.mjs`, remplacer `entryPoints: ["src/main.js"]` par `entryPoints: ["src/main.ts"]` (ligne 68).

- [ ] **Step 2 : Créer `src/main.ts`**

Le fichier actuel `src/main.js` fait `module.exports = require("./plugin")`. Équivalent ESM ré-exportant le default (le loader Obsidian consomme l'export par défaut, comme le sample plugin officiel) :
```ts
export { default } from "./plugin";
```
Puis supprimer `src/main.js`.

- [ ] **Step 3 : Créer `src/global.d.ts` avec les expandos DOM connus**

Squelette de départ (issu de la cartographie ; complété au fil des lots) :
```ts
export {};

declare global {
  interface HTMLElement {
    // Cycle de vie
    __quizDestroy?: () => void;
    __quizTextQuestionCleanup?: () => void;
    // Track / animation (engine/track.ts)
    __quizTransitionEndHandler?: (e: TransitionEvent) => void;
    __quizTargetX?: number;
    __quizTargetIndex?: number;
    __quizTargetHeight?: number;
    __quizLockedHeight?: number;
    // Nav tabs (engine/state.ts)
    __quizPressClearTimer?: number;
    // Viewport (engine/viewport.ts)
    __quizAppliedWidth?: number;
  }
}
```
Règle pour la suite : chaque fois qu'une conversion rencontre un `el.__quizXxx` non déclaré, ajouter la propriété ici (convention C5).

- [ ] **Step 4 : Typecheck**

Run : `npm run check`
Expected : PASS. `main.ts` importe `./plugin` (encore `.js`, typé `any` de module via `allowJs`), aucune erreur de type attendue.

- [ ] **Step 5 : Build**

Run : `npm run build`
Expected : `main.js`, `styles.css`, `manifest.json` régénérés et déployés dans les vaults. Aucune erreur esbuild.

- [ ] **Step 6 : Test loader dans Obsidian (CRITIQUE)**

Quitter Obsidian entièrement, rouvrir. Vérifier que le plugin Quiz Blocks se charge (pas d'erreur dans la console développeur), qu'un bloc quiz existant s'affiche et fonctionne. Ce test valide que la sortie ESM→cjs reste consommable par le loader d'Obsidian.
Expected : plugin chargé, quiz fonctionnel, identique à avant.

- [ ] **Step 7 : Commit**

```bash
git add esbuild.config.mjs src/main.ts src/global.d.ts
git rm src/main.js
git commit -m "build(ts): entrée esbuild en .ts, main.ts ESM, global.d.ts (expandos DOM)"
```

---

## Task 3 : Lot 1 — Types de données métier (`src/types/quiz.ts`)

**Files:**
- Create: `src/types/quiz.ts`
- Read (pour dériver les champs exacts) : `src/quiz-utils.js`, `src/engine/questions.js`, `src/engine/sanitizer.js`, `src/engine/state.js`

**Interfaces:**
- Produces: `QuizQuestion` (union discriminée), `QuizState`, `SlideMapEntry`, `ExamOptions`, `QuizResult`, `StatsRecord` — consommés par tous les lots suivants.

- [ ] **Step 1 : Lire la forme réelle des questions et de l'état**

Lire `src/engine/sanitizer.js` et `src/quiz-utils.js` (parsing/normalisation des questions) et `src/engine/state.js` (usage de `q.multiSelect`, `q.correctIndex`, `q.correctIndices`, prédicats `isTextQuestion`/`isOrderingQuestion`/`isMatchingQuestion`) pour relever les champs exacts de chaque variante.

- [ ] **Step 2 : Écrire `src/types/quiz.ts`**

Squelette à compléter avec les champs relevés au Step 1 (les champs ci-dessous sont confirmés par `state.js` ; ajouter les autres relevés) :
```ts
/** Variantes de question, discriminées par la présence des champs de correction. */
export interface QcmQuestion {
  prompt: string;
  choices: string[];
  correctIndex: number;
  multiSelect?: false;
  hint?: string;
}
export interface MultiSelectQuestion {
  prompt: string;
  choices: string[];
  correctIndices: number[];
  multiSelect: true;
  hint?: string;
}
export interface TextQuestion {
  prompt: string;
  answer: string;                 // vérifier le nom exact du champ dans sanitizer.js
  hint?: string;
}
export interface OrderingQuestion {
  prompt: string;
  items: string[];                // ordre correct ; vérifier via getOrderingCorrectOrder
  ordering: true;
  hint?: string;
}
export interface MatchingQuestion {
  prompt: string;
  rows: Array<{ left: string; right: string }>; // vérifier via getMatchRows/getMatchCorrectMap
  matching: true;
  hint?: string;
}
export type QuizQuestion =
  | QcmQuestion | MultiSelectQuestion | TextQuestion
  | OrderingQuestion | MatchingQuestion;

export type PracticeMode = "qcm" | "text";

export interface QuizState {
  selections: Array<number | Set<number> | string | Array<number | null> | null>;
  current: number;
  prevCurrent: number;
  lastQuestionIndex: number;
  locked: boolean;
  slideToken: number;
  isSliding: boolean;
  practiceMode: PracticeMode;
  pendingResultsLock: boolean;
  savedResultsPath: string | null;
  shuffleMap: number[];
  // champs textOnly : compléter en lisant engine/text-only.js
  textOnlyRatings?: Record<number, "understood" | string>;
}

export interface SlideMapEntry { questionIndex: number; /* compléter */ }
export interface ExamOptions { /* compléter en lisant engine/exam.js */ }
export interface QuizResult { pct: number; correct: number; total: number; }
export interface StatsRecord { bestScore: number; questionsDone: number; totalQuestions: number; }
```
Les commentaires `compléter/vérifier` sont des **actions** de ce step (lire le fichier cité, remplir le champ), pas des placeholders laissés dans le livrable final : à la fin du step, aucun commentaire `compléter` ne subsiste.

- [ ] **Step 3 : Typecheck**

Run : `npm run check`
Expected : PASS (fichier de types isolé, aucun consommateur encore).

- [ ] **Step 4 : Commit**

```bash
git add src/types/quiz.ts
git commit -m "feat(ts): types de données quiz (union discriminée QuizQuestion, QuizState)"
```

---

## Task 4 : Lot 1 — Utilitaires partagés

**Files:**
- Convert: `src/quiz-utils.js` → `.ts`, `src/hotkey-format.js` → `.ts`, `src/engine/utils.js` → `.ts`, `src/editor/utils.js` → `.ts`, `src/engine/mathjax.js` → `.ts`

**Interfaces:**
- Consumes: `src/types/quiz.ts` (Task 3).
- Produces: utilitaires typés (`parseQuizSource(...): QuizQuestion[]`, helpers de formatage, `mathjax` avec sa promesse mémoïsée typée).

- [ ] **Step 1 : Convertir les 5 fichiers**

Appliquer C2 (namespaces), C4 (le `require("json5")` de `quiz-utils` devient `import JSON5 from "json5"` ; les `require` lazy de mathjax restent lazy), C6. Typer les signatures publiques avec les types de `quiz.ts`. Pour `engine/mathjax.ts`, typer `let __mathJaxReady: Promise<void> | null`.

- [ ] **Step 2 : Typecheck après chaque fichier**

Run : `npm run check` après chaque conversion.
Expected : PASS. Les consommateurs encore en `.js` continuent d'importer sans erreur (module `any`).

- [ ] **Step 3 : Build**

Run : `npm run build`
Expected : succès.

- [ ] **Step 4 : Test Obsidian (fin de Lot 1)**

Quitter/rouvrir Obsidian. Vérifier qu'un quiz existant (avec au moins une formule mathématique `$...$`) s'affiche et se rend correctement.
Expected : rendu identique.

- [ ] **Step 5 : Commit**

```bash
git add src/quiz-utils.ts src/hotkey-format.ts src/engine/utils.ts src/editor/utils.ts src/engine/mathjax.ts
git rm src/quiz-utils.js src/hotkey-format.js src/engine/utils.js src/editor/utils.js src/engine/mathjax.js
git commit -m "refactor(ts): utilitaires partagés en TypeScript"
```

---

## Task 5 : Lot 2 — Editor : interface `EditorCtx`

**Files:**
- Create: `src/types/editor-ctx.ts`
- Read: `src/editor.js:55-143` (assemblage du ctx éditeur)

**Interfaces:**
- Produces: `EditorCtx`, consommé par toutes les factories `editor/*`.

- [ ] **Step 1 : Écrire `EditorCtx` d'après l'assemblage réel**

Lire `src/editor.js:55-110` (champs d'état, getter/setter `activeQuestion`, `Object.assign(ctx, {...})`) et déclarer une interface reflétant chaque membre :
```ts
import type { App } from "obsidian";
import type { QuizQuestion, ExamOptions } from "./quiz";
import type { EditorUIHandlers } from "../editor/ui";
// ... imports type des 6 handler-types

export interface EditorCtx {
  app: App;
  plugin: import("obsidian").Plugin;
  view: import("obsidian").ItemView;
  host: HTMLElement;
  questions: QuizQuestion[];
  activeIdx: number;
  get activeQuestion(): QuizQuestion;
  set activeQuestion(q: QuizQuestion);
  examOptions: ExamOptions | null;
  // sous-modules greffés
  ui: EditorUIHandlers;
  resize: ResizeHandlers;
  sidebar: SidebarHandlers;
  form: EditorFormHandlers;
  preview: PreviewHandlers;
  hint: EditorHintHandlers;
  // méthodes aplaties : compléter à mesure que les modules sont convertis
}
```
Les handler-types (`EditorUIHandlers`, etc.) sont définis par C1 dans chaque module lors de sa conversion (Task 6). Créer d'abord ce fichier avec les types de sous-modules importés en `import type` ; les erreurs « module non trouvé » se résolvent quand chaque module passe en `.ts`. Si un module n'est pas encore converti, déclarer temporairement son handler-type localement puis basculer sur l'import — ou convertir les modules avant de brancher l'import (ordre de Task 6).

- [ ] **Step 2 : Typecheck**

Run : `npm run check`
Expected : PASS ou erreurs de modules non convertis à résoudre au fil de Task 6. À ce stade, tolérer les imports vers `.js` non convertis.

- [ ] **Step 3 : Commit**

```bash
git add src/types/editor-ctx.ts
git commit -m "feat(ts): interface EditorCtx (squelette)"
```

---

## Task 6 : Lot 2 — Editor : conversion des modules

**Files:**
- Convert (ordre : feuilles d'abord) : `src/editor/hint.js`, `src/editor/export.js`, `src/editor/preview.js`, `src/editor/sidebar.js`, `src/editor/resize.js`, `src/editor/ui.js`, `src/editor/editor-form.js`, `src/editor/modals.js`, puis le racine `src/editor.js`
- Modify au fil de l'eau : `src/types/editor-ctx.ts` (compléter les méthodes aplaties)

**Interfaces:**
- Consumes: `EditorCtx` (Task 5), `quiz.ts` (Task 3).
- Produces: chaque module exporte `createXxxHandlers(ctx: EditorCtx): XxxHandlers` (C1) et son `XxxHandlers`. `editor.js` exporte `attachQuizEditorCore(...)` et la classe `QuizBuilderView` (C3).

- [ ] **Step 1 : Convertir chaque module dans l'ordre, en appliquant C1–C6**

Pour chaque fichier : renommer `.js`→`.ts`, factory typée (C1), déclarer le `XxxHandlers` et l'ajouter à `EditorCtx`, traiter les 5 classes `Modal`/`FuzzySuggestModal` de `modals.js` par C3, `export.js`/`utils` déjà couverts. Après chaque fichier, `npm run check`.

- [ ] **Step 2 : Convertir `src/editor.js` → `src/editor.ts`**

Typer l'assemblage du `ctx` (le littéral initial + `Object.assign`) en `EditorCtx`. Marquer le point d'assemblage complet par un cast unique documenté si nécessaire (`const ctx = { ... } as EditorCtx`). Typer les ~35 méthodes `.bind()` recopiées sur `view`. La classe `QuizBuilderView extends ItemView` par C3.

- [ ] **Step 3 : Typecheck complet du lot**

Run : `npm run check`
Expected : PASS, zéro erreur. Tous les modules `editor/*` et `editor.ts` sont typés.

- [ ] **Step 4 : Build**

Run : `npm run build`
Expected : succès.

- [ ] **Step 5 : Test Obsidian (fin de Lot 2)**

Quitter/rouvrir Obsidian. Ouvrir le Quiz Builder (vue onglet ET éditeur embarqué du dashboard). Créer une question de chaque type, éditer, redimensionner les panneaux, utiliser un hint, sauvegarder, rouvrir.
Expected : éditeur pleinement fonctionnel, identique à avant.

- [ ] **Step 6 : Commit**

```bash
git add src/editor.ts src/editor/ src/types/editor-ctx.ts
git rm src/editor.js src/editor/hint.js src/editor/export.js src/editor/preview.js src/editor/sidebar.js src/editor/resize.js src/editor/ui.js src/editor/editor-form.js src/editor/modals.js
git commit -m "refactor(ts): sous-système editor en TypeScript strict"
```

---

## Task 7 : Lot 3 — Dashboard : interface `DashboardCtx`

**Files:**
- Create: `src/types/dashboard-ctx.ts`
- Read: `src/dashboard.js:54-73`

**Interfaces:**
- Produces: `DashboardCtx` (champs `view, app, plugin, scanner, statsStore, navEl, contentEl, navigate, getActiveFile` + sous-modules `nav/home/quizzes/detail/ai`).

- [ ] **Step 1 : Écrire `DashboardCtx`**

Refléter `dashboard.js:54-64` (champs) et `:69-73` (sous-modules). Typer `scanner`, `statsStore`, `aiClient` via les types produits par leurs factories à signature non-ctx (`createScanner(app)`, `createStatsStore(plugin)`, `createAiClient(plugin)`).

- [ ] **Step 2 : Typecheck + Commit**

Run : `npm run check` (tolérer les modules non encore convertis).
```bash
git add src/types/dashboard-ctx.ts
git commit -m "feat(ts): interface DashboardCtx (squelette)"
```

---

## Task 8 : Lot 3 — Dashboard : conversion des modules

**Files:**
- Convert (feuilles d'abord) : `src/dashboard/nav.js`, `stats-store.js`, `scanner.js`, `quiz-card.js`, `quizzes.js`, `home.js`, `detail.js`, `effort-canvas.js`, `ui-select.js`, `voice-install.js`, `voice-input.js`, `ai-providers.js`, `ai-client.js`, `ai.js`, puis racine `src/dashboard.js`
- Modify: `src/types/dashboard-ctx.ts`, `src/global.d.ts` (si nouveaux expandos)

**Interfaces:**
- Consumes: `DashboardCtx` (Task 7), `quiz.ts`.
- Produces: modules typés ; `dashboard.ts` exporte `class QuizDashboardView extends ItemView` (C3).

- [ ] **Step 1 : Convertir chaque module (C1–C6)**

Points d'attention spécifiques :
- `ui-select.js` : le singleton module-scope `const openMenus = new Set<HTMLElement>()` reste au top-level du module (légitime) ; typer `createSelect(parent: HTMLElement, opts: SelectOptions)`.
- `ai-client.js`, `ai-providers.js`, `voice-*.js` : `require` Node (`child_process`, `fs`, `path`) conditionnés par `Platform` → C4 (rester lazy/dynamique, ne pas hisser). `const { requestUrl } = require("obsidian")` → import nommé.
- `effort-canvas.js`, `quiz-card.js` : factories à signature non-ctx, typer leurs paramètres directement.
- `ai.js` (1184 lignes) : le plus gros ; `loadPdfJs` d'Obsidian, `require("json5")` lazy → C4/C6.
Après chaque fichier : `npm run check`.

- [ ] **Step 2 : Convertir `src/dashboard.js` → `.ts`**

Typer l'assemblage `ctx` en `DashboardCtx` ; `QuizDashboardView extends ItemView` et son `Scope` (raccourcis) par C3/C6.

- [ ] **Step 3 : Typecheck complet**

Run : `npm run check`
Expected : PASS, zéro erreur sur tout `dashboard/*` + `dashboard.ts`.

- [ ] **Step 4 : Build**

Run : `npm run build`
Expected : succès.

- [ ] **Step 5 : Test Obsidian (fin de Lot 3)**

Quitter/rouvrir Obsidian. Ouvrir le dashboard : navigation, liste des quiz (scanner), page détail, génération IA avec au moins un fournisseur configuré, dropdowns `ui-select`, et si configuré le voice input.
Expected : dashboard pleinement fonctionnel, identique.

- [ ] **Step 6 : Commit**

```bash
git add src/dashboard.ts src/dashboard/ src/types/dashboard-ctx.ts src/global.d.ts
git rm src/dashboard/nav.js src/dashboard/stats-store.js src/dashboard/scanner.js src/dashboard/quiz-card.js src/dashboard/quizzes.js src/dashboard/home.js src/dashboard/detail.js src/dashboard/effort-canvas.js src/dashboard/ui-select.js src/dashboard/voice-install.js src/dashboard/voice-input.js src/dashboard/ai-providers.js src/dashboard/ai-client.js src/dashboard/ai.js src/dashboard.js
git commit -m "refactor(ts): sous-système dashboard en TypeScript strict"
```

---

## Task 9 : Lot 4 — Engine : interface `EngineCtx`

**Files:**
- Create: `src/types/engine-ctx.ts`
- Read: `src/engine.js:93-125` (littéral + getters/setters), `:128-144` (17 factories), `:149-222` (1er Object.assign), `:275-330` (état/prédicats), `:397-429` (2e Object.assign)

**Interfaces:**
- Produces: `EngineCtx`, la plus grande interface (~150 membres), consommée par les 17 factories `engine/*`.

- [ ] **Step 1 : Écrire l'état de base et les accessors**

Déclarer d'abord la partie état + accessors (distinguer snapshot primitif et accessor de closure, cf. spec §7) :
```ts
import type { App, Plugin } from "obsidian";
import type { QuizQuestion, QuizState, SlideMapEntry, ExamOptions } from "./quiz";

export interface EngineCtx {
  // données & DOM
  app: App;
  plugin: Plugin;
  container: HTMLElement;
  quiz: QuizQuestion[];
  quizState: QuizState;
  slideMap: SlideMapEntry[];
  sourcePath: string;
  // constantes de slides
  SLIDE_SUBMIT_INDEX: number;
  SLIDE_RESULTS_INDEX: number;
  // état examen (getters/setters de closure → vus comme propriétés)
  examStarted: boolean;
  examEnded: boolean;
  examStartTime: number;
  examTimeRemaining: number;
  isExamMode: boolean;
  examDurationMs: number;
  examOptions: ExamOptions | null;
  // accessors de closure (état vivant, NE PAS lire les flags snapshot)
  isDestroyed(): boolean;
  isQuizInstanceAlive(): boolean;
  currentAsyncEpoch(): number;
  getSlideGeneration(): number;
  // render assigné tardivement
  render(): void;
  // sous-modules (handler-types définis par C1 dans chaque module)
  cards: import("../engine/cards").CardHandlers;
  track: import("../engine/track").TrackHandlers;
  viewport: import("../engine/viewport").ViewportHandlers;
  state: import("../engine/state").StateHandlers;
  // ... les 17 sous-modules
  // méthodes aplaties (~60) : compléter à mesure de la conversion des modules
}
```

- [ ] **Step 2 : Règle de complétion**

À chaque module `engine/*` converti (Task 10), ajouter à `EngineCtx` : (a) son slot de sous-module (`cards: CardHandlers`) et (b) les méthodes de ce module qui sont aplaties sur `ctx` dans `engine.js:149-222` (ex. `isCorrect`, `goToSlide`, `warmSlideForAccurateHeight`). À la fin de Task 10, `EngineCtx` ne contient plus aucun commentaire « compléter ».

- [ ] **Step 3 : Typecheck + Commit**

Run : `npm run check` (tolérer modules engine non encore convertis).
```bash
git add src/types/engine-ctx.ts
git commit -m "feat(ts): interface EngineCtx (état de base + accessors)"
```

---

## Task 10 : Lot 4 — Engine : conversion des modules + `plugin.ts` + finalisation

**Files:**
- Convert (feuilles d'abord) : `src/engine/utils.js` (déjà fait Task 4), `sanitizer.js`, `questions.js`, `resources.js`, `focus.js`, `hint.js`, `warming.js`, `lifecycle.js`, `exam.js`, `text-only.js`, `results-save.js`, `zoom.js`, `viewport.js`, `track.js`, `cards.js`, `terminal.js`, `math-input.js`, `interactions.js`, `state.js`, puis racine `src/engine.js`
- Convert last: `src/plugin.js` → `src/plugin.ts`
- Modify: `src/types/engine-ctx.ts`, `src/global.d.ts`, `tsconfig.json` (finalisation)

**Interfaces:**
- Consumes: `EngineCtx` (Task 9), `quiz.ts`, `global.d.ts`.
- Produces: `engine.ts` exporte `{ renderInteractiveQuiz, parseQuizSource, ... }` ; `plugin.ts` exporte `default class InteractiveQuizPlugin extends Plugin`.

- [ ] **Step 1 : Convertir chaque module engine/ (C1–C6), compléter `EngineCtx`**

Points d'attention :
- `state.js` : expandos DOM `tab.__quizPressClearTimer` (déjà dans global.d.ts) ; typer `goToSlide(index: number, opts?: { forceRender?: boolean }): Promise<void>` etc.
- `track.js`, `viewport.js` : expandos `__quizTargetX`, `__quizAppliedWidth`, `__quizLockedHeight` (global.d.ts).
- `math-input.js` : `require("mathlive")` lazy → C4 (`await import("mathlive")`) ; `webFrame` d'electron → `import { webFrame } from "electron"` ; si le package `electron` n'est pas résolu par TS, `// @ts-expect-error webFrame fourni par l'hôte Electron d'Obsidian` au point d'usage unique.
- `warming.js`, `lifecycle.js` : lisent l'état vivant via les accessors de closure, pas les flags snapshot (spec §7).
Après chaque fichier : `npm run check`.

- [ ] **Step 2 : Convertir `src/engine.js` → `.ts`**

Typer l'assemblage multi-passes du `ctx` en `EngineCtx`. Les getters/setters de closure pour l'état examen (`engine.js:108-115`) restent des accessors ; le `render: null` placeholder (`:221`) puis `ctx.render = render` (`:800`) : typer `render` comme méthode et gérer le placeholder par un cast au point d'assemblage complet (`as EngineCtx`) documenté.

- [ ] **Step 3 : Convertir `src/plugin.js` → `src/plugin.ts` (en dernier)**

`plugin.js` consomme engine/dashboard/editor : le convertir maintenant que tous ses imports sont typés. `class InteractiveQuizPlugin extends Plugin` + `class ... extends PluginSettingTab` (C3). `registerMarkdownCodeBlockProcessor((source, el, mdCtx) => ...)` : renommer le paramètre Obsidian en `mdCtx` (spec §8) pour éviter le conflit avec le `ctx` maison. `MarkdownRenderChild` typé. Expando `host.__quizDestroy` (global.d.ts).

- [ ] **Step 4 : Finaliser `tsconfig.json`**

Une fois zéro `.js` dans `src/`, retirer les béquilles de migration :
```json
"allowJs": false,
"checkJs": true
```
(ou simplement retirer les deux lignes `allowJs`/`checkJs`, `allowJs` valant `false` par défaut). Retirer aussi le glob `"src/**/*.js"` de `include`, qui devient `["src/**/*.ts", "src/**/*.d.ts"]`.

- [ ] **Step 5 : Vérifier qu'aucun `.js` ne subsiste dans `src/`**

Run : `find src -name '*.js'`
Expected : aucun résultat.

- [ ] **Step 6 : Typecheck strict final**

Run : `npm run check`
Expected : PASS, zéro erreur, en `strict` + `noImplicitAny` + `checkJs`.

- [ ] **Step 7 : Build**

Run : `npm run build`
Expected : succès.

- [ ] **Step 8 : Test Obsidian complet (fin de Lot 4 — DoD)**

Quitter/rouvrir Obsidian. Scénario complet : rendu d'un quiz de chaque type de question, navigation entre slides (animations), soumission, page de résultats, sauvegarde des résultats, mode examen (chrono qui démarre/s'arrête), champ mathématique (clavier maths), hints, zoom, mode text-only. Vérifier aussi que le dashboard et l'éditeur (lots précédents) fonctionnent toujours ensemble.
Expected : plugin entièrement fonctionnel, iso-comportement.

- [ ] **Step 9 : Commit**

```bash
git add src/engine.ts src/engine/ src/plugin.ts src/types/engine-ctx.ts src/global.d.ts tsconfig.json
git rm src/plugin.js src/engine.js src/engine/sanitizer.js src/engine/questions.js src/engine/resources.js src/engine/focus.js src/engine/hint.js src/engine/warming.js src/engine/lifecycle.js src/engine/exam.js src/engine/text-only.js src/engine/results-save.js src/engine/zoom.js src/engine/viewport.js src/engine/track.js src/engine/cards.js src/engine/terminal.js src/engine/math-input.js src/engine/interactions.js src/engine/state.js
git commit -m "refactor(ts): sous-système engine + plugin en TypeScript strict — conversion complète"
```

---

## Definition of Done (rappel spec §11)

- Zéro fichier `.js` dans `src/` (hors `.mjs` d'outillage).
- `npm run check` vert en `strict` + `noImplicitAny` + `checkJs`.
- `allowJs`/`checkJs` de migration retirés.
- `npm run build` produit un `main.js` fonctionnel ; plugin testé identique dans Obsidian (lots 2, 3, 4).
- Aucun changement de comportement runtime.
