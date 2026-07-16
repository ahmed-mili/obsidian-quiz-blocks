import { Notice } from "obsidian";
import { mathifyElement } from "../engine/mathjax";
import { ConfirmModal } from "./modals";
import { t } from "../i18n";
import type { EditorCtx } from "../types/editor-ctx";

/** Handlers de la liste des questions (barre latérale) : rendu, réordonnancement, suppression. */
export interface SidebarHandlers {
	renderSidebar(): void;
	moveQuestion(i: number, dir: number): void;
	deleteQuestion(i: number): void;
}

export function createSidebarHandlers(ctx: EditorCtx): SidebarHandlers {
	const { Q_TYPES, _setIcon } = ctx;
	const view = ctx.view;

	function renderSidebar(): void {
		const list = view.sidebarListEl;
		list.empty();
		view.qCountEl.textContent = t("editor.sidebar.count", { n: ctx.questions.length });

		ctx.questions.forEach((q, i) => {
			// `qt` et non `t` : la variable de boucle masquerait t().
			const ti = Q_TYPES.find(qt => qt.key === q._type) || Q_TYPES[0];
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
			mathifyElement(text);

			const acts = item.createDiv({ cls: "qb-q-actions" });
			const up = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm" }); _setIcon(up, "chevron-up");
			const down = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm" }); _setIcon(down, "chevron-down");
			const del = acts.createEl("button", { cls: "qb-btn-icon qb-btn-sm qb-btn-danger" }); _setIcon(del, "x");

			item.addEventListener("click", e => {
				if ((e.target as HTMLElement).closest(".qb-q-actions")) return;
				ctx.activeIdx = i;
				view.render();
			});
			up.addEventListener("click", () => moveQuestion(i, -1));
			down.addEventListener("click", () => moveQuestion(i, 1));
			del.addEventListener("click", () => deleteQuestion(i));
		});
	}

	function moveQuestion(i: number, dir: number): void {
		const ni = i + dir;
		if (ni < 0 || ni >= ctx.questions.length) return;
		[ctx.questions[i], ctx.questions[ni]] = [ctx.questions[ni], ctx.questions[i]];
		if (ctx.activeIdx === i) ctx.activeIdx = ni;
		else if (ctx.activeIdx === ni) ctx.activeIdx = i;
			ctx.questions.forEach((qq, idx) => { if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title)) qq.title = `Question ${idx + 1}`; });
		view.render();
	}

	function deleteQuestion(i: number): void {
		if (ctx.questions.length <= 1) {
			new Notice(t("editor.notice.cannotDeleteLast"));
			return;
		}

		const q = ctx.questions[i];
		const title = q.title || `Question ${i + 1}`;

		const modal = new ConfirmModal(view.app,
			t("editor.delete.title", { title }),
			t("editor.delete.message"),
			t("editor.action.delete"),
			t("editor.action.cancel"),
			(confirmed) => {
				if (confirmed) {
					ctx.questions.splice(i, 1);
					// Corriger l'index actif: décrémenter si on supprime avant, ajuster si on supprime la question active
					if (ctx.activeIdx > i) ctx.activeIdx--;
					else if (ctx.activeIdx === i) ctx.activeIdx = Math.min(i, ctx.questions.length - 1);
						ctx.questions.forEach((qq, idx) => { if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title)) qq.title = `Question ${idx + 1}`; });
					view.render();
					new Notice(t("editor.notice.questionDeleted", { title }));
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
}
