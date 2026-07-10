'use strict';

/* ══════════════════════════════════════════════════════════
   QUIZZES VIEW — Dashboard
   Header + search + filtres + grid de QuizCards
══════════════════════════════════════════════════════════ */

function createQuizzesHandlers(ctx) {
	let currentFilter = "Tous";
	let searchQuery = "";

	const FILTERS = ["Tous", "En cours", "Maîtrisés", "Non commencés"];

	function render(container) {
		container.empty();

		const quizzes = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── Header ──
		const header = container.createDiv({ cls: "qbd-quizzes-header" });
		header.createEl("h2", { cls: "qbd-quizzes-title", text: "Mes quiz" });

		const newBtn = header.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
		const newIcon = newBtn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(newIcon, "plus");
		newBtn.createSpan({ text: "Nouveau" });
		newBtn.addEventListener("click", async () => {
			const { QuizBuilderView, VIEW_TYPE } = require("../editor");
			const existing = ctx.app.workspace.getLeavesOfType(VIEW_TYPE);
			let leaf;
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
		obsidian.setIcon(searchIcon, "search");

		const searchInput = searchWrap.createEl("input", {
			type: "text",
			placeholder: "Rechercher…",
			cls: "qbd-quizzes-search-input"
		});
		searchInput.value = searchQuery;
		searchInput.addEventListener("input", (e) => {
			searchQuery = e.target.value;
			renderQuizGrid(gridEl, quizzes, stats);
		});

		// ── Filters ──
		const filterBar = container.createDiv({ cls: "qbd-quizzes-filters" });
		for (const filter of FILTERS) {
			const btn = filterBar.createEl("button", {
				cls: `qbd-filter-pill ${currentFilter === filter ? "qbd-filter-pill--active" : ""}`,
				text: filter
			});
			btn.addEventListener("click", () => {
				currentFilter = filter;
				render(container);
			});
		}

		// ── Grid ──
		const gridEl = container.createDiv({ cls: "qbd-home-grid" });
		renderQuizGrid(gridEl, quizzes, stats);
	}

	function renderQuizGrid(gridEl, quizzes, stats) {
		gridEl.empty();

		const filtered = quizzes.filter(q => {
			// Search filter
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) {
				return false;
			}

			const s = stats[q.path];
			if (currentFilter === "En cours") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "Maîtrisés") return s && s.bestScore >= 80;
			if (currentFilter === "Non commencés") return !s || s.questionsDone === 0;
			return true;
		});

		if (filtered.length === 0) {
			gridEl.createDiv({ cls: "qbd-empty-state" }, el => {
				el.createEl("p", { text: "Aucun quiz trouvé" });
			});
			return;
		}

		for (const quiz of filtered) {
			renderQuizCard(gridEl, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }));
		}
	}

	return { render };
}

const obsidian = require("obsidian");
const renderQuizCard = require("./quiz-card");
module.exports = createQuizzesHandlers;