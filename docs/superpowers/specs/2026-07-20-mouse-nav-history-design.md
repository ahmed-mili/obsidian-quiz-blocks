# Navigation aux boutons souris (back/forward) dans le dashboard — design

Date : 2026-07-20 · Statut : validé par Ahmed (« Go », historique complet)

## Contexte

Les boutons latéraux de la souris (button 3 = précédent, button 4 = suivant)
naviguent l'historique d'onglet d'Obsidian, mais ignorent la navigation
INTERNE du dashboard quiz-blocks (pages Home / Mes quiz / Détail / Générer,
drill-down d'un dossier). Ahmed veut « avancer ou revenir en arrière avec
les macros de la souris » dans le dashboard.

## Objectif

Un historique de navigation interne à la vue dashboard, piloté par les
boutons latéraux quand le curseur est dans le dashboard :

- **Précédent** : revient à l'état quitté — page, dossier ouvert (drill),
  quiz du détail. Exemple : entrer dans un dossier puis bouton précédent =
  retour à la grille « All quizzes ».
- **Suivant** : refait le chemin en avant après un ou plusieurs retours
  (sémantique navigateur : toute nouvelle navigation vide la pile avant).
- Hors du dashboard, rien ne change (Obsidian garde sa navigation native).
- Chaque restauration est une ENTRÉE de vue : la transition d'entrée de
  « Mes quiz » (classe `qbd-quizzes-enter`) joue naturellement.

## Mécanisme

### État (dashboard.ts, sur la vue)

```ts
interface NavSnapshot {
	view: DashboardViewName;
	/** Dossier ouvert du drill — pertinent seulement si view === "quizzes". */
	drillFolder: string | null;
	/** Quiz du détail — pertinent seulement si view === "detail". */
	quiz: QuizIndexEntry | null;
}
```

- `navBackStack: NavSnapshot[]` et `navForwardStack: NavSnapshot[]` sur la
  vue (état d'interface, non persisté). Plafond 50 entrées (shift au-delà).
- `captureNav(): NavSnapshot` lit `currentView`, `selectedQuiz` et le drill
  courant via `this.quizzes.getOpenFolder()`.
- `isRestoringNav: boolean` — vrai pendant l'application d'un snapshot :
  les points d'enregistrement ne doivent PAS empiler pendant une
  restauration.

### Points d'enregistrement (pousser l'état QUITTÉ sur back, vider forward)

1. `navigate(view, data)` (dashboard.ts) — début de méthode : si
   `!isRestoringNav` et que le snapshot courant diffère de l'état d'arrivée
   (comparaison `view`/`drillFolder`/`quiz.path` — un re-clic du rail sur la
   page courante n'empile pas de doublon), empiler `captureNav()` et vider
   `navForwardStack`.
2. Drill in/out (quizzes.ts) — nouveau `ctx.recordNav()` appelé JUSTE AVANT
   de changer `openModuleFolder` dans `openModule()` ET dans le listener du
   bouton « All quizzes » du fil d'Ariane. `recordNav()` (délégué de la vue)
   applique la même garde `isRestoringNav` + dédoublonnage.

### Restauration (dashboard.ts)

- `goNavBack()` : si `navBackStack` vide → no-op. Sinon : empiler
  `captureNav()` sur `navForwardStack`, dépiler le snapshot, l'appliquer.
- `goNavForward()` : symétrique.
- Application (`applyNavSnapshot(s)`) sous `isRestoringNav = true` :
  `navigate(s.view, s.quiz ? { quiz: s.quiz } : undefined)` puis, si
  `s.view === "quizzes"` et `s.drillFolder !== null`,
  `this.quizzes.openFolder(s.drillFolder)` (navigate a déjà refermé le
  drill via `resetDrilldown`). `openFolder` re-rend : le drill restauré est
  une entrée (`lastPaintedView` a été ré-armé) → transition jouée.

### Nouvelles surfaces d'interface

- `QuizzesHandlers.getOpenFolder(): string | null` — drill courant.
- `QuizzesHandlers.openFolder(folder: string): void` — ouvre un dossier
  (équivalent d'`openModule`, exposé pour la restauration).
- `DashboardCtx.recordNav(): void` — pont quizzes.ts → vue.

### Écoute des boutons souris (dashboard.ts, onOpen)

- `this.registerDomEvent(this.contentEl, "mouseup", handler, { capture: true })`
  + le même sur `"mousedown"` : pour `event.button === 3 | 4`,
  `preventDefault()` + `stopPropagation()` (bloquer AUSSI mousedown évite
  que la navigation d'historique native d'Obsidian, déclenchée par ces
  boutons, tire en parallèle) ; l'action (`goNavBack`/`goNavForward`) part
  du `mouseup` seul.
- Portée : `this.contentEl` (racine `.qbd-root` de la vue) → actif partout
  dans le dashboard (sidebar comprise), inactif ailleurs.
- `registerDomEvent` détache au unload de la vue (pas de fuite).

## Cas limites

- Piles vides : le clic est consommé mais ne fait rien (comportement d'app,
  prévisible ; on ne laisse pas Obsidian sortir de la vue dashboard).
- Snapshot de détail dont le quiz a disparu du vault : appliqué tel quel —
  même comportement que `selectedQuiz` périmé aujourd'hui (le détail
  affiche ce qu'il peut ; pas de garde supplémentaire).
- Dossier du drill renommé/supprimé : le drill s'ouvre sur un dossier vide
  (empty state) ; « précédent » reste disponible.
- Mobile/tactile : aucun bouton 3/4 n'existe — listeners inertes, aucun
  impact (`isDesktopOnly` reste false, aucun module Node).

## Risque identifié (à trancher à la vérification in-app)

Si la navigation native d'Obsidian sur ces boutons passe par le canal
Electron `app-command` (process principal) et non par un listener DOM,
`preventDefault`/`stopPropagation` côté renderer pourraient ne pas la
bloquer : le dashboard naviguerait ET l'onglet Obsidian aussi. La
vérification in-app (étape finale du plan) doit tester explicitement ce
point ; si le double déclenchement se produit, investiguer le canal réel
avant toute rustine.

## Hors scope

- Raccourcis clavier back/forward (Obsidian en a déjà), geste trackpad.
- Persistance de l'historique entre sessions.
- Historique des états INTERNES d'une page (axe UE/Récent, sections
  repliées…) : seuls page + drill + quiz du détail sont capturés.

## Vérification

1. Contrats regex (script existant) : présence des piles, de la garde
   `isRestoringNav`, des listeners button 3/4 en capture.
2. `npm run check`, `npm run build`, reload Efrei.
3. In-app : séquence Generate → Mes quiz → drill XTI202 → détail d'un quiz,
   puis 3 × précédent (détail → drill → grille → Generate) et 2 × suivant ;
   vérifier à chaque pas la vue affichée, le dossier rouvert, et l'absence
   de navigation d'onglet Obsidian parasite (l'historique de la feuille ne
   doit pas bouger). Vérifier aussi qu'un clic bouton 3 dans une NOTE
   (hors dashboard) navigue toujours nativement.
