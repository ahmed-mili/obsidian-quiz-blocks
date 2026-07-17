import { setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../editor";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";
import { buildQuizTree, MASTERY_THRESHOLD } from "./quiz-tree";
import type { QuizTreeNode } from "./quiz-tree";

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

	/* L'accès réel aux réglages est `ctx.plugin.settings.<clé>` (même patron
	   qu'ai.ts). Lu à CHAQUE rendu : le réglage peut changer sous nos pieds
	   (autre appareil, rechargement). */
	function collapsedSet(): Set<string> {
		return new Set(ctx.plugin.settings.quizzesCollapsedFolders || []);
	}

	function toggleCollapsed(path: string): void {
		const set = collapsedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.plugin.settings.quizzesCollapsedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.plugin.saveSettings().catch(() => {});
	}

	/* Le conteneur du dernier rendu. `renderNode` est défini HORS de
	   `render`, donc `container` n'y est pas dans sa portée : sans cette
	   référence, le clic d'un chevron ne pourrait pas re-rendre. Même
	   patron qu'ai.ts:179/215. Réassigné à chaque rendu — ne JAMAIS
	   capturer un nœud DOM d'un rendu précédent, `render` fait
	   `container.empty()`. */
	let containerRef: HTMLElement | null = null;

	// Clés de traduction (pas de libellés) : la liste est construite à
	// l'ouverture de la vue, les libellés sont résolus à chaque rendu.
	const FILTERS: Array<{ key: FilterKey; labelKey: TransKey }> = [
		{ key: "all", labelKey: "dashboard.quizzes.filterAll" },
		{ key: "progress", labelKey: "dashboard.quizzes.filterProgress" },
		{ key: "mastered", labelKey: "dashboard.quizzes.filterMastered" },
		{ key: "fresh", labelKey: "dashboard.quizzes.filterFresh" }
	];

	function render(container: HTMLElement): void {
		containerRef = container;
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
			renderQuizGrid(treeEl, quizzes, stats);
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

		// ── Arbre ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		renderQuizGrid(treeEl, quizzes, stats);
	}

	/* Indentation : la compaction des chaînes supprime déjà les niveaux
	   creux, mais une hiérarchie réellement profonde ne doit pas écraser
	   les cartes à 360 px de large (Obsidian Android). D'où le plafond. */
	const INDENT_PX = 16;
	const MAX_INDENT_LEVELS = 4;

	function renderQuizGrid(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		treeEl.empty();

		const filtered = quizzes.filter(q => {
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) {
				return false;
			}
			const s = stats[q.path];
			if (currentFilter === "progress") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "mastered") return s && s.bestScore >= MASTERY_THRESHOLD;
			if (currentFilter === "fresh") return !s || s.questionsDone === 0;
			return true;
		});

		if (filtered.length === 0) {
			treeEl.createDiv({ cls: "qbd-empty-state" }, el => {
				el.createEl("p", { text: t("dashboard.quizzes.empty") });
			});
			return;
		}

		// L'arbre est construit sur les quiz RETENUS : un dossier vide après
		// filtrage n'existe pas, et les comptes affichés sont donc honnêtes.
		for (const node of buildQuizTree(filtered, stats)) {
			renderNode(treeEl, node, stats, 0);
		}
	}

	function renderNode(parent: HTMLElement, node: QuizTreeNode, stats: Record<string, QuizStatRecord>, depth: number): void {
		const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });

		// Un bouton, pas un div : focusable et actionnable au clavier sans
		// réimplémenter le rôle.
		const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
		head.type = "button";
		head.style.paddingLeft = (Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX) + "px";
		// Pas d'aria-label ici : Obsidian en fait un tooltip natif qui flotterait
		// au milieu de la page (cf. ai.ts). Le bouton contient déjà du texte
		// (libellé, compte, agrégat) : son nom accessible en découle
		// naturellement, plus utile qu'un libellé générique identique partout.
		// aria-expanded reste : il porte l'état, pas un intitulé redondant.
		const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
		// « path: "" » = les quiz posés à la racine du vault ; le libellé est
		// traduit ICI (au rendu), jamais figé dans la donnée.
		head.createSpan({
			cls: "qbd-quizzes-node-label",
			text: node.path === "" ? t("dashboard.quizzes.noFolder") : node.label,
		});
		head.createSpan({
			cls: "qbd-quizzes-node-count",
			text: t(node.total === 1 ? "dashboard.quizzes.folderCountOne" : "dashboard.quizzes.folderCountOther", { count: node.total }),
		});
		head.createSpan({
			cls: "qbd-quizzes-node-mastered",
			text: t(node.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: node.mastered }),
		});

		// Barre d'avancement : c'est elle qui rend un nœud REPLIÉ encore
		// informatif — sinon replier reviendrait à cacher.
		const bar = head.createDiv({ cls: "qbd-quizzes-node-bar" });
		const fill = bar.createDiv({ cls: "qbd-quizzes-node-bar-fill" });
		fill.style.width = (node.total > 0 ? Math.round(node.mastered / node.total * 100) : 0) + "%";

		// Une recherche déplie TEMPORAIREMENT tout ce qui a des résultats,
		// sans toucher à l'état mémorisé : une recherche ne doit pas
		// reconfigurer la page dans le dos de l'utilisateur. L'arbre étant
		// déjà construit sur les quiz filtrés, un nœud présent A des
		// résultats — d'où la condition sur la seule recherche.
		const collapsed = !searchQuery && collapsedSet().has(node.path);
		setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
		head.setAttribute("aria-expanded", String(!collapsed));

		// Pendant une recherche, `collapsed` est TOUJOURS false : l'affichage
		// est dicté par la recherche, pas par le réglage persisté. Un clic
		// ici ne changerait donc RIEN à l'écran, mais toggleCollapsed
		// écrirait quand même dans quizzesCollapsedFolders — l'utilisateur
		// ne découvrirait le changement qu'en vidant la recherche (le
		// dossier se replierait sans qu'aucune action visible ne l'ait
		// annoncé). On coupe la bascule à la racine (disabled = ni
		// cliquable ni focusable) plutôt que de laisser un clic muet
		// modifier un état invisible : ne PAS retirer ce disabled, ce
		// n'est pas une gêne mais la garde qui manquait dans la spec.
		head.disabled = searchQuery.length > 0;

		head.addEventListener("click", () => {
			toggleCollapsed(node.path);
			if (containerRef) render(containerRef);
		});

		if (collapsed) return;

		const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
		// Sous-dossiers d'abord, cartes ensuite : convention de tout
		// explorateur de fichiers, y compris celui d'Obsidian.
		for (const child of node.children) renderNode(body, child, stats, depth + 1);
		if (node.quizzes.length > 0) {
			const grid = body.createDiv({ cls: "qbd-home-grid" });
			grid.style.paddingLeft = (Math.min(depth + 1, MAX_INDENT_LEVELS) * INDENT_PX) + "px";
			for (const quiz of node.quizzes) {
				// showPath: false — le dossier est écrit juste au-dessus.
				renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), { showPath: false });
			}
		}
	}

	return { render };
}
