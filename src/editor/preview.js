'use strict';

module.exports = function createPreviewHandlers(ctx) {
	const { Q_TYPES, md2html, exportAllWithFence } = ctx;
	const view = ctx.view;

	function schedulePreview() {
		if (view._previewDebounce) clearTimeout(view._previewDebounce);
			view._previewDebounce = setTimeout(() => { if (view.previewBodyEl && view.previewBodyEl.isConnected) renderPreview(); }, 150);
	}

	function renderPreview() {
		const body = view.previewBodyEl;
		body.empty();

		const q = ctx.questions[ctx.activeIdx];
		if (!q) return;

		const t = q._type;
		const ti = Q_TYPES.find(x => x.key === t) || Q_TYPES[0];

		view.previewTitleEl.textContent = `Aperçu — ${q.title || `Question ${ctx.activeIdx + 1}`}`;

		const host = body.createDiv({ cls: "quiz-blocks-host" });
		const card = host.createEl("section", { cls: "quiz-card" });

		card.createEl("h2", { text: q.title || `Question ${ctx.activeIdx + 1}` });

		if (q.resourceButton) {
    const rbtn = card.createEl("button", { cls: "quiz-resource-btn" });
    const icon = rbtn.createSpan({ cls: "quiz-resource-btn-icon" });
    ctx._setIcon(icon, "paperclip");
    rbtn.createSpan({ cls: "quiz-resource-btn-label", text: q.resourceButton.label || "Ressource" });
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
			promptEl.querySelectorAll("img.qb-md-img").forEach(img => {
				const fileName = img.getAttribute("src");
				if (fileName) {
					const attachFolder = view.app.vault.getConfig("attachmentFolderPath") || "";
					const folderPath = attachFolder.replace("${file}", "").replace(/\/$/, "") || ".";
					const filePath = folderPath === "." ? fileName : `${folderPath}/${fileName}`;
					const file = view.app.vault.getAbstractFileByPath(filePath);
					if (file) {
						img.src = view.app.vault.adapter.getResourcePath(filePath);
					}
				}
			});
		}

		if (t === "single" || t === "multi") {
			const isMulti = t === "multi";
			if (isMulti) card.createDiv({ cls: "quiz-multi-indicator", text: "Sélectionnez une ou plusieurs réponses" });

			(q.options || []).forEach((o, i) => {
				const isCorrect = isMulti ? (q.correctIndices || []).includes(i) : i === q.correctIndex;
				const cls = `quiz-option ${isMulti ? "multi" : ""} ${isCorrect ? "correct" : ""}`.trim();
				const opt = card.createDiv({ cls, attr: { role: "button", tabindex: "0" } });
				opt.innerHTML = _resolveImagesInHtml(md2html(o || "..."));
			});
		}

		if (t === "ordering") {
			card.createDiv({ cls: "quiz-multi-indicator", text: "Classez les éléments dans le bon ordre" });
			const orderingWrap = card.createDiv({ cls: "quiz-ordering" });
			const slotsWrap = orderingWrap.createDiv({ cls: "quiz-ordering-slots" });
			(q.slots || []).forEach((slotLabel, si) => {
				const oi = q.correctOrder?.[si];
				const itemText = q.possibilities?.[oi] || "?";
				const slot = slotsWrap.createDiv({ cls: "quiz-slot filled correct" });
				slot.createDiv({ cls: "quiz-slot-label", text: slotLabel });
				slot.createDiv({ cls: "quiz-slot-value", text: itemText });
			});
		}

		if (t === "matching") {
			card.createDiv({ cls: "quiz-multi-indicator", text: "Associez chaque situation à un support" });
			const matchWrap = card.createDiv({ cls: "quiz-ordering" });
			const slotsWrap = matchWrap.createDiv({ cls: "quiz-ordering-slots" });
			(q.rows || []).forEach((row, ri) => {
				const ci = q.correctMap?.[ri];
				const choiceText = q.choices?.[ci] || "?";
				const slot = slotsWrap.createDiv({ cls: "quiz-slot filled correct" });
				slot.createDiv({ cls: "quiz-slot-label", text: row || `Ligne ${ri}` });
				slot.createDiv({ cls: "quiz-slot-value", text: choiceText });
			});
		}

		if (t === "text") {
			// FIDÉLITÉ au quiz réel : l'élève voit une zone VIDE avec le
			// placeholder — pré-remplir avec acceptedAnswers[0] SPOILAIT la
			// réponse dès l'arrivée sur l'aperçu (demande 2026-07-11),
			// en LaTeX brut de surcroît.
			const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap" });
			const ta = wrap.createEl("textarea", {
				cls: "quiz-textarea",
				attr: { readonly: true, "aria-readonly": "true", placeholder: q.placeholder || "Votre réponse..." },
			});
			ta.value = "";
		}

		if (t === "cmd") {
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

		if (t === "powershell") {
			const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-text-wrap-command" });
			const shell = wrap.createDiv({ cls: "quiz-command-shell quiz-terminal-variant-powershell" });
			shell.createSpan({ cls: "quiz-command-prefix", text: q.commandPrefix || "PS>" });
			const inputWrap = shell.createDiv({ cls: "quiz-command-input-wrap" });
			inputWrap.createEl("textarea", {
				cls: "quiz-textarea quiz-textarea-command",
				attr: { readonly: true, rows: "1", wrap: "off" },
			});
		}

		if (t === "bash") {
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
			const hintBtn = card.createEl("button", { cls: "quiz-hint-btn", text: "Indice", type: "button" });
			hintBtn.addEventListener("click", () => view._openHint(q.hint));
		}

		if (q._explainHtml) {
			const explainEl = card.createDiv({ cls: "quiz-explain good" });
			explainEl.innerHTML = q._explainHtml;
		} else if (q.explain && q.explain.trim()) {
			const explainEl = card.createDiv({ cls: "quiz-explain good" });
			explainEl.innerHTML = _resolveImagesInHtml(md2html(q.explain));
		}

		// LaTeX $...$ / $$...$$ : même rendu MathJax natif que le moteur —
		// l'aperçu doit être fidèle au quiz final (titre, énoncé, options,
		// explication).
		require("../engine/mathjax").mathifyElement(card);
	}

	function _resolveImagesInHtml(html) {
		if (!html) return html;
		const temp = document.createElement('div');
		temp.innerHTML = html;
		temp.querySelectorAll("img.qb-md-img").forEach(img => {
			const fileName = img.getAttribute("src");
			if (fileName) {
				const attachFolder = view.app.vault.getConfig("attachmentFolderPath") || "";
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

	function renderCode() {
		view.codeOutputEl.textContent = exportAllWithFence(ctx.questions, ctx.examOptions);
	}

	return {
		schedulePreview,
		renderPreview,
		_resolveImagesInHtml,
		renderCode
	};
};
