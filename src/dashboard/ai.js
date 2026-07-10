'use strict';

/* ══════════════════════════════════════════════════════════
   AI VIEW — Dashboard
   Formulaire de génération IA (onglets Sujet/Image/Texte)
   + preview (idle / loading / result / error).
   Providers, logos et modèles : voir ai-providers.js.
══════════════════════════════════════════════════════════ */

const aiProviders = require("./ai-providers");
const { createSelect, closeAllSelects, openActionMenu, openModelMenu, openEffortSlider, openOptionsMenu, openNotePicker } = require("./ui-select");
const voiceInput = require("./voice-input");

function createAiHandlers(ctx) {
	let composerText = "";
	let noteAttachment = null; // { name, content }
	let questionCount = 5;
	let questionType = "Mixte";
	let images = [];
	let phase = "idle"; // idle | loading | result | error
	// Client IA de la génération en cours — permet au bouton stop (et à
	// la touche Esc) d'annuler réellement (kill du CLI / abort du fetch).
	let activeClient = null;
	// Éditeur de quiz EMBARQUÉ pleine page après génération (référence :
	// l'éditeur complet, pas de nouvel onglet ; composer en bas).
	// generationId invalide l'instance à chaque nouvelle génération.
	let embedEditor = null;
	let generationId = 0;
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
		// Tooltips portalés au <body> (stop, effort) : un re-render détruit
		// leur ancre sans mouseleave → purge pour éviter les orphelins.
		document.querySelectorAll(".qbd-hover-tip").forEach(t => t.remove());
		container.empty();

		// ── Scène unique (le layout 2 colonnes est supprimé — maquette
		// validée 2026-07-10) : idle/loading/error → titre + composer
		// CENTRÉS dans la page (référence claude.ai, plus de zone
		// « Aperçu » vide) ; result → l'ÉDITEUR embarqué pleine page et
		// le composer EN BAS (variante B « chat »). `formCol` reste le
		// nom du parent du composer pour ne pas réécrire tout le bloc.
		const stage = container.createDiv({ cls: "qbd-ai-stage qbd-ai-stage--" + phase });
		// Zone résultat créée AVANT le composer : l'ordre DOM le met en bas.
		const resultZone = phase === "result" ? stage.createDiv({ cls: "qbd-ai-result-zone" }) : null;
		const formCol = stage;

		// ── Page header (absent en résultat : la barre du quiz suffit) ──
		if (phase !== "result") {
			const titleRow = formCol.createDiv({ cls: "qbd-ai-title-row" });
			const titleIcon = titleRow.createSpan({ cls: "qbd-ai-title-icon" });
			obsidian.setIcon(titleIcon, "sparkles");
			titleRow.createEl("h2", { cls: "qbd-ai-title", text: "Générer un quiz" });
			formCol.createEl("p", { cls: "qbd-ai-subtitle", text: "Créez un quiz à partir d'un sujet, d'images ou d'un texte." });
		}

		// Zone du loader de génération : AU-DESSUS du composer (demande
		// 2026-07-10 — le loader préfigure le résultat, qui vit en haut).
		// display: contents en CSS → la carte reste un enfant flex direct.
		const loadingZone = phase === "loading" ? stage.createDiv({ cls: "qbd-ai-loading-zone" }) : null;

		// ── Fournisseur : bouton LOGO SEUL dans le pied du composer (la
		// carte « Modèle IA » est supprimée) — le menu garde logos, statut
		// et sous-titre ; le tooltip au survol porte nom + statut.
		// Aucun fournisseur par défaut : le choix reste la première étape,
		// le contrôle Modèle n'apparaît qu'une fois le fournisseur choisi.
		const provider = ctx.plugin.settings.aiProvider || "";
		const currentModel = provider
			? (ctx.plugin.settings.aiModel || aiProviders.getProvider(provider).defaultModel)
			: "";

		let providerSelect = null;
		const buildProviderControl = (parent) => {
			providerSelect = createSelect(parent, {
				value: provider || undefined,
				options: aiProviders.PROVIDERS.map(p => ({ value: p.id, label: p.name, logo: p.logo, sub: p.sub })),
				renderTrigger: (el, o) => {
					if (!o) {
						// Aucun fournisseur : slot vide, le tooltip guide.
						const ic = el.createSpan({ cls: "qbd-provider-logo" });
						obsidian.setIcon(ic, "circle-dashed");
						return;
					}
					const logo = el.createSpan({ cls: "qbd-provider-logo qbd-provider-logo--" + o.logo });
					aiProviders.setBrandLogo(logo, o.logo);
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
				},
				// Re-vérifie les CLI à CHAQUE ouverture du menu (force = sans TTL) :
				// après un « claude/codex update », la version affichée se met à
				// jour toute seule, le menu ouvert est redessiné à l'arrivée des
				// résultats (setStatus → refreshMenu).
				onOpen: () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true })
			});
			providerSelect.el.addClass("qbd-provider-trigger-logo");
			// Tooltip : nom + statut, relus à chaque survol (les détections
			// async peuvent arriver après le rendu).
			let tip = null;
			const hide = () => { if (tip) { tip.remove(); tip = null; } };
			providerSelect.el.addEventListener("mouseenter", () => {
				if (tip) return;
				tip = document.body.createDiv({ cls: "qbd-hover-tip" });
				const p = aiProviders.PROVIDERS.find(x => x.id === (ctx.plugin.settings.aiProvider || ""));
				tip.createDiv({ cls: "qbd-hover-tip-title", text: p ? p.name : "Choisir un fournisseur" });
				const st = p && providerStatus[p.id];
				if (st) tip.createDiv({ cls: "qbd-hover-tip-body", text: st.text });
				const r = providerSelect.el.getBoundingClientRect();
				tip.style.visibility = "hidden";
				const tr = tip.getBoundingClientRect();
				const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
				let top = r.top - tr.height - 8;
				if (top < 8) top = r.bottom + 8;
				tip.style.left = left + "px";
				tip.style.top = top + "px";
				tip.style.visibility = "";
			});
			providerSelect.el.addEventListener("mouseleave", hide);
			providerSelect.el.addEventListener("click", hide);
		};

		// Le contrôle Modèle + effort vit désormais dans le pied du composer
		// (façon claude.ai) : on prépare ici sa fabrique, appelée plus bas.
		// La zone de hint reste sous le sélecteur de fournisseur.
		let modelSelect = null;
		let hintZone = null;
		let buildModelControl = null;
		// État partagé du contrôle Ollama : options mutables, derniers modèles
		// locaux détectés et rafraîchissement du libellé. La liste est reconstruite
		// à CHAQUE ouverture du menu (et sur détection async) → reflète toujours la
		// sélection courante des réglages, même éditée après le rendu de la vue.
		let ollamaCtl = null;

		// Construit les options Ollama depuis la sélection de l'utilisateur
		// (settings.aiOllamaModels, ordre réglable) + les locaux installés hors
		// sélection. `detected` = res.models de checkOllama ([{name,capabilities}])
		// ou null. Renvoie un tableau plat = UNE liste scrollable (façon app
		// Ollama), jusqu'à OLLAMA_MAX_MODELS.
		const buildOllamaList = (detected) => {
			const byNorm = new Map();
			(detected || []).forEach(m => byNorm.set(m.name.replace(/:latest$/, ""), m));
			const isInstalled = (v) => byNorm.has(v.replace(/:latest$/, ""));
			const iconFor = (cloud, installed) => cloud ? "cloud" : (installed ? null : "download");
			const decorate = (meta) => {
				const installed = meta.cloud ? true : isInstalled(meta.value);
				return { value: meta.value, label: meta.label, cloud: meta.cloud,
					thinking: meta.thinking !== false, installed, icon: iconFor(meta.cloud, installed) };
			};
			const catalog = ctx.plugin.settings.aiOllamaCatalog;
			const list = aiProviders.resolveOllamaSelection(ctx.plugin.settings.aiOllamaModels, catalog).map(decorate);
			// Modèles locaux installés hors sélection → ajoutés en fin de liste.
			(detected || []).forEach(m => {
				const norm = m.name.replace(/:latest$/, "");
				if (list.some(o => o.value === m.name || o.value.replace(/:latest$/, "") === norm)) return;
				list.push({ value: m.name, label: m.name.replace(":latest", ""), cloud: false,
					installed: true, thinking: (m.capabilities || []).includes("thinking"), icon: null });
			});
			// Modèle courant hors liste → placé en tête.
			const cur = ctx.plugin.settings.aiModel || currentModel;
			if (cur && !list.some(o => o.value === cur)) {
				list.unshift(decorate(aiProviders.getOllamaModelMeta(cur, catalog)));
			}
			return list;
		};
		// Claude Code et Codex (ChatGPT) partagent le même contrôle modèle+effort
		// (menu façon claude.ai). Seules changent la liste de modèles, la liste
		// d'efforts et la résolution du modèle (Fable expire côté Claude).
		if (provider === "claude-code" || provider === "codex") {
			const isClaude = provider === "claude-code";
			// Liste relue à CHAQUE usage (trigger + ouverture du menu) : côté
			// Claude, Fable expire à date ; côté Codex, la liste suit
			// ~/.codex/models_cache.json (nouveau modèle du compte → présent au
			// prochain clic, sans mise à jour manuelle du plugin).
			const getModels = () => isClaude ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels("codex");
			const resolveMv = (v) => isClaude ? aiProviders.resolveClaudeModel(v) : aiProviders.resolveCodexModel(v);
			// Modèle et effort = DEUX boutons séparés (référence claude.ai /
			// ChatGPT). Le modèle ouvre le menu de modèles (sans ligne Effort) ;
			// l'effort ouvre le popover slider (openEffortSlider), variante
			// claude ou codex. Les efforts Codex dépendent du modèle courant
			// (supported_reasoning_levels) → tout est relu à chaque usage.
			buildModelControl = (parent) => {
				const currentMv = () => resolveMv(ctx.plugin.settings.aiModel || currentModel);
				const currentEfforts = () => aiProviders.getEfforts(provider, currentMv());
				const currentEv = () => aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort, currentMv());

				// Référence Claude Code : « Opus 4.8  Max » — libellés nus,
				// SANS chevrons, rapprochés (l'effort en Capitalisé).
				const trigger = parent.createEl("button", { cls: "qbd-select qbd-model-trigger qbd-composer-plain" });
				trigger.type = "button";
				const trigLabel = trigger.createSpan({ cls: "qbd-select-label" });

				const effortBtn = parent.createEl("button", { cls: "qbd-select qbd-effort-trigger qbd-composer-plain" });
				effortBtn.type = "button";
				const effortLabel = effortBtn.createSpan({ cls: "qbd-select-label qbd-effort-trigger-label" });

				const EFFORT_DISPLAY = {
					low: "Low", medium: "Medium", high: "High",
					xhigh: "Extra", max: "Max", ultracode: "Ultracode", ultra: "Ultra"
				};

				const refreshTriggers = () => {
					trigLabel.empty();
					const models = getModels();
					const cur = models.find(m => m.value === currentMv()) || models[0];
					// Fast actif (codex) → éclair à gauche du nom du modèle,
					// comme la pill du composer ChatGPT.
					if (!isClaude && ctx.plugin.settings.aiCodexFast && cur.fast) {
						const z = trigLabel.createSpan({ cls: "qbd-model-trigger-zap" });
						obsidian.setIcon(z, "zap");
					}
					trigLabel.createSpan({ cls: "qbd-model-trigger-name", text: cur.label });
					const ev = currentEv();
					const ef = currentEfforts().find(e => e.value === ev);
					effortLabel.setText(EFFORT_DISPLAY[ev] || (ef ? ef.label : ev));
					effortBtn.classList.toggle("is-ultra", !!(ef && ef.accent));
				};
				refreshTriggers();

				trigger.addEventListener("click", () => {
					openModelMenu(trigger, {
						models: getModels(),
						currentModel: currentMv(),
						// L'effort a son propre bouton → pas de ligne Effort ici.
						efforts: [],
						onPickModel: async (v) => {
							ctx.plugin.settings.aiModel = v;
							await ctx.plugin.saveSettings();
							refreshTriggers();
						}
					});
				});

				effortBtn.addEventListener("click", () => {
					// Éclair Fast (codex) : seulement si CE modèle expose le tier
					// « priority » (models_cache) — toggle persisté aiCodexFast.
					const curModel = getModels().find(m => m.value === currentMv());
					const fast = (!isClaude && curModel && curModel.fast) ? {
						on: !!ctx.plugin.settings.aiCodexFast,
						onToggle: async (v) => {
							ctx.plugin.settings.aiCodexFast = v;
							await ctx.plugin.saveSettings();
							refreshTriggers(); // éclair du bouton modèle
						}
					} : null;
					openEffortSlider(effortBtn, {
						variant: isClaude ? "claude" : "codex",
						efforts: currentEfforts(),
						currentEffort: currentEv(),
						fast,
						onPickEffort: async (v) => {
							ctx.plugin.settings.aiEffort = v;
							await ctx.plugin.saveSettings();
							refreshTriggers();
						}
					});
				});
			};
		} else if (provider) {
			// Ollama partage le MÊME contrôle modèle+effort que Claude/Codex
			// (openModelMenu). L'effort est réel : câblé sur le param `think` de
			// l'API Ollama (low/medium/high/max). La ligne Effort n'apparaît que
			// pour un modèle à raisonnement (thinking). Les icônes nuage/
			// téléchargement/rien reproduisent l'app Ollama.
			const efforts = aiProviders.getEfforts(provider);
			// `detected` = derniers modèles locaux vus par checkOllama (pour les
			// ré-annexer à la reconstruction). La liste est reconstruite à CHAQUE
			// ouverture du menu → reflète toujours la sélection courante des réglages.
			ollamaCtl = { options: buildOllamaList(null), detected: null, refreshTrigger: null };
			buildModelControl = (parent) => {
				const trigger = parent.createEl("button", { cls: "qbd-select qbd-model-trigger" });
				trigger.type = "button";
				const trigLabel = trigger.createSpan({ cls: "qbd-select-label" });
				const trigChev = trigger.createSpan({ cls: "qbd-select-chevron" });
				obsidian.setIcon(trigChev, "chevron-down");
				const curOpt = () => {
					const mv = ctx.plugin.settings.aiModel || currentModel;
					return ollamaCtl.options.find(o => o.value === mv) || ollamaCtl.options[0];
				};
				const refreshTrigger = () => {
					trigLabel.empty();
					const cur = curOpt();
					const mv = ctx.plugin.settings.aiModel || currentModel;
					trigLabel.createSpan({ cls: "qbd-model-trigger-name", text: cur ? cur.label : (mv || "").replace(":latest", "") });
					if (cur && cur.thinking) {
						trigLabel.createSpan({ cls: "qbd-model-trigger-effort", text: aiProviders.getEffortLabel(aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort), provider) });
					}
				};
				refreshTrigger();
				ollamaCtl.refreshTrigger = refreshTrigger;
				trigger.addEventListener("click", () => {
					// Reconstruit à l'ouverture → la liste suit la sélection des
					// réglages (settings.aiOllamaModels) même modifiée après le rendu.
					ollamaCtl.options = buildOllamaList(ollamaCtl.detected);
					refreshTrigger();
					const cur = curOpt();
					openModelMenu(trigger, {
						models: ollamaCtl.options,
						searchable: true,
						currentModel: ctx.plugin.settings.aiModel || currentModel,
						efforts: (cur && cur.thinking) ? efforts : [],
						currentEffort: aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort),
						onPickModel: async (v) => {
							ctx.plugin.settings.aiModel = v;
							await ctx.plugin.saveSettings();
							refreshTrigger();
						},
						onPickEffort: async (v) => {
							ctx.plugin.settings.aiEffort = v;
							await ctx.plugin.saveSettings();
							refreshTrigger();
						}
					});
				});
			};
		}


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
		// Dictée vocale push-to-talk (opt-in — réglages « Saisie vocale »).
		voiceInput.attach(ctx, composerInput);
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

		// Rangée du bas : bouton « + » (gauche), puis à droite le modèle +
		// effort (façon claude.ai) et le bouton d'envoi.
		const composerBottom = composer.createDiv({ cls: "qbd-ai-composer-bottom" });
		const addBtn = composerBottom.createEl("button", { cls: "qbd-ai-composer-add" });
		addBtn.type = "button";
		addBtn.setAttribute("aria-label", "Ajouter du contenu");
		obsidian.setIcon(addBtn, "plus");

		// Groupe droite : logo fournisseur, sélecteur modèle + effort, puis
		// bouton options et bouton d'envoi.
		const composerTools = composerBottom.createDiv({ cls: "qbd-ai-composer-tools" });
		buildProviderControl(composerTools);
		if (buildModelControl) buildModelControl(composerTools);

		// Bouton Options (questions + type) : remplace l'ancienne carte
		// « Options » du formulaire — popover à la demande, tooltip d'état.
		const optsBtn = composerTools.createEl("button", { cls: "qbd-ai-composer-opts" });
		optsBtn.type = "button";
		optsBtn.setAttribute("aria-label", "Options du quiz");
		obsidian.setIcon(optsBtn, "sliders-horizontal");
		optsBtn.addEventListener("click", () => {
			openOptionsMenu(optsBtn, {
				count: questionCount, minCount: 2, maxCount: 20,
				type: questionType, types: TYPES,
				onCount: (n) => { questionCount = n; },
				onType: (t) => { questionType = t; }
			});
		});
		// Tooltip au survol : l'état courant (« 5 questions · Mixte »),
		// relu à chaque hover — pattern attachStopTip.
		{
			let tip = null;
			const hide = () => { if (tip) { tip.remove(); tip = null; } };
			optsBtn.addEventListener("mouseenter", () => {
				if (tip) return;
				tip = document.body.createDiv({ cls: "qbd-hover-tip" });
				tip.createDiv({ cls: "qbd-hover-tip-title", text: questionCount + " questions · " + questionType });
				const r = optsBtn.getBoundingClientRect();
				tip.style.visibility = "hidden";
				const tr = tip.getBoundingClientRect();
				const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
				let top = r.top - tr.height - 8;
				if (top < 8) top = r.bottom + 8;
				tip.style.left = left + "px";
				tip.style.top = top + "px";
				tip.style.visibility = "";
			});
			optsBtn.addEventListener("mouseleave", hide);
			optsBtn.addEventListener("click", hide);
		}

		// Bouton générer dans le composer (façon bouton d'envoi claude.ai) :
		// caché tant que le champ est vide, flèche ↑ blanche sur fond accent.
		// Pendant la génération il devient le bouton STOP (carré + tooltip
		// « Arrêter Esc ») qui annule réellement la génération.
		const sendBtn = composerTools.createEl("button", { cls: "qbd-ai-composer-send" });
		sendBtn.type = "button";
		const sendIcon = sendBtn.createSpan({ cls: "qbd-ai-composer-send-icon" });
		if (phase === "loading") {
			sendBtn.addClass("is-stop");
			// Pas d'aria-label ici : Obsidian en fait un tooltip natif,
			// redondant avec le tooltip custom « Arrêter Esc ».
			// Carré dessiné en CSS (l'icône Lucide est trop fine/petite).
			sendIcon.createDiv({ cls: "qbd-ai-stop-square" });
			attachStopTip(sendBtn);
			sendBtn.addEventListener("click", () => { if (activeClient) activeClient.abort(); });
		} else {
			sendBtn.setAttribute("aria-label", "Générer le quiz");
			obsidian.setIcon(sendIcon, "arrow-up");
			sendBtn.addEventListener("click", () => {
				if (canGenerate()) startGeneration(containerRef);
			});
		}
		generateBtnRef = sendBtn;
		updateGenerateBtn(generateBtnRef);

		// Détections async (statut fournisseur + modèles réels) : après la
		// création du contrôle modèle, donc modelSelect existe désormais.
		// ollamaCtl et buildOllamaList sont locaux à render → passés en
		// paramètres (les référencer directement depuis la fonction sœur
		// refreshProviderStatuses lançait un ReferenceError, statut Ollama gelé).
		refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList });

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
					hint: "PNG · JPG · WEBP",
					onClick: () => fileInput.click()
				},
				{
					icon: "file-text",
					label: "Utiliser la note active",
					hint: activeFile ? activeFile.basename : "Aucune note",
					disabled: !activeFile,
					onClick: () => attachActiveNote(activeFile)
				}
			]);
		});

		// Toute la carte est cliquable pour écrire (demande 2026-07-10) :
		// un clic hors des contrôles focus le champ, caret en fin de texte.
		// mousedown natif du textarea préservé (positionnement du caret).
		composer.addEventListener("mousedown", (e) => {
			if (e.target.closest("button, textarea, .qbd-select, .qbd-ai-note-chip, .qbd-ai-image-thumb")) return;
			e.preventDefault(); // pas de blur/re-focus visible
			const len = composerInput.value.length;
			composerInput.focus();
			composerInput.setSelectionRange(len, len);
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

		// Hint contextuel du fournisseur (CLI absent, serveur offline…) :
		// sous le composer depuis la suppression de la carte « Modèle IA ».
		// :empty → masqué ; rempli par refreshProviderStatuses/renderHint.
		if (provider) hintZone = formCol.createDiv({ cls: "qbd-ai-model-hint" });

		// (Les options Questions/Type vivent dans le popover du bouton
		// sliders du composer — l'ancienne carte « Options » est supprimée.)

		// ── État de la scène : loader AU-DESSUS du composer, erreur sous
		// le composer, ou l'éditeur embarqué dans la zone résultat. ──
		if (phase === "loading") renderLoading(loadingZone);
		else if (phase === "error") renderError(stage);
		else if (phase === "result") renderResult(resultZone);

		// Onglet ouvert → saisie immédiate sans clic (demande 2026-07-10).
		// Pas en phase résultat : le focus serait volé à l'éditeur embarqué
		// à chaque re-render.
		if (phase === "idle" || phase === "error") {
			requestAnimationFrame(() => {
				if (composerInput.isConnected) composerInput.focus({ preventScroll: true });
			});
		}
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
		// Redessine le trigger (dot de statut du fournisseur choisi) et les
		// options du menu s'il est ouvert (versions re-détectées à l'ouverture).
		if (providerSelect && providerSelect.el.isConnected) {
			providerSelect.setValue(ctx.plugin.settings.aiProvider || undefined);
			if (providerSelect.refreshMenu) providerSelect.refreshMenu();
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
	function refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force }) {
		const settings = ctx.plugin.settings;

		aiProviders.checkClaudeCode(force).then(res => {
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

		aiProviders.checkCodex(force).then(res => {
			if (res.ok) {
				setStatus("codex", providerSelect, "ok", "Codex v" + res.version);
			} else if (res.reason === "mobile") {
				setStatus("codex", providerSelect, "warn", "Desktop uniquement");
			} else {
				setStatus("codex", providerSelect, "err", "Codex non installé");
			}
			if (provider !== "codex") return;
			if (res.ok) {
				renderHint(hintZone, null);
			} else if (res.reason === "mobile") {
				renderHint(hintZone, {
					type: "warn", icon: "monitor",
					text: "La génération via ChatGPT (Codex) est disponible sur desktop uniquement."
				});
			} else {
				renderHint(hintZone, {
					type: "err", icon: "download",
					text: "Codex n'est pas installé. Installez-le puis connectez votre compte ChatGPT avec « codex login ».",
					action: {
						label: "Installer Codex", icon: "external-link",
						onClick: () => window.open("https://www.npmjs.com/package/@openai/codex", "_blank")
					}
				});
			}
		});

		aiProviders.checkOllama(settings.aiOllamaUrl).then(res => {
			if (res.ok) {
				// Affiche la version d'Ollama installée (comme Claude/Codex), ex.
				// « Ollama v0.31.2 ». Repli sur l'état du cache si version absente.
				const n = res.models.length;
				const fallback = n > 0 ? (n + " local" + (n > 1 ? "aux" : "") + " + cloud") : "Cloud prêt";
				setStatus("ollama", providerSelect, "ok", res.version ? ("Ollama v" + res.version) : fallback);
			} else {
				setStatus("ollama", providerSelect, "err", "Serveur non détecté");
			}
			if (provider !== "ollama") return;
			if (res.ok) {
				// Reconstruit les options (sélection + locaux réellement installés,
				// avec capability thinking) et rafraîchit le libellé du contrôle.
				if (ollamaCtl) {
					ollamaCtl.detected = res.models;
					ollamaCtl.options = buildOllamaList(res.models);
					if (ollamaCtl.refreshTrigger) ollamaCtl.refreshTrigger();
				}
				renderHint(hintZone, null);
			} else {
				renderHint(hintZone, {
					type: "err", icon: "power",
					text: "Serveur Ollama non détecté. Dans un terminal, lancez :",
					code: "ollama serve"
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

	/* Loader de génération — l'ANIMATION VALIDÉE (balayage qbd-glide,
	   icône sparkles, dots pulsants) est reprise à l'identique : mêmes
	   classes, mêmes keyframes. Seul le conteneur change (carte centrée
	   sous le composer, plus de colonne d'aperçu). */
	function renderLoading(host) {
		const loader = host.createDiv({ cls: "qbd-ai-preview-loading" });
		const iconWrap = loader.createDiv({ cls: "qbd-ai-loading-icon" });
		obsidian.setIcon(iconWrap, "sparkles");
		loader.createEl("p", { cls: "qbd-ai-loading-title", text: "Quiz en cours de création…" });

		const dots = loader.createDiv({ cls: "qbd-ai-loading-dots" });
		for (let i = 0; i < 3; i++) {
			dots.createDiv({ cls: "qbd-ai-loading-dot" });
		}
	}

	function renderError(host) {
		const errorEl = host.createDiv({ cls: "qbd-ai-preview-error" });
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
			render(containerRef);
		});
	}

	/* Zone résultat (pleine page, composer en bas) : barre compacte +
	   l'ÉDITEUR DE QUIZ COMPLET embarqué — exigence explicite, pas une
	   liste simplifiée. */
	function renderResult(container) {
		// ── Barre compacte : compte + Insérer dans une note + Recommencer ──
		const bar = container.createDiv({ cls: "qbd-ai-embed-bar" });
		const countWrap = bar.createDiv({ cls: "qbd-ai-result-count-wrap" });
		const checkIcon = countWrap.createSpan({ cls: "qbd-ai-result-check" });
		obsidian.setIcon(checkIcon, "check-circle");
		countWrap.createSpan({ cls: "qbd-ai-result-count", text: `${generatedQuestions.length} questions générées` });

		const insertBtn = bar.createEl("button", {
			cls: "qbd-btn qbd-btn--primary",
			text: "Insérer dans une note"
		});
		const insertIcon = insertBtn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(insertIcon, "plus");
		insertBtn.prepend(insertIcon);
		// Picker : notes OUVERTES en tête + recherche dans tout le vault.
		insertBtn.addEventListener("click", () => {
			const seen = new Set();
			const openFiles = [];
			for (const leaf of ctx.app.workspace.getLeavesOfType("markdown")) {
				const f = leaf.view && leaf.view.file;
				if (f && !seen.has(f.path)) { seen.add(f.path); openFiles.push(f); }
			}
			openNotePicker(insertBtn, {
				openFiles,
				allFiles: ctx.app.vault.getMarkdownFiles(),
				onPick: (file) => insertIntoNote(file)
			});
		});

		const restartBtn = bar.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
		const restartIcon = restartBtn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(restartIcon, "rotate-ccw");
		restartBtn.createSpan({ text: "Recommencer" });
		restartBtn.addEventListener("click", () => {
			phase = "idle";
			generatedQuestions = [];
			embedEditor = null;
			composerText = "";
			noteAttachment = null;
			images = [];
			render(containerRef);
		});

		// ── L'ÉDITEUR COMPLET, embarqué pleine page (composer en bas) ──
		const host = container.createDiv({ cls: "qbd-ai-editor-embed qb-root" });
		mountEmbedEditor(host);
	}

	/* Monte l'éditeur de quiz complet dans `host` (zone résultat pleine
	   page). L'instance survit aux re-renders de la page : les questions en
	   cours d'édition sont reprises tant que la génération n'a pas changé. */
	function mountEmbedEditor(host) {
		const { attachQuizEditorCore } = require("../editor");
		const prev = embedEditor;
		const inst = attachQuizEditorCore({}, host, ctx.app, ctx.plugin);
		inst.buildUI();
		if (prev && prev._genId === generationId) {
			// Re-render de la page → reprendre l'édition en cours, en place.
			inst.questions.length = 0;
			prev.questions.forEach(q => inst.questions.push(q));
			Object.assign(inst.examOptions, prev.examOptions);
			inst.render();
		} else {
			inst.render();
			const JSON5 = require("json5");
			// silent : pas de Notice d'import à chaque montage. Pas de
			// sourceFile → aucune sauvegarde automatique vers une note.
			inst.importQuizSource(JSON5.stringify(generatedQuestions, null, 2), null, { silent: true });
		}
		inst._genId = generationId;
		embedEditor = inst;
	}

	function updateGenerateBtn(btn) {
		if (!btn) return;
		// Le bouton d'envoi n'apparaît qu'avec du contenu (texte/image/note),
		// et reste désactivé tant que la génération n'est pas possible
		// (aucun fournisseur configuré). Pendant la génération il devient le
		// bouton stop → toujours visible et cliquable.
		const loading = phase === "loading";
		const hasContent = !!(composerText.trim() || images.length > 0 || noteAttachment);
		const canGen = canGenerate();
		btn.classList.toggle("is-visible", hasContent || loading);
		btn.disabled = loading ? false : !canGen;
		btn.classList.toggle("qbd-ai-composer-send--disabled", !loading && !canGen);
	}

	/* Tooltip du bouton stop (référence Claude Code : « Arrêter  Esc »),
	   au survol uniquement. */
	function attachStopTip(btn) {
		let tip = null;
		const hide = () => { if (tip) { tip.remove(); tip = null; } };
		btn.addEventListener("mouseenter", () => {
			if (tip) return;
			tip = document.body.createDiv({ cls: "qbd-hover-tip" });
			const row = tip.createDiv({ cls: "qbd-hover-tip-row" });
			row.createSpan({ cls: "qbd-hover-tip-title", text: "Arrêter" });
			row.createSpan({ cls: "qbd-hover-tip-esc", text: "Esc" });
			const r = btn.getBoundingClientRect();
			tip.style.visibility = "hidden";
			const tr = tip.getBoundingClientRect();
			const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
			let top = r.top - tr.height - 8;
			if (top < 8) top = r.bottom + 8;
			tip.style.left = left + "px";
			tip.style.top = top + "px";
			tip.style.visibility = "";
		});
		btn.addEventListener("mouseleave", hide);
		btn.addEventListener("click", hide);
	}

	async function startGeneration(container) {
		phase = "loading";
		errorMessage = "";
		render(container);

		const aiClient = require("./ai-client");
		const client = aiClient(ctx.plugin);
		activeClient = client;
		// Esc annule la génération (référence : tooltip « Arrêter  Esc »)
		const onEsc = (e) => {
			if (e.key === "Escape") { e.preventDefault(); client.abort(); }
		};
		document.addEventListener("keydown", onEsc);

		try {

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
			if (err && err.aborted) {
				// Annulation volontaire (bouton stop / Esc) → retour à l'état
				// initial, sans écran d'erreur.
				document.removeEventListener("keydown", onEsc);
				activeClient = null;
				generatedQuestions = [];
				phase = "idle";
				render(container);
				return;
			}
			errorMessage = err.message || "Vérifiez vos paramètres IA dans les paramètres du plugin.";
			generatedQuestions = [];
		}

		document.removeEventListener("keydown", onEsc);
		activeClient = null;
		if (generatedQuestions.length > 0) {
			// Nouvelle génération → l'éditeur embarqué repart des questions
			// fraîches (renderResult le monte pleine page).
			generationId++;
			embedEditor = null;
			phase = "result";
		} else {
			phase = "error";
		}
		render(container);
	}

	/* Insère le quiz dans la note choisie via le picker (« Insérer dans une
	   note »). L'état ÉDITÉ de l'éditeur embarqué prime sur les questions
	   générées brutes (les retouches faites dans l'éditeur sont insérées). */
	async function insertIntoNote(file) {
		if (!file) return;
		let quizJson;
		if (embedEditor && embedEditor.questions.length) {
			const { exportAll } = require("../editor/export");
			quizJson = exportAll(embedEditor.questions, embedEditor.examOptions);
		} else if (generatedQuestions.length) {
			quizJson = require("json5").stringify(generatedQuestions, null, 2);
		} else {
			return;
		}

		try {
			let content = await ctx.app.vault.read(file);

			const quizBlock = "```quiz-blocks\n" + quizJson + "\n```";

			// Vérifier s'il y a déjà un bloc quiz-blocks
			if (content.includes("```quiz-blocks")) {
				new obsidian.Notice("Un bloc quiz-blocks existe déjà dans « " + file.basename + " ». Ouvrez l'éditeur pour le modifier.");
				return;
			}

			content += "\n\n" + quizBlock;
			await ctx.app.vault.modify(file, content);
			new obsidian.Notice("Quiz inséré dans « " + file.basename + " »");
		} catch (err) {
			new obsidian.Notice("Erreur lors de l'insertion");
		}
	}

	return { render };
}

const obsidian = require("obsidian");
module.exports = createAiHandlers;