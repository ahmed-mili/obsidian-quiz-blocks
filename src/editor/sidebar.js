'use strict';

const obsidian = require("obsidian");
const { ConfirmModal } = require("./modals");

module.exports = function createSidebarHandlers(ctx) {
	const { Q_TYPES, _setIcon } = ctx;
	const view = ctx.view;

	function renderSidebar() {
		const list = view.sidebarListEl;
		list.empty();
		view.qCountEl.textContent = `Questions (${ctx.questions.length})`;

		ctx.questions.forEach((q, i) => {
			const ti = Q_TYPES.find(t => t.key === q._type) || Q_TYPES[0];
			const item = list.createDiv({ cls: `qb-q-item ${i === ctx.activeIdx ? "active" : ""}` });
			const qIcon = item.createDiv({ cls: "qb-q-icon" });
			_setIcon(qIcon, ti.lucide);
			const text = item.createDiv({ cls: "qb-q-text" });
			text.createDiv({ cls: "qb-q-title", text: q.title || `Question ${i + 1}` });
			text.createDiv({ cls: "qb-q-type", text: ti.label });

			// Afficher le début de la question (prompt) pour reconnaissance facile
			let previewText = q.prompt || "";
			// Nettoyer le markdown pour l'aperçu
			previewText = previewText.replace(/[#*_`\[\]!]/g, '').replace(/\n/g, ' ').trim();
			if (previewText) {
				if (previewText.length > 60) {
					previewText = previewText.substring(0, 60);
					// Ne pas couper au milieu d'un segment $...$ : un segment
					// incomplet resterait en dollars bruts après mathify.
					if (((previewText.match(/\$/g) || []).length) % 2 === 1) {
						previewText = previewText.slice(0, previewText.lastIndexOf("$"));
					}
					previewText += "...";
				}
				text.createDiv({ cls: "qb-q-preview", text: previewText });
			}
			// LaTeX $...$ du titre et de l'aperçu : rendu MathJax (les
			// items affichaient les dollars bruts — demande 2026-07-11).
			require("../engine/mathjax").mathifyElement(text);

			const acts = item.createDiv({ cls: "qb-q-actions" });
			const up = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm" }); _setIcon(up, "chevron-up");
			const down = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm" }); _setIcon(down, "chevron-down");
			const del = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm qb-btn-danger" }); _setIcon(del, "x");

			item.addEventListener("click", e => {
				if (e.target.closest(".qb-q-actions")) return;
				ctx.activeIdx = i;
				view.render();
			});
			up.addEventListener("click", () => moveQuestion(i, -1));
			down.addEventListener("click", () => moveQuestion(i, 1));
			del.addEventListener("click", () => deleteQuestion(i));
		});
	}

	function moveQuestion(i, dir) {
		const ni = i + dir;
		if (ni < 0 || ni >= ctx.questions.length) return;
		[ctx.questions[i], ctx.questions[ni]] = [ctx.questions[ni], ctx.questions[i]];
		if (ctx.activeIdx === i) ctx.activeIdx = ni;
		else if (ctx.activeIdx === ni) ctx.activeIdx = i;
			ctx.questions.forEach((qq, idx) => { if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title)) qq.title = `Question ${idx + 1}`; });
		view.render();
	}

	function deleteQuestion(i) {
		if (ctx.questions.length <= 1) {
			new obsidian.Notice("Impossible de supprimer la dernière question");
			return;
		}

		const q = ctx.questions[i];
		const title = q.title || `Question ${i + 1}`;

		const modal = new ConfirmModal(view.app,
			`Supprimer "${title}" ?`,
			`Cette action est irréversible. La question sera définitivement supprimée.`,
			"Supprimer",
			"Annuler",
			(confirmed) => {
				if (confirmed) {
					ctx.questions.splice(i, 1);
					// Corriger l'index actif: décrémenter si on supprime avant, ajuster si on supprime la question active
					if (ctx.activeIdx > i) ctx.activeIdx--;
					else if (ctx.activeIdx === i) ctx.activeIdx = Math.min(i, ctx.questions.length - 1);
						ctx.questions.forEach((qq, idx) => { if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title)) qq.title = `Question ${idx + 1}`; });
					view.render();
					new obsidian.Notice(`Question "${title}" supprimée`);
				}
			}
		);
		modal.open();
	}

	return {
		renderSidebar,
		moveQuestion,
		deleteQuestion
	};
};
