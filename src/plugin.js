'use strict';

const obsidian = require("obsidian");
const { parseQuizSource, renderInteractiveQuiz } = require("./engine");
const { QuizBuilderView, VIEW_TYPE } = require("./editor");
const { QuizDashboardView, VIEW_TYPE_DASHBOARD } = require("./dashboard");
const createScanner = require("./dashboard/scanner");
const createStatsStore = require("./dashboard/stats-store");

const PLUGIN_ID = "quiz-blocks";
const PLUGIN_NAME = "Quiz Blocks";
const QUIZ_BLOCK_LANGUAGE = "quiz-blocks";

const DEFAULT_SETTINGS = {
	enableCodeHighlighting: true,
	quizStats: {},
	aiProvider: "",
	aiModel: "",
	aiOllamaUrl: "http://localhost:11434",
	aiOllamaCloudKey: "",
};

function createLogger() {
	return {
		debug(...args) {
			console.debug(`[${PLUGIN_ID}]`, ...args);
		},
		info(...args) {
			console.log(`[${PLUGIN_ID}]`, ...args);
		},
		warn(...args) {
			console.warn(`[${PLUGIN_ID}]`, ...args);
		},
		error(...args) {
			console.error(`[${PLUGIN_ID}]`, ...args);
		}
	};
}

class QuizBlocksSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: PLUGIN_NAME });

		containerEl.createEl("p", {
			text: "Create interactive quizzes in Obsidian from quiz-blocks code blocks.",
			cls: "setting-item-description"
		});

		containerEl.createEl("h3", { text: "Supported question types" });

		const typesEl = containerEl.createEl("ul");
		typesEl.createEl("li", { text: "Single choice" });
		typesEl.createEl("li", { text: "Multiple choice" });
		typesEl.createEl("li", { text: "Text input" });
		typesEl.createEl("li", { text: "Ordering" });
		typesEl.createEl("li", { text: "Matching" });

		containerEl.createEl("h3", { text: "Quick example" });

		const exampleCode = `[
  {
    title: "Question 1",
    prompt: "What is 2 + 2?",
    options: ["3", "4", "5"],
    correctIndex: 1
  }
]`;

		const codeWrap = containerEl.createDiv({
			cls: "quiz-blocks-settings-code-block markdown-rendered"
		});

		const codeHeader = codeWrap.createDiv({
			cls: "quiz-blocks-settings-code-header"
		});

		codeHeader.createSpan({
			text: "quiz-blocks",
			cls: "quiz-blocks-settings-code-lang"
		});

		const copyBtn = codeHeader.createEl("button", {
			cls: "clickable-icon extra-setting-button quiz-blocks-settings-copy-btn"
		});

		copyBtn.setAttr("type", "button");
		copyBtn.setAttr("aria-label", "Copy code");
		copyBtn.setAttr("title", "Copy code");

		obsidian.setIcon(copyBtn, "copy");

		const pre = codeWrap.createEl("pre", {
			cls: "quiz-blocks-settings-code-pre"
		});

		pre.createEl("code", {
			text: exampleCode,
			cls: "language-quiz-blocks"
		});

		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(
					"```quiz-blocks\n" + exampleCode + "\n```"
				);

				obsidian.setIcon(copyBtn, "check");

				window.setTimeout(() => {
					obsidian.setIcon(copyBtn, "copy");
				}, 1200);
			} catch (error) {
				console.error("[quiz-blocks] copy failed", error);
				new obsidian.Notice("Unable to copy the example.");
			}
		});

		containerEl.createEl("h3", { text: "Notes" });

		const notesEl = containerEl.createEl("ul");
		notesEl.createEl("li", { text: "The code block content must be a valid JSON5 array." });
		notesEl.createEl("li", { text: "Hints, explanations, scoring, navigation, and transitions are supported." });
		notesEl.createEl("li", { text: "Interactive rendering happens directly inside the note preview." });

		// ─── Available Commands Section ───
		containerEl.createEl("h3", { text: "Commandes et raccourcis clavier (par défaut)" });

		const commandsInfo = [
			{
				id: "open-quiz-builder",
				name: "Ouvrir le Quiz Editor",
				hotkey: "Ctrl+Shift+E",
				desc: "Ouvre un nouvel onglet avec le Quiz Editor vide"
			},
			{
				id: "open-quiz-from-active-note",
				name: "Ouvrir le quiz de la note active",
				hotkey: "Ctrl+Shift+Q",
				desc: "Ouvre l'éditeur et charge le quiz de la note active"
			}
		];

		// Tableau des commandes
		const commandsTable = containerEl.createDiv({ cls: "qb-commands-table" });
		commandsTable.style.cssText = "margin: 1em 0; border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;";

		for (const cmd of commandsInfo) {
			const row = commandsTable.createDiv({ cls: "qb-command-row" });
			row.style.cssText = "display: flex; align-items: center; padding: 0.75em 1em; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary);";

			const infoDiv = row.createDiv({ cls: "qb-command-info" });
			infoDiv.style.cssText = "flex: 1; min-width: 0;";
			infoDiv.createDiv({ cls: "qb-command-name", text: cmd.name }).style.cssText = "font-weight: 600; color: var(--text-normal); margin-bottom: 0.25em;";
			infoDiv.createDiv({ cls: "qb-command-desc", text: cmd.desc }).style.cssText = "font-size: 0.85em; color: var(--text-muted);";

			const hotkeyDiv = row.createDiv({ cls: "qb-command-hotkey" });
			hotkeyDiv.style.cssText = "display: flex; align-items: center; gap: 0.5em; margin-left: 1em;";

			// Afficher le raccourci par défaut
			const hotkeyBadge = hotkeyDiv.createSpan({ cls: "qb-hotkey-badge", text: cmd.hotkey });
			hotkeyBadge.style.cssText = "font-family: var(--font-monospace); font-size: 0.75em; padding: 0.25em 0.5em; background: var(--interactive-accent); color: var(--text-on-accent); border-radius: 4px; white-space: nowrap;";
		}

		// Supprimer la dernière bordure
		const rows = commandsTable.querySelectorAll('.qb-command-row');
		if (rows.length > 0) {
			rows[rows.length - 1].style.borderBottom = 'none';
		}

		// Bouton unique en bas
		const buttonContainer = containerEl.createDiv({ cls: "qb-config-button-container" });
		buttonContainer.style.cssText = "margin-top: 1.5em; text-align: center;";

		const configButton = buttonContainer.createEl("button", { cls: "mod-cta" });
		configButton.textContent = "Configurer les raccourcis";
		configButton.style.cssText = "padding: 0.75em 1.5em; font-size: 1em;";
		configButton.addEventListener("click", () => {
			this.app.setting.open();
			this.app.setting.openTabById('hotkeys');
			const tab = this.app.setting.activeTab;
			if (tab && tab.searchComponent) {
				tab.searchComponent.setValue('quiz blocks');
				if (tab.updateHotkeyVisibility) {
					tab.updateHotkeyVisibility();
				}
			}
		});

		// Note explicative
		const noteEl = containerEl.createEl("p", { cls: "setting-item-description" });
		noteEl.textContent = "Cliquez sur le bouton ci-dessus pour personnaliser les raccourcis clavier dans les paramètres d'Obsidian.";
		noteEl.style.cssText = "text-align: center; margin-top: 0.75em; font-style: italic;";

		// ─── AI Settings ───
		containerEl.createEl("h3", { text: "Génération IA" });

		containerEl.createEl("p", {
			text: "Configurez votre fournisseur IA pour générer des quiz automatiquement.",
			cls: "setting-item-description"
		});

		// ─── Modèles par fournisseur (registry partagé) ───
		const aiProviders = require("./dashboard/ai-providers");
		const CLAUDE_CODE_MODELS = aiProviders.CLAUDE_CODE_MODELS;
		const OLLAMA_MODELS = aiProviders.OLLAMA_MODELS;
		const OLLAMA_CLOUD_MODELS = aiProviders.OLLAMA_CLOUD_MODELS;

		const TUTORIALS = {
			"claude-code": {
				title: "Comment configurer Claude (compte par abonnement)",
				sections: [
					{
						heading: "1. Installer Claude Code",
						text: "La génération utilise le CLI Claude Code : aucune clé API, c'est votre abonnement Claude (Pro, Max, Team ou Enterprise) qui est utilisé.",
						link: { label: "Installer Claude Code", url: "https://claude.com/claude-code" }
					},
					{
						heading: "2. Connecter votre compte",
						text: "Ouvrez un terminal, lancez « claude », puis tapez /login et connectez-vous avec votre compte Claude.",
						link: null
					},
					{
						heading: "3. C'est tout",
						text: "Le plugin détecte Claude Code automatiquement. Choisissez un modèle ci-dessus et générez.",
						link: null
					}
				],
				warning: "Vos requêtes passent par votre session Claude Code locale et comptent dans l'usage de votre abonnement. Aucune clé n'est stockée dans Obsidian.",
				docsLink: { label: "Documentation Claude Code", url: "https://code.claude.com/docs" }
			},
			ollama: {
				title: "Comment configurer Ollama",
				sections: [
					{
						heading: "1. Installer Ollama",
						text: "Téléchargez et installez Ollama pour votre système.",
						link: { label: "Télécharger Ollama", url: "https://ollama.com/download" }
					},
					{
						heading: "2. Télécharger un modèle",
						text: "Ouvrez un terminal et lancez : ollama pull qwen3:14b",
						link: { label: "Voir tous les modèles", url: "https://ollama.com/models" }
					},
					{
						heading: "3. Démarrer Ollama",
						text: "Ollama démarre automatiquement. Le serveur est sur http://localhost:11434",
						link: null
					},
					{
						heading: "4. Configurer ici",
						text: "Choisissez le modèle téléchargé dans la liste ci-dessus. Pour Ollama en cloud, changez l'URL du serveur.",
						link: null
					}
				],
				warning: "Ollama fonctionne localement et ne nécessite pas de clé API. Votre données restent sur votre machine.",
				docsLink: { label: "Documentation Ollama", url: "https://github.com/ollama/ollama" },
				tips: [
					"💡 Installez d'autres modèles avec : ollama pull <nom-du-modele>",
					"💡 Pour Ollama en cloud, changez l'URL pour celle de votre serveur distant."
				]
			},
			"ollama-cloud": {
				title: "Comment configurer Ollama Cloud",
				sections: [
					{
						heading: "1. Créer un compte",
						text: "Allez sur ollama.com et créez un compte gratuit.",
						link: { label: "Ouvrir ollama.com", url: "https://ollama.com" }
					},
					{
						heading: "2. Obtenir une clé API",
						text: "Accédez à ollama.com/settings/keys et créez une clé API.",
						link: { label: "Créer une clé", url: "https://ollama.com/settings/keys" }
					},
					{
						heading: "3. Configurer ici",
						text: "Collez votre clé API ci-dessus et choisissez un modèle.",
						link: null
					}
				],
				warning: "Ollama Cloud héberge les modèles sur des serveurs NVIDIA. Vos données ne sont jamais utilisées pour l'entraînement.",
				docsLink: { label: "Documentation Ollama Cloud", url: "https://docs.ollama.com/cloud" },
				tips: [
					"Outil gratuit : 1 modèle à la fois. Pro (20$/mois) : 3 modèles simultanés.",
					"Les modèles Cloud n’ont pas de limite de mémoire — même les grands modèles fonctionnent."
				]
			}
		};

		// Provider dropdown
		new obsidian.Setting(containerEl)
			.setName("Fournisseur IA")
			.setDesc("Choisissez le fournisseur pour la génération de quiz")
			.addDropdown(dropdown => dropdown
				.addOption("", "Aucun (à choisir)")
				.addOption("claude-code", "Claude (abonnement)")
				.addOption("ollama", "Ollama (local)")
					.addOption("ollama-cloud", "Ollama Cloud")
				.setValue(this.plugin.settings.aiProvider || "")
				.onChange(async (value) => {
					this.plugin.settings.aiProvider = value;
					// Reset model to default when switching provider
					const defaults = { "claude-code": "opus", ollama: "qwen3:14b", "ollama-cloud": "qwen3:14b" };
					this.plugin.settings.aiModel = defaults[value] || "";
					await this.plugin.saveSettings();
					// Re-render settings but preserve scroll position
					const scrollTop = containerEl.closest(".modal-content")?.scrollTop ?? 0;
					this.display();
					requestAnimationFrame(() => {
						const modal = containerEl.closest(".modal-content");
						if (modal) modal.scrollTop = scrollTop;
					});
				}));

		const currentProvider = this.plugin.settings.aiProvider || "";

		// API Key (Ollama Cloud only)
		if (currentProvider === "ollama-cloud") {
			new obsidian.Setting(containerEl)
				.setName("Clé API Ollama Cloud")
				.setDesc("Créez une clé sur ollama.com/settings/keys")
				.addText(text => {
					text.setPlaceholder("ollama-…")
						.setValue(this.plugin.settings.aiOllamaCloudKey || "")
						.onChange(async (value) => {
							this.plugin.settings.aiOllamaCloudKey = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// Model dropdown (provider-specific) — masqué tant qu'aucun
		// fournisseur n'est choisi
		if (currentProvider) {
			const models = currentProvider === "ollama-cloud" ? OLLAMA_CLOUD_MODELS : currentProvider === "ollama" ? OLLAMA_MODELS : CLAUDE_CODE_MODELS;
			const currentModel = this.plugin.settings.aiModel || models[0].value;

			new obsidian.Setting(containerEl)
				.setName("Modèle")
				.setDesc(currentProvider === "ollama"
					? "Modèle Ollama à utiliser. Assurez-vous de l'avoir téléchargé avec ollama pull."
					: currentProvider === "ollama-cloud"
					? "Modèle Ollama Cloud à utiliser pour la génération."
					: "Modèle Claude à utiliser (mêmes noms que dans Claude Code).")
				.addDropdown(dropdown => {
					for (const m of models) {
						dropdown.addOption(m.value, m.label + (m.hint ? " (" + m.hint + ")" : ""));
					}
					// If current model is not in the list, add it as custom
					if (!models.find(m => m.value === currentModel)) {
						dropdown.addOption(currentModel, currentModel + " (personnalisé)");
					}
					dropdown.setValue(currentModel);
					dropdown.onChange(async (value) => {
						this.plugin.settings.aiModel = value;
						await this.plugin.saveSettings();
					});
				});
		}

		// Ollama URL (local only)
		if (currentProvider === "ollama") {
			new obsidian.Setting(containerEl)
				.setName("URL du serveur Ollama")
				.setDesc("Adresse du serveur Ollama local.")
				.addText(text => text
					.setPlaceholder("http://localhost:11434")
					.setValue(this.plugin.settings.aiOllamaUrl || "http://localhost:11434")
					.onChange(async (value) => {
						this.plugin.settings.aiOllamaUrl = value;
						await this.plugin.saveSettings();
					}));
		}

		// ─── Contextual Tutorial ───
		const tutorial = TUTORIALS[currentProvider];
		if (tutorial) {
			const tutorialEl = containerEl.createDiv({ cls: "qb-ai-tutorial" });
			tutorialEl.style.cssText = "margin-top: 1.5em; padding: 1.2em; background: var(--background-secondary); border-radius: 10px; border: 1px solid var(--background-modifier-border);";

			const tutorialHeader = tutorialEl.createDiv({ cls: "qb-ai-tutorial-header" });
			tutorialHeader.style.cssText = "display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.8em;";
			const headerIcon = tutorialHeader.createSpan({ cls: "qb-ai-tutorial-icon" });
			obsidian.setIcon(headerIcon, currentProvider === "claude-code" ? "sparkles" : currentProvider === "ollama-cloud" ? "cloud" : "cpu");
			headerIcon.style.cssText = "display: flex; align-items: center; color: var(--interactive-accent);";
			tutorialHeader.createEl("h4", {
				text: tutorial.title,
				cls: "qb-ai-tutorial-title"
			}).style.cssText = "margin: 0; font-size: 1.05em; color: var(--text-normal);";

			for (const section of tutorial.sections) {
				const sectionEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-section" });
				sectionEl.style.cssText = "margin-bottom: 0.7em;";

				const headingEl = sectionEl.createEl("strong", { text: section.heading });
				headingEl.style.cssText = "display: block; font-size: 0.92em; margin-bottom: 0.15em; color: var(--text-normal);";
				sectionEl.createEl("span", {
					text: section.text,
					cls: "qb-ai-tutorial-desc"
				}).style.cssText = "display: block; font-size: 0.88em; color: var(--text-muted); line-height: 1.4;";

				if (section.link) {
					const linkEl = sectionEl.createEl("a", {
						text: section.link.label,
						href: section.link.url,
						cls: "qb-ai-tutorial-link"
					});
					linkEl.style.cssText = "display: inline-block; margin-top: 0.2em; font-size: 0.85em; color: var(--interactive-accent); text-decoration: underline;";
					linkEl.target = "_blank";
					linkEl.rel = "noopener noreferrer";
				}
			}

			if (tutorial.warning) {
				const warnEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-warning" });
				warnEl.style.cssText = "margin-top: 0.8em; padding: 0.6em 0.8em; background: var(--background-primary); border-radius: 6px; border-left: 3px solid var(--color-yellow); font-size: 0.88em; color: var(--text-muted);";
				const warnIcon = warnEl.createSpan();
				obsidian.setIcon(warnIcon, "alert-triangle");
				warnIcon.style.cssText = "display: inline-flex; vertical-align: middle; margin-right: 0.4em; color: var(--color-yellow);";
				warnEl.createSpan({ text: " " + tutorial.warning });
			}

			if (tutorial.tips) {
				for (const tip of tutorial.tips) {
					const tipEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-tip" });
					tipEl.style.cssText = "margin-top: 0.3em; font-size: 0.88em; color: var(--text-muted); line-height: 1.4;";
					tipEl.textContent = tip;
				}
			}

			if (tutorial.docsLink) {
				const docsEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-docs" });
				docsEl.style.cssText = "margin-top: 0.8em; padding-top: 0.6em; border-top: 1px solid var(--background-modifier-border);";
				const docsIcon = docsEl.createSpan();
				obsidian.setIcon(docsIcon, "external-link");
				docsIcon.style.cssText = "display: inline-flex; vertical-align: middle; margin-right: 0.4em; color: var(--text-muted);";
				const docsLink = docsEl.createEl("a", {
					text: tutorial.docsLink.label,
					href: tutorial.docsLink.url,
					cls: "qb-ai-tutorial-docs-link"
				});
				docsLink.style.cssText = "font-size: 0.88em; color: var(--interactive-accent); text-decoration: underline;";
				docsLink.target = "_blank";
				docsLink.rel = "noopener noreferrer";
			}
		}
	}
}

module.exports = class InteractiveQuizPlugin extends obsidian.Plugin {
	async onload() {
		await this.loadSettings();
		this.log = createLogger();

		this.log.info("plugin chargé");

		/* ─── Scanner & Stats Store ─── */
		this._scanner = createScanner(this.app);
		this._statsStore = createStatsStore(this);
		this._statsStore.load();

		/* ─── Quiz Dashboard View ─── */
		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new QuizDashboardView(leaf, this));

		this.addCommand({
			id: "open-quiz-dashboard",
			name: "Ouvrir le Dashboard",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "d" }],
			callback: async () => {
				const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
				this.app.workspace.revealLeaf(leaf);
			},
		});

		this.addSettingTab(new QuizBlocksSettingTab(this.app, this));

		if (this.settings.enableCodeHighlighting) {
			this.registerQuizBlocksCodeHighlighting();
			this.register(() => this.unregisterQuizBlocksCodeHighlighting());
		}

		/* ─── Quiz Builder View ─── */
		this.registerView(VIEW_TYPE, (leaf) => new QuizBuilderView(leaf, this));

		this.addCommand({
			id: "open-quiz-builder",
			name: "Ouvrir le Quiz Editor",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "e" }],
			callback: async () => {
				const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
			},
		});

		this.addCommand({
			id: "open-quiz-from-active-note",
			name: "Ouvrir le quiz de la note active",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "q" }],
			callback: async () => {
				// Check if there's an active file
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || !activeFile.path.endsWith('.md')) {
					new obsidian.Notice("Aucune note active");
					return;
				}

				try {
					// Read file content
					const content = await this.app.vault.read(activeFile);
					// Find first quiz-blocks fence
					const match = content.match(/```quiz-blocks\n([\s\S]*?)\n```/);
					if (!match) {
						new obsidian.Notice("Aucun bloc quiz-blocks trouvé dans cette note");
						return;
					}

					// Open or get the Quiz Editor
					const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
					let leaf;
					if (existing.length > 0) {
						leaf = existing[0];
						this.app.workspace.revealLeaf(leaf);
					} else {
						leaf = this.app.workspace.getLeaf("tab");
						await leaf.setViewState({ type: VIEW_TYPE, active: true });
						this.app.workspace.revealLeaf(leaf);
					}

					// Open the quiz for editing
					const view = leaf.view;
					if (view && view.openQuizFile) {
						await view.openQuizFile(activeFile, match[1]);
						new obsidian.Notice(`Quiz ouvert : ${activeFile.name}`);
					}
				} catch (err) {
					console.error("Open error:", err);
					new obsidian.Notice("Erreur lors de l'ouverture");
				}
			},
		});

		/* ─── Ribbon Icon ─── */
		this.addRibbonIcon("graduation-cap", "Ouvrir le Dashboard", async () => {
			const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
			if (existing.length > 0) {
				this.app.workspace.revealLeaf(existing[0]);
				return;
			}
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
			this.app.workspace.revealLeaf(leaf);
		});

		/* ─── Code Block Processor ─── */
		this.registerMarkdownCodeBlockProcessor(
			QUIZ_BLOCK_LANGUAGE,
			async (source, el, ctx) => {
				const host = el.createDiv({ cls: "quiz-blocks-host" });

				try {
					const quiz = parseQuizSource(source);

					await renderInteractiveQuiz({
						app: this.app,
						plugin: this,
						container: host,
						quiz,
						sourcePath: ctx.sourcePath,
						Notice: obsidian.Notice
					});
				} catch (error) {
					this.log.error("erreur pendant le rendu du bloc", error);

					host.empty();
					host.createEl("p", {
						text: `⚠️ Impossible de charger le quiz : ${error?.message || "erreur inconnue"}`
					});
				}
			}
		);

		/* ─── Scanner init (async, non-blocking) ─── */
		this._scanner.init().catch(err => this.log.warn("Scanner init error:", err));
	}

	onunload() {
		this._scanner?.destroy();
		this._statsStore?.destroy();
		this.log?.info("plugin déchargé");
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

		if ("enableDebugLogs" in this.settings) {
			delete this.settings.enableDebugLogs;
			await this.saveSettings();
		}

		if ("aiCompatibleUrl" in this.settings) {
			delete this.settings.aiCompatibleUrl;
			await this.saveSettings();
		}

		// Migration : le provider Anthropic (clé API) est remplacé par
		// Claude via Claude Code (abonnement). Le choix du fournisseur
		// redevient explicite : aucun présélectionné.
		if (this.settings.aiProvider === "anthropic" || "aiApiKey" in this.settings) {
			if (this.settings.aiProvider === "anthropic") {
				this.settings.aiProvider = "";
				this.settings.aiModel = "";
			}
			delete this.settings.aiApiKey;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getCodeMirrorGlobal() {
		if (typeof window === "undefined") return null;
		const cm = window.CodeMirror;
		if (!cm || typeof cm.defineMode !== "function" || typeof cm.getMode !== "function") {
			return null;
		}
		return cm;
	}

	registerQuizBlocksCodeHighlighting() {
		const cm = this.getCodeMirrorGlobal();

		if (!cm) {
			this.log.warn("CodeMirror global introuvable : coloration désactivée.");
			return;
		}

		try {
			cm.defineMode(QUIZ_BLOCK_LANGUAGE, config => {
				return cm.getMode(
					{
						...config,
						json: true
					},
					"javascript"
				);
			});

			this.log.debug("mode de coloration enregistré pour quiz-blocks");
		} catch (error) {
			this.log.error("impossible d'enregistrer la coloration", error);
		}
	}

	unregisterQuizBlocksCodeHighlighting() {
		const cm = this.getCodeMirrorGlobal();
		if (!cm) return;

		try {
			cm.defineMode(QUIZ_BLOCK_LANGUAGE, config => cm.getMode(config, "null"));
			this.log.debug("mode de coloration désactivé");
		} catch (error) {
			this.log.error("impossible de retirer la coloration", error);
		}
	} 
};