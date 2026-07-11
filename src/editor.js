'use strict';

const obsidian = require("obsidian");
const { parseQuizSource } = require("./quiz-utils");
const { Q_TYPES, loadReact, _setIcon, _iconSpan, makeDefault, md2html, escHtml, esc5 } = require("./editor/utils");
const { exportQuestion, exportAll, exportAllWithFence } = require("./editor/export");
const { ConfirmModal, TypePickerModal, ImportQuizModal, QuizFileSuggestModal, ImportFromNoteModal, _htmlToText } = require("./editor/modals");

const createEditorUIHandlers = require("./editor/ui");
const createResizeHandlers = require("./editor/resize");
const createSidebarHandlers = require("./editor/sidebar");
const createEditorFormHandlers = require("./editor/editor-form");
const createPreviewHandlers = require("./editor/preview");
const createHintHandlers = require("./editor/hint");

const VIEW_TYPE = "quiz-blocks-builder";

/* ════════════════════════════════════════════════════════
   CŒUR DE L'ÉDITEUR — attachQuizEditorCore(view, host, app, plugin)
   Assemble l'état, le ctx et les handlers de l'éditeur sur `view`,
   avec le DOM monté dans `host`. Utilisé par la vue onglet
   (QuizBuilderView) ET par l'éditeur EMBARQUÉ dans la page Générer
   du dashboard (`view` y est un simple objet, sans leaf).
   ════════════════════════════════════════════════════════ */
function attachQuizEditorCore(view, host, app, plugin) {
	view.app = view.app || app;
	view.plugin = plugin;
	// Les handlers (ui.js…) lisent view.contentEl : pour la vue onglet c'est
	// le contentEl de l'ItemView, pour l'embed c'est le host fourni.
	view.contentEl = view.contentEl || host;
	view.questions = [Object.assign(makeDefault("single"), { title: "Question 1" })];
	view.activeIdx = 0;
	view.panels = { sidebar: true, editor: true, preview: true, code: false };
	view._previewDebounce = 0;
	view.examOptions = {
		enabled: false,
		durationMinutes: 10,
		autoSubmit: true,
		showTimer: true
	};
	view.activeEditorTab = 'content';
	view.sourceFile = null; // Fichier source ouvert en mode édition directe
	view._saveDebounce = 0; // Timer pour sauvegarde automatique

	view._savedWidths = {
		sidebar: 320,
		editor: 480,
		preview: 304,
		code: 288
	};
	view._minPanelWidth = 50;
	view._hideThreshold = 10;

	// Créer le contexte partagé (ctx) pour injection de dépendances
	const ctx = {
		view,
		app: view.app,
		plugin: plugin,
		container: host,

		questions: view.questions,
		activeIdx: view.activeIdx,
		panels: view.panels,
		examOptions: view.examOptions,
		activeEditorTab: view.activeEditorTab,
		_savedWidths: view._savedWidths,
		_minPanelWidth: view._minPanelWidth,
		_hideThreshold: view._hideThreshold,
		_previewDebounce: view._previewDebounce,

		get activeQuestion() { return ctx.questions[ctx.activeIdx]; },
		set activeQuestion(v) { ctx.questions[ctx.activeIdx] = v; },

		Q_TYPES,
		loadReact,
		_setIcon,
		_iconSpan,
		makeDefault,
		md2html,
		escHtml,
		esc5,
		exportQuestion,
		exportAll,
		exportAllWithFence,
		parseQuizSource,
		ConfirmModal,
		TypePickerModal,
		ImportQuizModal,
		QuizFileSuggestModal,
		ImportFromNoteModal,
		VIEW_TYPE
	};

	// Initialiser les handlers
	const ui = createEditorUIHandlers(ctx);
	const resize = createResizeHandlers(ctx);
	const sidebar = createSidebarHandlers(ctx);
	const editorForm = createEditorFormHandlers(ctx);
	const preview = createPreviewHandlers(ctx);
	const hint = createHintHandlers(ctx);

	// Attacher les modules au ctx
	Object.assign(ctx, {
		ui,
		resize,
		sidebar,
		editorForm,
		preview,
		hint
	});

	// Exposer les méthodes sur l'instance
	view.buildUI = ui.buildUI.bind(ui);
	view.syncPanels = ui.syncPanels.bind(ui);
	view.render = ui.render.bind(ui);
	view.showTypeModal = ui.showTypeModal.bind(ui);

	view._setupResizer = resize._setupResizer.bind(resize);
	view._closeLeftPanel = resize._closeLeftPanel.bind(resize);
	view._closeRightPanel = resize._closeRightPanel.bind(resize);
	view._resizePanels = resize._resizePanels.bind(resize);

	view.renderSidebar = sidebar.renderSidebar.bind(sidebar);
	view.moveQuestion = sidebar.moveQuestion.bind(sidebar);
	view.deleteQuestion = sidebar.deleteQuestion.bind(sidebar);

	view.renderEditor = editorForm.renderEditor.bind(editorForm);
	view._field = editorForm._field.bind(editorForm);
	view._resourceSection = editorForm._resourceSection.bind(editorForm);
	view._renderTypeFields = editorForm._renderTypeFields.bind(editorForm);
	view._arrayEditor = editorForm._arrayEditor.bind(editorForm);

	view.schedulePreview = preview.schedulePreview.bind(preview);
	view.renderPreview = preview.renderPreview.bind(preview);
	view._resolveImagesInHtml = preview._resolveImagesInHtml.bind(preview);
	view.renderCode = preview.renderCode.bind(preview);

	view._ensureHintOverlay = hint._ensureHintOverlay.bind(hint);
	view._applyHintTheme = hint._applyHintTheme.bind(hint);
	view._openHint = hint._openHint.bind(hint);
	view._closeHint = hint._closeHint.bind(hint);
	view._addHintEscHandler = hint._addHintEscHandler.bind(hint);
	view._removeHintEscHandler = hint._removeHintEscHandler.bind(hint);

	// Sauvegarder ctx sur l'instance
	view._ctx = ctx;

	// ── Méthodes partagées (vue onglet + éditeur embarqué) ──

	view.importQuizSource = async function (source, fileName = null, opts = {}) {
		try {
			const parsed = parseQuizSource(source);
			if (!Array.isArray(parsed) || parsed.length === 0) {
				new obsidian.Notice("Aucune question trouvée");
				return;
			}

			const questions = [];
			let examOptions = null;

			for (const q of parsed) {
				if (q.examMode) {
					examOptions = {
						enabled: true,
						durationMinutes: q.examDurationMinutes || 10,
						autoSubmit: q.examAutoSubmit ?? false,
						showTimer: q.examShowTimer ?? true
					};
					continue;
				}

				const question = view.convertParsedToInternal(q);
				if (question) questions.push(question);
			}

			if (questions.length === 0) {
				new obsidian.Notice("Aucune question valide trouvée");
				return;
			}

			// Stocker le nom du fichier importé
			view.importedFileName = fileName;

			// Mettre à jour le tableau en place pour que ctx.questions reste synchronisé
			view.questions.length = 0;
			questions.forEach(q => view.questions.push(q));
			view.activeIdx = 0;
			if (view._ctx) view._ctx.activeIdx = 0;  // Sync ctx.activeIdx
			if (examOptions) {
				Object.assign(view.examOptions, examOptions);
				// Mettre à jour l'UI de l'examen si la fonction existe
				if (view.updateExamUIState) view.updateExamUIState();
			}

			// Mettre à jour le nom du fichier affiché dans l'UI
			if (view._fileNameEl) {
				view._fileNameEl.textContent = fileName || "quiz-blocks";
				view._fileNameEl.classList.toggle("has-file", !!fileName);
			}

			// Rafraîchir le titre de l'onglet
			if (view.leaf && view.sourceFile) {
				// Mettre à jour getDisplayText pour retourner le nom du fichier
				view.getDisplayText = () => view.sourceFile.basename;

				// Forcer le rafraîchissement via updateHeader (méthode interne)
				if (view.leaf.updateHeader) {
					view.leaf.updateHeader();
				}

				// Déclencher un événement pour forcer le rafraîchissement
				view.app.workspace.trigger('layout-change');
			}

			view.render();
			if (!opts.silent) {
				new obsidian.Notice(`${questions.length} question(s) importée(s)${fileName ? " depuis " + fileName : ""}`);
			}
		} catch (err) {
			console.error("Import error:", err);
			new obsidian.Notice("Erreur lors de l'import: " + err.message);
		}
	};

	view.openQuizFile = async function (file, source) {
		// Stocker le fichier source pour sauvegarde automatique
		view.sourceFile = file;
		await view.importQuizSource(source, file.name);
	};

	view.saveToSourceFile = async function () {
		if (!view.sourceFile) return;

		try {
			// Lire le contenu actuel du fichier
			const content = await view.app.vault.read(view.sourceFile);

			// Générer le nouveau contenu du quiz (SANS les fences)
			const { exportAll } = require("./editor/export");
			const newQuizJson = exportAll(view.questions, view.examOptions);

			// Valider que le JSON5 généré est correct avant de sauvegarder
			try {
				const { parseQuizSource } = require("./quiz-utils");
				parseQuizSource(newQuizJson);
			} catch (parseErr) {
				console.error("[Quiz Blocks] JSON5 invalide généré:", parseErr);
				new obsidian.Notice("Erreur: le quiz généré n'est pas valide.");
				return;
			}

			// Reconstruire le bloc complet avec les fences
			const newQuizBlock = "```quiz-blocks\n" + newQuizJson + "\n```";

			// Remplacer le bloc quiz-blocks dans le fichier
			const quizBlockRegex = /```quiz-blocks[\s\S]*?```/;
			if (!quizBlockRegex.test(content)) {
				console.error("[Quiz Blocks] Aucun bloc quiz-blocks trouvé dans le fichier");
				new obsidian.Notice("Erreur: bloc quiz-blocks introuvable");
				return;
			}

			const updatedContent = content.replace(quizBlockRegex, newQuizBlock);

			// Sauvegarder si le contenu a changé
			if (updatedContent !== content) {
				await view.app.vault.modify(view.sourceFile, updatedContent);
				view.updateSaveIndicator?.(true);
			}
		} catch (err) {
			console.error("[Quiz Blocks] Save error:", err);
			new obsidian.Notice("Erreur lors de la sauvegarde: " + err.message);
		}
	};

	view.scheduleSave = function () {
		if (!view.sourceFile) return;
		if (view._saveDebounce) clearTimeout(view._saveDebounce);
		view._saveDebounce = setTimeout(() => view.saveToSourceFile(), 1000);
		// Mettre à jour l'indicateur de sauvegarde
		view.updateSaveIndicator?.(false);
	};

	view.convertParsedToInternal = function (q) {
		let type = "single";
		if (q.ordering) type = "ordering";
		else if (q.matching) type = "matching";
		else if (q.multiSelect) type = "multi";
		else if (q.type === "text") {
			if (q.terminalVariant === "cmd") type = "cmd";
			else if (q.textVariant === "powershell") type = "powershell";
			else if (q.textVariant === "bash") type = "bash";
			else type = "text";
		}

		const question = makeDefault(type);
		question._id = q.id || Math.random().toString(36).slice(2, 10);
		question.title = q.title || "";
		question._userModifiedTitle = !/^Question \d+$/.test(question.title);
		question.hint = q.hint || "";

		if (q.prompt) {
			question.prompt = q.prompt;
		} else if (q.promptHtml) {
			question.prompt = _htmlToText(q.promptHtml);
		}
		if (q.promptHtml) {
			question._promptHtml = q.promptHtml;
			// Si promptHtml existe, activer par défaut l'édition HTML
			question._useHtmlPrompt = true;
		}

		if (q.explain) question.explain = q.explain;
		else if (q.explainHtml) {
			question.explain = _htmlToText(q.explainHtml);
		}
		if (q.explainHtml) {
			question._explainHtml = q.explainHtml;
		}

		if (q.resourceButton) {
			question.resourceButton = { ...q.resourceButton };
		}

		if (type === "single" || type === "multi") {
			question.options = q.options || ["", ""];
			if (type === "single") {
				question.correctIndex = q.correctIndex ?? 0;
			} else {
				question.correctIndices = q.correctIndices || [];
			}
		}

		if (type === "ordering") {
			question.slots = q.slots || ["Étape 1", "Étape 2"];
			question.possibilities = q.possibilities || ["", ""];
			question.correctOrder = q.correctOrder || [0, 1];
		}

		if (type === "matching") {
			question.rows = q.rows || ["", ""];
			question.choices = q.choices || ["", ""];
			question.correctMap = q.correctMap || [0, 0];
		}

		if (["text", "cmd", "powershell", "bash"].includes(type)) {
			question.acceptedAnswers = (q.acceptedAnswers || q.acceptableAnswers || [""]).slice();
			// `answer`/`correctText` : formats émis par la génération IA et
			// UNIONNÉS aux acceptedAnswers par le moteur (terminal.js:166-170)
			// — les fusionner pareil ici, sinon le round-trip éditeur→export
			// PERD une réponse valide (answer est dans knownKeys, donc plus
			// réémis via _extraFields). String/number seulement (le moteur
			// ignore les autres types) ; `!= null` : answer 0 est légitime.
			for (const extra of [q.correctText, q.answer]) {
				if (extra == null) continue;
				if (typeof extra !== "string" && typeof extra !== "number") continue;
				const v = String(extra);
				if (question.acceptedAnswers.length === 1 && question.acceptedAnswers[0] === "") {
					question.acceptedAnswers = [v];
				} else if (!question.acceptedAnswers.includes(v)) {
					question.acceptedAnswers.push(v);
				}
			}
			question.caseSensitive = q.caseSensitive || false;
			question.placeholder = q.placeholder || "";
			if (type === "cmd" || type === "powershell") {
				question.commandPrefix = q.commandPrefix || (type === "cmd" ? "C:\\>" : "PS>");
			}
		}

		const knownKeys = new Set(['id','title','prompt','promptHtml','options','correctIndex','multiSelect','correctIndices','ordering','slots','possibilities','correctOrder','matching','rows','choices','correctMap','type','terminalVariant','textVariant','commandPrefix','placeholder','caseSensitive','acceptedAnswers','acceptableAnswers','correctText','answer','hint','explain','explainHtml','resourceButton','examMode','examDurationMinutes','examAutoSubmit','examShowTimer']);
		question._extraFields = {};
		for (const key of Object.keys(q)) {
			if (!knownKeys.has(key)) question._extraFields[key] = q[key];
		}

		return question;
	};

	return view;
}

/* ════════════════════════════════════════════════════════
   QUIZ BUILDER VIEW
   ════════════════════════════════════════════════════════ */
class QuizBuilderView extends obsidian.ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		// Tout l'assemblage (état, ctx, handlers, méthodes) est partagé avec
		// l'éditeur embarqué du dashboard via attachQuizEditorCore.
		attachQuizEditorCore(this, this.contentEl, this.app, plugin);
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() {
		if (this.sourceFile) {
			return this.sourceFile.basename || "Quiz Editor";
		}
		return "Quiz Editor";
	}
	getIcon() { return "graduation-cap"; }

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("qb-root");
		this.buildUI();
		this.render();
	}

	onClose() {
		this._closeHint();
		this._removeHintEscHandler();
		const overlay = document.getElementById("qb-hint-overlay");
		if (overlay) overlay.remove();
		// Cleanup any resize overlays that might be stuck
		const resizeOverlays = document.querySelectorAll('div[style*="cursor:ew-resize"]');
		resizeOverlays.forEach(el => el.remove());
		this.contentEl.empty();
	}

}

module.exports = { QuizBuilderView, VIEW_TYPE, QuizFileSuggestModal, attachQuizEditorCore };
