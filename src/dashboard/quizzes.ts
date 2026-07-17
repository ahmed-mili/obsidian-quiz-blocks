import { setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../editor";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { MASTERY_THRESHOLD } from "./quiz-mastery";
import { parseModuleMap } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import { renderQuizGrid, renderModuleDrill } from "./quizzes-render";
import type { GroupingKey } from "./quizzes-render";

/* ══════════════════════════════════════════════════════════
   QUIZZES VIEW — Dashboard
   Contrôleur : état, réglages, header/recherche/filtres/sélecteur.
   Le PEINTRE (grille module/UE/activité/type + drill-down) vit dans
   quizzes-render.ts — extrait pour rester sous le plafond de 350
   lignes (cf. rapport Task 4).
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

	/* Axe de regroupement : « module » (défaut, noms + UE de Dashboard.md),
	   « ue » (cartes de module groupées par UE), « recent » (activité) et
	   « type » empruntent l'IDÉE du sélecteur de StudySmarter, pas son
	   exécution. Toute valeur inconnue (dont l'ancienne « folder ») migre
	   vers « module ». */
	function currentGrouping(): GroupingKey {
		const g = ctx.plugin.settings.quizzesGrouping;
		return g === "recent" || g === "type" || g === "ue" || g === "module" ? g : "module";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.plugin.settings.quizzesGrouping = g;
		ctx.plugin.saveSettings().catch(() => {});
	}

	/* Le conteneur du dernier rendu : sans cette référence, un clic (chevron,
	   carte, retour) ne pourrait pas re-rendre depuis un callback capturé
	   dans quizzes-render.ts. Même patron qu'ai.ts:179/215. Réassigné à
	   chaque rendu — ne JAMAIS capturer un nœud DOM d'un rendu précédent,
	   `render` fait `container.empty()`. */
	let containerRef: HTMLElement | null = null;

	/* Table module lue depuis la note de correspondance, mise en cache : la
	   lecture est ASYNC (vault.cachedRead) alors que render() est synchrone.
	   null tant que non chargée → dégradation (moduleForQuiz retombe sur le
	   dossier parent, sans UE). loadModuleMap() la peuple à l'ouverture de la
	   vue puis re-rend. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;
	/* Module ouvert (drill-down) : null = grille ; sinon on affiche les quiz de
	   ce module + un fil d'Ariane. État d'interface, non persisté. */
	let openModuleFolder: string | null = null;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		try {
			const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
			const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
			moduleMap = file ? parseModuleMap(await ctx.app.vault.cachedRead(file)) : { byFolder: new Map(), ueOrder: [] };
		} catch {
			moduleMap = { byFolder: new Map(), ueOrder: [] };
		}
		if (containerRef) render(containerRef);
	}

	/** Map effective au rendu : la vraie si chargée, sinon une map vide (les
	    quiz retombent sur leur dossier parent, sans UE) — ne plante jamais. */
	function effectiveMap(): ModuleMap {
		return moduleMap ?? { byFolder: new Map(), ueOrder: [] };
	}

	function openModule(folder: string): void {
		openModuleFolder = folder;
		if (containerRef) render(containerRef);
	}

	/** Filtre partagé (recherche + pilule active) — grille ET drill-down. */
	function applyFilters(quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): QuizIndexEntry[] {
		return quizzes.filter(q => {
			if (searchQuery && !q.title.toLowerCase().includes(searchQuery.toLowerCase()) && !q.path.toLowerCase().includes(searchQuery.toLowerCase())) {
				return false;
			}
			const s = stats[q.path];
			if (currentFilter === "progress") return s && s.questionsDone > 0 && s.questionsDone < q.questions;
			if (currentFilter === "mastered") return s && s.bestScore >= MASTERY_THRESHOLD;
			if (currentFilter === "fresh") return !s || s.questionsDone === 0;
			return true;
		});
	}

	/* Bascule entre la grille (4 axes) et le drill-down d'un module ouvert —
	   factorisé pour que la recherche (qui re-rend SEULEMENT le contenu, pas
	   tout `render`) suive le même mode que le rendu initial. */
	function renderContent(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (openModuleFolder !== null) {
			renderModuleDrill(treeEl, ctx, quizzes, stats, effectiveMap(), openModuleFolder, applyFilters, () => {
				openModuleFolder = null;
				if (containerRef) render(containerRef);
			});
		} else {
			renderQuizGrid({
				ctx,
				searchActive: searchQuery.length > 0,
				isExpanded: (key) => expandedSet().has(key),
				toggleExpanded,
				rerender: () => { if (containerRef) render(containerRef); },
				openModule,
			}, treeEl, currentGrouping(), applyFilters(quizzes, stats), stats, effectiveMap());
		}
	}

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

	function render(container: HTMLElement): void {
		containerRef = container;
		container.empty();

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// Chargement paresseux, UNE fois : la note de correspondance est lue en
		// async (vault.cachedRead) alors que render() est synchrone — le premier
		// rendu se fait donc sans UE/noms résolus, puis loadModuleMap() re-rend.
		if (!moduleMapLoaded) { void loadModuleMap(); }

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
			renderContent(treeEl, quizzes, stats);
		});

		// ── Regroupement (module / UE / activité / type) ──
		// Masqué en drill-down : l'axe de regroupement n'a pas de sens à
		// l'intérieur d'un module (spec Task 4). Le déclencheur affiche
		// TOUJOURS le mode courant en toutes lettres, jamais une icône seule :
		// sans ça, un utilisateur qui revient après plusieurs jours en mode
		// « Par activité » croirait à un bug plutôt qu'à un mode qu'il a choisi
		// (retour Ahmed 2026-07-17 — StudySmarter est l'inspiration, pas le contrat).
		if (openModuleFolder === null) {
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
		}

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

		// ── Contenu : grille (module/UE/activité/type) ou drill-down d'un module ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		renderContent(treeEl, quizzes, stats);
	}

	return { render };
}
