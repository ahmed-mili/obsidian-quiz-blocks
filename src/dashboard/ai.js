'use strict';

/* ══════════════════════════════════════════════════════════
   AI VIEW — Dashboard
   Formulaire de génération IA (onglets Sujet/Image/Texte)
   + preview (idle / loading / result / error).
   Providers, logos et modèles : voir ai-providers.js.
══════════════════════════════════════════════════════════ */

const aiProviders = require("./ai-providers");
const { createSelect, closeAllSelects, openActionMenu } = require("./ui-select");

function createAiHandlers(ctx) {
	let composerText = "";
	let noteAttachment = null; // { name, content }
	let questionCount = 5;
	let questionType = "Mixte";
	let images = [];
	let phase = "idle"; // idle | loading | result | error
	let generatedQuestions = [];
	let errorMessage = "";

	const TYPES = ["Mixte", "Choix unique", "Choix multiple", "Texte libre"];

	function canGenerate() {
		const providerId = ctx.plugin.settings.aiProvider || "";
		if (!providerId) return false;
		// Un fournisseur desktop-only (Claude Code CLI) est inutilisable sur
		// mobile : on bloque l'envoi à la source (le bouton d'envoi lit
		// canGenerate) plutôt que de laisser l'utilisateur envoyer un prompt
		// qui échouera — sinon composer « cassé ». Le hint « desktop
		// uniquement » explique déjà pourquoi.
		const provider = aiProviders.getProvider(providerId);
		if (provider && provider.desktopOnly && ctx.app.isMobile) return false;
		return !!(composerText.trim() || images.length > 0 || noteAttachment);
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

		// ── Carte Modèle IA : sélecteur de fournisseur + modèle ──
		// Aucun fournisseur par défaut : le choix est la première étape,
		// la rangée Modèle n'apparaît qu'une fois le fournisseur choisi.
		const provider = ctx.plugin.settings.aiProvider || "";
		const currentModel = provider
			? (ctx.plugin.settings.aiModel || aiProviders.getProvider(provider).defaultModel)
			: "";

		const modelCard = formCol.createDiv({ cls: "qbd-ai-model-card" });
		const modelHeader = modelCard.createDiv({ cls: "qbd-ai-model-header" });
		modelHeader.createEl("span", { cls: "qbd-ai-model-label", text: "Modèle IA" });

		// Rangée fournisseur — un seul sélecteur, options avec logos + statut
		const providerRow = modelCard.createDiv({ cls: "qbd-ai-model-row" });
		providerRow.createEl("span", { cls: "qbd-ai-model-row-label", text: "Fournisseur" });
		const providerSelect = createSelect(providerRow, {
			value: provider || undefined,
			placeholder: "Choisir un fournisseur…",
			options: aiProviders.PROVIDERS.map(p => ({ value: p.id, label: p.name, logo: p.logo, sub: p.sub })),
			renderTrigger: (el, o) => {
				if (!o) {
					el.setText("Choisir un fournisseur…");
					return;
				}
				const logo = el.createSpan({ cls: "qbd-provider-logo qbd-provider-logo--" + o.logo });
				aiProviders.setBrandLogo(logo, o.logo);
				el.createSpan({ cls: "qbd-provider-trigger-name", text: o.label });
				const st = providerStatus[o.value];
				el.createSpan({ cls: "qbd-status-dot qbd-status-dot--" + (st ? st.dot : "checking") });
			},
			renderOption: (el, o) => {
				const logo = el.createSpan({ cls: "qbd-provider-logo qbd-provider-logo--" + o.logo });
				aiProviders.setBrandLogo(logo, o.logo);
				const body = el.createDiv({ cls: "qbd-provider-option-body" });
				body.createSpan({ cls: "qbd-select-option-label", text: o.label });
				const st = providerStatus[o.value];
				body.createSpan({ cls: "qbd-provider-option-sub", text: st ? st.text : o.sub });
				el.createSpan({ cls: "qbd-status-dot qbd-status-dot--" + (st ? st.dot : "checking") });
			},
			onChange: async (id) => {
				ctx.plugin.settings.aiProvider = id;
				ctx.plugin.settings.aiModel = aiProviders.getProvider(id).defaultModel;
				await ctx.plugin.saveSettings();
				render(container);
			}
		});

		// Rangée modèle + hint : seulement une fois le fournisseur choisi
		let modelSelect = null;
		let hintZone = null;
		if (provider) {
			const modelRow = modelCard.createDiv({ cls: "qbd-ai-model-row" });
			modelRow.createEl("span", { cls: "qbd-ai-model-row-label", text: "Modèle" });
			modelSelect = createSelect(modelRow, {
				value: currentModel,
				options: withCurrentOption(aiProviders.getDefaultModels(provider), currentModel),
				onChange: async (v) => {
					ctx.plugin.settings.aiModel = v;
					await ctx.plugin.saveSettings();
				}
			});

			// Zone de hint contextuelle (clé manquante, serveur offline…)
			hintZone = modelCard.createDiv({ cls: "qbd-ai-model-hint" });
		}

		refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect });


		// ── Composer (champ unique + bouton « + » d'attachements) ──
		let generateBtnRef = null;

		const composer = formCol.createDiv({ cls: "qbd-ai-composer" });

		// Attachements : vignettes d'images + note attachée
		if (images.length > 0 || noteAttachment) {
			const attachRow = composer.createDiv({ cls: "qbd-ai-composer-attachments" });
			for (let i = 0; i < images.length; i++) {
				const thumb = attachRow.createDiv({ cls: "qbd-ai-image-thumb" });
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
			if (noteAttachment) {
				const chip = attachRow.createDiv({ cls: "qbd-ai-note-chip" });
				const chipIcon = chip.createSpan({ cls: "qbd-ai-note-chip-icon" });
				obsidian.setIcon(chipIcon, "file-text");
				chip.createSpan({ cls: "qbd-ai-note-chip-name", text: noteAttachment.name });
				const chipRemove = chip.createEl("button", { cls: "qbd-ai-note-chip-remove" });
				obsidian.setIcon(chipRemove, "x");
				chipRemove.addEventListener("click", () => {
					noteAttachment = null;
					render(containerRef);
				});
			}
		}

		const composerInput = composer.createEl("textarea", { cls: "qbd-ai-composer-input" });
		composerInput.placeholder = "Décrivez le sujet du quiz, ou collez votre contenu…";
		composerInput.value = composerText;
		composerInput.rows = 2;
		const autoGrow = () => {
			composerInput.style.height = "auto";
			composerInput.style.height = Math.min(composerInput.scrollHeight, 220) + "px";
		};
		composerInput.addEventListener("input", (e) => {
			composerText = e.target.value;
			autoGrow();
			updateGenerateBtn(generateBtnRef);
		});
		// Coller une image directement dans le champ
		composerInput.addEventListener("paste", (e) => {
			const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
			if (files.length > 0) {
				e.preventDefault();
				addImageFiles(files);
			}
		});
		requestAnimationFrame(autoGrow);

		// Rangée du bas : bouton « + » (ajouter ce dont on a besoin)
		const composerBottom = composer.createDiv({ cls: "qbd-ai-composer-bottom" });
		const addBtn = composerBottom.createEl("button", { cls: "qbd-ai-composer-add" });
		addBtn.type = "button";
		addBtn.setAttribute("aria-label", "Ajouter du contenu");
		obsidian.setIcon(addBtn, "plus");

		const fileInput = composer.createEl("input", { type: "file", cls: "qbd-ai-file-input" });
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		fileInput.addEventListener("change", (e) => {
			if (e.target.files?.length) addImageFiles(Array.from(e.target.files));
		});

		addBtn.addEventListener("click", () => {
			const activeFile = ctx.getActiveFile ? ctx.getActiveFile() : ctx.app.workspace.getActiveFile();
			openActionMenu(addBtn, [
				{
					icon: "image",
					label: "Ajouter des images",
					sub: "PNG · JPG · WEBP — ou glissez / collez",
					onClick: () => fileInput.click()
				},
				{
					icon: "file-text",
					label: "Utiliser la note active",
					sub: activeFile ? activeFile.basename : "Aucune note ouverte",
					disabled: !activeFile,
					onClick: () => attachActiveNote(activeFile)
				}
			]);
		});

		// Glisser-déposer d'images sur tout le composer
		composer.addEventListener("dragover", (e) => {
			e.preventDefault();
			composer.classList.add("qbd-ai-composer--dragover");
		});
		composer.addEventListener("dragleave", () => composer.classList.remove("qbd-ai-composer--dragover"));
		composer.addEventListener("drop", (e) => {
			e.preventDefault();
			composer.classList.remove("qbd-ai-composer--dragover");
			if (e.dataTransfer?.files?.length) addImageFiles(Array.from(e.dataTransfer.files));
		});

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

	/* Derniers statuts connus par provider : { dot, text }.
	   Lus par le sélecteur de fournisseur (trigger + options). */
	const providerStatus = {};

	function setStatus(id, providerSelect, dot, text) {
		providerStatus[id] = { dot, text };
		// Redessine le trigger (dot de statut du fournisseur choisi)
		if (providerSelect && providerSelect.el.isConnected) {
			providerSelect.setValue(ctx.plugin.settings.aiProvider || undefined);
		}
	}

	/* Hint contextuel sous la rangée modèle : icône + texte
	   + action optionnelle (lien externe, réglages, commande). */
	function renderHint(zone, opts) {
		if (!zone || !zone.isConnected) return;
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

	/* Détections async : statut de chaque provider (trigger + menu du
	   sélecteur), et pour le provider actif, hint contextuel + liste
	   réelle de modèles. */
	function refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect }) {
		const settings = ctx.plugin.settings;

		aiProviders.checkClaudeCode().then(res => {
			if (res.ok) {
				setStatus("claude-code", providerSelect, "ok", "Claude Code v" + res.version);
			} else if (res.reason === "mobile") {
				setStatus("claude-code", providerSelect, "warn", "Desktop uniquement");
			} else {
				setStatus("claude-code", providerSelect, "err", "Claude Code non installé");
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
			if (res.ok) {
				const n = res.models.length;
				setStatus("ollama", providerSelect, "ok", n + " modèle" + (n > 1 ? "s" : "") + " installé" + (n > 1 ? "s" : ""));
			} else if (res.reason === "no-models") {
				setStatus("ollama", providerSelect, "warn", "Aucun modèle installé");
			} else {
				setStatus("ollama", providerSelect, "err", "Serveur non détecté");
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
			if (res.ok) {
				setStatus("ollama-cloud", providerSelect, "ok", "Connecté");
			} else if (res.reason === "no-key") {
				setStatus("ollama-cloud", providerSelect, "warn", "Clé API requise");
			} else if (res.reason === "bad-key") {
				setStatus("ollama-cloud", providerSelect, "err", "Clé invalide");
			} else {
				setStatus("ollama-cloud", providerSelect, "err", "Hors ligne");
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

	/* Attache le contenu de la note active comme source du quiz. */
	async function attachActiveNote(file) {
		if (!file) {
			new obsidian.Notice("Aucune note active");
			return;
		}
		try {
			const content = await ctx.app.vault.read(file);
			noteAttachment = { name: file.basename, content };
			render(containerRef);
		} catch (e) {
			new obsidian.Notice("Impossible de lire la note active");
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
				composerText = "";
				noteAttachment = null;
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

			// Source déduite du contenu du composer :
			// images → vision ; note attachée → texte source ; sinon sujet
			const source = images.length > 0 ? "image" : noteAttachment ? "text" : "topic";
			const prompt = source === "image"
				? (composerText.trim() || "Analyse les images fournies")
				: source === "text"
				? (composerText.trim() ? composerText.trim() + "\n\n" : "") + noteAttachment.content
				: composerText.trim();

			// Convert image files to base64 for vision API
			let imageData = [];
			if (images.length > 0) {
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
				source,
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