import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { parseModuleMap, applyModuleOverrides } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import { isArchived } from "./quiz-menu";
import { NewFolderModal } from "./module-edit";
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
	/** Referme le drill-down d'un module (état d'interface non persisté).
	    Appelé par le dashboard quand on (re)navigue vers « Mes quiz » via le
	    rail : sans ça, entrer dans un module puis revenir par le rail rouvrirait
	    le module au lieu de la grille (le fil d'Ariane, lui, le remet déjà). */
	resetDrilldown(): void;
}

export function createQuizzesHandlers(ctx: DashboardCtx): QuizzesHandlers {
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

	/* Axe de regroupement : DEUX axes seulement (demande Excalidraw
	   2026-07-18) — « UE » (défaut : en-têtes d'UE, cartes de module dessous)
	   et « Récent » (activité). Toute valeur historique (« module », « type »,
	   « folder »…) migre vers « ue ». */
	function currentGrouping(): GroupingKey {
		const g = ctx.plugin.settings.quizzesGrouping;
		return g === "recent" ? g : "ue";
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
		// Cède TOUJOURS avant de poursuivre : sans ce yield, quand la note de
		// correspondance est absente, getFirstLinkpathDest renvoie null et la
		// branche « map vide » ci-dessous ne traverse alors AUCUN await réel —
		// la fonction (jusqu'à son `if (containerRef) render(...)` final)
		// s'exécute donc de façon SYNCHRONE et RÉENTRANTE, depuis l'intérieur
		// du render() qui vient de l'appeler (juste après `void loadModuleMap()`
		// ligne ~175), avant que CE render() ait fini de construire header/
		// recherche/sélecteur/filtres/contenu. Le render() imbriqué peint une
		// copie complète ; le render() externe reprend ensuite et peint une
		// SECONDE copie par-dessus, sans container.empty() entre les deux →
		// header/recherche/sélecteur/groupe/arbre dupliqués dans le DOM. Ce
		// yield garantit que le render() déclencheur s'est entièrement déroulé
		// avant toute réentrée, quelle que soit la branche empruntée plus bas.
		await Promise.resolve();
		try {
			const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
			const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
			moduleMap = file ? parseModuleMap(await ctx.app.vault.cachedRead(file)) : { byFolder: new Map(), ueOrder: [] };
		} catch {
			moduleMap = { byFolder: new Map(), ueOrder: [] };
		}
		if (containerRef) render(containerRef);
	}

	/** Map effective au rendu : la note si chargée (sinon map vide), TOUJOURS
	    recouverte par les overrides du modal « Modifier dossier » (réglages) —
	    relus à chaque rendu, ils peuvent changer sous nos pieds. */
	function effectiveMap(): ModuleMap {
		const base = moduleMap ?? { byFolder: new Map(), ueOrder: [] };
		return applyModuleOverrides(base, ctx.plugin.settings.quizzesModuleOverrides || {});
	}

	function openModule(folder: string): void {
		openModuleFolder = folder;
		if (containerRef) render(containerRef);
	}

	/** Filtre partagé — grille ET drill-down. Recherche et pilules d'état ont
	    été RETIRÉES (demande Ahmed 2026-07-18) : il ne reste que l'exclusion
	    des ARCHIVÉS, qui ne vivent que dans la section « Archivés » en bas de
	    la grille (contrat StudySmarter vérifié en live). */
	function applyFilters(quizzes: QuizIndexEntry[]): QuizIndexEntry[] {
		return quizzes.filter(q => !isArchived(ctx, q.path));
	}

	/* Bascule entre la grille et le drill-down d'un module ouvert. */
	function renderContent(treeEl: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (openModuleFolder !== null) {
			renderModuleDrill(treeEl, ctx, quizzes, stats, effectiveMap(), openModuleFolder, applyFilters, () => {
				openModuleFolder = null;
				if (containerRef) render(containerRef);
			}, () => { if (containerRef) render(containerRef); });
		} else {
			const archived = quizzes.filter(q => isArchived(ctx, q.path));
			renderQuizGrid({
				ctx,
				isExpanded: (key) => expandedSet().has(key),
				toggleExpanded,
				rerender: () => { if (containerRef) render(containerRef); },
				openModule,
			}, treeEl, currentGrouping(), applyFilters(quizzes), stats, effectiveMap(), archived);
		}
	}

	// Ordre FIXE : « UE » (défaut) puis « Récent » — libellés SANS « By/Par »
	// (demande Excalidraw 2026-07-18 : « on ne doit voir que UE ou Recent »).
	const GROUPING_ORDER: GroupingKey[] = ["ue", "recent"];
	const GROUPING_LABEL_KEYS: Record<GroupingKey, TransKey> = {
		ue: "dashboard.quizzes.groupByUE",
		recent: "dashboard.quizzes.groupByActivity"
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

		// Bouton « Nouveau dossier » — même bouton pilule blanc que « Create
		// Study Set » de StudySmarter (capture 2026-07-18), libellé adapté.
		const newBtn = header.createEl("button", { cls: "qbd-btn--create" });
		const newIcon = newBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(newIcon, "plus");
		newBtn.createSpan({ text: t("dashboard.quizzes.new") });
		newBtn.addEventListener("click", () => {
			new NewFolderModal(ctx, effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); }).open();
		});

		// ── Regroupement (UE / Récent) ──
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

		// ── Contenu : grille (UE/Récent) ou drill-down d'un module ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		renderContent(treeEl, quizzes, stats);
	}

	return {
		render,
		resetDrilldown() { openModuleFolder = null; },
	};
}
