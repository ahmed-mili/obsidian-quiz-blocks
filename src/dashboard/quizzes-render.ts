import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";
import { openQuizForPlay } from "./quiz-open";
import { buildQuizCardMenu, buildModuleCardMenu } from "./quiz-menu";
import { renderModuleCard } from "./module-card";
import { moduleForQuiz, buildModuleGroups, buildUeGroups } from "./quiz-modules";
import type { ModuleMap, ModuleGroup, UeGroup } from "./quiz-modules";
import { buildRecentGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";

/* ══════════════════════════════════════════════════════════
   QUIZZES RENDER — extrait de quizzes.ts (Task 4) pour rester
   sous le plafond de 350 lignes : TOUT ce qui peint le contenu
   de « Mes quiz » (les 4 axes + le drill-down d'un module) vit
   ici. quizzes.ts reste le contrôleur : état, réglages, header/
   recherche/filtres/sélecteur, dispatch vers ce module.
══════════════════════════════════════════════════════════ */

/* Deux axes seulement depuis la demande Excalidraw 2026-07-18 (« on ne doit
   voir que UE ou Recent ») ; « module » et « type » ont été retirés. */
export type GroupingKey = "ue" | "recent";

/** Dépendances d'ÉTAT fournies par le contrôleur (réglages, recherche,
    re-rendu) — tout ce qui n'est pas pur DOM reste côté quizzes.ts. */
export interface GridDeps {
	ctx: DashboardCtx;
	/** Recherche active : force les groupes ouverts et désactive le repli. */
	searchActive: boolean;
	isExpanded: (key: string) => boolean;
	toggleExpanded: (key: string) => void;
	rerender: () => void;
	openModule: (folder: string) => void;
}

const RECENT_GROUP_LABEL_KEYS: Record<RecentGroupKey, TransKey> = {
	"recent:7d": "dashboard.quizzes.recentWeek",
	"recent:30d": "dashboard.quizzes.recentMonth",
	"recent:older": "dashboard.quizzes.recentOlder",
};

/* En-tête de section — copie LITTÉRALE de StudySmarter (capture Ahmed
   2026-07-18) : chevron + libellé gras + BADGE compteur, rien d'autre
   (ni agrégat de maîtrise, ni barre). */
function fillNodeHeadStats(head: HTMLElement, total: number): void {
	head.createSpan({ cls: "qbd-quizzes-node-badge", text: String(total) });
}

/* Bascule de repli partagée par un groupe (activité, UE, archivés).
   `defaultOpen` (les sections StudySmarter sont OUVERTES par défaut —
   capture 2026-07-18) inverse la lecture du réglage : la clé présente dans
   quizzesExpandedFolders signifie alors « repliée par l'utilisateur ».
   Recherche : forcée ouverte + bascule désactivée (ne reconfigure jamais la
   page dans le dos de l'utilisateur, n'écrit pas dans le réglage). */
function wireCollapseToggle(deps: GridDeps, head: HTMLButtonElement, chev: HTMLElement, key: string, defaultOpen = true): boolean {
	const collapsed = !deps.searchActive && (defaultOpen ? deps.isExpanded(key) : !deps.isExpanded(key));
	setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
	head.setAttribute("aria-expanded", String(!collapsed));
	head.disabled = deps.searchActive;
	head.addEventListener("click", () => { deps.toggleExpanded(key); deps.rerender(); });
	return collapsed;
}

/* Rendu partagé des modes « recent » et « type » : groupe PLAT (pas de
   sous-groupes), même en-tête visuel qu'un en-tête d'UE. */
function renderFlatGroup(
	deps: GridDeps,
	parent: HTMLElement,
	key: string,
	label: string,
	total: number,
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	/** false = section repliée par défaut (seulement « Archivés »). */
	defaultOpen = true
): void {
	const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
	const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
	head.type = "button";
	const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
	head.createSpan({ cls: "qbd-quizzes-node-label", text: label });
	fillNodeHeadStats(head, total);
	const collapsed = wireCollapseToggle(deps, head, chev, key, defaultOpen);
	if (collapsed) return;

	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	const grid = body.createDiv({ cls: "qbd-home-grid" });
	for (const quiz of quizzes) {
		// PAS de { showPath: false } : ni titre de dossier ni sous-groupe
		// au-dessus dans ces modes, le chemin reste la seule indication d'où
		// sort le quiz (cf. quiz-card.ts, défaut true).
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => deps.ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(deps.ctx.app, q),
			menu: buildQuizCardMenu(deps.ctx, deps.rerender),
		});
	}
}

/** Grille plate de cartes de module (mode « module » et corps d'un groupe d'UE).
    La carte affiche toujours son sous-titre UE (demande d'Ahmed : l'UE sur la
    carte façon StudySmarter, même sous un en-tête d'UE — comme StudySmarter
    garde le sous-titre d'une carte dans une section groupée). */
function renderModuleGrid(deps: GridDeps, parent: HTMLElement, groups: ModuleGroup[], map: ModuleMap): void {
	const grid = parent.createDiv({ cls: "qbd-module-grid" });
	const menu = buildModuleCardMenu(deps.ctx, deps.rerender, map);
	for (const g of groups) renderModuleCard(grid, g, (m) => deps.openModule(m.folder), menu);
}

/* En-tête d'UE repliable + grille de cartes de module dessous. */
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup, map: ModuleMap): void {
	const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
	const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
	head.type = "button";
	const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
	head.createSpan({ cls: "qbd-quizzes-node-label", text: ue.ue ?? t("dashboard.quizzes.noUe") });
	// Badge = nombre d'éléments DIRECTS de la section (les modules), comme le
	// compteur des sections « Mes dossiers » de StudySmarter.
	fillNodeHeadStats(head, ue.modules.length);
	const collapsed = wireCollapseToggle(deps, head, chev, ue.key);
	if (collapsed) return;
	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	renderModuleGrid(deps, body, ue.modules, map);
}

/** Contenu de la grille pour les 4 axes (pas le drill-down) : dispatch par
    mode. `filtered` est DÉJÀ passé au tamis recherche/pilule par l'appelant. */
export function renderQuizGrid(
	deps: GridDeps,
	treeEl: HTMLElement,
	mode: GroupingKey,
	filtered: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	/** Quiz archivés (déjà passés au tamis recherche) — rendus dans une
	    section repliable en PIED de grille, comme la section « Archived »
	    au bas de la Library StudySmarter. */
	archived: QuizIndexEntry[] = []
): void {
	treeEl.empty();
	if (filtered.length === 0 && archived.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}

	if (mode === "recent") {
		for (const g of buildRecentGroups(filtered, stats)) {
			renderFlatGroup(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.total, g.quizzes, stats);
		}
	} else {
		// Axe UE (défaut) : en-tête d'UE repliable, cartes de module dessous ;
		// « Sans UE » (modules non résolus) en dernier (garanti par buildUeGroups).
		const modules = buildModuleGroups(filtered, stats, map);
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue, map);
	}

	// ── Section « Archivés » en pied de grille (tous les axes) — repliée par
	// défaut, même en-tête repliable que les groupes plats. Clé « archived: » :
	// « : » est interdit dans un chemin Obsidian, aucune collision possible.
	if (archived.length > 0) {
		renderFlatGroup(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archived.length, archived, stats, false);
	}
}

/** Filtre partagé (recherche + pilule active) — grille ET drill-down. */
export type ApplyFilters = (quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>) => QuizIndexEntry[];

/* Drill-down : fil d'Ariane (« Tous les quiz » › nom du module) + les quiz de
   CE module, filtrés (recherche + pilule) comme la grille. moduleForQuiz (pas
   buildModuleGroups par quiz) : O(1) par quiz au lieu de reconstruire un
   groupe entier à chaque itération. */
export function renderModuleDrill(
	treeEl: HTMLElement,
	ctx: DashboardCtx,
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	openModuleFolder: string,
	applyFilters: ApplyFilters,
	onBack: () => void,
	/* Re-rendu SANS refermer le drill-down (reset de stats depuis le menu ⋯). */
	rerender: () => void
): void {
	treeEl.empty();

	const crumb = treeEl.createDiv({ cls: "qbd-quizzes-breadcrumb" });
	const back = crumb.createEl("button", { cls: "qbd-quizzes-crumb-back" });
	back.type = "button";
	const backIcon = back.createSpan({ cls: "qbd-quizzes-crumb-icon" });
	setIcon(backIcon, "chevron-left");
	back.createSpan({ text: t("dashboard.quizzes.backToModules") });
	back.addEventListener("click", onBack);

	// Nom du module ouvert (depuis la table ; fallback = le dossier).
	const info = map.byFolder.get(openModuleFolder);
	crumb.createSpan({ cls: "qbd-quizzes-crumb-current", text: info ? info.name : openModuleFolder });

	const inModule = applyFilters(quizzes, stats).filter(q => moduleForQuiz(q.path, map).folder === openModuleFolder);
	if (inModule.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}
	const grid = treeEl.createDiv({ cls: "qbd-home-grid" });
	for (const quiz of inModule) {
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(ctx.app, q),
			menu: buildQuizCardMenu(ctx, rerender),
		});
	}
}
