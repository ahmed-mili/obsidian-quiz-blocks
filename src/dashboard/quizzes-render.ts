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
import { buildRecentModuleGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { moduleAccent } from "./module-color";
import { openIconPicker } from "./icon-picker";
import { suggestIcons } from "./icon-suggest";

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
   (La recherche a été retirée de la vue le 2026-07-18.) */
function wireCollapseToggle(deps: GridDeps, nodeEl: HTMLElement, head: HTMLButtonElement, chev: HTMLElement, key: string, defaultOpen = true): void {
	const collapsed = defaultOpen ? deps.isExpanded(key) : !deps.isExpanded(key);
	// UN SEUL icône (chevron-right) : l'orientation « ouvert » est une ROTATION
	// CSS animée, pas un second icône — c'est ce qui rend la flèche fluide.
	setIcon(chev, "chevron-right");
	nodeEl.classList.toggle("is-collapsed", collapsed);
	head.setAttribute("aria-expanded", String(!collapsed));
	// Un SEUL filet et un SEUL listener transitionend vivants par nœud : des
	// clics enchaînés accumulaient les stopAnim des clics précédents, et un
	// filet orphelin retirait is-animating EN PLEINE animation suivante —
	// l'overflow (et désormais la visibility du repli stable) basculait en
	// plein mouvement.
	let animTimer = 0;
	let offEnd: (() => void) | null = null;
	head.addEventListener("click", () => {
		// Bascule PUREMENT CSS : le corps reste monté, sa hauteur s'anime
		// (grid-template-rows). On persiste l'état (toggleExpanded) mais SANS
		// rerender — un rerender détruirait le DOM et tuerait la transition.
		deps.toggleExpanded(key);
		// Purge du cycle d'animation précédent avant d'en ouvrir un nouveau.
		window.clearTimeout(animTimer);
		offEnd?.();
		// Clip pendant TOUTE la transition (is-animating), retiré à la fin : à
		// l'état ouvert stable le corps repasse en overflow visible, sinon il
		// rogne la carte quand elle se surélève au survol.
		nodeEl.classList.add("is-animating");
		const nowCollapsed = nodeEl.classList.toggle("is-collapsed");
		head.setAttribute("aria-expanded", String(!nowCollapsed));
		const body = nodeEl.querySelector(".qbd-quizzes-node-body");
		const stopAnim = () => {
			window.clearTimeout(animTimer);
			offEnd?.();
			nodeEl.classList.remove("is-animating");
		};
		if (body) {
			const onEnd = (e: Event) => {
				const te = e as TransitionEvent;
				// Cibler le corps LUI-MÊME : un transitionend d'un descendant
				// bouillonne jusqu'ici et arrêterait l'animation trop tôt.
				if (te.target !== body || te.propertyName !== "grid-template-rows") return;
				stopAnim();
			};
			offEnd = () => {
				body.removeEventListener("transitionend", onEnd);
				offEnd = null;
			};
			body.addEventListener("transitionend", onEnd);
		}
		// Filet : reduced-motion (pas de transitionend) ou transition coupée.
		animTimer = window.setTimeout(stopAnim, 320);
	});
}

/* Section repliable générique : en-tête (chevron + libellé + badge) + corps.
   Le corps reste TOUJOURS monté pour animer la hauteur. Son enfant dédié
   sépare le clipping de la grille qui peint les bordures des cartes. */
function renderCollapsibleSection(deps: GridDeps, parent: HTMLElement, key: string, label: string, total: number, defaultOpen = true): HTMLElement {
	const nodeEl = parent.createDiv({ cls: "qbd-quizzes-node" });
	const head = nodeEl.createEl("button", { cls: "qbd-quizzes-node-head" });
	head.type = "button";
	const chev = head.createSpan({ cls: "qbd-quizzes-node-chevron" });
	head.createSpan({ cls: "qbd-quizzes-node-label", text: label });
	fillNodeHeadStats(head, total);
	wireCollapseToggle(deps, nodeEl, head, chev, key, defaultOpen);
	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	return body.createDiv({ cls: "qbd-quizzes-node-clip" });
}

/** Grille plate de cartes de module (mode « module » et corps d'un groupe d'UE).
    La carte affiche toujours son sous-titre UE (demande d'Ahmed : l'UE sur la
    carte façon StudySmarter, même sous un en-tête d'UE — comme StudySmarter
    garde le sous-titre d'une carte dans une section groupée). */
function renderModuleGrid(deps: GridDeps, parent: HTMLElement, groups: ModuleGroup[], map: ModuleMap): void {
	const grid = parent.createDiv({ cls: "qbd-module-grid" });
	const menu = buildModuleCardMenu(deps.ctx, deps.rerender, map);
	// Raccourci « changer l'icône » depuis la pastille de la carte : picker
	// portalé au body (pas de modal ici) → override + save + rerender.
	const pickIcon = (group: ModuleGroup, anchor: HTMLElement) => {
		openIconPicker(anchor, group.icon, (name) => {
			const overrides = { ...(deps.ctx.plugin.settings.quizzesModuleOverrides || {}) };
			overrides[group.folder] = { ...(overrides[group.folder] || {}), icon: name };
			deps.ctx.plugin.settings.quizzesModuleOverrides = overrides;
			deps.ctx.plugin.saveSettings().catch(() => {});
			deps.rerender();
		}, document.body, suggestIcons(group.name, group.ue));
	};
	for (const g of groups) renderModuleCard(grid, g, (m) => deps.openModule(m.folder), menu, pickIcon);
}

/* En-tête d'UE repliable + grille de cartes de module dessous. Badge = nombre
   d'éléments DIRECTS de la section (les modules), comme le compteur des
   sections « Mes dossiers » de StudySmarter. */
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup, map: ModuleMap): void {
	const body = renderCollapsibleSection(deps, parent, ue.key, ue.ue ?? t("dashboard.quizzes.noUe"), ue.modules.length);
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
	/** Quiz des DOSSIERS archivés — rendus en CARTES DE DOSSIER dans une
	    section repliable en pied de grille (jamais de cartes de quiz :
	    l'archivage n'existe qu'au niveau dossier, Ahmed 2026-07-19). */
	archivedQuizzes: QuizIndexEntry[] = []
): void {
	treeEl.empty();
	const archivedFolders = deps.ctx.plugin.settings.quizzesArchivedFolders || [];
	if (filtered.length === 0 && archivedQuizzes.length === 0 && archivedFolders.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}

	// Les deux axes affichent des cartes de MODULE (règle Ahmed 2026-07-18 :
	// « Recent » ne montre que les dossiers, jamais des quiz). Les dossiers
	// déclarés par le modal Nouveau dossier / Modifier dossier existent même
	// sans quiz (alwaysInclude) — SAUF archivés : leur carte vit uniquement
	// dans la section « Archivés » (sinon elle resterait en grille à 0 quiz).
	const alwaysInclude = Object.keys(deps.ctx.plugin.settings.quizzesModuleOverrides || {})
		.filter(f => !archivedFolders.includes(f));
	const modules = buildModuleGroups(filtered, stats, map, alwaysInclude);

	if (mode === "recent") {
		for (const g of buildRecentModuleGroups(modules, stats)) {
			const body = renderCollapsibleSection(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.modules.length);
			renderModuleGrid(deps, body, g.modules, map);
		}
	} else {
		// Axe UE (défaut) : en-tête d'UE repliable, cartes de module dessous ;
		// « Sans UE » (modules non résolus) en dernier (garanti par buildUeGroups).
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue, map);
	}

	// ── Section « Archivés » en pied de grille (tous les axes) — repliée par
	// défaut, CARTES DE DOSSIER (menu ⋯ complet : Unarchive direct, drill au
	// clic). Les dossiers archivés sans quiz restent listés (alwaysInclude =
	// tous les dossiers du flag). Clé « archived: » : « : » est interdit dans
	// un chemin Obsidian, aucune collision possible.
	if (archivedQuizzes.length > 0 || archivedFolders.length > 0) {
		const archivedModules = buildModuleGroups(archivedQuizzes, stats, map, archivedFolders);
		const body = renderCollapsibleSection(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archivedModules.length, false);
		renderModuleGrid(deps, body, archivedModules, map);
	}
}

/** Filtre partagé (exclusion des archivés) — grille ET drill-down. */
export type ApplyFilters = (quizzes: QuizIndexEntry[]) => QuizIndexEntry[];

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

	const inModule = applyFilters(quizzes).filter(q => moduleForQuiz(q.path, map).folder === openModuleFolder);
	if (inModule.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}
	// Tous les quiz du module ouvert partagent l'accent de CE dossier.
	const accent = moduleAccent(info ?? { folder: openModuleFolder });
	const grid = treeEl.createDiv({ cls: "qbd-home-grid" });
	for (const quiz of inModule) {
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(ctx.app, q),
			menu: buildQuizCardMenu(ctx, rerender),
			accent,
		});
	}
}
