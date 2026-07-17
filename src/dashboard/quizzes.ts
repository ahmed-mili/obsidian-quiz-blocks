import { setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../editor";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard, quizTypeLabel } from "./quiz-card";
import { openQuizForPlay } from "./quiz-open";
import { MASTERY_THRESHOLD } from "./quiz-mastery";
import { buildModuleGroups } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { buildRecentGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { buildTypeGroups } from "./quiz-type";
import { openActionMenu } from "./ui-select";

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
	   (autre appareil, rechargement). Le réglage liste les groupes DÉPLIÉS
	   (replié = défaut) : à 200 quiz, tout déplier d'office reproduit le mur
	   qu'on cherche à éviter — cf. défaut n°1, Ahmed 2026-07-17. */
	function expandedSet(): Set<string> {
		return new Set(ctx.plugin.settings.quizzesExpandedFolders || []);
	}

	function toggleExpanded(path: string): void {
		const set = expandedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.plugin.settings.quizzesExpandedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.plugin.saveSettings().catch(() => {});
	}

	/* Axe de regroupement de l'arbre : « folder » (défaut, prévisible — le
	   vault tel qu'il est), « recent » (activité) et « type » empruntent
	   l'IDÉE du sélecteur de StudySmarter, pas son exécution (leur libellé
	   « Récents » est ambigu — quoi, ouvert ? modifié ? joué ? — d'où des
	   clés i18n qui répondent d'elles-mêmes : cf. dashboard.ts i18n). */
	type GroupingKey = "module" | "ue" | "recent" | "type";

	function currentGrouping(): GroupingKey {
		const g = ctx.plugin.settings.quizzesGrouping;
		return g === "recent" || g === "type" || g === "ue" || g === "module" ? g : "module";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.plugin.settings.quizzesGrouping = g;
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

	// Ordre FIXE d'affichage dans le menu du sélecteur (pas alphabétique, pas
	// par usage) : « module » est le nouveau défaut prévisible (cf. spec).
	const GROUPING_ORDER: GroupingKey[] = ["module", "ue", "recent", "type"];
	const GROUPING_LABEL_KEYS: Record<GroupingKey, TransKey> = {
		module: "dashboard.quizzes.groupByModule",
		ue: "dashboard.quizzes.groupByUE",
		recent: "dashboard.quizzes.groupByActivity",
		type: "dashboard.quizzes.groupByType"
	};
	// Libellés des 3 groupes du mode « recent » (quiz-recent.ts ne connaît pas
	// t() : c'est ICI, au rendu, que la clé se traduit).
	const RECENT_GROUP_LABEL_KEYS: Record<RecentGroupKey, TransKey> = {
		"recent:7d": "dashboard.quizzes.recentWeek",
		"recent:30d": "dashboard.quizzes.recentMonth",
		"recent:older": "dashboard.quizzes.recentOlder"
	};

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

		// ── Regroupement (dossier / activité / type) ──
		// Le déclencheur affiche TOUJOURS le mode courant en toutes lettres,
		// jamais une icône seule : sans ça, un utilisateur qui revient après
		// plusieurs jours en mode « Par activité » ne verrait plus ses dossiers
		// et croirait à un bug plutôt qu'à un mode qu'il a choisi (retour Ahmed
		// 2026-07-17 — StudySmarter est la source d'inspiration, pas le contrat).
		const groupWrap = container.createDiv({ cls: "qbd-quizzes-group" });
		const groupBtn = groupWrap.createEl("button", { cls: "qbd-select qbd-quizzes-group-select" });
		groupBtn.type = "button";
		const groupLabel = groupBtn.createSpan({ cls: "qbd-select-label" });
		const groupChev = groupBtn.createSpan({ cls: "qbd-select-chevron" });
		setIcon(groupChev, "chevron-down");
		groupLabel.setText(t(GROUPING_LABEL_KEYS[currentGrouping()]));
		groupBtn.addEventListener("click", () => {
			const active = currentGrouping();
			openActionMenu(groupBtn, GROUPING_ORDER.map(g => ({
				icon: g === active ? "check" : undefined,
				label: t(GROUPING_LABEL_KEYS[g]),
				onClick: () => { if (g !== active) { setGrouping(g); render(container); } }
			})));
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

		const mode = currentGrouping();
		if (mode === "recent") {
			for (const g of buildRecentGroups(filtered, stats)) {
				renderFlatGroup(treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.total, g.mastered, g.quizzes, stats);
			}
		} else if (mode === "type") {
			// Clé de repli préfixée « type: » — même garantie que « recent: »
			// juste au-dessus (wireCollapseToggle) : Obsidian interdit « : » dans
			// un nom de fichier/dossier, donc aucune collision possible avec un
			// vrai chemin de vault.
			for (const g of buildTypeGroups(filtered, stats)) {
				renderFlatGroup(treeEl, `type:${g.type}`, quizTypeLabel(g.type), g.total, g.mastered, g.quizzes, stats);
			}
		} else {
			// INTÉRIMAIRE (relief immédiat demandé par Ahmed, 2026-07-17) :
			// regroupement PAR MODULE via les noms de dossier (map vide) plutôt
			// que l'arbre à chemins bruts, qu'Ahmed a rejeté à l'écran. Les quiz
			// sous « syncthing/XTI201 - CCNA 1/ » rejoignent le module
			// « XTI201 - CCNA 1 » (moduleForQuiz remonte l'ancêtre) : ni chemin
			// brut, ni « syncthing ». La grille de cartes de module + UE +
			// drill-down (avec les noms de Dashboard.md) remplace ceci en Task 4.
			const emptyMap: ModuleMap = { byFolder: new Map(), ueOrder: [] };
			for (const g of buildModuleGroups(filtered, stats, emptyMap)) {
				renderFlatGroup(treeEl, `module:${g.folder}`, g.name || t("dashboard.quizzes.noFolder"), g.total, g.mastered, g.quizzes, stats);
			}
		}
	}

	/* Compte + agrégat de maîtrise + barre : même formule pour un nœud de
	   dossier (renderNode) et un groupe plat activité/type (renderFlatGroup). */
	function fillNodeHeadStats(head: HTMLElement, total: number, mastered: number): void {
		head.createSpan({
			cls: "qbd-quizzes-node-count",
			text: t(total === 1 ? "dashboard.quizzes.folderCountOne" : "dashboard.quizzes.folderCountOther", { count: total }),
		});
		head.createSpan({
			cls: "qbd-quizzes-node-mastered",
			text: t(mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: mastered }),
		});
		// Barre d'avancement : c'est elle qui rend un nœud REPLIÉ encore
		// informatif — sinon replier reviendrait à cacher.
		// Omise quand rien n'est maîtrisé : une piste vide à 0 % n'apprend rien
		// de plus que le « 0 mastered » écrit juste à côté, et elle attire
		// l'œil pour rien. Le compte, lui, reste toujours affiché.
		if (mastered > 0) {
			const bar = head.createDiv({ cls: "qbd-quizzes-node-bar" });
			const fill = bar.createDiv({ cls: "qbd-quizzes-node-bar-fill" });
			fill.style.width = Math.round(mastered / total * 100) + "%";
		}
	}

	/* Bascule de repli partagée par un nœud de dossier ET un groupe plat
	   (activité/type) : même mécanique — état lu dans quizzesExpandedFolders
	   (replié tant que la clé n'y figure pas), forcé ouvert pendant une
	   recherche (elle ne doit pas reconfigurer la page dans le dos de
	   l'utilisateur, ET ne doit rien écrire dans le réglage), bouton désactivé
	   pendant la recherche pour ne pas laisser un clic muet modifier un état
	   invisible (ne PAS retirer ce disabled : ce n'est pas une gêne mais la
	   garde qui manquait dans la spec). Seule la CLÉ change selon l'appelant :
	   un chemin de dossier réel pour renderNode, ou une clé préfixée
	   « recent: »/« type: » pour renderFlatGroup. */
	function wireCollapseToggle(head: HTMLButtonElement, chev: HTMLElement, key: string): boolean {
		const collapsed = !searchQuery && !expandedSet().has(key);
		setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
		head.setAttribute("aria-expanded", String(!collapsed));
		head.disabled = searchQuery.length > 0;
		head.addEventListener("click", () => {
			toggleExpanded(key);
			if (containerRef) render(containerRef);
		});
		return collapsed;
	}

	/* Rendu partagé des modes « recent » et « type » : groupes PLATS (pas de
	   sous-groupes), même en-tête visuel qu'un nœud de dossier (cohérence,
	   aucun CSS nouveau). */
	function renderFlatGroup(
		parent: HTMLElement,
		key: string,
		label: string,
		total: number,
		mastered: number,
		quizzes: QuizIndexEntry[],
		stats: Record<string, QuizStatRecord>
	): void {
		const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
		const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
		head.type = "button";
		const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
		head.createSpan({ cls: "qbd-quizzes-node-label", text: label });
		fillNodeHeadStats(head, total, mastered);

		const collapsed = wireCollapseToggle(head, chev, key);
		if (collapsed) return;

		const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
		const grid = body.createDiv({ cls: "qbd-home-grid" });
		for (const quiz of quizzes) {
			// PAS de { showPath: false } ici : ni titre de dossier ni sous-groupe
			// au-dessus dans ces modes, le chemin redevient la seule indication
			// d'où sort le quiz (cf. quiz-card.ts, défaut true).
			renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
				onPlay: (q) => openQuizForPlay(ctx.app, q)
			});
		}
	}

	return { render };
}
