/**
 * Interface du ctx (god-object) du sous-système éditeur (src/editor.js,
 * fonction attachQuizEditorCore, lignes 25-143).
 *
 * `attachQuizEditorCore(view, host, app, plugin)` construit un littéral `ctx`
 * (editor.js:55-92), lui greffe 6 sous-modules via `Object.assign` (editor.js:
 * 94-110), puis recopie ~35 méthodes liées (`.bind()`) sur `view` (editor.js:
 * 113-143 + les 5 méthodes partagées `view.xxx = async function…`,
 * editor.js:150-378). Ce fichier type le ctx lui-même : l'état de base, le
 * getter/setter `activeQuestion`, les utilitaires greffés et les 6 sous-modules
 * (désormais typés — Task 6a a converti editor/*.js en .ts). `EditorHostView`
 * ci-dessous porte le socle d'état garanti par attachQuizEditorCore ainsi que
 * les méthodes aplaties effectivement lues via `view` par les modules convertis
 * en Task 6a. Les méthodes aplaties restantes (buildUI, moveQuestion, _field,
 * showTypeModal, renderPreview, _close*Panel, _ensureHintOverlay…) et la classe
 * QuizBuilderView seront ajoutées en Task 6b, à la conversion de editor.js.
 */

import type { App, Plugin, TFile } from "obsidian";
import type { ExamOptions } from "./quiz";
import type { parseQuizSource } from "../quiz-utils";
import type * as EditorUtils from "../editor/utils";
import type * as EditorExport from "../editor/export";
import type { DraftQuestion } from "../editor/utils";

// ── Handler-types réels des 6 sous-modules editor/* (convertis en Task 6a) ──
import type { EditorUIHandlers } from "../editor/ui";
import type { ResizeHandlers } from "../editor/resize";
import type { SidebarHandlers } from "../editor/sidebar";
import type { EditorFormHandlers } from "../editor/editor-form";
import type { PreviewHandlers } from "../editor/preview";
import type { HintHandlers } from "../editor/hint";

// ── Classes de modale (editor/modals.ts, converti en Task 6a) ──
import type { ConfirmModal, TypePickerModal, ImportQuizModal, QuizFileSuggestModal, ImportFromNoteModal } from "../editor/modals";

/* ════════════════════════════════════════════════════════
   Types d'état dérivés de l'assemblage réel (editor.js)
   ════════════════════════════════════════════════════════ */

/**
 * Options d'examen ÉDITEUR (view.examOptions / ctx.examOptions, editor.js:
 * 35-40, lues/écrites dans editor/ui.ts et editor/export.ts). Sur-ensemble de
 * `ExamOptions` (types/quiz.ts) : ce dernier modélise les options ACTIVES
 * telles que lues par le moteur une fois l'examen construit (quiz-utils.ts
 * extractExamOptions) — il n'a pas de champ `enabled` car sa seule présence
 * (non-null) vaut activation. Le FORMULAIRE éditeur, lui, existe même quand
 * l'examen est désactivé et garde donc un toggle `enabled` explicite en plus
 * des 3 champs de `ExamOptions`.
 */
export interface EditorExamOptions extends ExamOptions {
	enabled: boolean;
}

/** Visibilité des 4 panneaux de l'éditeur (view.panels, editor.js:33). */
export interface EditorPanelsState {
	sidebar: boolean;
	editor: boolean;
	preview: boolean;
	code: boolean;
}

/** Largeurs sauvegardées des panneaux redimensionnables (view._savedWidths, editor.js:45-50). */
export interface EditorPanelWidths {
	sidebar: number;
	editor: number;
	preview: number;
	code: number;
}

/* ════════════════════════════════════════════════════════
   Hôte de l'éditeur (`view`) — socle garanti par attachQuizEditorCore
   + méthodes aplaties lues par les modules editor/* (Task 6a)
   ════════════════════════════════════════════════════════ */

/**
 * `view`, l'hôte sur lequel attachQuizEditorCore greffe l'état et les
 * méthodes de l'éditeur. Selon le contexte d'appel (editor.js:19-23) c'est
 * SOIT une vraie `ItemView` (QuizBuilderView, onglet dédié — editor.js:
 * 386-392, qui étend `obsidian.ItemView`), SOIT un simple objet sans `leaf`
 * (éditeur embarqué dans la page "Générer" du dashboard). D'où un type
 * dédié plutôt que `ItemView` strict : seuls les champs effectivement
 * assignés par attachQuizEditorCore (et les méthodes aplaties lues par les
 * sous-modules) sont modélisés ici. Les méthodes aplaties non encore lues par
 * un module converti (buildUI, moveQuestion, _field, renderPreview, etc.) et
 * les champs propres à la vue onglet (leaf, getDisplayText…) restent à AJOUTER
 * EN TASK 6b, à la conversion de editor.js.
 */
export interface EditorHostView {
	app: App;
	plugin: Plugin;
	/** contentEl du ItemView réel, ou `host` fourni tel quel pour l'éditeur embarqué (editor.js:30). */
	contentEl: HTMLElement;
	questions: DraftQuestion[];
	activeIdx: number;
	panels: EditorPanelsState;
	examOptions: EditorExamOptions;
	/** Onglet actif du panneau éditeur ; seule la valeur "content" est assignée aujourd'hui (editor.js:41). */
	activeEditorTab: string;
	/**
	 * Fichier source ouvert en édition directe, ou `null` (editor.js:42, 227).
	 * Assigné depuis `app.workspace.getActiveFile()` (TFile | null) dans
	 * plugin.js:820-851 → view.openQuizFile(activeFile, …).
	 */
	sourceFile: TFile | null;
	_savedWidths: EditorPanelWidths;
	_minPanelWidth: number;
	_hideThreshold: number;
	_previewDebounce: number;
	/** Timer de sauvegarde automatique différée (editor.js:43, scheduleSave editor.js:276-282). */
	_saveDebounce: number;

	/** Référence au ctx sauvegardée sur l'hôte (editor.js:146, `view._ctx = ctx`). */
	_ctx?: EditorCtx;

	// ── État/champs DOM assignés par les sous-modules (editor/ui.ts) ──
	_isDirty: boolean;
	importedFileName?: string | null;
	_fileNameEl: HTMLElement;
	_saveBtn: HTMLButtonElement;
	_exportBtn: HTMLButtonElement;
	sidebarEl: HTMLElement;
	editorEl: HTMLElement;
	previewEl: HTMLElement;
	codeEl: HTMLElement;
	resizerSidebarEditor: HTMLElement;
	resizerEditorCode: HTMLElement;
	resizerEditorPreview: HTMLElement;
	resizerPreviewCode: HTMLElement;
	resizerCodeRight: HTMLElement;
	qCountEl: HTMLElement;
	sidebarListEl: HTMLElement;
	previewTitleEl: HTMLElement;
	previewBodyEl: HTMLElement;
	codeOutputEl: HTMLElement;
	editorInnerEl: HTMLElement;
	/** Handler Échap de la modale d'indice (editor/hint.ts), attaché/détaché à la volée. */
	_hintEscHandler?: ((e: KeyboardEvent) => void) | null;

	// ── Méthodes aplaties lues via `view` par les modules convertis (Task 6a) ──
	render: EditorUIHandlers["render"];
	syncPanels: EditorUIHandlers["syncPanels"];
	renderSidebar: SidebarHandlers["renderSidebar"];
	renderEditor: EditorFormHandlers["renderEditor"];
	renderCode: PreviewHandlers["renderCode"];
	schedulePreview: PreviewHandlers["schedulePreview"];
	_resolveImagesInHtml: PreviewHandlers["_resolveImagesInHtml"];
	_openHint: HintHandlers["_openHint"];
	_setupResizer: ResizeHandlers["_setupResizer"];

	// ── Méthodes partagées définies dans attachQuizEditorCore (editor.js:150-378) ──
	importQuizSource(source: string, fileName?: string | null, opts?: { silent?: boolean }): Promise<void>;
	saveToSourceFile?(): Promise<void>;
	scheduleSave?(): void;

	// ── Callbacks UI installés par editor/ui.ts (buildUI) ──
	updateExamUIState?(): void;
	updateSaveIndicator?(saved: boolean): void;
}

/* ════════════════════════════════════════════════════════
   EditorCtx — le ctx lui-même (editor.js:55-110)
   ════════════════════════════════════════════════════════ */

export interface EditorCtx {
	/** Référence à l'hôte (ItemView réel ou objet embarqué) — même objet que `view` dans attachQuizEditorCore. */
	view: EditorHostView;
	app: App;
	plugin: Plugin;
	/** `host` passé à attachQuizEditorCore ; nommé `container` dans le littéral ctx réel (editor.js:59), pas `host`. */
	container: HTMLElement;

	/**
	 * Copie de `view.questions` au moment de la construction du ctx (même
	 * référence de tableau — editor.js:61). Les objets question insérés par
	 * l'éditeur (makeDefault(), editor/utils.ts) sont des "brouillons" internes
	 * (`DraftQuestion` : discriminés par `_type`/`_id`, avec les champs
	 * d'édition `_promptHtml`/`_extraFields`…) — d'où `DraftQuestion[]` plutôt
	 * que `QuizQuestion[]` (trop strict pour l'éditeur).
	 */
	questions: DraftQuestion[];
	/**
	 * Copie PRIMITIVE de `view.activeIdx` au moment de la construction du ctx
	 * (editor.js:62) — PAS une référence live : `view.activeIdx` et
	 * `ctx.activeIdx` peuvent diverger et doivent être resynchronisés à la
	 * main (cf. editor.js:187-188, commentaire "// Sync ctx.activeIdx").
	 */
	activeIdx: number;
	/** Même référence d'objet que `view.panels` (editor.js:63). */
	panels: EditorPanelsState;
	/** Même référence d'objet que `view.examOptions` (editor.js:64). */
	examOptions: EditorExamOptions;
	/** Copie primitive de `view.activeEditorTab` au moment de la construction du ctx (editor.js:65). */
	activeEditorTab: string;
	/** Même référence d'objet que `view._savedWidths` (editor.js:66). */
	_savedWidths: EditorPanelWidths;
	_minPanelWidth: number;
	_hideThreshold: number;
	/** Copie primitive de `view._previewDebounce` au moment de la construction du ctx (editor.js:69). */
	_previewDebounce: number;

	/** Question active — `ctx.questions[ctx.activeIdx]` (getter/setter, editor.js:71-72). */
	get activeQuestion(): DraftQuestion;
	set activeQuestion(value: DraftQuestion);

	// ── Utilitaires statiques greffés sur ctx (editor.js:5, 74-81) ──
	Q_TYPES: typeof EditorUtils.Q_TYPES;
	loadReact: typeof EditorUtils.loadReact;
	_setIcon: typeof EditorUtils._setIcon;
	_iconSpan: typeof EditorUtils._iconSpan;
	makeDefault: typeof EditorUtils.makeDefault;
	md2html: typeof EditorUtils.md2html;
	escHtml: typeof EditorUtils.escHtml;
	esc5: typeof EditorUtils.esc5;

	// ── export/import — src/editor/export.ts (converti en Task 6a) ──
	exportQuestion: typeof EditorExport.exportQuestion;
	exportAll: typeof EditorExport.exportAll;
	exportAllWithFence: typeof EditorExport.exportAllWithFence;
	/** src/quiz-utils.ts (déjà converti) — parse un bloc quiz-blocks JSON5. */
	parseQuizSource: typeof parseQuizSource;

	// ── Classes de modale greffées sur ctx (editor.js:7, 86-90) ──
	ConfirmModal: typeof ConfirmModal;
	TypePickerModal: typeof TypePickerModal;
	ImportQuizModal: typeof ImportQuizModal;
	QuizFileSuggestModal: typeof QuizFileSuggestModal;
	ImportFromNoteModal: typeof ImportFromNoteModal;

	/** Identifiant du type de vue Obsidian de l'éditeur (editor.js:16, "quiz-blocks-builder"). */
	VIEW_TYPE: string;

	// ── Sous-modules greffés via Object.assign(ctx, {...}) (editor.js:94-110) ──
	// NB : le champ réel s'appelle `editorForm` (pas `form`) dans editor.js:107.
	ui: EditorUIHandlers;
	resize: ResizeHandlers;
	sidebar: SidebarHandlers;
	editorForm: EditorFormHandlers;
	preview: PreviewHandlers;
	hint: HintHandlers;
}
