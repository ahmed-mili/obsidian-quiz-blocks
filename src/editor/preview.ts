import type { EditorCtx } from "../types/editor-ctx";
import { mathifyElement } from "../engine/mathjax";
import { t } from "../i18n";

/** API interne non publique d'Obsidian : lecture d'un réglage du vault (ex. attachmentFolderPath). */
type VaultWithGetConfig = { getConfig(key: string): string | null };

/** Sous-ensemble typé du module moteur engine/math-input.ts. */
interface MathInputModule {
	isMathQuestion(q: unknown): boolean;
	createMathField(host: HTMLElement, opts?: { readOnly?: boolean; template?: unknown }): unknown;
}

/** Handlers d'aperçu (rendu fidèle au quiz) et de génération du code JSON5. */
export interface PreviewHandlers {
	schedulePreview(): void;
	renderPreview(): void;
	_resolveImagesInHtml(html: string): string;
	renderCode(): void;
}

export function createPreviewHandlers(ctx: EditorCtx): PreviewHandlers {
	const { Q_TYPES, md2html, exportAllWithFence } = ctx;
	const view = ctx.view;

	function schedulePreview(): void {
		if (view._previewDebounce) clearTimeout(view._previewDebounce);
			view._previewDebounce = window.setTimeout(() => { if (view.previewBodyEl && view.previewBodyEl.isConnected) renderPreview(); }, 150);
	}

	function renderPreview(): void {
		const body = view.previewBodyEl;
		body.empty();

		const q = ctx.questions[ctx.activeIdx];
		if (!q) return;

		// Renommé `t` → `qType` : masquait la fonction de traduction t().
		const qType = q._type;
		const ti = Q_TYPES.find(x => x.key === qType) || Q_TYPES[0];

		// « Question N » : titre de repli non localisé (motif du titre auto
		// écrit dans le .md, cf. editor/ui.ts).
		view.previewTitleEl.textContent = t("editor.preview.titleWith", { title: q.title || `Question ${ctx.activeIdx + 1}` });

		const host = body.createDiv({ cls: "quiz-blocks-host" });
		const card = host.createEl("section", { cls: "quiz-card" });

		card.createEl("h2", { text: q.title || `Question ${ctx.activeIdx + 1}` });

		if (q.resourceButton) {
    const rbtn = card.createEl("button", { cls: "quiz-resource-btn" });
    const icon = rbtn.createSpan({ cls: "quiz-resource-btn-icon" });
    ctx._setIcon(icon, "paperclip");
    rbtn.createSpan({ cls: "quiz-resource-btn-label", text: q.resourceButton.label || t("editor.preview.resourceFallback") });
}


		if (q._promptHtml) {
			const promptEl = card.createDiv({ cls: "quiz-question" });
			// Convertir les wiki-links en balises img, puis résoudre les chemins
			let html = q._promptHtml.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" class="qb-md-img" />');
			html = _resolveImagesInHtml(html);
			promptEl.innerHTML = html;
		} else if (q.prompt) {
			const promptEl = card.createDiv({ cls: "quiz-question" });
			promptEl.innerHTML = md2html(q.prompt);
			promptEl.querySelectorAll<HTMLImageElement>("img.qb-md-img").forEach(img => {
				const fileName = img.getAttribute("src");
				if (fileName) {
					const attachFolder = (view.app.vault as unknown as VaultWithGetConfig).getConfig("attachmentFolderPath") || "";
					const folderPath = attachFolder.replace("${file}", "").replace(/\/$/, "") || ".";
					const filePath = folderPath === "." ? fileName : `${folderPath}/${fileName}`;
					const file = view.app.vault.getAbstractFileByPath(filePath);
					if (file) {
						img.src = view.app.vault.adapter.getResourcePath(filePath);
					}
				}
			});
		}

		// ── APERÇU = ÉTAT INITIAL du quiz, jamais l'état corrigé (demande
		// Ahmed 2026-07-11) : aucune option verte, aucun slot pré-rempli,
		// pas d'explication — les réponses ne se voient QUE dans le
		// panneau Éditeur, ouvert volontairement. ──
		if (qType === "single" || qType === "multi") {
			const isMulti = qType === "multi";
			if (isMulti) card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.multiHint") });

			(q.options || []).forEach((o) => {
				const cls = `quiz-option ${isMulti ? "multi" : ""}`.trim();
				const opt = card.createDiv({ cls, attr: { role: "button", tabindex: "0" } });
				opt.innerHTML = _resolveImagesInHtml(md2html(o || "..."));
			});
		}

		if (qType === "ordering") {
			card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.orderingHint") });
			const orderingWrap = card.createDiv({ cls: "quiz-ordering" });
			const slotsWrap = orderingWrap.createDiv({ cls: "quiz-ordering-slots" });
			(q.slots || []).forEach((slotLabel) => {
				const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
				slot.createDiv({ cls: "quiz-slot-label", text: slotLabel });
				slot.createDiv({ cls: "quiz-slot-value", text: "…" });
			});
			// Pool des possibilités dans l'ordre STOCKÉ (celui affiché à
			// l'élève) — pas l'ordre correct.
			const pool = orderingWrap.createDiv({ cls: "quiz-ordering-pool" });
			(q.possibilities || []).forEach(p => pool.createSpan({ cls: "quiz-pool-item", text: p }));
		}

		if (qType === "matching") {
			card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.matchingHint") });
			const matchWrap = card.createDiv({ cls: "quiz-ordering" });
			const slotsWrap = matchWrap.createDiv({ cls: "quiz-ordering-slots" });
			(q.rows || []).forEach((row, ri) => {
				const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
				slot.createDiv({ cls: "quiz-slot-label", text: row || t("editor.matching.rowFallback", { n: ri }) });
				slot.createDiv({ cls: "quiz-slot-value", text: "…" });
			});
			const pool = matchWrap.createDiv({ cls: "quiz-ordering-pool" });
			(q.choices || []).forEach(c => pool.createSpan({ cls: "quiz-pool-item", text: c }));
		}

		if (qType === "text") {
			// FIDÉLITÉ au quiz réel : l'élève voit une zone VIDE avec le
			// placeholder — pré-remplir avec acceptedAnswers[0] SPOILAIT la
			// réponse dès l'arrivée sur l'aperçu (demande 2026-07-11),
			// en LaTeX brut de surcroît.
			const mathInput = require("../engine/math-input") as MathInputModule;
			if (mathInput.isMathQuestion(q)) {
				// Question math : le même éditeur d'équations que le quiz,
				// en lecture seule, gabarit affiché s'il existe.
				const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-math-wrap" });
				mathInput.createMathField(wrap, {
					readOnly: true,
					template: (q._extraFields && q._extraFields.answerTemplate) || q.answerTemplate || "",
				});
			} else {
				const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap" });
				const ta = wrap.createEl("textarea", {
					cls: "quiz-textarea",
					attr: { readonly: true, "aria-readonly": "true", placeholder: q.placeholder || t("editor.text.defaultPlaceholder") },
				});
				ta.value = "";
			}
		}

		if (qType === "cmd") {
			// Zone VIDE, comme dans le quiz réel (pas de spoiler — cf. text).
			const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-text-wrap-command" });
			const shell = wrap.createDiv({ cls: "quiz-command-shell quiz-terminal-variant-cmd" });
			shell.createSpan({ cls: "quiz-command-prefix", text: q.commandPrefix || "C:\\>" });
			const inputWrap = shell.createDiv({ cls: "quiz-command-input-wrap" });
			inputWrap.createEl("textarea", {
				cls: "quiz-textarea quiz-textarea-command",
				attr: { readonly: true, rows: "1", wrap: "off" },
			});
		}

		if (qType === "powershell") {
			const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-text-wrap-command" });
			const shell = wrap.createDiv({ cls: "quiz-command-shell quiz-terminal-variant-powershell" });
			shell.createSpan({ cls: "quiz-command-prefix", text: q.commandPrefix || "PS>" });
			const inputWrap = shell.createDiv({ cls: "quiz-command-input-wrap" });
			inputWrap.createEl("textarea", {
				cls: "quiz-textarea quiz-textarea-command",
				attr: { readonly: true, rows: "1", wrap: "off" },
			});
		}

		if (qType === "bash") {
			const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-text-wrap-command" });
			const shell = wrap.createDiv({ cls: "quiz-command-shell quiz-terminal-variant-bash" });
			const prefixSpan = shell.createSpan({ cls: "quiz-command-prefix quiz-command-prefix-bash" });
			prefixSpan.innerHTML = '<span class="quiz-bash-prefix-userhost">user@hostname</span><span class="quiz-bash-prefix-colon">:</span><span class="quiz-bash-prefix-path">~</span><span class="quiz-bash-prefix-dollar">$ </span>';
			const inputWrap = shell.createDiv({ cls: "quiz-command-input-wrap" });
			inputWrap.createEl("textarea", {
				cls: "quiz-textarea quiz-textarea-command",
				attr: { readonly: true, rows: "1", wrap: "off" },
			});
		}

		if (q.hint && q.hint.trim()) {
			const hintBtn = card.createEl("button", { cls: "quiz-hint-btn", text: t("editor.hint.label"), type: "button" });
			hintBtn.addEventListener("click", () => view._openHint(q.hint));
		}

		// Pas d'explication dans l'aperçu : elle contient la réponse (le
		// quiz réel ne la montre qu'après validation) — elle se relit dans
		// le panneau Éditeur.

		// LaTeX $...$ / $$...$$ : même rendu MathJax natif que le moteur —
		// l'aperçu doit être fidèle au quiz final (titre, énoncé, options,
		// explication).
		mathifyElement(card);
	}

	function _resolveImagesInHtml(html: string): string {
		if (!html) return html;
		const temp = document.createElement('div');
		temp.innerHTML = html;
		temp.querySelectorAll<HTMLImageElement>("img.qb-md-img").forEach(img => {
			const fileName = img.getAttribute("src");
			if (fileName) {
				const attachFolder = (view.app.vault as unknown as VaultWithGetConfig).getConfig("attachmentFolderPath") || "";
				const folderPath = attachFolder.replace("${file}", "").replace(/\/$/, "") || ".";
				const filePath = folderPath === "." ? fileName : `${folderPath}/${fileName}`;
				const file = view.app.vault.getAbstractFileByPath(filePath);
				if (file) {
					img.src = view.app.vault.adapter.getResourcePath(filePath);
				}
			}
		});
		return temp.innerHTML;
	}

	function renderCode(): void {
		view.codeOutputEl.textContent = exportAllWithFence(ctx.questions, ctx.examOptions);
	}

	return {
		schedulePreview,
		renderPreview,
		_resolveImagesInHtml,
		renderCode
	};
}
