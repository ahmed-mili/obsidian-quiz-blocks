import { t } from "../i18n";
import type { EditorCtx } from "../types/editor-ctx";

/** Handlers de la modale d'indice (overlay plein écran, hors flux de l'éditeur). */
export interface HintHandlers {
	_ensureHintOverlay(): HTMLElement;
	_applyHintTheme(overlay: HTMLElement | null): void;
	_addHintEscHandler(): void;
	_removeHintEscHandler(): void;
	_openHint(text: string): void;
	_closeHint(): void;
}

export function createHintHandlers(ctx: EditorCtx): HintHandlers {
	const { md2html } = ctx;
	const view = ctx.view;

	function _ensureHintOverlay(): HTMLElement {
		let overlay = document.getElementById("qb-hint-overlay");
		if (overlay) return overlay;

		overlay = document.createElement("div");
		overlay.id = "qb-hint-overlay";
		overlay.className = "quiz-hint-modal-overlay";
		overlay.innerHTML = `
			<div class="quiz-hint-modal" role="dialog" aria-modal="true">
				<div class="quiz-hint-modal-header">
					<div class="quiz-hint-modal-title">${t("editor.hint.label")}</div>
					<button class="quiz-hint-modal-close" type="button" aria-label="${t("editor.action.close")}">×</button>
				</div>
				<div class="quiz-hint-modal-body"></div>
			</div>`;

		overlay.addEventListener("click", e => { if (e.target === overlay) _closeHint(); });
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		if (modal) modal.addEventListener("click", e => e.stopPropagation());
		const closeBtn = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
		if (closeBtn) closeBtn.addEventListener("click", e => { e.preventDefault(); _closeHint(); });

		document.body.appendChild(overlay);

		_applyHintTheme(overlay);
		return overlay;
	}

	function _addHintEscHandler(): void {
		if (view._hintEscHandler) return; // Already attached
		view._hintEscHandler = e => {
			const o = document.getElementById("qb-hint-overlay");
			if (!o || !o.classList.contains("is-open")) return;
			if (e.key === "Escape") _closeHint();
		};
		document.addEventListener("keydown", view._hintEscHandler);
	}

	function _removeHintEscHandler(): void {
		if (view._hintEscHandler) {
			document.removeEventListener("keydown", view._hintEscHandler);
			view._hintEscHandler = null;
		}
	}

	function _applyHintTheme(overlay: HTMLElement | null): void {
		if (!overlay) return;
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		const header = overlay.querySelector<HTMLElement>(".quiz-hint-modal-header");
		const title = overlay.querySelector<HTMLElement>(".quiz-hint-modal-title");
		const bodyEl = overlay.querySelector<HTMLElement>(".quiz-hint-modal-body");
		const closeBtn = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");

		const body = document.body;
		const root = document.documentElement;
		const isLight = body?.classList.contains("theme-light") || root?.classList.contains("theme-light");
		const mode = isLight ? "light" : "dark";
		overlay.dataset.theme = mode;

		const cs = getComputedStyle(body);
		const bgPrimary = cs.getPropertyValue("--background-primary").trim() || (mode === "dark" ? "#111827" : "#ffffff");
		const bgSecondary = cs.getPropertyValue("--background-secondary").trim() || (mode === "dark" ? "#1f2937" : "#f5f6fa");
		const textNormal = cs.getPropertyValue("--text-normal").trim() || (mode === "dark" ? "#e5e7eb" : "#1f2937");
		const border = cs.getPropertyValue("--background-modifier-border").trim() || (mode === "dark" ? "rgba(148,163,184,.25)" : "rgba(31,41,55,.14)");
		const shadow = mode === "dark" ? "0 18px 48px rgba(2,6,23,.45)" : "0 18px 48px rgba(15,23,42,.14)";
		const overlayBg = mode === "dark" ? "rgba(2,6,23,.42)" : "rgba(15,23,42,.16)";

		overlay.style.background = overlayBg;
		if (modal) { modal.style.background = bgPrimary; modal.style.color = textNormal; modal.style.border = `1px solid ${border}`; modal.style.boxShadow = shadow; }
		if (header) { header.style.background = bgSecondary; header.style.borderBottom = `1px solid ${border}`; }
		if (title) title.style.color = textNormal;
		if (bodyEl) bodyEl.style.color = textNormal;
		if (closeBtn) { closeBtn.style.color = textNormal; closeBtn.style.border = `1px solid ${border}`; closeBtn.style.background = mode === "dark" ? "rgba(255,255,255,.06)" : "rgba(15,23,42,.04)"; }
	}

	function _openHint(text: string): void {
		const overlay = _ensureHintOverlay();
		const body = overlay.querySelector<HTMLElement>(".quiz-hint-modal-body");
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		// L'overlay est construit UNE fois puis réutilisé (cache par id sur le
		// body) : ses libellés seraient figés dans la langue du 1er affichage.
		// On les rafraîchit à chaque ouverture.
		const titleEl = overlay.querySelector<HTMLElement>(".quiz-hint-modal-title");
		if (titleEl) titleEl.textContent = t("editor.hint.label");
		const closeEl = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
		if (closeEl) closeEl.setAttribute("aria-label", t("editor.action.close"));
		if (body) body.innerHTML = view._resolveImagesInHtml(md2html(text));
		_applyHintTheme(overlay);
		_addHintEscHandler();

		overlay.classList.add("is-open");
		overlay.style.transition = "none";
		overlay.style.opacity = "0";
		if (modal) { modal.style.transition = "none"; modal.style.opacity = "0"; modal.style.transform = "translateY(10px) scale(0.84)"; }
		void overlay.offsetWidth;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				overlay.style.transition = "opacity 320ms cubic-bezier(0.22, 1, 0.36, 1)";
				overlay.style.opacity = "1";
				if (modal) {
					modal.style.transition = "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.22, 1, 0.36, 1)";
					modal.style.opacity = "1";
					modal.style.transform = "translateY(0) scale(1)";
				}
				const focus = overlay.querySelector<HTMLElement>(".quiz-hint-modal-close");
				if (focus) setTimeout(() => { try { focus.focus(); } catch (_) { /* noop */ } }, 340);
			});
		});
	}

	function _closeHint(): void {
		const overlay = document.getElementById("qb-hint-overlay");
		if (!overlay || !overlay.classList.contains("is-open")) return;
		const modal = overlay.querySelector<HTMLElement>(".quiz-hint-modal");
		_removeHintEscHandler();

		overlay.style.transition = "opacity 240ms cubic-bezier(0.4, 0, 0.2, 1)";
		overlay.style.opacity = "0";
		if (modal) {
			modal.style.transition = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms cubic-bezier(0.4, 0, 0.2, 1)";
			modal.style.opacity = "0";
			modal.style.transform = "translateY(8px) scale(0.94)";
		}
		setTimeout(() => {
			overlay.classList.remove("is-open");
			overlay.style.transition = "";
			overlay.style.opacity = "";
			if (modal) { modal.style.transition = ""; modal.style.opacity = ""; modal.style.transform = ""; }
		}, 300);
	}

	return {
		_ensureHintOverlay,
		_applyHintTheme,
		_addHintEscHandler,
		_removeHintEscHandler,
		_openHint,
		_closeHint
	};
}
