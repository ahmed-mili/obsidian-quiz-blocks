import { setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../editor";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";

/* ══════════════════════════════════════════════════════════
   QUIZZES VIEW — Dashboard
   Header + search + filtres + grid de QuizCards
══════════════════════════════════════════════════════════ */

export interface QuizzesHandlers {
	render(container: HTMLElement): void;
}

/* Le filtre actif est une CLÉ stable, plus le libellé affiché : celui-ci
   dépend de la langue, et le comparer (`currentFilter === "En cours"`) aurait
   silencieusement rendu tout filtrage inopérant hors du français. */
type FilterKey = "all" | "progress" | "mastered" | "fresh";

export function createQuizzesHandlers(ctx: DashboardCtx): QuizzesHandlers {
	let currentFilter: FilterKey = "all";
	let searchQuery = "";

	// Clés de traduction (pas de libellés) : la liste est construite à
	// l'ouverture de la vue, les libellés sont résolus à chaque rendu.
	const FILTERS: Array<{ key: FilterKey; labelKey: TransKey }> = [
		{ key: "all", labelKey: "dashboard.quizzes.filterAll" },
		{ key: "progress", labelKey: "dashboard.quizzes.filterProgress" },
		{ key: "mastered", labelKey: "dashboard.quizzes.filterMastered" },
		{ key: "fresh", labelKey: "dashboard.quizzes.filterFresh" }
	];

	function render(container: HTMLElement): void {
		container.empty();

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── Header ──
		const header = container.createDiv({ cls: "qbd-quizzes-header" });
		header.createEl("h2", { cls: "qbd-quizzes-title", text: t("dashboard.quizzes.title") });

		const newBtn = header.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
		const newIcon = newBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(newIcon, "plus");
		newBtn.createSpan({ text: t("dashboard.quizzes.new") });
		newBtn.addEventListener("click", async () => {
			const existing = ctx.app.workspace.getLeavesOfType(VIEW_TYPE);
			let leaf: WorkspaceLeaf;
			if (existing.length > 0) {
				leaf = existing[0];
				ctx.app.workspace.revealLeaf(leaf);
			} else {
				leaf = ctx.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
				ctx.app.workspace.revealLeaf(leaf);
			}
		});

		// ── Search ──
		const searchWrap = container.createDiv({ cls: "qbd-quizzes-search" });
		const searchIcon = searchWrap.createSpan({ cls: "qbd-quizzes-search-icon" });
		setIcon(searchIcon, "search");

		const searchInput = searchWrap.createEl("input", {
			type: "text",
			placeholder: t("dashboard.quizzes.search"),
			cls: "qbd-quizzes-search-input"
		});
		searchInput.value = searchQuery;
		searchInput.addEventListener("input", (e) => {
			searchQuery = (e.target as HTMLInputElement).value;
			renderQuizGrid(gridEl, quizzes, stats);
		});

		// ── Filters ──
		const filterBar = container.createDiv({ cls: "qbd-quizzes-filters" });
		for (const filter of FILTERS) {
			const btn = filterBar.createEl("button", {
				cls: `qbd-filter-pill ${currentFilter === filter.key ? "qbd-filter-pill--active" : ""}`,
				text: t(filter.labelKey)
			});
			btn.addEventListener("click", () => {
				currentFilter = filter.key;
				render(container);
			});
		}

		// ── Grid ──
		const gridEl = container.createDiv({ cls: "qbd-home-grid" });
		renderQuizGrid(gridEl, quizzes, stats);
	}

	function renderQuizGrid(gridEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		gridEl.empty();

		const filtered = quizzes.filter(q => {
			// Search filter
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) {
				return false;
			}

			const s = stats[q.path];
			if (currentFilter === "progress") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "mastered") return s && s.bestScore >= 80;
			if (currentFilter === "fresh") return !s || s.questionsDone === 0;
			return true;
		});

		if (filtered.length === 0) {
			gridEl.createDiv({ cls: "qbd-empty-state" }, el => {
				el.createEl("p", { text: t("dashboard.quizzes.empty") });
			});
			return;
		}

		for (const quiz of filtered) {
			renderQuizCard(gridEl, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }));
		}
	}

	return { render };
}
