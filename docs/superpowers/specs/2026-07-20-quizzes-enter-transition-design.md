# Transition d'entrée de « Mes quiz » — design

Date : 2026-07-20 · Statut : validé par Ahmed (approche B + replay sur UE↔Récent)

## Contexte

L'entrée dans un dossier (drill-down) possède une transition validée
(capture 2026-07-20) composée de trois morceaux :

1. **Hero** (`.qbd-quizzes-folder-hero`) : fondu + descente,
   `qbd-folder-hero-in` 0.45s ease (`dashboard-quizzes.css:470`).
2. **Cartes de quiz** (`.qbd-quiz-card--folder`) : fondu + montée + scale,
   `qbd-folder-card-in` 0.5s, cascade `--qbd-card-delay = 120 + i × 60 ms`
   posée par `quiz-card.ts:74` (`entryIndex`).
3. **Panneau Progress** (`.qbd-progress-panel`) : même keyframe, délai fixe 220 ms.

La vue racine de « Mes quiz » (grille des dossiers) apparaît sans aucune
animation : au retour via « All quizzes » comme à l'arrivée sur la page
depuis une autre page (ex. Generate → My quizzes), tout « pop » d'un coup.

## Objectif

Rejouer la même transition à **chaque entrée** dans une vue de « Mes quiz » :

- navigation entrante vers la page (rail, retour du détail, Generate → My quizzes) ;
- entrée dans un dossier (comportement actuel, conservé) ;
- retour à la grille via « All quizzes » ;
- basculement d'axe UE ↔ Récent (la grille est entièrement reconstruite,
  la cascade accompagne le changement — décision Ahmed).

Et ne **jamais** la rejouer sur un re-render interne : renommage, archivage,
changement d'icône, création de dossier, reset de stats. (Aujourd'hui le
drill rejoue son animation sur reset de stats — corrigé au passage.)

## Mécanisme (approche B : classe d'entrée)

### Contrôleur (`quizzes.ts`)

- Nouvel état de closure `lastPaintedView: string | null = null` — clé de la
  dernière vue peinte : `"root"` ou le chemin du dossier ouvert.
- Au début de `render()` : `viewKey = openModuleFolder ?? "root"` ;
  `entering = viewKey !== lastPaintedView` ; puis `lastPaintedView = viewKey`.
- `render()` pose la classe : `container.classList.toggle("qbd-quizzes-enter", entering)`
  (le container est le `contentEl` partagé du dashboard : `toggle(force)`
  gère la pose ET le retrait — jamais de classe résiduelle sur une autre page).
- Ré-armements (`lastPaintedView = null`) :
  - `resetDrilldown()` — appelé par `dashboard.ts` à chaque navigation
    ENTRANTE vers la page (le commentaire de `dashboard.ts:170` distingue
    déjà navigation entrante et re-render interne) ;
  - `loadModuleMap()` juste avant son `render(containerRef)` final — le
    premier rendu est re-peint quelques ms plus tard quand la note de
    correspondance arrive ; sans ré-armement, ce second rendu couperait
    l'animation à peine commencée (cartes soudain opaques) ;
  - `setGrouping()` — basculement UE ↔ Récent (décision Ahmed).
- Les transitions drill in / drill out n'ont besoin d'aucun armement :
  `openModuleFolder` change → `viewKey ≠ lastPaintedView`.

### Peintre (`quizzes-render.ts` + `module-card.ts`)

- `renderQuizGrid` tient un **compteur global d'entrée** qui traverse les
  sections : chaque en-tête de section (`.qbd-quizzes-node`) puis chacune de
  ses cartes de dossier consomme un cran de cascade.
- Délai : formule identique au drill, `120 + i × 60 ms`, posé en
  `--qbd-card-delay` inline (sur `.qbd-quizzes-node` pour l'en-tête — la
  variable est héritée par le head —, sur la carte retournée par
  `renderModuleCard` pour les cartes).
- Section « Archivés » : son en-tête s'insère en fin de cascade ; ses cartes
  (corps replié par défaut) reçoivent le délai comme les autres — invisible
  tant que replié, cohérent si déplié.

### CSS (`dashboard-quizzes.css`, `dashboard-components.css`)

- **Scoper les 3 animations existantes** sous `.qbd-quizzes-enter`
  (hero, `.qbd-quiz-card--folder`, `.qbd-progress-panel`) : hors entrée,
  aucun élément n'a d'`animation`.
- **Nouvelles règles racine**, sous le même scope :
  - `.qbd-quizzes-header` et `.qbd-quizzes-group` → `qbd-folder-hero-in`
    (même timing que le hero du dossier) ;
  - `.qbd-quizzes-node-head` (l'en-tête SEUL — animer `.qbd-quizzes-node`
    entier mettrait les cartes enfants sous un parent en opacity 0 et
    masquerait leur cascade) et `.qbd-module-card` → `qbd-folder-card-in`
    avec `animation-delay: var(--qbd-card-delay, 120ms)`.
- `@media (prefers-reduced-motion: reduce)` : étendre le bloc existant
  (`dashboard-quizzes.css:860`) aux nouveaux sélecteurs.

## Hors scope

- Pages Home, Generate, Détail (aucune transition ajoutée).
- Aucun plafond de délai de cascade (fidélité au comportement drill actuel).
- Aucune nouvelle chaîne i18n, aucun changement de données persistées.

## Vérification

1. `npm run check` puis `npm run build`, reload via
   `obsidian plugin:reload id=quiz-blocks vault=<vault>`.
2. Visuel : entrée dossier (inchangée), retour « All quizzes » (cascade),
   Generate → My quizzes (cascade), UE ↔ Récent (cascade).
3. Non-régression : renommer un dossier / changer une icône / reset stats →
   **aucun** replay ; toggle chevron d'une section → animation de repli
   intacte (elle ne passe pas par `render()`).
