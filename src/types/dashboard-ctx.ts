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
 * Task 8a convertit le cluster RENDU (scanner/stats-store/quiz-card/nav/
 * home/quizzes/detail/effort-canvas) : Scanner/StatsStore sont désormais les
 * vrais types importés depuis scanner.ts/stats-store.ts. `ai` (dashboard/ai.js)
 * et `AiClient` (ai-client.js) restent en placeholder `unknown`-based — hors
 * périmètre 8a (lot IA, tâche suivante).
 */

import type { App, ItemView, Plugin, TFile } from "obsidian";
import type { Scanner, QuizIndexEntry } from "../dashboard/scanner";
import type { StatsStore } from "../dashboard/stats-store";
import type { NavHandlers } from "../dashboard/nav";
import type { QuizzesHandlers } from "../dashboard/quizzes";
import type { HomeHandlers } from "../dashboard/home";
import type { DetailHandlers } from "../dashboard/detail";
import type { VoiceSettings } from "../dashboard/voice-install";

export type { Scanner, StatsStore };

/** Vues possibles du dashboard (dashboard.js:23 currentView, navigate, previousView). */
export type DashboardViewName = "home" | "quizzes" | "detail" | "ai";

/**
 * Placeholder du client IA (src/dashboard/ai-client.js, createAiClient(plugin)).
 * NE FIGURE PAS dans le littéral ctx ni sur la vue : instancié à la demande,
 * en interne, par le sous-module `ai` (dashboard/ai.js:1072-1073, `const
 * aiClient = require("./ai-client"); const client = aiClient(ctx.plugin);`).
 * Déclaré ici par anticipation, pour la prochaine tâche (typage de
 * dashboard/ai.js), qui en aura besoin dès que ai-client.js passera en .ts.
 */
export interface AiClient {
	[member: string]: unknown;
}

/**
 * Placeholder générique d'un sous-module de handlers dashboard encore en .js.
 * Après Task 8a, seul `ai` (dashboard/ai.js, createAiHandlers(ctx)) l'utilise
 * encore — hors périmètre 8a (lot IA). Chaque handler expose au moins une
 * méthode `render(container, ...)` mais la signature exacte diffère par
 * module ; non modélisé ici pour éviter tout `any` implicite avant conversion.
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
	currentView: DashboardViewName;
	/** Quiz sélectionné pour la vue détail (dashboard.js:24). */
	selectedQuiz: QuizIndexEntry | null;
	/** Vue précédente, pour le retour depuis "detail" (dashboard.js:25, 131-134). */
	previousView: DashboardViewName;
	/** dashboard.js:26, 50 — conteneur sidebar, assigné en onOpen. */
	navEl: HTMLElement | null;
	/** dashboard.js:27, 51 — conteneur contenu, assigné en onOpen (nommé `contentEl_` pour ne pas masquer `ItemView.contentEl`). */
	contentEl_: HTMLElement | null;
	/** Getters dashboard.js:39-40, lisent `plugin._scanner`/`plugin._statsStore`. */
	readonly scanner: Scanner;
	readonly statsStore: StatsStore;
	/** ctx sauvegardé sur la vue (dashboard.js:66, `this.ctx = ctx`). */
	ctx?: DashboardCtx;

	// ── Sous-modules assignés en onOpen (dashboard.js:69-73) — Task 8a a typé
	//    nav/home/quizzes/detail avec leur vrai handler-type ; `ai` reste en
	//    placeholder DashboardHandlers (hors périmètre 8a, lot IA). ──
	nav?: NavHandlers;
	home?: HomeHandlers;
	quizzes?: QuizzesHandlers;
	detail?: DetailHandlers;
	ai?: DashboardHandlers;

	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry }): void;
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
	/**
	 * `plugin.settings` : uniquement le sous-ensemble "dictée" (`VoiceSettings`,
	 * lu par `voice-input.ts` via `ctx.plugin.settings`) est honnêtement typé à
	 * ce stade (Task 8b) — la forme complète (aiProvider, aiModel, quizStats…)
	 * sera étoffée par la conversion du lot IA (Task 8c) et de `plugin.js`
	 * lui-même (encore `.js`). Les champs non listés existent bel et bien au
	 * runtime, simplement pas encore déclarés ici.
	 */
	plugin: Plugin & { settings: VoiceSettings };
	/** Copie de `view.scanner` au moment de la construction du ctx (dashboard.js:58). */
	scanner: Scanner;
	/** Copie de `view.statsStore` au moment de la construction du ctx (dashboard.js:59). */
	statsStore: StatsStore;
	/** Même référence DOM que `view.navEl` (dashboard.js:60) — déjà assignée à ce stade (onOpen l'a créée avant de construire ctx, dashboard.js:50). */
	navEl: HTMLElement;
	/** Même référence DOM que `view.contentEl_` (dashboard.js:61) — nommé `contentEl` dans le littéral ctx réel. */
	contentEl: HTMLElement;
	/** dashboard.js:62, délègue à `view.navigate(view, data)` (dashboard.js:127-139). `data.quiz` est le seul champ lu. */
	navigate: (view: DashboardViewName, data?: { quiz?: QuizIndexEntry }) => void;
	/** dashboard.js:63, `() => this.app.workspace.getActiveFile()`. */
	getActiveFile: () => TFile | null;
}
