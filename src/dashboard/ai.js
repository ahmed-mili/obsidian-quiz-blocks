'use strict';

/* ══════════════════════════════════════════════════════════
   AI VIEW — Dashboard
   Formulaire de génération IA (onglets Sujet/Image/Texte)
   + preview (idle / loading / result / error).
   Providers, logos et modèles : voir ai-providers.js.
══════════════════════════════════════════════════════════ */

const aiProviders = require("./ai-providers");
const { createSelect, closeAllSelects } = require("./ui-select");

function createAiHandlers(ctx) {
	let currentTab = "topic";
	let topicValue = "";
	let textValue = "";
	let questionCount = 5;
	let questionType = "Mixte";
	let images = [];
	let phase = "idle"; // idle | loading | result | error
	let generatedQuestions = [];
	let errorMessage = "";

	const TABS = [
		{ key: "topic", label: "Sujet", icon: "lightbulb" },
		{ key: "image", label: "Image", icon: "image" },
		{ key: "text", label: "Texte", icon: "file-text" }
	];

	const TYPES = ["Mixte", "Choix unique", "Choix multiple", "Texte libre"];

	function canGenerate() {
		return (currentTab === "topic" && topicValue.trim()) ||
			(currentTab === "image" && images.length > 0) ||
			(currentTab === "text" && textValue.trim());
	}

	async function render(container) {
		containerRef = container;
		closeAllSelects();
		container.empty();

		// ── Layout 2 colonnes ──
		const layout = container.createDiv({ cls: "qbd-ai-layout" });

		// ── Formulaire (colonne gauche) ──
		const formCol = layout.createDiv({ cls: "qbd-ai-form" });

		// ── Page header ──
		const titleRow = formCol.createDiv({ cls: "qbd-ai-title-row" });
		const titleIcon = titleRow.createSpan({ cls: "qbd-ai-title-icon" });
		obsidian.setIcon(titleIcon, "sparkles");
		titleRow.createEl("h2", { cls: "qbd-ai-title", text: "Générer un quiz" });
		formCol.createEl("p", { cls: "qbd-ai-subtitle", text: "Créez un quiz à partir d'un sujet, d'images ou d'un texte." });

		// ── Carte Modèle IA : providers cliquables + modèle ──
		const provider = ctx.plugin.settings.aiProvider || "claude-code";
		const currentModel = ctx.plugin.settings.aiModel || aiProviders.getProvider(provider).defaultModel;

		const modelCard = formCol.createDiv({ cls: "qbd-ai-model-card" });
		const modelHeader = modelCard.createDiv({ cls: "qbd-ai-model-header" });
		modelHeader.createEl("span", { cls: "qbd-ai-model-label", text: "Modèle IA" });

		// Grille des providers — un clic change de fournisseur
		const grid = modelCard.createDiv({ cls: "qbd-ai-provider-grid" });
		const statusEls = {};
		for (const p of aiProviders.PROVIDERS) {
			const card = grid.createEl("button", {
				cls: "qbd-ai-pcard" + (p.id === provider ? " qbd-ai-pcard--active" : "")
			});
			card.type = "button";
			card.setAttribute("aria-pressed", p.id === provider ? "true" : "false");
			const top = card.createDiv({ cls: "qbd-ai-pcard-top" });
			const logo = top.createSpan({ cls: "qbd-ai-pcard-logo qbd-ai-pcard-logo--" + p.logo });
			aiProviders.setBrandLogo(logo, p.logo);
			top.createSpan({ cls: "qbd-ai-pcard-name", text: p.name });
			const dot = top.createSpan({ cls: "qbd-ai-pcard-dot qbd-ai-pcard-dot--checking" });
			const sub = card.createDiv({ cls: "qbd-ai-pcard-sub", text: p.sub });
			statusEls[p.id] = { dot, sub };
			card.addEventListener("click", async () => {
				if (p.id === provider) return;
				ctx.plugin.settings.aiProvider = p.id;
				ctx.plugin.settings.aiModel = p.defaultModel;
				await ctx.plugin.saveSettings();
				render(container);
			});
		}

		// Rangée modèle — dropdown custom (jamais de <select> natif)
		const modelRow = modelCard.createDiv({ cls: "qbd-ai-model-row" });
		modelRow.createEl("span", { cls: "qbd-ai-model-row-label", text: "Modèle" });
		const modelSelect = createSelect(modelRow, {
			value: currentModel,
			options: withCurrentOption(aiProviders.getDefaultModels(provider), currentModel),
			onChange: async (v) => {
				ctx.plugin.settings.aiModel = v;
				await ctx.plugin.saveSettings();
			}
		});

		// Zone de hint contextuelle (clé manquante, serveur offline…)
		const hintZone = modelCard.createDiv({ cls: "qbd-ai-model-hint" });

		refreshProviderStatuses({ statusEls, hintZone, provider, currentModel, modelSelect });


		// ── Onglets source ──
		const tabsCard = formCol.createDiv({ cls: "qbd-ai-tabs-card" });
		const tabBar = tabsCard.createDiv({ cls: "qbd-ai-tab-bar" });
		for (const tab of TABS) {
			const btn = tabBar.createEl("button", {
				cls: `qbd-ai-tab ${currentTab === tab.key ? "qbd-ai-tab--active" : ""}`
			});
			const tabIcon = btn.createSpan({ cls: "qbd-ai-tab-icon" });
			obsidian.setIcon(tabIcon, tab.icon);
			btn.createSpan({ cls: "qbd-ai-tab-label", text: tab.label });
			btn.addEventListener("click", () => {
				currentTab = tab.key;
				render(container);
			});
		}

		const tabContent = tabsCard.createDiv({ cls: "qbd-ai-tab-content" });
		let generateBtnRef = null;

		if (currentTab === "topic") {
			const input = tabContent.createEl("input", {
				type: "text",
				cls: "qbd-ai-input",
				placeholder: "La Révolution française, Algorithmes de tri…",
				value: topicValue
			});
			input.addEventListener("input", (e) => {
				topicValue = e.target.value;
				updateGenerateBtn(generateBtnRef);
			});
		} else if (currentTab === "image") {
			renderImageTab(tabContent);
		} else {
			const textarea = tabContent.createEl("textarea", {
				cls: "qbd-ai-textarea",
				placeholder: "Collez le contenu source… La sélection active est pré-remplie automatiquement.",
				value: textValue
			});
			textarea.rows = 5;
			textarea.addEventListener("input", (e) => {
				textValue = e.target.value;
				updateGenerateBtn(generateBtnRef);
			});
		}

		// ── Options ──
		const optionsCard = formCol.createDiv({ cls: "qbd-ai-options" });
		const optionsHeader = optionsCard.createDiv({ cls: "qbd-ai-options-header" });
		optionsHeader.createEl("span", { cls: "qbd-ai-options-label", text: "Options" });

		// Question count
		const countRow = optionsCard.createDiv({ cls: "qbd-ai-option-row" });
		countRow.createEl("span", { cls: "qbd-ai-option-label", text: "Questions" });
		const rangeWrap = countRow.createDiv({ cls: "qbd-ai-range-wrap" });
		const rangeInput = rangeWrap.createEl("input", {
			type: "range",
			cls: "qbd-ai-range"
		});
		rangeInput.min = 2;
		rangeInput.max = 20;
		rangeInput.value = String(questionCount);
		const countDisplay = rangeWrap.createEl("span", { cls: "qbd-ai-option-value", text: String(questionCount) });
		rangeInput.addEventListener("input", (e) => {
			questionCount = parseInt(e.target.value);
			countDisplay.textContent = String(questionCount);
		});

		// Question type — dropdown custom
		const typeRow = optionsCard.createDiv({ cls: "qbd-ai-option-row" });
		typeRow.createEl("span", { cls: "qbd-ai-option-label", text: "Type" });
		const typeWrap = typeRow.createDiv({ cls: "qbd-ai-type-select-wrap" });
		createSelect(typeWrap, {
			value: questionType,
			options: TYPES.map(t => ({ value: t, label: t })),
			onChange: (v) => { questionType = v; }
		});

		// ── Generate button ──
		const canGen = canGenerate();
		const generateBtn = formCol.createEl("button", {
			cls: `qbd-ai-generate-btn ${canGen ? "qbd-ai-generate-btn--active" : ""}`
		});
		generateBtnRef = generateBtn;
		if (!canGen) generateBtn.setAttribute("disabled", "");
		const genIcon = generateBtn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(genIcon, "sparkles");
		generateBtn.createSpan({ cls: "qbd-ai-generate-btn-text", text: "Générer le quiz" });
		generateBtn.prepend(genIcon);

		generateBtn.addEventListener("click", () => {
			if (!canGenerate()) return;
			startGeneration(container);
		});

		// ── Preview (colonne droite) ──
		const previewCol = layout.createDiv({ cls: "qbd-ai-preview" });
		renderPreview(previewCol);
	}

	let containerRef = null;

	/* Ajoute le modèle courant à la liste s'il n'y figure pas
	   (modèle personnalisé saisi ailleurs). */
	function withCurrentOption(models, current) {
		if (!current || models.some(m => m.value === current)) return models;
		return [...models, { value: current, label: current, hint: "personnalisé" }];
	}

	function setDot(els, state) {
		els.dot.className = "qbd-ai-pcard-dot qbd-ai-pcard-dot--" + state;
	}

	/* Hint contextuel sous la rangée modèle : icône + texte
	   + action optionnelle (lien externe, réglages, commande). */
	function renderHint(zone, opts) {
		if (!zone.isConnected) return;
		zone.empty();
		if (!opts) return;
		const hint = zone.createDiv({ cls: "qbd-ai-hint qbd-ai-hint--" + (opts.type || "info") });
		const icon = hint.createSpan({ cls: "qbd-ai-hint-icon" });
		obsidian.setIcon(icon, opts.icon || (opts.type === "err" ? "alert-circle" : "info"));
		const body = hint.createDiv({ cls: "qbd-ai-hint-body" });
		body.createSpan({ cls: "qbd-ai-hint-text", text: opts.text });
		if (opts.code) {
			body.createEl("code", { cls: "qbd-ai-hint-code", text: opts.code });
		}
		if (opts.action) {
			const btn = hint.createEl("button", { cls: "qbd-ai-hint-action" });
			btn.type = "button";
			if (opts.action.icon) {
				const aIcon = btn.createSpan({ cls: "qbd-ai-hint-action-icon" });
				obsidian.setIcon(aIcon, opts.action.icon);
			}
			btn.createSpan({ text: opts.action.label });
			btn.addEventListener("click", opts.action.onClick);
		}
	}

	function openPluginSettings() {
		const setting = ctx.app.setting;
		setting.open();
		setting.openTabById(ctx.plugin.manifest.id);
	}

	/* Détections async : dots + sous-titres des 3 cards, et pour
	   le provider actif, hint contextuel + liste réelle de modèles. */
	function refreshProviderStatuses({ statusEls, hintZone, provider, currentModel, modelSelect }) {
		const settings = ctx.plugin.settings;

		aiProviders.checkClaudeCode().then(res => {
			const els = statusEls["claude-code"];
			if (!els || !els.dot.isConnected) return;
			if (res.ok) {
				setDot(els, "ok");
				els.sub.textContent = "Prêt · v" + res.version;
			} else if (res.reason === "mobile") {
				setDot(els, "warn");
				els.sub.textContent = "Desktop uniquement";
			} else {
				setDot(els, "err");
				els.sub.textContent = "CLI non détecté";
			}
			if (provider !== "claude-code") return;
			if (res.ok) {
				renderHint(hintZone, null);
			} else if (res.reason === "mobile") {
				renderHint(hintZone, {
					type: "warn", icon: "monitor",
					text: "La génération via Claude est disponible sur desktop uniquement."
				});
			} else {
				renderHint(hintZone, {
					type: "err", icon: "download",
					text: "Claude Code n'est pas installé. Installez-le puis connectez votre compte avec /login.",
					action: {
						label: "Installer Claude Code", icon: "external-link",
						onClick: () => window.open("https://claude.com/claude-code", "_blank")
					}
				});
			}
		});

		aiProviders.checkOllamaLocal(settings.aiOllamaUrl).then(res => {
			const els = statusEls["ollama"];
			if (!els || !els.dot.isConnected) return;
			if (res.ok) {
				setDot(els, "ok");
				els.sub.textContent = res.models.length + " modèle" + (res.models.length > 1 ? "s" : "") + " installé" + (res.models.length > 1 ? "s" : "");
			} else if (res.reason === "no-models") {
				setDot(els, "warn");
				els.sub.textContent = "Aucun modèle installé";
			} else {
				setDot(els, "err");
				els.sub.textContent = "Serveur non détecté";
			}
			if (provider !== "ollama") return;
			if (res.ok) {
				// Le dropdown liste les modèles réellement installés
				const options = res.models.map(m => ({
					value: m.name,
					label: m.name.replace(":latest", ""),
					hint: m.size ? (m.size / 1e9).toFixed(1) + " Go" : undefined
				}));
				const norm = (currentModel || "").replace(/:latest$/, "");
				const match = options.find(o => o.value === currentModel || o.value.replace(/:latest$/, "") === norm);
				if (!match) options.push({ value: currentModel, label: currentModel, hint: "non installé" });
				modelSelect.setOptions(options, match ? match.value : currentModel);
				renderHint(hintZone, null);
			} else if (res.reason === "no-models") {
				renderHint(hintZone, {
					type: "warn", icon: "download",
					text: "Aucun modèle installé. Dans un terminal, exécutez :",
					code: "ollama pull qwen3:14b"
				});
			} else {
				renderHint(hintZone, {
					type: "err", icon: "power",
					text: "Serveur Ollama non détecté. Dans un terminal, lancez :",
					code: "ollama serve"
				});
			}
		});

		aiProviders.checkOllamaCloud(settings.aiOllamaCloudKey).then(res => {
			const els = statusEls["ollama-cloud"];
			if (!els || !els.dot.isConnected) return;
			if (res.ok) {
				setDot(els, "ok");
				els.sub.textContent = "Connecté";
			} else if (res.reason === "no-key") {
				setDot(els, "warn");
				els.sub.textContent = "Clé API requise";
			} else if (res.reason === "bad-key") {
				setDot(els, "err");
				els.sub.textContent = "Clé invalide";
			} else {
				setDot(els, "err");
				els.sub.textContent = "Hors ligne";
			}
			if (provider !== "ollama-cloud") return;
			if (res.ok) {
				if (res.models && res.models.length > 0) {
					const options = res.models.map(m => ({
						value: m.name,
						label: m.name.replace(":latest", "")
					}));
					if (!options.some(o => o.value === currentModel)) {
						options.push({ value: currentModel, label: currentModel, hint: "personnalisé" });
					}
					modelSelect.setOptions(options, currentModel);
				}
				renderHint(hintZone, null);
			} else if (res.reason === "no-key") {
				renderHint(hintZone, {
					type: "warn", icon: "key-round",
					text: "Ajoutez votre clé API Ollama Cloud (gratuite) dans les réglages.",
					action: { label: "Configurer la clé", icon: "settings", onClick: openPluginSettings }
				});
			} else if (res.reason === "bad-key") {
				renderHint(hintZone, {
					type: "err", icon: "key-round",
					text: "Clé API Ollama Cloud invalide. Vérifiez-la sur ollama.com/settings/keys.",
					action: { label: "Corriger la clé", icon: "settings", onClick: openPluginSettings }
				});
			} else {
				renderHint(hintZone, {
					type: "err", icon: "wifi-off",
					text: "Impossible de joindre ollama.com. Vérifiez votre connexion."
				});
			}
		});
	}

	function addImageFiles(files) {
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			images.push({ file, url: URL.createObjectURL(file) });
		}
		render(containerRef);
	}

	function renderImageTab(container) {
		const dropZone = container.createDiv({ cls: "qbd-ai-drop-zone" });
		const dropIcon = dropZone.createDiv({ cls: "qbd-ai-drop-zone-icon" });
		obsidian.setIcon(dropIcon, "upload");
		dropZone.createEl("p", { cls: "qbd-ai-drop-zone-text", text: "Glissez des images ici" });
		dropZone.createEl("p", { cls: "qbd-ai-drop-hint", text: "ou cliquez pour sélectionner · PNG · JPG · WEBP" });

		const fileInput = container.createEl("input", {
			type: "file",
			cls: "qbd-ai-file-input"
		});
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		fileInput.addEventListener("change", (e) => {
			if (e.target.files?.length) addImageFiles(Array.from(e.target.files));
		});

		dropZone.addEventListener("click", () => fileInput.click());
		dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("qbd-ai-drop-zone--hover"); });
		dropZone.addEventListener("dragleave", () => { dropZone.classList.remove("qbd-ai-drop-zone--hover"); });
		dropZone.addEventListener("drop", (e) => {
			e.preventDefault();
			dropZone.classList.remove("qbd-ai-drop-zone--hover");
			if (e.dataTransfer?.files?.length) addImageFiles(Array.from(e.dataTransfer.files));
		});

		if (images.length > 0) {
			const thumbs = container.createDiv({ cls: "qbd-ai-image-thumbs" });
			for (let i = 0; i < images.length; i++) {
				const thumb = thumbs.createDiv({ cls: "qbd-ai-image-thumb" });
				const imgEl = thumb.createEl("img", { cls: "qbd-ai-image-thumb-img" });
				imgEl.src = images[i].url;
				const removeBtn = thumb.createEl("button", { cls: "qbd-ai-image-remove" });
				obsidian.setIcon(removeBtn, "x");
				const idx = i;
				removeBtn.addEventListener("click", () => {
					URL.revokeObjectURL(images[idx].url);
					images.splice(idx, 1);
					render(containerRef);
				});
			}
		}
	}

	function renderPreview(container) {
		container.empty();

		const label = container.createEl("p", {
			cls: "qbd-ai-preview-label",
			text: phase === "idle" ? "Aperçu" : phase === "loading" ? "Génération en cours…" : phase === "error" ? "Erreur" : "Résultat"
		});

		if (phase === "idle") {
			const empty = container.createDiv({ cls: "qbd-ai-preview-empty" });
			const emptyIconWrap = empty.createDiv({ cls: "qbd-ai-preview-empty-icon" });
			obsidian.setIcon(emptyIconWrap, "sparkles");
			empty.createEl("p", { cls: "qbd-ai-preview-empty-text", text: "Le quiz apparaîtra ici" });
			empty.createEl("p", { cls: "qbd-ai-preview-empty-hint", text: "Remplissez le formulaire et cliquez sur Générer" });
		} else if (phase === "loading") {
			const loader = container.createDiv({ cls: "qbd-ai-preview-loading" });
			const iconWrap = loader.createDiv({ cls: "qbd-ai-loading-icon" });
			obsidian.setIcon(iconWrap, "sparkles");
			loader.createEl("p", { cls: "qbd-ai-loading-title", text: "Quiz en cours de création…" });
			loader.createEl("p", { cls: "qbd-ai-loading-sub", text: "Cela ne prendra qu'un instant." });

			const dots = loader.createDiv({ cls: "qbd-ai-loading-dots" });
			for (let i = 0; i < 3; i++) {
				dots.createDiv({ cls: "qbd-ai-loading-dot" });
			}
		} else if (phase === "error") {
			const errorEl = container.createDiv({ cls: "qbd-ai-preview-error" });
			const errorIcon = errorEl.createDiv({ cls: "qbd-ai-error-icon" });
			obsidian.setIcon(errorIcon, "alert-triangle");
			errorEl.createEl("p", { cls: "qbd-ai-error-title", text: "Échec de la génération" });
			errorEl.createEl("p", { cls: "qbd-ai-error-msg", text: errorMessage });

			const retryBtn = errorEl.createEl("button", {
				cls: "qbd-btn qbd-btn--ghost qbd-ai-error-retry",
				text: "Réessayer"
			});
			retryBtn.addEventListener("click", () => {
				phase = "idle";
				render(container.parentElement.parentElement);
			});
		} else if (phase === "result") {
			const header = container.createDiv({ cls: "qbd-ai-result-header" });
			const countWrap = header.createDiv({ cls: "qbd-ai-result-count-wrap" });
			const checkIcon = countWrap.createSpan({ cls: "qbd-ai-result-check" });
			obsidian.setIcon(checkIcon, "check-circle");
			countWrap.createSpan({ cls: "qbd-ai-result-count", text: `${generatedQuestions.length} questions générées` });

			const restartBtn = header.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
			const restartIcon = restartBtn.createSpan({ cls: "qbd-btn-icon" });
			obsidian.setIcon(restartIcon, "rotate-ccw");
			restartBtn.createSpan({ text: "Recommencer" });
			restartBtn.addEventListener("click", () => {
				phase = "idle";
				generatedQuestions = [];
				topicValue = "";
				textValue = "";
				images = [];
				render(container.parentElement.parentElement);
			});

			const resultList = container.createDiv({ cls: "qbd-ai-result-list" });
			for (let i = 0; i < generatedQuestions.length; i++) {
				const q = generatedQuestions[i];
				const item = resultList.createDiv({ cls: "qbd-ai-result-item" });
				const num = item.createDiv({ cls: "qbd-ai-result-num" });
				num.textContent = String(i + 1);
				item.createSpan({ cls: "qbd-ai-result-text", text: q.prompt || q.title || `Question ${i + 1}` });
				item.createSpan({ cls: "qbd-ai-result-type-badge", text: q.type || "Choix unique" });
			}

			// Action buttons
			const actions = container.createDiv({ cls: "qbd-ai-result-actions" });
			const insertBtn = actions.createEl("button", {
				cls: "qbd-btn qbd-btn--primary",
				text: "Insérer dans la note"
			});
			const insertIcon = insertBtn.createSpan({ cls: "qbd-btn-icon" });
			obsidian.setIcon(insertIcon, "plus");
			insertBtn.prepend(insertIcon);
			insertBtn.addEventListener("click", () => insertIntoNote());

			const editBtn = actions.createEl("button", {
				cls: "qbd-btn qbd-btn--ghost",
				text: "Ouvrir dans l'éditeur"
			});
			const editIcon = editBtn.createSpan({ cls: "qbd-btn-icon" });
			obsidian.setIcon(editIcon, "pencil");
			editBtn.prepend(editIcon);
			editBtn.addEventListener("click", () => openInEditor());
		}
	}

	function updateGenerateBtn(btn) {
		if (!btn) return;
		const canGen = canGenerate();

		if (canGen) {
			btn.classList.add("qbd-ai-generate-btn--active");
			btn.removeAttribute("disabled");
		} else {
			btn.classList.remove("qbd-ai-generate-btn--active");
			btn.setAttribute("disabled", "");
		}
	}

	async function startGeneration(container) {
		phase = "loading";
		errorMessage = "";
		render(container);

		try {
			const aiClient = require("./ai-client");
			const client = aiClient(ctx.plugin);

			const prompt = currentTab === "topic" ? topicValue
				: currentTab === "text" ? textValue
				: "Analyse les images fournies";

			// Convert image files to base64 for vision API
			let imageData = [];
			if (currentTab === "image" && images.length > 0) {
				imageData = await Promise.all(images.map(async (img) => {
					const buffer = await img.file.arrayBuffer();
					const bytes = new Uint8Array(buffer);
					let binary = "";
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					const base64 = btoa(binary);
					return { base64, mediaType: img.file.type || "image/png" };
				}));
			}

			generatedQuestions = await client.generate(prompt, {
				count: questionCount,
				type: questionType,
				source: currentTab,
				images: imageData
			});
		} catch (err) {
			errorMessage = err.message || "Vérifiez vos paramètres IA dans les paramètres du plugin.";
			generatedQuestions = [];
		}

		phase = generatedQuestions.length > 0 ? "result" : "error";
		render(container);
	}

	async function insertIntoNote() {
		if (generatedQuestions.length === 0) return;

		const activeFile = ctx.app.workspace.getActiveFile();
		if (!activeFile) {
			new obsidian.Notice("Aucune note active");
			return;
		}

		try {
			const JSON5 = require("json5");
			let content = await ctx.app.vault.read(activeFile);

			const quizBlock = "```quiz-blocks\n" + JSON5.stringify(generatedQuestions, null, 2) + "\n```";

			// Vérifier s'il y a déjà un bloc quiz-blocks
			if (content.includes("```quiz-blocks")) {
				new obsidian.Notice("Un bloc quiz-blocks existe déjà dans cette note. Ouvrez l'éditeur pour le modifier.");
				return;
			}

			content += "\n\n" + quizBlock;
			await ctx.app.vault.modify(activeFile, content);
			new obsidian.Notice("Quiz inséré dans la note");
		} catch (err) {
			new obsidian.Notice("Erreur lors de l'insertion");
		}
	}

	async function openInEditor() {
		if (generatedQuestions.length === 0) return;
		const activeFile = ctx.app.workspace.getActiveFile();
		if (!activeFile) {
			new obsidian.Notice("Aucune note active");
			return;
		}

		try {
			const { QuizBuilderView, VIEW_TYPE } = require("../editor");
			const existing = ctx.app.workspace.getLeavesOfType(VIEW_TYPE);
			let leaf;
			if (existing.length > 0) {
				leaf = existing[0];
				ctx.app.workspace.revealLeaf(leaf);
			} else {
				leaf = ctx.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
				ctx.app.workspace.revealLeaf(leaf);
			}

			const JSON5 = require("json5");
			const source = JSON5.stringify(generatedQuestions, null, 2);
			const view = leaf.view;
			if (view && view.openQuizFile) {
				await view.openQuizFile(activeFile, source);
			}
		} catch (err) {
			new obsidian.Notice("Erreur lors de l'ouverture dans l'éditeur");
		}
	}

	return { render };
}

const obsidian = require("obsidian");
module.exports = createAiHandlers;