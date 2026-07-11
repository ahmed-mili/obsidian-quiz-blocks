'use strict';

const obsidian = require("obsidian");
const { parseQuizSource, renderInteractiveQuiz } = require("./engine");
const { QuizBuilderView, VIEW_TYPE } = require("./editor");
const { QuizDashboardView, VIEW_TYPE_DASHBOARD } = require("./dashboard");
const createScanner = require("./dashboard/scanner");
const createStatsStore = require("./dashboard/stats-store");
const voiceInstall = require("./dashboard/voice-install");

const PLUGIN_ID = "quiz-blocks";
const PLUGIN_NAME = "Quiz Blocks";
const QUIZ_BLOCK_LANGUAGE = "quiz-blocks";

const DEFAULT_SETTINGS = {
	enableCodeHighlighting: true,
	quizStats: {},
	aiProvider: "",
	aiModel: "",
	aiEffort: "high",
	// Mode Fast de Codex (service tier « priority », 1.5x speed) — l'éclair
	// du popover effort ChatGPT. Ignoré si le modèle ne l'expose pas.
	aiCodexFast: false,
	aiOllamaUrl: "http://localhost:11434",
	aiOllamaCloudKey: "",
	// Modèles Ollama affichés dans le menu (ordre réglable, max 7) : les
	// OLLAMA_PRIMARY_COUNT premiers = liste principale, le reste = « Plus de
	// modèles ». null → sélection par défaut (cf. aiProviders.resolveOllamaSelection).
	aiOllamaModels: null,
	// Cache du catalogue cloud récupéré de ollama.com ([{value,label}]) : liste
	// des modèles récents proposés à l'ajout. null → repli embarqué.
	aiOllamaCatalog: null,
	// ── Raccourcis du composer IA (menu « + ») — actifs quand la vue
	// dashboard a le focus, affichés en hint dans le menu, modifiables
	// dans les réglages (demande Ahmed, maquette 2026-07-11 231626).
	// Ctrl+U = le raccourci de claude.ai pour « Ajouter des fichiers »
	// (captures Ahmed 2026-07-11 2357xx) — et Ctrl+F reste le réflexe
	// « recherche » partout ailleurs.
	hotkeyAddFiles: { modifiers: ["Mod"], key: "u" },
	hotkeyAddNotes: { modifiers: ["Mod"], key: "e" },
	// ── Saisie vocale (dictée locale whisper.cpp) — opt-in complet.
	// Spec : docs/superpowers/specs/2026-07-10-voice-input-design.md
	voiceEnabled: false,
	voiceBackend: "cpu",      // "cpu" | "cuda"
	voiceModel: "small-q5_1", // cf. voice-install.js MODELS
	voiceLang: "fr",          // "fr" | "auto" | "en"
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
			codex: {
				title: "Comment configurer ChatGPT (Codex CLI)",
				sections: [
					{
						heading: "1. Installer le Codex CLI — pas l'application Codex",
						text: "La génération utilise le Codex CLI, l'outil de terminal d'OpenAI : npm install -g @openai/codex (Node.js requis). L'application de bureau Codex ne suffit pas : elle n'installe pas la commande « codex » que le plugin utilise.",
						link: { label: "Page npm du Codex CLI", url: "https://www.npmjs.com/package/@openai/codex" }
					},
					{
						heading: "2. Connecter votre compte ChatGPT",
						text: "Dans un terminal, lancez « codex login » et connectez-vous avec votre compte ChatGPT. Aucune clé API : c'est votre abonnement qui est utilisé.",
						link: null
					},
					{
						heading: "3. C'est tout",
						text: "Le plugin détecte le Codex CLI automatiquement — revenez simplement sur Obsidian après l'installation. Choisissez un modèle ci-dessus et générez.",
						link: null
					}
				],
				warning: "Vos requêtes passent par votre session Codex locale et comptent dans l'usage de votre abonnement ChatGPT. Aucune clé n'est stockée dans Obsidian.",
				docsLink: { label: "Codex CLI sur GitHub", url: "https://github.com/openai/codex" }
			},
			ollama: {
				title: "Comment configurer Ollama (local + cloud)",
				sections: [
					{
						heading: "1. Installer Ollama",
						text: "Téléchargez et installez Ollama pour votre système.",
						link: { label: "Télécharger Ollama", url: "https://ollama.com/download" }
					},
					{
						heading: "2a. Modèles cloud (recommandé sans GPU)",
						text: "Connectez le daemon à votre compte : ollama signin. Les modèles « :cloud » tournent sur le cloud Ollama, sans téléchargement ni clé API. Le forfait gratuit donne accès aux modèles gpt-oss et minimax-m3 ; les plus gros (glm, kimi, qwen3.5…) nécessitent un abonnement Pro/Max.",
						link: { label: "Voir les modèles cloud", url: "https://ollama.com/search?c=cloud" }
					},
					{
						heading: "2b. Modèles locaux (nécessite un GPU / de la RAM)",
						text: "Téléchargez un modèle : ollama pull qwen3.5:9b. Il tourne sur votre machine.",
						link: { label: "Voir tous les modèles", url: "https://ollama.com/search" }
					},
					{
						heading: "3. Configurer ici",
						text: "Choisissez un modèle dans la liste ci-dessus. Les « :cloud » = cloud, les autres = local. Serveur par défaut : http://localhost:11434",
						link: null
					}
				],
				warning: "Un seul serveur Ollama (localhost) sert local ET cloud : le suffixe « :cloud » distingue les deux. Les modèles cloud passent par votre compte Ollama connecté ; les locaux restent sur votre machine.",
				docsLink: { label: "Documentation Ollama", url: "https://github.com/ollama/ollama" },
				tips: [
					"💡 Sans GPU : utilisez un modèle « :cloud » gratuit (ex. gpt-oss:120b-cloud).",
					"💡 Modèles cloud : pas de limite de mémoire — même les très grands modèles fonctionnent.",
					"💡 Erreur « requires a subscription » : le modèle cloud choisi est réservé au forfait Pro/Max. Prenez un gpt-oss gratuit ou abonnez-vous."
				]
			}
		};

		// Provider dropdown
		new obsidian.Setting(containerEl)
			.setName("Fournisseur IA")
			.setDesc("Choisissez le fournisseur pour la génération de quiz")
			.addDropdown(dropdown => {
				dropdown.addOption("", "Aucun (à choisir)");
				for (const p of aiProviders.PROVIDERS) {
					dropdown.addOption(p.id, p.name + (p.sub ? " — " + p.sub : ""));
				}
				dropdown.setValue(this.plugin.settings.aiProvider || "")
					.onChange(async (value) => {
						this.plugin.settings.aiProvider = value;
						// Reset model + effort to the new provider's defaults
						const prov = aiProviders.getProvider(value);
						this.plugin.settings.aiModel = value ? prov.defaultModel : "";
						if (value) this.plugin.settings.aiEffort = aiProviders.getDefaultEffort(value);
						await this.plugin.saveSettings();
						// Re-render settings but preserve scroll position
						const scrollTop = containerEl.closest(".modal-content")?.scrollTop ?? 0;
						this.display();
						requestAnimationFrame(() => {
							const modal = containerEl.closest(".modal-content");
							if (modal) modal.scrollTop = scrollTop;
						});
					});
			});

		const currentProvider = this.plugin.settings.aiProvider || "";

		// Model dropdown (provider-specific) — masqué tant qu'aucun
		// fournisseur n'est choisi
		if (currentProvider) {
			const models = currentProvider === "claude-code" ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels(currentProvider);
			const currentModel = currentProvider === "claude-code"
				? aiProviders.resolveClaudeModel(this.plugin.settings.aiModel || models[0].value)
				: (this.plugin.settings.aiModel || models[0].value);

			new obsidian.Setting(containerEl)
				.setName("Modèle")
				.setDesc(currentProvider === "ollama"
					? "Modèle Ollama. Les « :cloud » tournent sur le cloud (compte connecté via ollama signin) ; les autres en local (ollama pull)."
					: currentProvider === "codex"
					? "Modèle Codex (ChatGPT) à utiliser pour la génération."
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

			// Modèles affichés dans le menu (sélection + ordre réglable, façon
			// claude.ai) : les N premiers = liste principale, le reste = flyout
			// « Plus de modèles ». Glisser-déposer pour réordonner.
			const MAX = aiProviders.OLLAMA_MAX_MODELS;
			const VISIBLE = aiProviders.OLLAMA_VISIBLE_COUNT;
			const getCatalog = () => aiProviders.getOllamaCatalog(this.plugin.settings.aiOllamaCatalog);
			const getSel = () => aiProviders.resolveOllamaSelection(this.plugin.settings.aiOllamaModels, getCatalog()).map(m => m.value);
			const saveSel = async (arr) => {
				this.plugin.settings.aiOllamaModels = arr.slice(0, MAX);
				await this.plugin.saveSettings();
			};

			const setting = new obsidian.Setting(containerEl)
				.setName("Modèles affichés dans le menu")
				.setDesc("Glissez pour réordonner. Le menu affiche une liste défilante ; les " + VISIBLE + " premiers sont visibles sans défiler (max " + MAX + "). Certains modèles cloud nécessitent un abonnement Ollama Pro/Max (erreur 403 à la génération).");
			setting.settingEl.style.display = "block";
			// Bouton « rafraîchir » : récupère le catalogue récent depuis ollama.com.
			setting.addExtraButton(b => b
				.setIcon("refresh-cw")
				.setTooltip("Rafraîchir la liste depuis ollama.com")
				.onClick(async () => {
					b.setDisabled(true);
					try {
						const cat = await aiProviders.fetchOllamaCloudCatalog();
						this.plugin.settings.aiOllamaCatalog = cat;
						await this.plugin.saveSettings();
						new obsidian.Notice("Catalogue Ollama à jour (" + cat.length + " modèles).");
					} catch (e) {
						new obsidian.Notice("Échec du rafraîchissement (ollama.com injoignable).");
					}
					b.setDisabled(false);
					render();
				}));
			const listEl = setting.controlEl.createDiv({ cls: "qbd-model-manager" });
			setting.controlEl.style.width = "100%";

			const render = () => {
				listEl.empty();
				const catalog = getCatalog();
				const sel = getSel();
				sel.forEach((val, idx) => {
					const meta = aiProviders.getOllamaModelMeta(val, catalog);
					if (idx === VISIBLE) listEl.createDiv({ cls: "qbd-model-manager-sep", text: "Accessible en défilant" });
					const row = listEl.createDiv({ cls: "qbd-model-manager-row" });
					row.setAttribute("draggable", "true");
					const handle = row.createSpan({ cls: "qbd-model-manager-handle" });
					obsidian.setIcon(handle, "grip-vertical");
					const icon = row.createSpan({ cls: "qbd-model-manager-icon" });
					obsidian.setIcon(icon, meta.cloud ? "cloud" : "hard-drive");
					row.createSpan({ cls: "qbd-model-manager-label", text: meta.label });
					const rm = row.createEl("button", { cls: "qbd-model-manager-remove" });
					obsidian.setIcon(rm, "x");
					rm.setAttribute("aria-label", "Retirer");
					rm.addEventListener("click", async () => {
						const a = getSel(); a.splice(idx, 1); await saveSel(a); render();
					});
					row.addEventListener("dragstart", (e) => {
						e.dataTransfer.setData("text/plain", String(idx));
						e.dataTransfer.effectAllowed = "move";
						row.classList.add("is-dragging");
					});
					row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
					row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("is-drop-target"); });
					row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
					row.addEventListener("drop", async (e) => {
						e.preventDefault(); row.classList.remove("is-drop-target");
						const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
						if (isNaN(from) || from === idx) return;
						const a = getSel();
						const [moved] = a.splice(from, 1);
						a.splice(idx, 0, moved);
						await saveSel(a); render();
					});
				});
				if (sel.length >= MAX) {
					listEl.createDiv({ cls: "qbd-model-manager-note", text: "Maximum " + MAX + " modèles. Retirez-en un pour en ajouter un autre." });
				} else {
					const avail = catalog.filter(m => !sel.includes(m.value));
					if (avail.length) {
						const addWrap = listEl.createDiv({ cls: "qbd-model-manager-add" });
						addWrap.createSpan({ cls: "qbd-model-manager-add-label", text: "Ajouter :" });
						avail.forEach(m => {
							const chip = addWrap.createEl("button", { cls: "qbd-model-manager-chip" });
							const ci = chip.createSpan({ cls: "qbd-model-manager-chip-icon" });
							obsidian.setIcon(ci, "plus");
							chip.createSpan({ text: m.label });
							chip.addEventListener("click", async () => {
								const a = getSel();
								if (a.length < MAX) { a.push(m.value); await saveSel(a); render(); }
							});
						});
					}
					// Ajout manuel : n'importe quel tag de modèle (futur-proof).
					const manualWrap = listEl.createDiv({ cls: "qbd-model-manager-manual" });
					const input = manualWrap.createEl("input", { cls: "qbd-model-manager-input", attr: { type: "text", placeholder: "Autre modèle (ex. glm-5.3:cloud)" } });
					const addManual = async () => {
						const v = (input.value || "").trim();
						if (!v) return;
						const a = getSel();
						if (!a.includes(v) && a.length < MAX) { a.push(v); await saveSel(a); render(); }
					};
					const addBtn = manualWrap.createEl("button", { cls: "qbd-model-manager-manual-btn", text: "Ajouter" });
					addBtn.addEventListener("click", addManual);
					input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } });
				}
			};
			render();

			// Rafraîchit le catalogue en tâche de fond à l'ouverture (best-effort).
			aiProviders.fetchOllamaCloudCatalog().then(cat => {
				this.plugin.settings.aiOllamaCatalog = cat;
				return this.plugin.saveSettings();
			}).then(() => render()).catch(() => { /* hors-ligne → repli */ });
		}

		// ─── Contextual Tutorial ───
		const tutorial = TUTORIALS[currentProvider];
		if (tutorial) {
			const tutorialEl = containerEl.createDiv({ cls: "qb-ai-tutorial" });
			tutorialEl.style.cssText = "margin-top: 1.5em; padding: 1.2em; background: var(--background-secondary); border-radius: 10px; border: 1px solid var(--background-modifier-border);";

			const tutorialHeader = tutorialEl.createDiv({ cls: "qb-ai-tutorial-header" });
			tutorialHeader.style.cssText = "display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.8em;";
			const headerIcon = tutorialHeader.createSpan({ cls: "qb-ai-tutorial-icon" });
			obsidian.setIcon(headerIcon, currentProvider === "ollama" ? "cpu" : "sparkles");
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

		// ─── Raccourcis du composer IA ───
		// Capture au clavier : clic sur le bouton → « Appuyez sur une
		// combinaison… » → le prochain keydown non-modificateur devient le
		// raccourci (un modificateur est exigé : une lettre nue taperait
		// le raccourci en écrivant dans le composer). Les vues dashboard
		// ouvertes re-bindent leur Scope immédiatement.
		containerEl.createEl("h3", { text: "Raccourcis du composer IA" });
		const { formatHotkey, eventToHotkey } = require("./hotkey-format");
		const rebindDashboards = () => {
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
				if (leaf.view && leaf.view.bindComposerHotkeys) leaf.view.bindComposerHotkeys();
			}
		};
		const addHotkeySetting = (name, desc, key) => {
			new obsidian.Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addButton((btn) => {
					btn.buttonEl.addClass("quiz-blocks-hotkey-btn");
					const paint = () => btn.setButtonText(formatHotkey(this.plugin.settings[key]) || "Aucun");
					paint();
					btn.onClick(() => {
						btn.setButtonText("Appuyez sur une combinaison…");
						const onKey = async (e) => {
							e.preventDefault();
							e.stopPropagation();
							if (e.key === "Escape") { cleanup(); paint(); return; }
							const hk = eventToHotkey(e);
							if (!hk) return; // modificateur seul : on attend la touche
							if (!hk.modifiers.length) {
								new obsidian.Notice("Ajoutez un modificateur (Ctrl, Alt ou Shift)");
								return;
							}
							cleanup();
							this.plugin.settings[key] = hk;
							await this.plugin.saveSettings();
							rebindDashboards();
							paint();
						};
						const cleanup = () => {
							btn.buttonEl.removeEventListener("keydown", onKey, true);
							btn.buttonEl.removeEventListener("blur", onBlur);
						};
						const onBlur = () => { cleanup(); paint(); };
						btn.buttonEl.addEventListener("keydown", onKey, true);
						btn.buttonEl.addEventListener("blur", onBlur);
						btn.buttonEl.focus();
					});
				})
				.addExtraButton((b) => b
					.setIcon("rotate-ccw")
					.setTooltip("Restaurer le défaut")
					.onClick(async () => {
						this.plugin.settings[key] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
						await this.plugin.saveSettings();
						rebindDashboards();
						this.display();
					}));
		};
		addHotkeySetting("Ajouter des fichiers ou des images", "Ouvre le sélecteur de fichiers du composer (menu « + »).", "hotkeyAddFiles");
		addHotkeySetting("Ajouter des notes", "Ouvre le sélecteur de notes du composer (menu « + »).", "hotkeyAddNotes");

		// ─── Saisie vocale (dictée) ───
		containerEl.createEl("h3", { text: "Saisie vocale (dictée)" });
		if (!voiceInstall.isSupported()) {
			containerEl.createEl("p", {
				text: "Disponible sur Windows uniquement pour l'instant.",
				cls: "setting-item-description",
			});
		} else {
			new obsidian.Setting(containerEl)
				.setName("Activer la dictée")
				.setDesc("Maintenir Espace dans le composer IA pour dicter (transcription 100 % locale, whisper.cpp).")
				.addToggle(t => t
					.setValue(this.plugin.settings.voiceEnabled)
					.onChange(async (v) => {
						this.plugin.settings.voiceEnabled = v;
						await this.plugin.saveSettings();
						this.display();
					}));

			if (this.plugin.settings.voiceEnabled) {
				new obsidian.Setting(containerEl)
					.setName("Accélération")
					.setDesc("CPU : léger (8 Mo), universel. GPU NVIDIA : téléchargement ~680 Mo, transcription quasi instantanée. (Pas de build AMD/Intel en v1.)")
					.addDropdown(d => d
						.addOption("cpu", "CPU")
						.addOption("cuda", "GPU NVIDIA (CUDA)")
						.setValue(this.plugin.settings.voiceBackend)
						.onChange(async (v) => {
							this.plugin.settings.voiceBackend = v;
							await this.plugin.saveSettings();
							this.display();
						}));

				new obsidian.Setting(containerEl)
					.setName("Modèle")
					.setDesc("Rapide suffit pour une dictée propre ; Max gagne sur le bruit/les accents.")
					.addDropdown(d => {
						for (const [id, m] of Object.entries(voiceInstall.MODELS)) d.addOption(id, m.label);
						d.setValue(this.plugin.settings.voiceModel)
							.onChange(async (v) => {
								this.plugin.settings.voiceModel = v;
								await this.plugin.saveSettings();
								this.display();
							});
					});

				new obsidian.Setting(containerEl)
					.setName("Langue")
					.addDropdown(d => d
						.addOption("fr", "Français")
						.addOption("auto", "Détection automatique")
						.addOption("en", "Anglais")
						.setValue(this.plugin.settings.voiceLang)
						.onChange(async (v) => {
							this.plugin.settings.voiceLang = v;
							await this.plugin.saveSettings();
						}));

				// État d'installation + téléchargements (rien sans clic explicite).
				const st = voiceInstall.getStatus(this.plugin.settings);
				const fmtPct = (d, t) => (t ? Math.round((d / t) * 100) + " %" : Math.round(d / 1e6) + " Mo");
			// onProgress arrive à CHAQUE chunk (~16 Ko) : sur le zip CUDA
			// (~678 Mo) ça ferait des dizaines de milliers de setButtonText.
			// Ne toucher au DOM que quand le libellé change réellement.
			const throttledProgress = (btn) => {
				let last = "";
				return (d, t) => {
					const label = fmtPct(d, t);
					if (label !== last) { last = label; btn.setButtonText(label); }
				};
			};

				const binRow = new obsidian.Setting(containerEl)
					.setName("Binaire whisper.cpp (" + this.plugin.settings.voiceBackend + ")")
					.setDesc(st.cliPath ? "Installé — " + st.cliPath : "Non installé.");
				if (!st.cliPath) binRow.addButton(b => b
					.setButtonText("Télécharger")
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installBinary(this.plugin.settings.voiceBackend,
								throttledProgress(b));
							new obsidian.Notice("Binaire whisper.cpp installé.");
						} catch (e) {
							console.error("[quiz-blocks] install binaire:", e);
							new obsidian.Notice("Téléchargement échoué : " + e.message);
						}
						this.display();
					}));

				const mdlRow = new obsidian.Setting(containerEl)
					.setName("Modèle — " + ((voiceInstall.MODELS[this.plugin.settings.voiceModel] || {}).label || this.plugin.settings.voiceModel))
					.setDesc(st.modelFile ? "Installé — " + st.modelFile : "Non installé.");
				if (!st.modelFile) mdlRow.addButton(b => b
					.setButtonText("Télécharger")
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installModel(this.plugin.settings.voiceModel,
								throttledProgress(b));
							new obsidian.Notice("Modèle installé.");
						} catch (e) {
							console.error("[quiz-blocks] install modèle:", e);
							new obsidian.Notice("Téléchargement échoué : " + e.message);
						}
						this.display();
					}));
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

				// Lie la destruction de l'instance au cycle de vie du bloc : à chaque
				// re-render/unload, Obsidian appelle onunload → destroyQuiz, ce qui retire
				// les listeners document/window, ResizeObservers et timers. Sans ça, chaque
				// re-render (édition de note, toggle mode) fuit une instance complète.
				const renderChild = new obsidian.MarkdownRenderChild(host);
				renderChild.onunload = () => { try { host.__quizDestroy?.(); } catch (_) {} };
				ctx.addChild(renderChild);

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
		// Menus/popovers portalés au <body> (ui-select) : sans fermeture ici,
		// un menu ouvert au moment d'un unload (update/reload du plugin)
		// resterait orphelin dans le DOM avec ses closures mortes.
		try { require("./dashboard/ui-select").closeAllSelects(); } catch (e) { /* best effort */ }
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

		// Migration 2026-07-12 : le défaut « Ajouter des fichiers » passe
		// de Ctrl+F à Ctrl+U (référence claude.ai). Un Ctrl+F stocké ne
		// peut être que l'ancien défaut resauvé tel quel, pas un choix.
		const hf = this.settings.hotkeyAddFiles;
		if (hf && hf.key === "f" && Array.isArray(hf.modifiers)
			&& hf.modifiers.length === 1 && hf.modifiers[0] === "Mod") {
			this.settings.hotkeyAddFiles = { modifiers: ["Mod"], key: "u" };
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