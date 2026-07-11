'use strict';

const obsidian = require("obsidian");

/* ══════════════════════════════════════════════════════════
   QUIZ DASHBOARD VIEW — ItemView Obsidian
   Layout 2 colonnes (sidebar + contenu) avec navigation
   entre Accueil, Mes quiz, Détail et Génération IA.
══════════════════════════════════════════════════════════ */

const VIEW_TYPE_DASHBOARD = "quiz-blocks-dashboard";

const createNavHandlers = require("./dashboard/nav");
const createHomeHandlers = require("./dashboard/home");
const createQuizzesHandlers = require("./dashboard/quizzes");
const createDetailHandlers = require("./dashboard/detail");
const createAiHandlers = require("./dashboard/ai");

class QuizDashboardView extends obsidian.ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentView = "home"; // home | quizzes | detail | ai
		this.selectedQuiz = null;
		this.previousView = "home";
		this.navEl = null;
		this.contentEl_ = null;
		this._unregisterScanner = null;
		this._unregisterLeafChange = null;
	}

	static getViewType() { return VIEW_TYPE_DASHBOARD; }
	static getDisplayText() { return "Quiz Blocks"; }

	getViewType() { return VIEW_TYPE_DASHBOARD; }
	getDisplayText() { return "Quiz Blocks"; }
	getIcon() { return "graduation-cap"; }

	get scanner() { return this.plugin._scanner; }
	get statsStore() { return this.plugin._statsStore; }

	onOpen() {
		this.containerEl.classList.add("qbd-root-container");
		this.contentEl.empty();
		this.contentEl.addClass("qbd-root");

		// Layout principal : sidebar + contenu
		const layout = this.contentEl.createDiv({ cls: "qbd-layout" });

		this.navEl = layout.createDiv({ cls: "qbd-sidebar" });
		this.contentEl_ = layout.createDiv({ cls: "qbd-content" });

		// Contexte partagé pour les sous-modules
		const ctx = {
			view: this,
			app: this.app,
			plugin: this.plugin,
			scanner: this.scanner,
			statsStore: this.statsStore,
			navEl: this.navEl,
			contentEl: this.contentEl_,
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

		// Écouter le changement de note active
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.nav) this.nav.updateActiveNote();
			})
		);

		// Rendu initial
		this.renderSidebar();
		this.renderCurrentView();
	}

	onClose() {
		if (this._unregisterScanner) this._unregisterScanner();
	}

	navigate(view, data) {
		if (data) {
			if (data.quiz) this.selectedQuiz = data.quiz;
		}
		// Track previous view for back navigation from detail
		if (view === "detail") {
			this.previousView = this.currentView;
		}
		this.currentView = view;
		this.nav.setActive(view);
		this.renderSidebar();
		this.renderCurrentView();
	}

	renderSidebar() {
		this.navEl.empty();
		this.nav.render(this.navEl);
	}

	renderCurrentView() {
		this.contentEl_.empty();

		switch (this.currentView) {
			case "home":
				this.home.render(this.contentEl_);
				break;
			case "quizzes":
				this.quizzes.render(this.contentEl_);
				break;
			case "detail":
				if (this.selectedQuiz) {
					this.detail.render(this.contentEl_, this.selectedQuiz);
				} else {
					this.currentView = "home";
					this.home.render(this.contentEl_);
				}
				break;
			case "ai":
				this.ai.render(this.contentEl_);
				break;
			default:
				this.home.render(this.contentEl_);
		}
	}
}

module.exports = { QuizDashboardView, VIEW_TYPE_DASHBOARD };