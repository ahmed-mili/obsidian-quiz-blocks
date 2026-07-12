# Conversion TypeScript de quiz-blocks — Design

- Date : 2026-07-12
- Statut : validé (design), prêt pour plan d'implémentation
- Périmètre : conversion complète et typée des 50 fichiers `src/*.js` vers TypeScript strict

## 1. Contexte

Le plugin `quiz-blocks` est écrit à 100 % en JavaScript CommonJS : 50 fichiers, 16 311 lignes, aucun test automatisé. Le build est assuré par esbuild (`esbuild.config.mjs`), sortie CommonJS (`main.js`), avec `obsidian` et `electron` marqués `external`.

L'architecture repose sur un pattern factory `module.exports = function createXxx(ctx) { ... return {...} }` et sur **trois god-objects `ctx` distincts**, un par sous-système, assemblés en plusieurs passes (`Object.assign` successifs + assignations 1-à-1) :

- `EngineCtx` — moteur de rendu du quiz, assemblé dans `src/engine.js` (~150 membres, 17 factories, état runtime `quizState`, expandos `__quiz*`, getters/setters de closure pour l'état d'examen).
- `DashboardCtx` — `ItemView` du dashboard, assemblé dans `src/dashboard.js` (5 factories).
- `EditorCtx` — Quiz Builder + éditeur embarqué, assemblé dans `src/editor.js` (6 factories, ~35 méthodes `.bind()` recopiées sur la `view`).

Le package de types `obsidian` n'est pas installé. Aucun `tsconfig.json`/`jsconfig.json` n'existe.

## 2. Objectif

Obtenir une codebase 100 % TypeScript, idiomatique (ESM), typée strictement, à **iso-fonctionnalité runtime**. Le bénéfice visé est la clarté de lecture (humains et IA) et la détection d'erreurs de type avant exécution. Le résultat n'a de valeur que si le typage est réel : renommer `.js` en `.ts` sans typer les `ctx` est explicitement exclu.

## 3. Décisions validées

| Décision | Choix | Raison |
|---|---|---|
| Système de modules | **ESM** (`import`/`export`) | Vraie conversion idiomatique, standard TS/Obsidian. Les 148 `require` et 51 `module.exports` sont réécrits. |
| Niveau de typage | **`strict` complet, zéro `any` implicite** | Seul niveau qui produit la clarté visée. Les cas vraiment retors deviennent des `// @ts-expect-error` documentés, jamais des `any` silencieux. |
| Déroulé | **Par lots testables dans Obsidian** | Aucun test auto : on attrape chaque régression près de sa cause. Commits réversibles. |
| Typage des `ctx` | **Interfaces écrites à la main** | Lisible (c'est la doc), évite le cycle de types qu'induirait une dérivation `ReturnType`. |

## 4. Principe non négociable : un typecheck séparé

esbuild **strip** les annotations de types sans les vérifier. Un build vert ne garantit donc rien sur les types. On ajoute un script de vérification :

```json
"scripts": {
  "check": "tsc --noEmit"
}
```

Le « feu vert » d'un lot est défini comme : `tsc --noEmit` sans erreur **ET** `npm run build` réussi **ET** test manuel réel dans Obsidian.

## 5. Lot 0 — Socle

Aucun fichier métier converti à ce stade. Objectif : plugin strictement identique, build vert, socle TS prêt.

### 5.1 Dépendances

`npm i -D typescript obsidian` (dernière version compatible du package de types Obsidian ; il est rétrocompatible avec `minAppVersion` 1.5.0).

### 5.2 tsconfig.json

- `strict: true`, `noImplicitAny: true`, `strictNullChecks: true` (inclus dans `strict`).
- `target: "ES2020"` (aligné sur esbuild).
- `module: "ESNext"`, `moduleResolution: "Bundler"`. Raffinement par rapport au design initial (qui évoquait `NodeNext`) : `Bundler` correspond exactement au comportement d'esbuild et évite les extensions `.js` obligatoires dans les imports que `NodeNext` imposerait. Ce choix sert l'ESM sans friction ; il ne change aucune décision validée.
- `esModuleInterop: true`, `allowSyntheticDefaultImports: true`.
- `skipLibCheck: true` (les `.d.ts` de mathlive / compute-engine sont volumineux).
- `noEmit: true` (esbuild reste l'émetteur).
- `allowJs: true`, `checkJs: false` **pendant** la migration, pour que les `.js` non encore convertis coexistent sans bloquer `tsc`. Retirés au dernier lot (voir §11).
- `isolatedModules: true` (esbuild compile fichier par fichier).

### 5.3 esbuild.config.mjs

- Entrée : `src/main.ts`.
- Sortie : `main.js`, `format: "cjs"` **inchangé** (Obsidian charge le plugin en CommonJS).
- `obsidian` et `electron` restent `external`.
- Point d'attention vérifié au lot 0 : l'export par défaut de la classe `Plugin` doit rester consommable par le loader d'Obsidian. On suit le pattern du `obsidian-sample-plugin` officiel (`export default class ... extends Plugin`, ré-exporté depuis `main.ts`). Critère de test du lot 0 : le plugin se charge et fonctionne à l'identique.

### 5.4 Fichiers de types transverses

- `src/types/` : dossier des types partagés.
- `src/global.d.ts` : augmentations globales pour les expandos DOM (voir §8).

## 6. Lot 1 — Types métier + utilitaires partagés

On pose d'abord les types de données qui circulent partout, dans `src/types/quiz.ts` :

- `QuizQuestion` en **union discriminée** couvrant les variantes : qcm (choix unique), multiSelect, text, ordering, matching.
- `QuizState` : `selections`, `current`, `prevCurrent`, `locked`, `shuffleMap`, `slideToken`, `practiceMode`, champs `textOnly*`, etc.
- `SlideMapEntry`, options d'examen (`examOptions`, durées), structures de résultats, records de stats du dashboard.

Ces types sont la documentation de fond du projet.

On convertit en même temps les feuilles sans dépendances internes : `quiz-utils`, `hotkey-format`, `engine/utils`, `editor/utils`, `engine/mathjax`.

## 7. Typage des trois `ctx`

Approche retenue : **interface explicite écrite à la main** par sous-système (`EngineCtx`, `DashboardCtx`, `EditorCtx`), dans `src/types/`.

- Chaque factory est typée par sa signature : `createCardRenderers(ctx: EngineCtx): CardHandlers`, etc. Le type de retour est déclaré explicitement pour rester lisible.
- L'interface `EngineCtx` reflète l'assemblage réel : état de base (`quiz`, `quizState`, `container`, `app`, `plugin`), sous-modules (`ctx.cards`, `ctx.track`, `ctx.viewport`…) **et** les ~60 méthodes aplaties directement sur `ctx`.
- **Assemblage progressif** : `ctx` est construit en plusieurs passes. On le type dès le littéral initial et on complète ; le point de bascule où il est considéré complet est marqué par un cast unique et documenté (`as EngineCtx`) plutôt que par des `any` intermédiaires. Le détail exact du point de bascule est une décision d'implémentation, tranchée dans le plan.
- **État d'examen et flags primitifs** : `EngineCtx` distingue le snapshot primitif (flags `__quiz*` copiés par valeur) des accessors de closure qui lisent l'état vivant (`isDestroyed()`, `currentAsyncEpoch()`, `isQuizInstanceAlive()`). Les getters/setters de closure (`examStarted`, `examEnded`, `examTimeRemaining`, `examStartTime`) sont typés comme propriétés `boolean`/`number`, leur nature accessor étant transparente pour les consommateurs.

Alternative écartée : dérivation par `ReturnType<typeof createXxx>`. Elle induit un cycle (`EngineCtx` dépend des factories qui dépendent de `EngineCtx`) et produit un type illisible au survol, contraire à l'objectif de clarté.

## 8. Expandos DOM et API Obsidian

- **Expandos DOM** (`host.__quizDestroy`, `track.__quizTargetX`, `track.__quizTransitionEndHandler`, `tab.__quizPressClearTimer`, `vp.__quizAppliedWidth`, `item.__quizTextQuestionCleanup`…) : augmentation globale ciblée de `HTMLElement` dans `src/global.d.ts`, propriétés optionnelles préfixées `__quiz`, typées (`() => void`, `number`, `Map`, handlers d'événements).
- **Classes Obsidian** : typées directement via le package (`extends obsidian.Plugin`, `PluginSettingTab`, `ItemView`, `Modal`, `FuzzySuggestModal`, `MarkdownRenderChild`).
- **Conflit de nom** : le `ctx` maison et le `MarkdownPostProcessorContext` d'Obsidian (`plugin.js:876`) portent le même nom. Le paramètre Obsidian est renommé localement (`mdCtx`) pour lever l'ambiguïté.
- **Dépendances externes** : `json5` et `mathlive` fournissent leurs propres types. Les modules Node core (`fs`, `path`, `os`, `child_process`) utilisés dans `dashboard/ai-*` et `voice-*` sont couverts par `@types/node` (ajouté en devDependency si nécessaire). `electron` (`webFrame`) reste `external` et typé via son package si présent, sinon `// @ts-expect-error` documenté au point d'usage unique (`math-input`).

## 9. Ordre des lots

Du plus périphérique et autonome au plus central et risqué.

- **Lot 0 — Socle** (§5).
- **Lot 1 — Types métier + utilitaires partagés** (§6).
- **Lot 2 — Editor** (10 fichiers : `editor.js` + `editor/*`). Sous-système le plus autonome. Test : ouvrir le Quiz Builder, créer et éditer un quiz, sauvegarder.
- **Lot 3 — Dashboard** (15 fichiers : `dashboard.js` + `dashboard/*`, dont les `ai-*` volumineux et `ui-select`). Test : ouvrir le dashboard, génération IA (au moins un fournisseur), voice input, dropdowns `ui-select`.
- **Lot 4 — Engine** (21 fichiers : `engine.js` + `engine/*`). En dernier car c'est le god-object le plus dur et le plus dépendant des types métier. Test : rendu d'un quiz complet, navigation entre slides, animations, mode examen (chrono), champ mathématique.

Chaque lot : `tsc --noEmit` vert + `npm run build` + **redémarrage complet d'Obsidian** (un simple reload ne suffit pas toujours à recharger le JS d'un plugin déjà chargé, comportement connu du projet) + commit dédié réversible.

## 10. Workflow de validation par lot

1. Convertir les fichiers du lot (`.js` → `.ts`, `require`/`module.exports` → `import`/`export`, typage strict).
2. `npm run check` (`tsc --noEmit`) doit être vert.
3. `npm run build` doit réussir.
4. Fermer et rouvrir Obsidian, exécuter le scénario de test du lot.
5. Commit.

## 11. Definition of Done

- Zéro fichier `.js` dans `src/` (hors fichiers de config d'outillage `.mjs`).
- `tsc --noEmit` vert avec `strict: true` et `noImplicitAny: true`.
- `allowJs`/`checkJs` retirés du `tsconfig.json`.
- `npm run build` produit un `main.js` fonctionnel ; plugin testé et identique dans Obsidian sur les scénarios des lots 2, 3, 4.
- Aucun changement de comportement runtime observé.

## 12. Hors scope (YAGNI)

- Pas de refactor de l'architecture `ctx` : on la type, on ne la redessine pas (autre projet, dangereux sans tests).
- Pas d'ajout de tests unitaires (proposable ultérieurement comme filet de sécurité durable).
- Pas de changement de comportement runtime.
- Pas de modification du CSS ni du build CSS.

## 13. Risques et mitigations

| Risque | Mitigation |
|---|---|
| `require` lazy/inline (anti-cycle, perf, timing) mal traduits en imports | Les convertir au cas par cas : import statique si sans risque de cycle, sinon `import()` dynamique préservant le timing d'origine. Vérifié par test au lot concerné. |
| Régression runtime non attrapée (aucun test) | Déroulé par lots + scénario de test manuel par lot + commits réversibles. |
| `EngineCtx` trop lourd à typer d'un coup | Traité en dernier (lot 4), après stabilisation des types métier ; interface complétée au fil de la conversion des modules `engine/`. |
| Loader Obsidian sensible à la forme de l'export par défaut | Vérifié dès le lot 0 en suivant le pattern du sample plugin officiel. |
| Types tiers bruyants (mathlive, compute-engine) | `skipLibCheck: true`. |
