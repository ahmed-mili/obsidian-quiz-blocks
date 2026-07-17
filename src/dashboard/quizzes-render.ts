import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard, quizTypeLabel } from "./quiz-card";
import { openQuizForPlay } from "./quiz-open";
import { renderModuleCard } from "./module-card";
import { moduleForQuiz, buildModuleGroups, buildUeGroups } from "./quiz-modules";
import type { ModuleMap, ModuleGroup, UeGroup } from "./quiz-modules";
import { buildRecentGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { buildTypeGroups } from "./quiz-type";

/* ══════════════════════════════════════════════════════════
   QUIZZES RENDER — extrait de quizzes.ts (Task 4) pour rester
   sous le plafond de 350 lignes : TOUT ce qui peint le contenu
   de « Mes quiz » (les 4 axes + le drill-down d'un module) vit
   ici. quizzes.ts reste le contrôleur : état, réglages, header/
   recherche/filtres/sélecteur, dispatch vers ce module.
══════════════════════════════════════════════════════════ */

export type GroupingKey = "module" | "ue" | "recent" | "type";

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

/* Compte + agrégat de maîtrise + barre : même formule pour un groupe plat
   (activité/type) et un en-tête d'UE. */
function fillNodeHeadStats(head: HTMLElement, total: number, mastered: number): void {
	head.createSpan({
		cls: "qbd-quizzes-node-count",
		text: t(total === 1 ? "dashboard.quizzes.folderCountOne" : "dashboard.quizzes.folderCountOther", { count: total }),
	});
	head.createSpan({
		cls: "qbd-quizzes-node-mastered",
		text: t(mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther", { count: mastered }),
	});
	// Omise quand rien n'est maîtrisé : une piste vide à 0 % n'apprend rien de
	// plus que le compte juste à côté, et attire l'œil pour rien.
	if (mastered > 0) {
		const bar = head.createDiv({ cls: "qbd-quizzes-node-bar" });
		const fill = bar.createDiv({ cls: "qbd-quizzes-node-bar-fill" });
		fill.style.width = Math.round(mastered / total * 100) + "%";
	}
}

/* Bascule de repli partagée par un groupe plat (activité/type) et un en-tête
   d'UE : repliée tant que la clé n'est pas dans quizzesExpandedFolders,
   forcée ouverte + désactivée pendant une recherche (ne doit pas reconfigurer
   la page dans le dos de l'utilisateur, ni écrire dans le réglage). */
function wireCollapseToggle(deps: GridDeps, head: HTMLButtonElement, chev: HTMLElement, key: string): boolean {
	const collapsed = !deps.searchActive && !deps.isExpanded(key);
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
	const collapsed = wireCollapseToggle(deps, head, chev, key);
	if (collapsed) return;

	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	const grid = body.createDiv({ cls: "qbd-home-grid" });
	for (const quiz of quizzes) {
		// PAS de { showPath: false } : ni titre de dossier ni sous-groupe
		// au-dessus dans ces modes, le chemin reste la seule indication d'où
		// sort le quiz (cf. quiz-card.ts, défaut true).
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => deps.ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(deps.ctx.app, q),
		});
	}
}

/** Grille plate de cartes de module (mode « module »), et corps d'un groupe d'UE. */
function renderModuleGrid(parent: HTMLElement, groups: ModuleGroup[], onOpen: (folder: string) => void): void {
	const grid = parent.createDiv({ cls: "qbd-module-grid" });
	for (const g of groups) renderModuleCard(grid, g, (m) => onOpen(m.folder));
}

/* En-tête d'UE repliable + grille de cartes de module dessous. */
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup): void {
	const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
	const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
	head.type = "button";
	const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
	head.createSpan({ cls: "qbd-quizzes-node-label", text: ue.ue ?? t("dashboard.quizzes.noUe") });
	fillNodeHeadStats(head, ue.total, ue.mastered);
	const collapsed = wireCollapseToggle(deps, head, chev, ue.key);
	if (collapsed) return;
	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	renderModuleGrid(body, ue.modules, deps.openModule);
}

/** Contenu de la grille pour les 4 axes (pas le drill-down) : dispatch par
    mode. `filtered` est DÉJÀ passé au tamis recherche/pilule par l'appelant. */
export function renderQuizGrid(
	deps: GridDeps,
	treeEl: HTMLElement,
	mode: GroupingKey,
	filtered: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap
): void {
	treeEl.empty();
	if (filtered.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}

	if (mode === "recent") {
		for (const g of buildRecentGroups(filtered, stats)) {
			renderFlatGroup(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.total, g.mastered, g.quizzes, stats);
		}
	} else if (mode === "type") {
		// Clé préfixée « type: » — Obsidian interdit « : » dans un chemin, donc
		// aucune collision possible avec une vraie clé de dossier.
		for (const g of buildTypeGroups(filtered, stats)) {
			renderFlatGroup(deps, treeEl, `type:${g.type}`, quizTypeLabel(g.type), g.total, g.mastered, g.quizzes, stats);
		}
	} else if (mode === "ue") {
		// Axe UE : en-tête d'UE repliable, cartes de module dessous ; « Sans
		// UE » (modules non résolus par la note de correspondance) en dernier
		// (garanti par buildUeGroups).
		const modules = buildModuleGroups(filtered, stats, map);
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue);
	} else {
		// Mode « module » (défaut) : grille plate de cartes de module — noms
		// et UE résolus depuis la note de correspondance (map).
		renderModuleGrid(treeEl, buildModuleGroups(filtered, stats, map), deps.openModule);
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
	onBack: () => void
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
		});
	}
}
