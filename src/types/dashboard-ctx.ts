/**
 * Interface du ctx (god-object) du sous-système dashboard (src/dashboard.js,
 * classe QuizDashboardView extends ItemView, méthode onOpen).
 *
 * Le littéral `ctx` construit en onOpen (dashboard.js:54-64) est PLUS PETIT
 * que celui de l'éditeur (EditorCtx) : il ne porte que l'état de base + deux
 * helpers, `this.ctx = ctx` (dashboard.js:66), puis 5 sous-modules sont
 * assignés directement sur la VUE — PAS sur ctx (dashboard.js:69-73) :
 *   this.nav = createNavHandlers(ctx)
 *   this.home = createHomeHandlers(ctx)
 *   this.quizzes = createQuizzesHandlers(ctx)
 *   this.detail = createDetailHandlers(ctx)
 *   this.ai = createAiHandlers(ctx)
 * D'où la scission en deux interfaces ci-dessous : `DashboardCtx` (fidèle au
 * littéral ctx réel) et `DashboardView` (l'hôte `this`, qui porte les 5
 * handlers + l'état propre à la vue).
 *
 * scanner/statsStore sont produits par des factories à signature NON-ctx
 * (createScanner(app) et createStatsStore(plugin), src/dashboard/scanner.js
 * et src/dashboard/stats-store.js) et les 5 modules dashboard/*.js listés
 * ci-dessus ne sont PAS encore convertis en .ts → aucun type ne peut être
 * importé depuis eux sans casser `npm run check`. Placeholders `unknown`-based
 * ci-dessous, à remplacer par les vrais types en Task 8 (conversion du lot
 * dashboard).
 */

import type { App, ItemView, Plugin, TFile } from "obsidian";

/* ════════════════════════════════════════════════════════
   Placeholders — remplacés par les vrais types en Task 8
   quand scanner.js / stats-store.js / ai-client.js et les
   5 modules dashboard/{nav,home,quizzes,detail,ai}.js
   passeront en .ts. Volontairement `unknown`-based (jamais
   `any`) : aucun membre n'est garanti tant que le module
   source reste en JS.
   ════════════════════════════════════════════════════════ */

/**
 * Placeholder du scanner de quiz (src/dashboard/scanner.js, createScanner(app)).
 * Usages observés côté dashboard/*.js (non modélisés ici) : init(), destroy(),
 * scanVault(), scanFile(), getQuizzes(), getQuiz(), getTotalQuestions(),
 * onChange(cb) — scanner.js:234-243.
 */
export interface Scanner {
	[member: string]: unknown;
}

/**
 * Placeholder du store de stats (src/dashboard/stats-store.js, createStatsStore(plugin)).
 * Usages observés côté dashboard/*.js (non modélisés ici) : load(), updateRecord(),
 * getRecord(), getAll(), deleteRecord(), formatRelativeTime(), destroy() —
 * stats-store.js:94-102.
 */
export interface StatsStore {
	[member: string]: unknown;
}

/**
 * Placeholder du client IA (src/dashboard/ai-client.js, createAiClient(plugin)).
 * NE FIGURE PAS dans le littéral ctx ni sur la vue : instancié à la demande,
 * en interne, par le sous-module `ai` (dashboard/ai.js:1072-1073, `const
 * aiClient = require("./ai-client"); const client = aiClient(ctx.plugin);`).
 * Déclaré ici par anticipation pour Task 8 (typage de dashboard/ai.js), qui
 * en aura besoin dès que ai-client.js passera en .ts.
 */
export interface AiClient {
	[member: string]: unknown;
}

/**
 * Placeholder d'un sous-module de handlers dashboard (nav/home/quizzes/detail/ai),
 * produit par sa factory `createXxxHandlers(ctx)` (dashboard/{nav,home,quizzes,
 * detail,ai}.js, toutes encore en .js). Chaque module expose au moins une
 * méthode `render(container, ...)` mais la signature exacte diffère par module
 * (ex. detail.render(container, quiz)) — non modélisé ici pour éviter tout
 * `any` implicite avant Task 8.
 */
export interface DashboardHandlers {
	[member: string]: unknown;
}

/* ════════════════════════════════════════════════════════
   DashboardView — l'hôte `this` (QuizDashboardView), qui
   porte les 5 sous-modules + l'état propre à la vue
   ════════════════════════════════════════════════════════ */

/**
 * `view` / `this` dans QuizDashboardView (dashboard.js:19-171). Porte l'état
 * de navigation, les getters `scanner`/`statsStore` (dashboard.js:39-40) et
 * les 5 sous-modules assignés en onOpen (dashboard.js:69-73) — c'est CETTE
 * interface, pas DashboardCtx, qui porte nav/home/quizzes/detail/ai.
 */
export interface DashboardView extends ItemView {
	plugin: Plugin;
	/** dashboard.js:23, valeurs réellement utilisées (switch dashboard.js:149-169). */
	currentView: "home" | "quizzes" | "detail" | "ai";
	/** Quiz sélectionné pour la vue détail (dashboard.js:24) ; forme réelle non typée, cf. Scanner (Task 8). */
	selectedQuiz: unknown;
	/** Vue précédente, pour le retour depuis "detail" (dashboard.js:25, 131-134). */
	previousView: string;
	/** dashboard.js:26, 50 — conteneur sidebar, assigné en onOpen. */
	navEl: HTMLElement | null;
	/** dashboard.js:27, 51 — conteneur contenu, assigné en onOpen (nommé `contentEl_` pour ne pas masquer `ItemView.contentEl`). */
	contentEl_: HTMLElement | null;
	/** Getters dashboard.js:39-40, lisent `plugin._scanner`/`plugin._statsStore`. */
	readonly scanner: Scanner;
	readonly statsStore: StatsStore;
	/** ctx sauvegardé sur la vue (dashboard.js:66, `this.ctx = ctx`). */
	ctx?: DashboardCtx;

	// ── Sous-modules assignés en onOpen (dashboard.js:69-73) — Task 8 remplacera
	//    DashboardHandlers par le type réel de chaque factory createXxxHandlers. ──
	nav?: DashboardHandlers;
	home?: DashboardHandlers;
	quizzes?: DashboardHandlers;
	detail?: DashboardHandlers;
	ai?: DashboardHandlers;

	navigate(view: string, data?: { quiz?: unknown }): void;
	renderSidebar(): void;
	renderCurrentView(): void;
}

/* ════════════════════════════════════════════════════════
   DashboardCtx — le ctx lui-même (dashboard.js:54-64)
   ════════════════════════════════════════════════════════ */

export interface DashboardCtx {
	/** Référence à la vue hôte — même objet que `this` dans QuizDashboardView (dashboard.js:55). */
	view: DashboardView;
	app: App;
	plugin: Plugin;
	/** Copie de `view.scanner` au moment de la construction du ctx (dashboard.js:58). */
	scanner: Scanner;
	/** Copie de `view.statsStore` au moment de la construction du ctx (dashboard.js:59). */
	statsStore: StatsStore;
	/** Même référence DOM que `view.navEl` (dashboard.js:60) — déjà assignée à ce stade (onOpen l'a créée avant de construire ctx, dashboard.js:50). */
	navEl: HTMLElement;
	/** Même référence DOM que `view.contentEl_` (dashboard.js:61) — nommé `contentEl` dans le littéral ctx réel. */
	contentEl: HTMLElement;
	/** dashboard.js:62, délègue à `view.navigate(view, data)` (dashboard.js:127-139). `data.quiz` est le seul champ lu. */
	navigate: (view: string, data?: { quiz?: unknown }) => void;
	/** dashboard.js:63, `() => this.app.workspace.getActiveFile()`. */
	getActiveFile: () => TFile | null;
}
