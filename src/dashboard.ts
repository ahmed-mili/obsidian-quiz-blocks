import { ItemView, Scope } from "obsidian";
import type { WorkspaceLeaf, KeymapEventHandler } from "obsidian";

// C1 (plan) : les 5 factories des sous-modules dashboard/* sont désormais des
// EXPORTS NOMMÉS (Tasks 8a–8c). L'ancien `const createX = require("./dashboard/x")`
// consommait le module ENTIER en supposant que `module.exports` ÉTAIT la
// fonction — après conversion ESM ce require renvoyait le namespace, cassant
// l'appel au runtime (`createNavHandlers is not a function`). Les imports
// nommés ci-dessous rétablissent la parité.
import { createNavHandlers, type NavHandlers } from "./dashboard/nav";
import { createHomeHandlers, type HomeHandlers } from "./dashboard/home";
import { createQuizzesHandlers, type QuizzesHandlers } from "./dashboard/quizzes";
import { createDetailHandlers, type DetailHandlers } from "./dashboard/detail";
import { createAiHandlers, type AiHandlers } from "./dashboard/ai";

import type { DashboardCtx, DashboardView, DashboardViewName, DashboardPlugin } from "./types/dashboard-ctx";
import type { Scanner, QuizIndexEntry } from "./dashboard/scanner";
import type { StatsStore } from "./dashboard/stats-store";
import type { Hotkey } from "./hotkey-format";

/* ══════════════════════════════════════════════════════════
   QUIZ DASHBOARD VIEW — ItemView Obsidian
   Layout 2 colonnes (sidebar + contenu) avec navigation
   entre Accueil, Mes quiz, Détail et Génération IA.
══════════════════════════════════════════════════════════ */

export const VIEW_TYPE_DASHBOARD = "quiz-blocks-dashboard";

export class QuizDashboardView extends ItemView implements DashboardView {
	plugin: DashboardPlugin;
	currentView: DashboardViewName = "home"; // home | quizzes | detail | ai
	selectedQuiz: QuizIndexEntry | null = null;
	previousView: DashboardViewName = "home";
	navEl: HTMLElement | null = null;
	contentEl_: HTMLElement | null = null;
	ctx?: DashboardCtx;

	// Sous-modules greffés en onOpen (dashboard.js:69-73). Définitivement
	// assignés AVANT tout render / navigate / raccourci (onOpen les pose puis
	// appelle bindComposerHotkeys/renderSidebar) : d'où le `!`.
	nav!: NavHandlers;
	home!: HomeHandlers;
	quizzes!: QuizzesHandlers;
	detail!: DetailHandlers;
	ai!: AiHandlers;

	private _unregisterScanner: (() => void) | null = null;
	private _unregisterLeafChange: (() => void) | null = null;
	private _hkHandlers?: KeymapEventHandler[];

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	static getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	static getDisplayText(): string { return "Quiz Blocks"; }

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return "Quiz Blocks"; }
	getIcon(): string { return "graduation-cap"; }

	get scanner(): Scanner { return this.plugin._scanner; }
	get statsStore(): StatsStore { return this.plugin._statsStore; }

	async onOpen(): Promise<void> {
		this.containerEl.classList.add("qbd-root-container");
		this.contentEl.empty();
		this.contentEl.addClass("qbd-root");

		// Layout principal : sidebar + contenu
		const layout = this.contentEl.createDiv({ cls: "qbd-layout" });

		const navEl = layout.createDiv({ cls: "qbd-sidebar" });
		const contentEl = layout.createDiv({ cls: "qbd-content" });
		this.navEl = navEl;
		this.contentEl_ = contentEl;

		// Contexte partagé pour les sous-modules. Le littéral est COMPLET (les 5
		// sous-modules ne vivent pas sur le ctx mais sur `this`) : l'annotation
		// `: DashboardCtx` suffit, sans cast intermédiaire.
		const ctx: DashboardCtx = {
			view: this,
			app: this.app,
			plugin: this.plugin,
			scanner: this.scanner,
			statsStore: this.statsStore,
			navEl,
			contentEl,
			navigate: (view, data) => this.navigate(view, data),
			getActiveFile: () => this.app.workspace.getActiveFile()
		};

		this.ctx = ctx;

		// Initialiser les modules
		this.nav = createNavHandlers(ctx);
		this.home = createHomeHandlers(ctx);
		this.quizzes = createQuizzesHandlers(ctx);
		this.detail = createDetailHandlers(ctx);
		this.ai = createAiHandlers(ctx);

		// Raccourcis du composer (menu « + ») : Scope de vue Obsidian —
		// actif quand la vue est focalisée, même caret dans le textarea.
		this.bindComposerHotkeys();

		// Écouter les changements du scanner. La SIDEBAR aussi : le badge
		// « Mes quiz » lit getQuizzes() au render — sans ça il reste figé
		// sur le compte partiel du scan initial (badge « 1 » au démarrage).
		// La vue « Générer » est exclue du re-render : elle n'affiche rien
		// du scan, et un re-render intempestif (n'importe quel fichier du
		// vault modifié) fermerait le popover d'options ou couperait la
		// dictée en cours.
		if (this.scanner) {
			this._unregisterScanner = this.scanner.onChange(() => {
				this.renderSidebar();
				if (this.currentView !== "ai") this.renderCurrentView();
			});
		}

		// Rendu initial
		this.renderSidebar();
		this.renderCurrentView();
	}

	/* (Re)bind les raccourcis du composer depuis les réglages — appelé à
	   l'ouverture ET par la SettingTab quand l'utilisateur les change (le
	   Scope existant est conservé, seuls ses handlers sont remplacés :
	   remplacer this.scope à chaud laisserait l'ancien scope poussé sur
	   le keymap tant que la vue reste active). Les touches sont CLAIMÉES
	   même hors de la vue « Générer » : dans une ItemView custom,
	   Ctrl+F/Ctrl+E natifs ne font rien — les laisser fuir déclencherait
	   un comportement Obsidian sans rapport (piège hotkey connu). */
	bindComposerHotkeys(): void {
		const scope: Scope = this.scope ?? (this.scope = new Scope(this.app.scope));
		if (this._hkHandlers) for (const h of this._hkHandlers) scope.unregister(h);
		const handlers: KeymapEventHandler[] = [];
		this._hkHandlers = handlers;
		const s = this.plugin.settings;
		const bind = (hk: Hotkey | null | undefined, action: () => void): void => {
			if (!hk || !hk.key) return;
			handlers.push(scope.register(hk.modifiers || [], hk.key, (e: KeyboardEvent) => {
				e.preventDefault();
				if (this.currentView === "ai") action();
				return false;
			}));
		};
		// `this.ai` (et ses méthodes openAddFiles/openAddNotes, requises par
		// AiHandlers) sont toujours définis quand un raccourci se déclenche :
		// bindComposerHotkeys ne tourne que sur une vue déjà passée par onOpen,
		// et le callback n'est armé que tant que la vue est focalisée. Le garde
		// défensif `if (this.ai && this.ai.openAddFiles)` d'origine était donc
		// mort — l'appel direct est iso-fonctionnel.
		bind(s.hotkeyAddFiles, () => this.ai.openAddFiles());
		bind(s.hotkeyAddNotes, () => this.ai.openAddNotes());
	}

	async onClose(): Promise<void> {
		if (this._unregisterScanner) this._unregisterScanner();
	}

	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry }): void {
		if (data) {
			if (data.quiz) this.selectedQuiz = data.quiz;
		}
		// Track previous view for back navigation from detail
		if (view === "detail") {
			this.previousView = this.currentView;
		}
		// Naviguer VERS « Mes quiz » (rail, retour depuis le détail…) referme
		// tout drill-down de module : la grille est le point d'entrée attendu.
		// C'est une navigation ENTRANTE, pas un re-render interne (filtre,
		// recherche, drill) qui, lui, passe par le render() capturé du handler
		// et doit conserver le module ouvert.
		if (view === "quizzes" && this.quizzes) {
			this.quizzes.resetDrilldown();
		}
		this.currentView = view;
		this.nav.setActive(view);
		this.renderSidebar();
		this.renderCurrentView();
	}

	renderSidebar(): void {
		if (!this.navEl) return;
		this.navEl.empty();
		this.nav.render(this.navEl);
	}

	renderCurrentView(): void {
		const contentEl = this.contentEl_;
		if (!contentEl) return;
		contentEl.empty();

		switch (this.currentView) {
			case "home":
				this.home.render(contentEl);
				break;
			case "quizzes":
				this.quizzes.render(contentEl);
				break;
			case "detail":
				if (this.selectedQuiz) {
					this.detail.render(contentEl, this.selectedQuiz);
				} else {
					this.currentView = "home";
					this.home.render(contentEl);
				}
				break;
			case "ai":
				this.ai.render(contentEl);
				break;
			default:
				this.home.render(contentEl);
		}
	}
}
