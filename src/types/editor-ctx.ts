/**
 * Interface du ctx (god-object) du sous-système éditeur (src/editor.js,
 * fonction attachQuizEditorCore, lignes 25-143).
 *
 * `attachQuizEditorCore(view, host, app, plugin)` construit un littéral `ctx`
 * (editor.js:55-92), lui greffe 6 sous-modules via `Object.assign` (editor.js:
 * 94-110), puis recopie ~35 méthodes liées (`.bind()`) sur `view` (editor.js:
 * 113-143 + les 5 méthodes partagées `view.xxx = async function…`,
 * editor.js:150-378). Ce fichier type le ctx lui-même : l'état de base, le
 * getter/setter `activeQuestion`, les utilitaires greffés et les slots des 6
 * sous-modules. Il ne modélise PAS les ~35 méthodes bindées sur `view`
 * elles-mêmes (leur signature réelle vient des modules editor/*.js, encore
 * .js aujourd'hui) : `EditorHostView` ci-dessous ne porte que le socle d'état
 * garanti par attachQuizEditorCore ; Task 6 y ajoutera buildUI/render/
 * renderSidebar/etc. au fil de la conversion de chaque module editor/*.
 *
 * Fichier isolé (aucun runtime touché) — base pour Task 6, qui convertira les
 * modules editor/*.js en .ts et branchera les vrais handler-types en lieu et
 * place des placeholders déclarés ici.
 */

import type { App, Plugin, TFile } from "obsidian";
import type { QuizQuestion, ExamOptions } from "./quiz";
import type { parseQuizSource } from "../quiz-utils";
import type * as EditorUtils from "../editor/utils";

/* ════════════════════════════════════════════════════════
   Types d'état dérivés de l'assemblage réel (editor.js)
   ════════════════════════════════════════════════════════ */

/**
 * Options d'examen ÉDITEUR (view.examOptions / ctx.examOptions, editor.js:
 * 35-40, lues/écrites dans editor/ui.js:135-231 et editor/export.js:98-99).
 * Sur-ensemble de `ExamOptions` (types/quiz.ts) : ce dernier modélise les
 * options ACTIVES telles que lues par le moteur une fois l'examen construit
 * (quiz-utils.ts extractExamOptions) — il n'a pas de champ `enabled` car sa
 * seule présence (non-null) vaut activation. Le FORMULAIRE éditeur, lui,
 * existe même quand l'examen est désactivé et garde donc un toggle `enabled`
 * explicite en plus des 3 champs de `ExamOptions`.
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

/**
 * Constructeur d'une modale Obsidian (Modal ou FuzzySuggestModal) greffée sur
 * ctx (ConfirmModal, TypePickerModal, ImportQuizModal, QuizFileSuggestModal,
 * ImportFromNoteModal — src/editor/modals.js, encore .js). Les 5 classes ont
 * des signatures de constructeur différentes ; ce placeholder les couvre
 * honnêtement sans deviner leurs paramètres exacts. Task 6 remplacera ce type
 * par les vraies classes quand modals.js devient modals.ts.
 */
export type EditorModalCtor = new (...args: unknown[]) => unknown;

/* ════════════════════════════════════════════════════════
   Handler-types des sous-modules editor/* — PLACEHOLDERS
   ════════════════════════════════════════════════════════
   Chacun des 6 modules editor/*.js (ui, resize, sidebar, editor-form,
   preview, hint) exporte une factory `createXxxHandlers(ctx) => { ... }`
   greffée sur ctx via Object.assign (editor.js:94-110). Ces modules sont
   encore .js aujourd'hui et n'exportent aucun type : importer un type de
   handler concret depuis eux échouerait ("has no exported member") et
   casserait `npm run check`.
   Ces interfaces sont donc des placeholders permissifs (index signature
   `unknown`) — À COMPLÉTER EN TASK 6, module par module, quand chacun passe
   en .ts et exporte son vrai type Xxx Handlers (alors importé ici via
   `import type` et substitué à ces déclarations locales). */

/** Placeholder — src/editor/ui.js (createEditorUIHandlers). À compléter en Task 6. */
export interface EditorUIHandlers { [method: string]: unknown }

/** Placeholder — src/editor/resize.js (createResizeHandlers). À compléter en Task 6. */
export interface ResizeHandlers { [method: string]: unknown }

/** Placeholder — src/editor/sidebar.js (createSidebarHandlers). À compléter en Task 6. */
export interface SidebarHandlers { [method: string]: unknown }

/** Placeholder — src/editor/editor-form.js (createEditorFormHandlers). À compléter en Task 6. */
export interface EditorFormHandlers { [method: string]: unknown }

/** Placeholder — src/editor/preview.js (createPreviewHandlers). À compléter en Task 6. */
export interface PreviewHandlers { [method: string]: unknown }

/** Placeholder — src/editor/hint.js (createHintHandlers). À compléter en Task 6. */
export interface HintHandlers { [method: string]: unknown }

/* ════════════════════════════════════════════════════════
   Hôte de l'éditeur (`view`) — socle garanti par attachQuizEditorCore
   ════════════════════════════════════════════════════════ */

/**
 * `view`, l'hôte sur lequel attachQuizEditorCore greffe l'état et les
 * méthodes de l'éditeur. Selon le contexte d'appel (editor.js:19-23) c'est
 * SOIT une vraie `ItemView` (QuizBuilderView, onglet dédié — editor.js:
 * 386-392, qui étend `obsidian.ItemView`), SOIT un simple objet sans `leaf`
 * (éditeur embarqué dans la page "Générer" du dashboard). D'où un type
 * dédié plutôt que `ItemView` strict : seuls les champs effectivement
 * assignés par attachQuizEditorCore sont modélisés ici (garantis dans les
 * deux cas). Les ~35 méthodes liées (buildUI, syncPanels, render,
 * renderSidebar, renderEditor, schedulePreview, _openHint, etc. —
 * editor.js:113-143 et les 5 méthodes partagées editor.js:150-378) ainsi que
 * les champs optionnels propres à la vue onglet (leaf, sourceFile réel,
 * getDisplayText…) restent À AJOUTER EN TASK 6, au fil de la conversion de
 * chaque module editor/*.js dont elles proviennent.
 */
export interface EditorHostView {
	app: App;
	plugin: Plugin;
	/** contentEl du ItemView réel, ou `host` fourni tel quel pour l'éditeur embarqué (editor.js:30). */
	contentEl: HTMLElement;
	questions: QuizQuestion[];
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
	 * référence de tableau — editor.js:61). Les OBJETS question insérés par
	 * l'éditeur (makeDefault(), editor/utils.ts) sont en réalité des
	 * "brouillons" internes (discriminés par `_type`/`_id`, pas encore par
	 * les flags `ordering`/`matching`/`multiSelect`/`type` de `QuizQuestion`)
	 * — `QuizQuestion[]` est utilisé ici comme approximation du modèle de
	 * données cible (cohérent avec le brief Task 5) ; Task 6, en convertissant
	 * editor-form.js/export.js, tranchera si un type "brouillon" dédié
	 * (dérivé de `DraftQuestion`, editor/utils.ts) est nécessaire à la place.
	 */
	questions: QuizQuestion[];
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
	get activeQuestion(): QuizQuestion;
	set activeQuestion(value: QuizQuestion);

	// ── Utilitaires statiques greffés sur ctx (editor.js:5, 74-81) ──
	Q_TYPES: typeof EditorUtils.Q_TYPES;
	loadReact: typeof EditorUtils.loadReact;
	_setIcon: typeof EditorUtils._setIcon;
	_iconSpan: typeof EditorUtils._iconSpan;
	makeDefault: typeof EditorUtils.makeDefault;
	md2html: typeof EditorUtils.md2html;
	escHtml: typeof EditorUtils.escHtml;
	esc5: typeof EditorUtils.esc5;

	/**
	 * export/import — src/editor/export.js (encore .js). `exportQuestion`
	 * prend un brouillon de question (cf. note sur `questions` ci-dessus) et
	 * l'index de la question ; signature honnête en `unknown` en attendant la
	 * conversion du module en Task 6.
	 */
	exportQuestion: (question: unknown, idx: number) => string;
	exportAll: (questions: unknown[], examOptions?: EditorExamOptions | null) => string;
	exportAllWithFence: (questions: unknown[], examOptions?: EditorExamOptions | null) => string;
	/** src/quiz-utils.ts (déjà converti) — parse un bloc quiz-blocks JSON5. */
	parseQuizSource: typeof parseQuizSource;

	// ── Classes de modale greffées sur ctx (editor.js:7, 86-90) ──
	ConfirmModal: EditorModalCtor;
	TypePickerModal: EditorModalCtor;
	ImportQuizModal: EditorModalCtor;
	QuizFileSuggestModal: EditorModalCtor;
	ImportFromNoteModal: EditorModalCtor;

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

	// ── Méthodes aplaties (.bind() sur `view`, pas sur `ctx` — editor.js:
	// 113-143 + 150-378) : PAS modélisées ici. Elles vivent sur `view`
	// (EditorHostView ci-dessus), qui ne porte pour l'instant que le socle
	// d'état garanti par attachQuizEditorCore. À AJOUTER EN TASK 6 sur
	// EditorHostView, au fil de la conversion de chaque module editor/*.js
	// dont elles proviennent (buildUI/syncPanels/render/showTypeModal →
	// ui.ts ; _setupResizer/_closeLeftPanel/_closeRightPanel/_resizePanels →
	// resize.ts ; renderSidebar/moveQuestion/deleteQuestion → sidebar.ts ;
	// renderEditor/_field/_resourceSection/_renderTypeFields/_arrayEditor →
	// editor-form.ts ; schedulePreview/renderPreview/_resolveImagesInHtml/
	// renderCode → preview.ts ; _ensureHintOverlay/_applyHintTheme/_openHint/
	// _closeHint/_addHintEscHandler/_removeHintEscHandler → hint.ts ; et les
	// 5 méthodes partagées définies directement dans attachQuizEditorCore :
	// importQuizSource, openQuizFile, saveToSourceFile, scheduleSave,
	// convertParsedToInternal, editor.js:150-378).
}
