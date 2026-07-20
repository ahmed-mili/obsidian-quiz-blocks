# Mouse Nav History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boutons latéraux de la souris (3 = précédent, 4 = suivant) pour naviguer l'historique interne du dashboard (pages + drill-down + détail), sans toucher à la navigation native d'Obsidian hors du dashboard.

**Architecture:** La vue dashboard tient deux piles de `NavSnapshot` (`view`, `drillFolder`, `quiz`). `navigate()` et les transitions de drill (via un nouveau `ctx.recordNav()`) empilent l'état quitté ; la restauration applique un snapshot sous une garde `isRestoringNav` pour ne pas ré-empiler. Deux listeners DOM en capture sur le conteneur de la vue neutralisent les boutons 3/4 (mousedown + mouseup) et déclenchent la navigation au mouseup.

**Tech Stack:** TypeScript strict, API Obsidian (`registerDomEvent`), script de contrat `scripts/check-folder-drill-design.mjs`, build esbuild.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-20-mouse-nav-history-design.md`.
- Aucune chaîne visible nouvelle (pas d'i18n), aucune donnée persistée (piles = état d'interface).
- Commentaires en français ; `npm run check` vert après chaque task ; les contrats EXISTANTS de `scripts/check-folder-drill-design.mjs` restent PASS.
- Mobile : listeners inertes (aucun bouton 3/4), `isDesktopOnly` reste false, aucun module Node.
- La restauration d'un état est une ENTRÉE : la transition `qbd-quizzes-enter` doit jouer (aucun contournement de `lastPaintedView`).

---

### Task 1: Historique — piles, snapshots, enregistrement, restauration

**Files:**
- Modify: `src/dashboard.ts` (état de classe, `navigate`, nouvelles méthodes)
- Modify: `src/types/dashboard-ctx.ts` (`DashboardCtx.recordNav`, `QuizzesHandlers` — voir Interfaces)
- Modify: `src/dashboard/quizzes.ts` (`openModule`, listener breadcrumb, `getOpenFolder`/`openFolder`)
- Test: `scripts/check-folder-drill-design.mjs`

**Interfaces:**
- Consumes: `QuizzesHandlers.resetDrilldown()` (existant, appelé par `navigate`), `openModuleFolder` (état de closure de quizzes.ts), `lastPaintedView` (armement d'entrée existant).
- Produces (pour Task 2 et la restauration) : `QuizDashboardView.recordNav(): void`, `QuizDashboardView.goNavBack(): void`, `QuizDashboardView.goNavForward(): void` ; `QuizzesHandlers.getOpenFolder(): string | null` ; `QuizzesHandlers.openFolder(folder: string): void` ; `DashboardCtx.recordNav: () => void`.

- [ ] **Step 1: Écrire les contrats en échec**

Ajouter à la fin du tableau `checks` de `scripts/check-folder-drill-design.mjs` (le fichier lit déjà `dashboard` et `quizzes`) :

```js
	["l'historique souris empile l'état quitté et vide la pile avant", /recordNav\(\): void \{[\s\S]*?this\.navBackStack\.push\(snap\);[\s\S]*?this\.navForwardStack\.length = 0;/, dashboard],
	["une restauration n'empile jamais (garde isRestoringNav)", /recordNav\(\): void \{\s*\n\s*if \(this\.isRestoringNav\) return;/, dashboard],
	["entrer dans un dossier enregistre l'état quitté", /function openModule\(folder: string\): void \{\s*\n[\s\S]{0,220}?ctx\.recordNav\(\);/, quizzes],
	["le retour « All quizzes » enregistre l'état quitté", /back\.addEventListener\("click", \(\) => \{\s*\n\s*ctx\.recordNav\(\);\s*\n\s*openModuleFolder = null;/, quizzes],
	["la restauration d'un drill repasse par openModule", /openFolder\(folder: string\) \{ openModule\(folder\); \}/, quizzes],
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`
Expected: `FAIL` pour les cinq nouveaux contrats, aucun autre FAIL.

- [ ] **Step 3: Types — `src/types/dashboard-ctx.ts`**

Dans `DashboardCtx`, après le champ `navigate`, ajouter :

```ts
	/** Historique boutons souris (spec 2026-07-20-mouse-nav-history) : empile
	    l'état de navigation COURANT avant un changement — appelé par quizzes.ts
	    juste avant drill in/out. Délègue à `view.recordNav()` (no-op pendant
	    une restauration, garde isRestoringNav côté vue). */
	recordNav: () => void;
```

Dans `DashboardView`, après `renderCurrentView(): void;`, ajouter :

```ts
	/** Historique boutons souris — cf. QuizDashboardView (dashboard.ts). */
	recordNav(): void;
	goNavBack(): void;
	goNavForward(): void;
```

- [ ] **Step 4: Vue — `src/dashboard.ts`**

Après le bloc d'imports, ajouter :

```ts
/** Photo d'un état de navigation pour l'historique boutons souris (spec
    2026-07-20-mouse-nav-history) : page + dossier ouvert + quiz du détail.
    État d'interface, jamais persisté. */
interface NavSnapshot {
	view: DashboardViewName;
	/** Dossier du drill-down — pertinent seulement si view === "quizzes". */
	drillFolder: string | null;
	/** Quiz affiché — pertinent seulement si view === "detail". */
	quiz: QuizIndexEntry | null;
}

/** Plafond des piles d'historique (shift au-delà) : borne la mémoire sans
    jamais gêner un usage réel. */
const NAV_HISTORY_MAX = 50;
```

Dans la classe `QuizDashboardView`, après `private _hkHandlers?: KeymapEventHandler[];`, ajouter :

```ts
	// ── Historique boutons souris (spec 2026-07-20-mouse-nav-history) ──
	private navBackStack: NavSnapshot[] = [];
	private navForwardStack: NavSnapshot[] = [];
	/* Vrai pendant l'application d'un snapshot : navigate()/recordNav() ne
	   doivent alors PAS empiler — une restauration n'est pas une navigation. */
	private isRestoringNav = false;

	private captureNav(): NavSnapshot {
		return {
			view: this.currentView,
			drillFolder: this.quizzes ? this.quizzes.getOpenFolder() : null,
			quiz: this.currentView === "detail" ? this.selectedQuiz : null,
		};
	}

	private sameNav(a: NavSnapshot, b: NavSnapshot): boolean {
		return a.view === b.view && a.drillFolder === b.drillFolder
			&& (a.quiz?.path ?? null) === (b.quiz?.path ?? null);
	}

	/** Empile l'état COURANT sur back et vide forward. Appelé par navigate()
	    et, via ctx.recordNav, par les transitions de drill (quizzes.ts). */
	recordNav(): void {
		if (this.isRestoringNav) return;
		const snap = this.captureNav();
		// Dédoublonnage défensif : deux enregistrements consécutifs du même
		// état (ex. drill in juste après une navigation) ne créent qu'une entrée.
		const top = this.navBackStack[this.navBackStack.length - 1];
		if (top && this.sameNav(top, snap)) return;
		this.navBackStack.push(snap);
		if (this.navBackStack.length > NAV_HISTORY_MAX) this.navBackStack.shift();
		this.navForwardStack.length = 0;
	}

	private applyNavSnapshot(s: NavSnapshot): void {
		this.isRestoringNav = true;
		try {
			this.navigate(s.view, s.quiz ? { quiz: s.quiz } : undefined);
			if (s.view === "quizzes" && s.drillFolder !== null && this.quizzes) {
				// navigate() vient de refermer le drill (resetDrilldown) : rouvrir
				// le dossier restauré — c'est une ENTRÉE, la transition rejoue.
				this.quizzes.openFolder(s.drillFolder);
			}
		} finally {
			this.isRestoringNav = false;
		}
	}

	goNavBack(): void {
		const snap = this.navBackStack.pop();
		if (!snap) return;
		this.navForwardStack.push(this.captureNav());
		this.applyNavSnapshot(snap);
	}

	goNavForward(): void {
		const snap = this.navForwardStack.pop();
		if (!snap) return;
		this.navBackStack.push(this.captureNav());
		this.applyNavSnapshot(snap);
	}
```

En tête de `navigate(view, data)`, AVANT le bloc `if (data)`, ajouter :

```ts
		// Historique boutons souris : empiler l'état QUITTÉ — sauf restauration
		// (goNavBack/Forward gèrent leurs piles) et sauf navigation immobile
		// (re-clic du rail sur la page courante : rien à restaurer).
		const arriving: NavSnapshot = {
			view,
			drillFolder: null, // naviguer referme toujours le drill (resetDrilldown)
			quiz: view === "detail" ? (data?.quiz ?? this.selectedQuiz) : null,
		};
		if (!this.isRestoringNav && !this.sameNav(this.captureNav(), arriving)) {
			this.recordNav();
		}
```

Dans le littéral `ctx` de `onOpen`, après `navigate: (view, data) => this.navigate(view, data),`, ajouter :

```ts
			recordNav: () => this.recordNav(),
```

- [ ] **Step 5: Contrôleur quizzes — `src/dashboard/quizzes.ts`**

Dans `openModule` (fonction existante), ajouter l'enregistrement en tête :

```ts
	function openModule(folder: string): void {
		// Historique boutons souris : l'état quitté (grille ou autre dossier)
		// doit rester restaurable (spec 2026-07-20-mouse-nav-history).
		ctx.recordNav();
		openModuleFolder = folder;
		if (containerRef) render(containerRef);
	}
```

Dans le listener du bouton « All quizzes » du fil d'Ariane, ajouter la même
ligne en tête :

```ts
		back.addEventListener("click", () => {
			ctx.recordNav();
			openModuleFolder = null;
			if (containerRef) render(containerRef);
		});
```

Dans l'interface `QuizzesHandlers`, après `resetDrilldown(): void;`, ajouter :

```ts
	/** Dossier ouvert du drill-down (null = grille) — lu par captureNav()
	    (historique boutons souris, dashboard.ts). */
	getOpenFolder(): string | null;
	/** Restauration d'historique : rouvre un dossier par le MÊME chemin de
	    code qu'un clic de carte (openModule) — le recordNav interne est
	    neutralisé par la garde isRestoringNav de la vue. */
	openFolder(folder: string): void;
```

Dans le `return` final de `createQuizzesHandlers`, après `resetDrilldown`, ajouter :

```ts
		getOpenFolder() { return openModuleFolder; },
		openFolder(folder: string) { openModule(folder); },
```

- [ ] **Step 6: Vérifier contrats + typecheck**

Run: `node scripts/check-folder-drill-design.mjs && npm run check`
Expected: `PASS: contrat visuel du dossier ouvert`, tsc code de sortie 0.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard.ts src/types/dashboard-ctx.ts src/dashboard/quizzes.ts scripts/check-folder-drill-design.mjs
git commit -m "feat(dashboard): historique de navigation interne (piles back/forward + restauration)"
```

---

### Task 2: Listeners boutons souris

**Files:**
- Modify: `src/dashboard.ts` (`onOpen`, après l'assignation des sous-modules)
- Test: `scripts/check-folder-drill-design.mjs`

**Interfaces:**
- Consumes: `goNavBack()` / `goNavForward()` (Task 1), `this.contentEl` (conteneur `.qbd-root` de l'ItemView, couvre sidebar + contenu).

- [ ] **Step 1: Écrire les contrats en échec**

Ajouter à la fin du tableau `checks` :

```js
	["les boutons souris 3/4 sont neutralisés dans le dashboard (capture, deux phases)", /const swallowNavButtons = \(e: MouseEvent, act: boolean\): void => \{\s*\n\s*if \(e\.button !== 3 && e\.button !== 4\) return;\s*\n\s*e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/, dashboard],
	["l'action d'historique ne part que du mouseup", /registerDomEvent\(this\.contentEl, "mousedown", \(e: MouseEvent\) => swallowNavButtons\(e, false\), \{ capture: true \}\);\s*\n\s*this\.registerDomEvent\(this\.contentEl, "mouseup", \(e: MouseEvent\) => swallowNavButtons\(e, true\), \{ capture: true \}\);/, dashboard],
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`
Expected: `FAIL` pour les deux nouveaux contrats, aucun autre FAIL.

- [ ] **Step 3: Implémenter les listeners dans `onOpen`**

Dans `onOpen`, après l'assignation des sous-modules (`this.ai = createAiHandlers(ctx);`), ajouter :

```ts
		// ── Boutons latéraux souris (3 = précédent, 4 = suivant) : historique
		// interne du dashboard (spec 2026-07-20-mouse-nav-history). En CAPTURE
		// et sur les DEUX phases : la navigation d'onglet native d'Obsidian
		// écoute aussi ces boutons — on la neutralise DANS le dashboard,
		// l'action ne part que du mouseup. Pile vide = clic consommé sans
		// effet (comportement d'app, on ne sort jamais de la vue). Mobile :
		// aucun bouton 3/4 n'existe, listeners inertes. registerDomEvent
		// détache au unload de la vue.
		const swallowNavButtons = (e: MouseEvent, act: boolean): void => {
			if (e.button !== 3 && e.button !== 4) return;
			e.preventDefault();
			e.stopPropagation();
			if (!act) return;
			if (e.button === 3) this.goNavBack(); else this.goNavForward();
		};
		this.registerDomEvent(this.contentEl, "mousedown", (e: MouseEvent) => swallowNavButtons(e, false), { capture: true });
		this.registerDomEvent(this.contentEl, "mouseup", (e: MouseEvent) => swallowNavButtons(e, true), { capture: true });
```

- [ ] **Step 4: Vérifier contrats + typecheck**

Run: `node scripts/check-folder-drill-design.mjs && npm run check`
Expected: `PASS: contrat visuel du dossier ouvert`, tsc code de sortie 0.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts scripts/check-folder-drill-design.mjs
git commit -m "feat(dashboard): boutons latéraux souris = précédent/suivant dans le dashboard"
```

---

### Task 3: Build, reload et vérification dans Obsidian

**Files:**
- Aucune modification attendue (vérification ; corriger seulement si un point échoue).

**Interfaces:**
- Consumes: le CLI Obsidian (invoquer le skill `obsidian:cli` AVANT toute commande `obsidian ...` ; TOUJOURS `vault="Efrei"`), la vue dashboard (`app.workspace.getLeavesOfType("quiz-blocks-dashboard")`).

- [ ] **Step 1: Build et reload**

Run: `npm run build` puis `obsidian vault="Efrei" plugin:reload id=quiz-blocks`
Expected: exit 0, reload OK.

- [ ] **Step 2: Vérifier l'historique par l'API (eval)**

Via `obsidian vault="Efrei" eval`, sur la vue dashboard (l'ouvrir si besoin) :
séquence `navigate("ai")` → `navigate("quizzes")` → `quizzes.openFolder(<un dossier réel du vault>)` → `navigate("detail", { quiz: <un quiz réel> })`, puis `goNavBack()` × 3 en vérifiant après chaque appel `currentView` et `quizzes.getOpenFolder()` (attendu : detail → quizzes+dossier → quizzes racine → ai), puis `goNavForward()` × 2 (attendu : quizzes racine → quizzes+dossier). Vérifier aussi que la restauration du drill pose `qbd-quizzes-enter` sur `.qbd-content` (transition rejouée).

- [ ] **Step 3: Vérifier le câblage DOM**

Dans le même eval : `document.querySelector(".qbd-content").dispatchEvent(new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true }))` → `currentView` doit reculer d'un cran (le listener capture de la vue le voit). Répéter avec `button: 4` → avancer d'un cran.

- [ ] **Step 4: Rapport (limite connue)**

Consigner les résultats dans le rapport. Noter explicitement : le test « un VRAI clic hardware sur les boutons latéraux ne déclenche pas EN PLUS la navigation d'onglet native d'Obsidian » ne peut pas être automatisé (le canal natif peut être `app-command` côté Electron) — à faire confirmer par Ahmed à la souris ; si un double déclenchement apparaît, investiguer le canal réel avant toute rustine (spec, section Risque).
