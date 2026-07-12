import type { EditorCtx } from "../types/editor-ctx";
import type { EditorPanelsState } from "../types/editor-ctx";

/** Clés des 4 panneaux redimensionnables. */
type PanelKey = keyof EditorPanelsState;
/** Type de poignée de redimensionnement (paire de panneaux adjacents, ou bord droit de code). */
type ResizerType = "sidebar-editor" | "editor-preview" | "preview-code" | "editor-code" | "code-right";

/** Handlers de redimensionnement des panneaux (drag des poignées, fermeture au seuil). */
export interface ResizeHandlers {
	_setupResizer(resizerEl: HTMLElement, leftPanel: HTMLElement, rightPanel: HTMLElement, type: ResizerType): void;
	_closeLeftPanel(type: ResizerType, mainEl: HTMLElement): void;
	_closeRightPanel(type: ResizerType, mainEl: HTMLElement): void;
	_resizePanels(type: ResizerType, mainEl: HTMLElement, leftWidth: number, rightWidth: number): void;
}

export function createResizeHandlers(ctx: EditorCtx): ResizeHandlers {
	const view = ctx.view;

	function _setupResizer(resizerEl: HTMLElement, leftPanel: HTMLElement, rightPanel: HTMLElement, type: ResizerType): void {
		let startX = 0;
		let startWidthLeft = 0;
		let startWidthRight = 0;
		let isDragging = false;
		let overlay: HTMLElement | null = null;
		let rafId: number | null = null;

		const dragState: { delta: number; mainEl: HTMLElement | null; needsUpdate: boolean } = {
			delta: 0,
			mainEl: null,
			needsUpdate: false
		};

		const updatePanels = () => {
			if (!dragState.needsUpdate || !dragState.mainEl) return;

			const delta = dragState.delta;
			const mainEl = dragState.mainEl;

			const newLeftWidth = startWidthLeft + delta;
			const newRightWidth = startWidthRight - delta;

			const mainRect = mainEl.getBoundingClientRect();
			const minPreviewWidth = 100;

			if (type === 'editor-preview') {
				if (newLeftWidth <= view._hideThreshold && delta < 0) {
					_closeLeftPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				if (newRightWidth <= view._hideThreshold && delta > 0) {
					_closeRightPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				const previewWidth = mainRect.width - newLeftWidth;
				if (newLeftWidth >= view._minPanelWidth && previewWidth >= minPreviewWidth) {
					_resizePanels(type, mainEl, newLeftWidth, newRightWidth);
				}
			} else if (type === 'preview-code') {
				const newCodeWidth = startWidthRight - delta;
				if (newCodeWidth <= view._hideThreshold && delta > 0) {
					_closeRightPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				const previewWidth = mainRect.width - newCodeWidth;
				if (previewWidth <= view._hideThreshold && delta < 0) {
					_closeLeftPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				if (newCodeWidth >= view._minPanelWidth && previewWidth >= minPreviewWidth) {
					_resizePanels(type, mainEl, 0, newCodeWidth);
				}
			} else if (type === 'code-right') {
				// Resize code depuis sa bordure droite
				const newCodeWidth = startWidthLeft + delta;
				if (newCodeWidth >= view._minPanelWidth) {
					mainEl.style.setProperty('--qb-code-w', `${newCodeWidth}px`);
					view._savedWidths.code = newCodeWidth;
				}
			} else {
				if (newLeftWidth <= view._hideThreshold && delta < 0) {
					_closeLeftPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				if (newRightWidth <= view._hideThreshold && delta > 0) {
					_closeRightPanel(type, mainEl);
					view.syncPanels();
					dragState.needsUpdate = false;
					return;
				}
				if (newLeftWidth >= view._minPanelWidth && newRightWidth >= view._minPanelWidth) {
					_resizePanels(type, mainEl, newLeftWidth, newRightWidth);
				}
			}

			dragState.needsUpdate = false;
		};

		const scheduleUpdate = () => {
			if (!dragState.needsUpdate) {
				dragState.needsUpdate = true;
				rafId = requestAnimationFrame(() => {
					updatePanels();
				});
			}
		};

		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			isDragging = true;
			startX = e.clientX;

			dragState.mainEl = view.contentEl.querySelector<HTMLElement>('.qb-main');
			if (!dragState.mainEl) return;

			const leftRect = leftPanel.getBoundingClientRect();
			const rightRect = rightPanel.getBoundingClientRect();
			startWidthLeft = leftRect.width;
			startWidthRight = rightRect.width;

			if (type === 'sidebar-editor') {
				view._savedWidths.sidebar = startWidthLeft;
				view._savedWidths.editor = startWidthRight;
			} else if (type === 'editor-preview') {
				view._savedWidths.editor = startWidthLeft;
				view._savedWidths.preview = startWidthRight;
			} else if (type === 'preview-code') {
				view._savedWidths.preview = startWidthLeft;
				view._savedWidths.code = startWidthRight;
			} else if (type === 'editor-code') {
				view._savedWidths.editor = startWidthLeft;
				view._savedWidths.code = startWidthRight;
			} else if (type === 'code-right') {
				view._savedWidths.code = startWidthLeft;
			}

			overlay = document.createElement('div');
			overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:ew-resize;';
			document.body.appendChild(overlay);

			resizerEl.classList.add('resizing');
			document.body.style.userSelect = 'none';

			const mainEl = dragState.mainEl;
			if (mainEl) mainEl.classList.add('is-resizing');

			const onMouseMove = (e: MouseEvent) => {
				if (!isDragging) return;
				dragState.delta = e.clientX - startX;
				scheduleUpdate();
			};

			const onMouseUp = (_e: MouseEvent) => {
				if (!isDragging) return;
				isDragging = false;

				if (rafId) {
					cancelAnimationFrame(rafId);
					rafId = null;
				}

				if (dragState.needsUpdate) {
					updatePanels();
				}

				resizerEl.classList.remove('resizing');
				document.body.style.userSelect = '';

				if (mainEl) mainEl.classList.remove('is-resizing');

				if (overlay) {
					overlay.remove();
					overlay = null;
				}

				dragState.needsUpdate = false;
				dragState.mainEl = null;

				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
			};

			document.addEventListener('mousemove', onMouseMove, { passive: true });
			document.addEventListener('mouseup', onMouseUp);
		};

		resizerEl.addEventListener('mousedown', onMouseDown);
	}

	function _closeLeftPanel(type: ResizerType, mainEl: HTMLElement): void {
		const panelNames: Record<ResizerType, PanelKey | null> = {
			'sidebar-editor': 'sidebar',
			'editor-preview': 'editor',
			'preview-code': 'preview',
			'editor-code': 'editor',
			'code-right': 'code'
		};
		const panel = panelNames[type];

		if (!panel) return;

		ctx.panels[panel] = false;
		if (panel !== 'preview') {
			mainEl.style.setProperty(`--qb-${panel}-w`, '0px');
		}

		if (!Object.values(ctx.panels).some(Boolean)) {
			ctx.panels[panel] = true;
			if (panel !== 'preview') {
				mainEl.style.setProperty(`--qb-${panel}-w`, `${ctx._savedWidths[panel]}px`);
			}
		}
	}

	function _closeRightPanel(type: ResizerType, mainEl: HTMLElement): void {
		const panelNames: Record<ResizerType, PanelKey | null> = {
			'sidebar-editor': 'editor',
			'editor-preview': 'preview',
			'preview-code': 'code',
			'editor-code': 'code',
			'code-right': null  // Pas de panel à droite
		};
		const panel = panelNames[type];

		if (!panel) return;

		ctx.panels[panel] = false;
		if (panel !== 'preview') {
			mainEl.style.setProperty(`--qb-${panel}-w`, '0px');
		}

		if (!Object.values(ctx.panels).some(Boolean)) {
			ctx.panels[panel] = true;
			if (panel !== 'preview') {
				mainEl.style.setProperty(`--qb-${panel}-w`, `${ctx._savedWidths[panel]}px`);
			}
		}
	}

	function _resizePanels(type: ResizerType, mainEl: HTMLElement, leftWidth: number, rightWidth: number): void {
		// _resizePanels n'est appelé que pour les types à deux panneaux (jamais
		// 'code-right') : les deux moitiés sont donc des PanelKey valides.
		const [leftPanel, rightPanel] = type.split('-') as [PanelKey, PanelKey];
		ctx.panels[leftPanel] = true;
		ctx.panels[rightPanel] = true;

		if (leftPanel !== 'preview') {
			mainEl.style.setProperty(`--qb-${leftPanel}-w`, `${leftWidth}px`);
			view._savedWidths[leftPanel] = leftWidth;  // Sauvegarder la largeur
		}
		if (rightPanel !== 'preview') {
			mainEl.style.setProperty(`--qb-${rightPanel}-w`, `${rightWidth}px`);
			view._savedWidths[rightPanel] = rightWidth;  // Sauvegarder la largeur
		}
	}

	return {
		_setupResizer,
		_closeLeftPanel,
		_closeRightPanel,
		_resizePanels
	};
}
