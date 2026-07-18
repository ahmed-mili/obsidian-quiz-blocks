import { setIcon, getIconIds } from "obsidian";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   ICON PICKER — sélecteur d'icône Lucide pour la carte de module
   (« Modifier dossier »). Portalé au MODAL (comme color-picker) →
   pas de vol de focus. Trois zones : une barre de RECHERCHE (accès à
   TOUTES les icônes via getIconIds), une section « Suggérées »
   (icônes proposées d'après le module, cf. icon-suggest.ts) et une
   grille curée par défaut. Un clic émet onChange + ferme.
══════════════════════════════════════════════════════════ */

/** Grille CURÉE affichée par défaut (sans recherche) — un jeu lisible et beau
    pour des matières / modules ; la recherche donne accès à tout le set Lucide. */
export const MODULE_ICONS = [
	"book", "book-text", "book-marked", "notebook", "notebook-text", "library",
	"graduation-cap", "file-text", "folder", "layers", "brain", "lightbulb",
	"target", "trophy", "star", "flask-conical", "atom", "microscope",
	"calculator", "sigma", "function-square", "dna", "cpu", "circuit-board",
	"code", "code-xml", "terminal", "braces", "binary", "bug",
	"network", "wifi", "router", "share-2", "cloud", "boxes",
	"shield-check", "shield", "lock", "key-round", "database", "server",
	"server-cog", "hard-drive", "monitor-cog", "globe", "languages", "map",
	"palette", "pen-tool", "music", "film", "briefcase", "list-checks",
	"scale", "trending-up", "rocket", "sparkles",
];

/** Icône d'un module sans choix explicite (fallback carte + aperçu modal). */
export const DEFAULT_MODULE_ICON = "book";

const COLS = 6;
const CELL = 34;
const GAP = 4;
const PAD = 10;
const PICKER_W = COLS * CELL + (COLS - 1) * GAP + 2 * PAD;
const SCROLL_MAX = 260;
/* Hauteur totale bornée pour le clamp au viewport : recherche + scroll + pads. */
const PICKER_H = 44 + SCROLL_MAX + 2 * PAD;

/** Tout le set d'icônes disponible (Lucide + custom), normalisé et trié —
    calculé une fois. Le préfixe « lucide- » est retiré (setIcon accepte les
    deux, on reste cohérent avec les noms nus stockés). */
let ALL_ICONS: string[] | null = null;
function allIcons(): string[] {
	if (ALL_ICONS) return ALL_ICONS;
	const seen = new Set<string>();
	for (const id of getIconIds()) seen.add(id.replace(/^lucide-/, ""));
	ALL_ICONS = [...seen].sort();
	return ALL_ICONS;
}

export interface IconPickerHandle {
	close(): void;
}

export function openIconPicker(
	anchorEl: HTMLElement,
	current: string | undefined,
	onChange: (icon: string) => void,
	container: HTMLElement = document.body,
	suggestions: string[] = []
): IconPickerHandle {
	const anchorRect = anchorEl.getBoundingClientRect();

	const root = container.createDiv({ cls: "qbd-icon-picker" });
	root.style.width = PICKER_W + "px";
	root.addEventListener("mousedown", (e) => e.stopPropagation());

	// ── Position clampée au viewport, flip au-dessus si trop bas ──
	let top = anchorRect.bottom + 6;
	if (top + PICKER_H > window.innerHeight - 8)
		top = Math.max(8, anchorRect.top - PICKER_H - 6);
	const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 8 - PICKER_W));
	root.style.top = top + "px";
	root.style.left = left + "px";

	// ── Barre de recherche ──
	const searchWrap = root.createDiv({ cls: "qbd-icon-search-wrap" });
	const searchIcon = searchWrap.createSpan({ cls: "qbd-icon-search-icon" });
	setIcon(searchIcon, "search");
	const search = searchWrap.createEl("input", { cls: "qbd-icon-search", type: "text" });
	search.placeholder = t("dashboard.quizzes.moduleIconSearch");
	search.spellcheck = false;

	// ── Zone scrollable (sections) ──
	const scroll = root.createDiv({ cls: "qbd-icon-scroll" });
	scroll.style.maxHeight = SCROLL_MAX + "px";

	const cellFor = (grid: HTMLElement, name: string) => {
		const cell = grid.createEl("button", { cls: "qbd-icon-cell" });
		cell.type = "button";
		setIcon(cell, name);
		cell.title = name;
		if (name === current) cell.addClass("is-active");
		cell.addEventListener("click", () => { onChange(name); close(); });
	};
	const section = (label: string | null, icons: string[]) => {
		if (label) scroll.createDiv({ cls: "qbd-icon-section-label", text: label });
		const grid = scroll.createDiv({ cls: "qbd-icon-grid" });
		for (const name of icons) cellFor(grid, name);
	};

	function render(query: string): void {
		scroll.empty();
		const q = query.trim().toLowerCase();
		if (!q) {
			// Vue par défaut : suggestions (si module reconnu) + grille curée.
			if (suggestions.length) section(t("dashboard.quizzes.moduleIconSuggested"), suggestions);
			section(suggestions.length ? t("dashboard.quizzes.moduleIconAll") : null, MODULE_ICONS);
			return;
		}
		// Recherche : tout le set Lucide, borné pour la perf.
		const hits = allIcons().filter(n => n.includes(q)).slice(0, 60);
		if (hits.length) section(null, hits);
		else scroll.createDiv({ cls: "qbd-icon-empty", text: t("dashboard.quizzes.moduleIconNoResult") });
	}
	render("");
	search.addEventListener("input", () => render(search.value));

	// ── Dismiss clic-dehors / Escape ──
	const onDocDown = (e: MouseEvent) => {
		if (!root.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocDown);
	document.addEventListener("keydown", onKey);

	function close(): void {
		document.removeEventListener("mousedown", onDocDown);
		document.removeEventListener("keydown", onKey);
		root.remove();
	}

	// Focus la recherche à l'ouverture (le picker est dans le modal → pas de vol).
	window.setTimeout(() => search.focus(), 0);
	return { close };
}
