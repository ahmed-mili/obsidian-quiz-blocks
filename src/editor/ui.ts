import { Notice } from "obsidian";
import { TypePickerModal, OpenQuizFromNoteModal } from "./modals";
import { makeDefault } from "./utils";
import type { EditorCtx, EditorPanelsState } from "../types/editor-ctx";

type PanelKey = keyof EditorPanelsState;

/** Handlers de l'ossature UI de l'éditeur (construction, synchro des panneaux, rendu, ajout de question). */
export interface EditorUIHandlers {
	buildUI(): void;
	syncPanels(): void;
	render(): void;
	showTypeModal(): void;
}

export function createEditorUIHandlers(ctx: EditorCtx): EditorUIHandlers {
	const { _setIcon, _iconSpan, exportAllWithFence } = ctx;
	const view = ctx.view;
	view._isDirty = false;

	function buildUI(): void {
		const root = view.contentEl;
		const header = root.createDiv({ cls: "qb-header" });

		const brand = header.createDiv({ cls: "qb-brand" });
		const logo = brand.createDiv({ cls: "qb-logo" });
		_setIcon(logo, "graduation-cap");
		const brandText = brand.createDiv({ cls: "qb-title-group" });
		brandText.createDiv({ cls: "qb-title", text: "Quiz Editor" });
		view._fileNameEl = brandText.createDiv({ cls: "qb-sub qb-file-name" });
		if (view.importedFileName) {
			view._fileNameEl.textContent = view.importedFileName;
			view._fileNameEl.classList.add("has-file");
		} else {
			view._fileNameEl.textContent = "quiz-blocks";
		}

		const toggles = header.createDiv({ cls: "qb-toggles" });
		const toggleEntries: [PanelKey, string, string][] = [["sidebar", "Questions", "list"], ["editor", "Éditeur", "pencil"], ["preview", "Aperçu", "eye"], ["code", "Code", "code"]];
		for (const [key, label, lucide] of toggleEntries) {
			const btn = toggles.createEl("button", { cls: `qb-toggle ${ctx.panels[key] ? "active" : ""}` });
			btn.dataset.panel = key;
			_iconSpan(btn, lucide, "qb-toggle-icon");
			btn.createSpan({ cls: "qb-toggle-label", text: label });
			btn.addEventListener("click", () => {
				const wasVisible = ctx.panels[key];
				ctx.panels[key] = !ctx.panels[key];
				if (!Object.values(ctx.panels).some(Boolean)) ctx.panels[key] = true;

				if (!wasVisible && ctx.panels[key]) {
					const mainEl = view.contentEl.querySelector<HTMLElement>('.qb-main');
					if (mainEl) {
						mainEl.style.setProperty('--qb-sidebar-w', '320px');
						mainEl.style.setProperty('--qb-editor-w', '480px');
						mainEl.style.setProperty('--qb-code-w', '288px');
					}
				}

				syncPanels();
			});
		}

		const actions = header.createDiv({ cls: "qb-actions" });

		view._saveBtn = actions.createEl("button", { cls: "qb-btn qb-btn-primary qb-save-btn" });
		view._saveBtn.disabled = true;
		view._saveBtn.title = "Aucune modification à sauvegarder";
		_iconSpan(view._saveBtn, "save", "qb-btn-leading-icon");
		view._saveBtn.createSpan({ text: "Sauvegarder" });
		view._saveBtn.addEventListener("click", () => {
			if (!view._saveBtn.disabled) {
				view.saveToSourceFile?.();
			}
		});

		const openBtn = actions.createEl("button", { cls: "qb-btn" });
		_iconSpan(openBtn, "file-input", "qb-btn-leading-icon");
		openBtn.createSpan({ text: "Ouvrir" });
		openBtn.addEventListener("click", () => {
			new OpenQuizFromNoteModal(view.app, view).open();
		});

		view._exportBtn = actions.createEl("button", { cls: "qb-btn qb-btn-accent" });
		_iconSpan(view._exportBtn, "share", "qb-btn-leading-icon");
		view._exportBtn.createSpan({ text: "Exporter" });
		view._exportBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(exportAllWithFence(ctx.questions, ctx.examOptions)).then(() => {
				view._exportBtn.empty();
				_iconSpan(view._exportBtn, "check", "qb-btn-leading-icon");
				view._exportBtn.createSpan({ text: "Copié !" });
				view._exportBtn.classList.add("qb-btn-ok");
				setTimeout(() => {
					view._exportBtn.empty();
					_iconSpan(view._exportBtn, "share", "qb-btn-leading-icon");
					view._exportBtn.createSpan({ text: "Exporter" });
					view._exportBtn.classList.remove("qb-btn-ok");
				}, 2000);
			});
		});

		const main = root.createDiv({ cls: "qb-main" });

		if (!main.style.getPropertyValue('--qb-sidebar-w')) {
			main.style.setProperty('--qb-sidebar-w', '320px');
			main.style.setProperty('--qb-editor-w', '480px');
			main.style.setProperty('--qb-code-w', '288px');
		}

		view.sidebarEl = main.createDiv({ cls: "qb-panel qb-sidebar" });
		view.resizerSidebarEditor = main.createDiv({ cls: "qb-resizer" });
		view.resizerSidebarEditor.dataset.resizer = "sidebar-editor";

		view.editorEl = main.createDiv({ cls: "qb-panel qb-editor" });

		// Resizer entre editor et code (visible quand preview est masqué)
		view.resizerEditorCode = main.createDiv({ cls: "qb-resizer" });
		view.resizerEditorCode.dataset.resizer = "editor-code";

		view.resizerEditorPreview = main.createDiv({ cls: "qb-resizer" });
		view.resizerEditorPreview.dataset.resizer = "editor-preview";

		view.previewEl = main.createDiv({ cls: "qb-panel qb-preview" });
		view.resizerPreviewCode = main.createDiv({ cls: "qb-resizer" });
		view.resizerPreviewCode.dataset.resizer = "preview-code";

		view.codeEl = main.createDiv({ cls: "qb-panel qb-code" });

		// Resizer à droite de code (pour resize libre)
		view.resizerCodeRight = main.createDiv({ cls: "qb-resizer" });
		view.resizerCodeRight.dataset.resizer = "code-right";

		view._setupResizer(view.resizerSidebarEditor, view.sidebarEl, view.editorEl, 'sidebar-editor');
		view._setupResizer(view.resizerEditorCode, view.editorEl, view.codeEl, 'editor-code');
		view._setupResizer(view.resizerEditorPreview, view.editorEl, view.previewEl, 'editor-preview');
		view._setupResizer(view.resizerPreviewCode, view.previewEl, view.codeEl, 'preview-code');
		view._setupResizer(view.resizerCodeRight, view.codeEl, view.editorEl, 'code-right');

		const sHead = view.sidebarEl.createDiv({ cls: "qb-sidebar-head" });
		view.qCountEl = sHead.createSpan({ text: "Questions (1)" });
		const addBtn = sHead.createEl("button", { cls: "qb-btn-icon" });
		_setIcon(addBtn, "plus");
		addBtn.addEventListener("click", () => showTypeModal());
		view.sidebarListEl = view.sidebarEl.createDiv({ cls: "qb-sidebar-list" });

		const examSection = view.sidebarEl.createEl("details", {
			cls: "qb-section-collapsible" + (ctx.examOptions.enabled ? "" : " qb-section-locked"),
			attr: ctx.examOptions.enabled ? { open: "" } : {}
		});
		const examSummary = examSection.createEl("summary", { cls: "qb-section-header" });
		// NB : _setIcon ne prend que (el, name) ; le 3e argument "qb-summary-icon"
		// de l'ancien code JS était ignoré à l'exécution (aucune classe appliquée).
		ctx._setIcon(examSummary, "graduation-cap");
		const examSummaryText = examSummary.createSpan({ text: "Mode Examen", cls: "qb-resource-summary-text" });

		const examToggle = examSummary.createEl("button", { cls: "qb-resource-toggle-btn", attr: { type: "button", title: ctx.examOptions.enabled ? "Désactiver" : "Activer" } });
		examToggle.createSpan({ cls: "qb-resource-toggle-dot" + (ctx.examOptions.enabled ? " is-on" : "") });
		examToggle.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			ctx.examOptions.enabled = !ctx.examOptions.enabled;
			updateExamUIState();
			view.renderCode();
			if (view.updateSaveIndicator) view.updateSaveIndicator(false);
			view._isDirty = true;

			if (ctx.examOptions.enabled) {
				examSection.setAttribute("open", "");
				examSection.classList.remove("qb-section-locked");
			} else {
				examSection.removeAttribute("open");
				examSection.classList.add("qb-section-locked");
			}
		});

		const examBody = examSection.createDiv({ cls: "qb-section-content" });
		const examOptionsContainer = examBody.createDiv({ cls: "qb-exam-options" });

		function updateExamUIState(): void {
			examToggle.title = ctx.examOptions.enabled ? "Désactiver" : "Activer";
			const dot = examToggle.querySelector(".qb-resource-toggle-dot");
			if (dot) {
				dot.className = "qb-resource-toggle-dot" + (ctx.examOptions.enabled ? " is-on" : "");
			}
			examSummaryText.textContent = "Mode Examen";
			durationInput.disabled = !ctx.examOptions.enabled;
			autoSubmitCb.disabled = !ctx.examOptions.enabled;
			showTimerCb.disabled = !ctx.examOptions.enabled;
			examOptionsContainer.classList.toggle("qb-exam-disabled", !ctx.examOptions.enabled);
			durationInput.value = String(ctx.examOptions.durationMinutes);
			autoSubmitCb.checked = ctx.examOptions.autoSubmit;
			showTimerCb.checked = ctx.examOptions.showTimer;
			if (ctx.examOptions.enabled) {
				examSection.setAttribute("open", "");
				examSection.classList.remove("qb-section-locked");
			} else {
				examSection.removeAttribute("open");
				examSection.classList.add("qb-section-locked");
			}
		}

		view.updateExamUIState = updateExamUIState;

		const durationWrap = examOptionsContainer.createDiv({ cls: "qb-field qb-field-group" });
		durationWrap.createEl("label", { cls: "qb-field-label", text: "Durée" });
		const inputContainer = durationWrap.createDiv({ cls: "qb-input-group" });
		const durationInput = inputContainer.createEl("input", {
			cls: "qb-field-input",
			type: "number",
			min: "1",
			max: "180",
			value: String(ctx.examOptions.durationMinutes),
			disabled: !ctx.examOptions.enabled
		} as DomElementInfo);
		inputContainer.createSpan({ text: "min", cls: "qb-field-unit" });
		durationInput.addEventListener("input", () => {
			ctx.examOptions.durationMinutes = Math.max(1, Math.min(180, parseInt(durationInput.value) || 10));
			view.renderCode();
			view._isDirty = true;
			if (view.updateSaveIndicator) view.updateSaveIndicator(false);
		});

		const autoSubmitWrap = examOptionsContainer.createEl("label", { cls: "qb-checkbox-wrap" });
		const autoSubmitCb = autoSubmitWrap.createEl("input", {
			type: "checkbox",
			checked: ctx.examOptions.autoSubmit,
			disabled: !ctx.examOptions.enabled
		} as DomElementInfo);
		autoSubmitWrap.createSpan({ text: " Soumettre auto à la fin", cls: "qb-checkbox-label" });
		autoSubmitCb.addEventListener("change", () => {
			ctx.examOptions.autoSubmit = autoSubmitCb.checked;
			view.renderCode();
			view._isDirty = true;
			if (view.updateSaveIndicator) view.updateSaveIndicator(false);
		});

		const showTimerWrap = examOptionsContainer.createEl("label", { cls: "qb-checkbox-wrap" });
		const showTimerCb = showTimerWrap.createEl("input", {
			type: "checkbox",
			checked: ctx.examOptions.showTimer,
			disabled: !ctx.examOptions.enabled
		} as DomElementInfo);
		showTimerWrap.createSpan({ text: " Afficher le timer", cls: "qb-checkbox-label" });
		showTimerCb.addEventListener("change", () => {
			ctx.examOptions.showTimer = showTimerCb.checked;
			view.renderCode();
			view._isDirty = true;
			if (view.updateSaveIndicator) view.updateSaveIndicator(false);
		});

		view.renderSidebar();

		const pHead = view.previewEl.createDiv({ cls: "qb-panel-head" });
		_iconSpan(pHead, "eye", "qb-panel-head-icon");
		view.previewTitleEl = pHead.createSpan({ text: "Aperçu" });
		view.previewBodyEl = view.previewEl.createDiv({ cls: "qb-preview-body" });

		const cHead = view.codeEl.createDiv({ cls: "qb-panel-head" });
		_iconSpan(cHead, "code", "qb-panel-head-icon");
		cHead.createSpan({ text: "JSON5 généré" });
		const copyBtn = cHead.createEl("button", { cls: "qb-btn qb-btn-accent qb-btn-sm" });
		_iconSpan(copyBtn, "clipboard-copy", "qb-btn-leading-icon");
		copyBtn.createSpan({ text: "Copier" });
		copyBtn.addEventListener("click", () => navigator.clipboard.writeText(exportAllWithFence(ctx.questions, ctx.examOptions)));
		view.codeOutputEl = view.codeEl.createDiv({ cls: "qb-code-output" });

		view.editorInnerEl = view.editorEl.createDiv({ cls: "qb-editor-inner" });

		view.updateSaveIndicator = (saved: boolean) => {
			if (!view.sourceFile) {
				view._saveBtn.disabled = true;
				view._saveBtn.title = "Ouvrez un fichier pour sauvegarder";
				return;
			}
			if (saved) {
				view._saveBtn.disabled = true;
				view._saveBtn.title = "Toutes les modifications sont sauvegardées";
				new Notice("✓ Sauvegardé", 2000);
			} else {
				view._saveBtn.disabled = false;
				view._saveBtn.title = "Cliquez pour sauvegarder les modifications";
			}
		};

		syncPanels();

		setInterval(() => {
			if (view._isDirty) {
				view.saveToSourceFile?.();
				view._isDirty = false;
			}
		}, 1000);
	}

	function syncPanels(): void {
		const mainEl = view.contentEl.querySelector<HTMLElement>('.qb-main');
		const map: Record<PanelKey, HTMLElement> = { sidebar: view.sidebarEl, editor: view.editorEl, preview: view.previewEl, code: view.codeEl };
		const defaultWidths = { sidebar: '320px', editor: '352px', code: '288px' };
		if (ctx.panels.preview && mainEl) {
			const editorWidth = mainEl.style.getPropertyValue('--qb-editor-w');
			if (editorWidth === 'auto') mainEl.style.setProperty('--qb-editor-w', defaultWidths.editor);
			const codeWidth = mainEl.style.getPropertyValue('--qb-code-w');
			if (codeWidth === 'auto') mainEl.style.setProperty('--qb-code-w', defaultWidths.code);
		}
		for (const [k, el] of Object.entries(map)) {
			if (!el) continue;
			el.toggleClass("qb-hidden", !ctx.panels[k as PanelKey]);
		}
		if (mainEl) {
			const mainRect = mainEl.getBoundingClientRect();
			let fixedWidthSum = 0;
			if (ctx.panels.sidebar) fixedWidthSum += parseFloat(mainEl.style.getPropertyValue('--qb-sidebar-w') || '320');
			if (ctx.panels.editor) fixedWidthSum += parseFloat(mainEl.style.getPropertyValue('--qb-editor-w') || '480');
			if (ctx.panels.code) fixedWidthSum += parseFloat(mainEl.style.getPropertyValue('--qb-code-w') || '288');
			if (fixedWidthSum > mainRect.width * 0.7) {
				mainEl.style.setProperty('--qb-sidebar-w', '320px');
				mainEl.style.setProperty('--qb-editor-w', '480px');
				mainEl.style.setProperty('--qb-code-w', '288px');
			}
		}
		view.contentEl.querySelectorAll<HTMLElement>(".qb-toggle").forEach(btn => btn.toggleClass("active", !!ctx.panels[btn.dataset.panel as PanelKey]));
		if (view.resizerSidebarEditor) {
			const showSidebarEditor = ctx.panels.sidebar && ctx.panels.editor;
			view.resizerSidebarEditor.toggleClass("qb-hidden", !showSidebarEditor);
		}
		if (view.resizerEditorPreview) {
			const showEditorPreview = ctx.panels.editor && ctx.panels.preview;
			view.resizerEditorPreview.toggleClass("qb-hidden", !showEditorPreview);
		}
		if (view.resizerPreviewCode) {
			// Visible seulement quand preview et code sont tous deux actifs
			const showPreviewCode = ctx.panels.preview && ctx.panels.code;
			view.resizerPreviewCode.toggleClass("qb-hidden", !showPreviewCode);
		}
		if (view.resizerEditorCode) {
			// Visible quand editor et code sont actifs mais preview est masqué
			const showEditorCode = ctx.panels.editor && ctx.panels.code && !ctx.panels.preview;
			view.resizerEditorCode.toggleClass("qb-hidden", !showEditorCode);
		}
		if (view.resizerCodeRight) {
			// Visible quand code est actif et qu'il y a un panel à gauche pour resize
			const showCodeRight = ctx.panels.code && (ctx.panels.editor || ctx.panels.preview);
			view.resizerCodeRight.toggleClass("qb-hidden", !showCodeRight);
		}
	}

	function render(): void {
		view.renderSidebar();
		view.renderEditor();
		view.schedulePreview();
		view.renderCode();
		syncPanels();
	}

	function showTypeModal(): void {
		const modal = new TypePickerModal(view.app, type => {
			const nq = makeDefault(type);
			nq.title = `Question ${ctx.questions.length + 1}`;
			ctx.questions.push(nq);
			ctx.activeIdx = ctx.questions.length - 1;
			view.render();
		});
		modal.open();
	}

	return { buildUI, syncPanels, render, showTypeModal };
}
