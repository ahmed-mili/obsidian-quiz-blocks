# Picker de mentions « @ » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Taper `@` dans le composer de la page « Générer » ouvre un picker de fichiers façon Claude Code (racine, navigation, recherche fuzzy globale, clavier) dont la sélection attache le fichier via la plomberie de chips existante.

**Architecture:** Deux modules neufs et deux greffes. `file-sources.ts` répond à « où sont les fichiers » (vault via l'API Obsidian, racines externes via `fs` gardé desktop) et ne connaît pas l'UI. `mention-picker.ts` est la glue textarea (détection du token, clavier, cycle de vie). `ui-select.ts` gagne `openMentionMenu`, un menu portalé sans champ de recherche interne, piloté de l'extérieur. `ai.ts` ne reçoit qu'une greffe minimale (Fable 5 travaille dans ce fichier).

**Tech Stack:** TypeScript strict (ESM), API Obsidian (`prepareFuzzySearch`, `TFolder`, `getAllLoadedFiles`, `Platform`), esbuild, aucune dépendance ajoutée.

**Spec:** `docs/superpowers/specs/2026-07-16-mention-picker-design.md`

## Global Constraints

Ces contraintes s'appliquent à **toutes** les tâches, sans être répétées à chaque fois.

- **Aucun framework de test dans ce projet.** La seule vérification automatisée est
  `npm run check` (`tsc --noEmit`). Le cycle TDD habituel ne s'applique pas : chaque tâche
  se termine par `npm run check` **plus** un test manuel décrit explicitement. Ne pas
  ajouter de framework de test (hors périmètre, non demandé).
- **`npm run build` normal** (déploie dans les vaults d'Ahmed : c'est voulu). La contrainte
  d'isolation par `VAULT_PLUGIN_DIR` est LEVÉE depuis le 2026-07-17 : Fable 5 a fini de
  travailler, il n'y a plus de déploiement concurrent à protéger. Le vault de test
  `QuizTest` n'est plus requis ; les tests manuels se font dans le vault **`Efrei`**
  (décision d'Ahmed, 2026-07-17). Efrei est le meilleur banc d'essai, inventaire réel du
  2026-07-17 : 3311 fichiers, 655 dossiers, 455 notes dont **452 avec un espace dans le
  chemin**, 307 PDF, 632 images, et 200 fichiers non attachables (zip/docx/pptx/exe) pour
  éprouver le masquage. Sa racine contient à la fois `Rapport de stage.zip` et le dossier
  `Rapport de stage` : le zip doit être masqué et le dossier rester listé.
- **`isDesktopOnly` reste `false`.** Aucune API Node au chargement ni sur un chemin
  atteignable sur mobile. `require("fs")` **paresseux**, dans la fonction, gardé par
  `if (!Platform.isDesktopApp)` avec repli propre. Pattern de référence :
  `src/dashboard/ai-client.ts:213`, `src/dashboard/ai-providers.ts:449`.
- **Aucune chaîne visible en dur.** Tout passe par `t("<domaine>.<clé>")`. L'anglais
  (`src/i18n/en/*.ts`) est la référence, le français est typé derrière (un oubli devient
  une erreur de compilation). `t()` est appelé **au rendu**, jamais dans une constante
  top-level.
- **`ui-select.ts` est le seul dropdown autorisé.** Jamais de `<select>` natif.
- **Icônes Lucide** via `setIcon()` d'Obsidian, jamais d'emoji ni de caractère Unicode.
- **Commentaires en français.** Modules visés < ~350 lignes.
- **Ne pas modifier `ai-client.ts`** : le contenu attaché passe déjà par `notesBlock`.
- **Ne pas traduire** les clés du format quiz, les `id:` de commandes, les logs, les classes CSS.
- Travail dans le worktree `C:\dev\obsidian-quiz-blocks\.claude\worktrees\mention-picker`,
  branche `feat/mention-picker`. **Les tâches committent, elles ne poussent JAMAIS.** Le
  merge sur `main` et le `git push` final sont faits une seule fois, par le contrôleur, à
  la toute fin (demandé explicitement par Ahmed le 2026-07-17).

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `src/dashboard/file-sources.ts` (créer) | Où sont les fichiers : listing, recherche, résolution. Vault + racines externes. Aucune UI. | 1, 5 |
| `src/dashboard/mention-picker.ts` (créer) | Glue textarea : token `@`, clavier, cycle de vie du menu. | 2 |
| `src/dashboard/ui-select.ts` (modifier) | Ajout d'`openMentionMenu` + `MentionMenuHandle`. | 2 |
| `src/dashboard/ai.ts` (modifier) | Greffe minimale : branchement du picker, garde Entrée, caret. | 2, 3 |
| `src/dashboard/voice-input.ts` (modifier) | Paramètre `isBlocked` pour ne pas s'armer quand le menu est ouvert. | 2 |
| `src/plugin.ts` (modifier) | Réglage `aiMentionExtraFolders` + section du SettingTab. | 4 |
| `src/types/dashboard-ctx.ts` (modifier) | Exposition du réglage à `ai.ts` via `AiSettings`. | 4 |
| `src/i18n/{en,fr}/{ai,settings}.ts` (modifier) | Nouvelles clés. | 2, 4 |
| `src/assets/css/dashboard/dashboard-ai.css` (modifier) | Styles du menu de mentions. | 2 |

---

### Task 0: Vault de test isolé

**Files:**
- Aucun fichier du repo. Crée `C:\obsidian-vaults\QuizTest\`.

**Interfaces:**
- Produces: un vault jetable où déployer les builds sans toucher aux 4 vaults d'Ahmed.

- [ ] **Step 1: Créer le vault via le skill dédié**

Invoquer le skill `vault-creator` (il évite le piège du vault créé à la main avec un
`.obsidian` vide, qui n'aurait pas le plugin installé). Vault : `C:\obsidian-vaults\QuizTest`,
avec le plugin `quiz-blocks` installé et activé.

- [ ] **Step 2: Peupler avec de quoi éprouver le picker**

Le contenu doit couvrir les cas de la spec, sinon le test manuel ne prouve rien :

```
QuizTest/
  Cours/
    Java/
      TD3 avec espaces.md        <- nom à espaces (410/443 notes d'Ahmed en ont)
      TD4.md
    Reseaux/
      TP1.md
  Guides/
    Guide test.md
  Dashboard.md
  schema.png                      <- image (vision)
  archive.zip                     <- format NON attachable : doit rester masqué
```

Chaque `.md` contient quelques paragraphes de cours réels (pas de lorem ipsum : on doit
pouvoir juger si le quiz généré est cohérent).

- [ ] **Step 3: Créer aussi un dossier externe de test**

```bash
mkdir -p "C:/Users/Ahmed/Downloads/quiz-test-externe/sous-dossier"
```
Y déposer un `.pdf` avec du texte, un `.md`, et un `.exe` bidon (qui devra rester masqué).

- [ ] **Step 4: Vérifier le déploiement isolé**

```bash
npm run build
```
Attendu : build OK, et `git -C C:/dev/obsidian-quiz-blocks status --short` inchangé côté
vaults d'Ahmed. Vérifier que `C:/obsidian-vaults/Efrei/.obsidian/plugins/quiz-blocks/main.js`
n'a **pas** été retouché (comparer son `mtime` avant/après).

---

### Task 1: `file-sources.ts` — le vault

**Files:**
- Create: `src/dashboard/file-sources.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `interface FileEntry { name: string; path: string; isFolder: boolean; source: "vault" | "external"; rootLabel?: string }`
  - `function isAttachable(name: string): boolean`
  - `function listVaultFolder(app: App, folderPath: string): FileEntry[]`
  - `function searchVault(app: App, query: string): FileEntry[]`

- [ ] **Step 1: Créer le module**

```ts
import { App, TAbstractFile, TFolder, prepareFuzzySearch } from "obsidian";

/* Une entrée listable dans le picker de mentions. Le picker ne connaît que
   ce type : d'où vient l'entrée (vault, disque) ne le regarde pas. */
export interface FileEntry {
	/** Nom affiché : « TD3.md », « Cours ». */
	name: string;
	/** Vault → chemin relatif au vault. Externe → chemin absolu. */
	path: string;
	isFolder: boolean;
	source: "vault" | "external";
	/** Racine externe d'appartenance, affichée en sous-titre (source « external »). */
	rootLabel?: string;
}

/* Formats que le composer sait réellement attacher (cf. addComposerFiles
   dans ai.ts : images → vision, PDF → texte extrait, texte → chip).
   Tout le reste est masqué : ne jamais proposer ce qu'on refusera. */
const TEXT_EXT = ["md", "txt", "csv", "json", "yaml", "yml", "xml", "html", "css", "js", "ts"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];
const ATTACHABLE_EXT = new Set([...TEXT_EXT, ...IMAGE_EXT, "pdf"]);

export function isAttachable(name: string): boolean {
	const i = name.lastIndexOf(".");
	if (i < 0) return false;
	return ATTACHABLE_EXT.has(name.slice(i + 1).toLowerCase());
}

/* Tri de la référence (capture Claude Code) : fichiers et dossiers
   MÉLANGÉS, alphabétique insensible à la casse. Pas de dossiers d'abord. */
function compareEntries(a: FileEntry, b: FileEntry): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function toVaultEntry(f: TAbstractFile): FileEntry {
	return { name: f.name, path: f.path, isFolder: f instanceof TFolder, source: "vault" };
}

/* Contenu d'un dossier du vault. folderPath vide → racine.
   Zéro I/O : l'arbre est déjà en mémoire dans Obsidian. */
export function listVaultFolder(app: App, folderPath: string): FileEntry[] {
	const folder = folderPath
		? app.vault.getAbstractFileByPath(folderPath)
		: app.vault.getRoot();
	if (!(folder instanceof TFolder)) return [];
	return folder.children
		.filter(c => c instanceof TFolder || isAttachable(c.name))
		.map(toVaultEntry)
		.sort(compareEntries);
}

/* Recherche fuzzy sur le CHEMIN COMPLET, dans tout le vault, toujours
   globale (décision d'Ahmed) : « Cours/ja » matche « Cours/Java/TD3.md »
   parce que le préfixe tapé fait simplement partie du motif — d'où
   l'absence de toute notion de périmètre. Fuzzy natif d'Obsidian
   (prepareFuzzySearch, obsidian.d.ts:5252), tri par score. */
export function searchVault(app: App, query: string): FileEntry[] {
	const fuzzy = prepareFuzzySearch(query);
	const scored: { entry: FileEntry; score: number }[] = [];
	for (const f of app.vault.getAllLoadedFiles()) {
		if (f.path === "/") continue; // la racine elle-même n'est pas une entrée
		if (!(f instanceof TFolder) && !isAttachable(f.name)) continue;
		const r = fuzzy(f.path);
		if (r) scored.push({ entry: toVaultEntry(f), score: r.score });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.map(x => x.entry);
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npm run check`
Expected: exit 0, aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/file-sources.ts
git commit -m "feat(ai): file-sources — listing et recherche fuzzy du vault"
```

---

### Task 2: Le `@` fonctionne sur le vault

Tâche la plus grosse du plan, mais indivisible : sans framework de test, `openMentionMenu`
et `mention-picker.ts` ne sont observables qu'une fois branchés dans `ai.ts`. Elle se
termine par le premier test réel dans Obsidian.

**Files:**
- Modify: `src/dashboard/ui-select.ts` (ajout en fin de fichier, après `openNotePicker`)
- Create: `src/dashboard/mention-picker.ts`
- Modify: `src/dashboard/voice-input.ts:70` (signature) et `:255` (garde dans `onKeyDown`)
- Modify: `src/dashboard/ai.ts` (~563-594)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`
- Modify: `src/assets/css/dashboard/dashboard-ai.css`

**Interfaces:**
- Consumes: `FileEntry`, `isAttachable`, `listVaultFolder`, `searchVault` (Task 1).
- Produces:
  - `interface MentionMenuItem { label: string; sub?: string; icon: string; onChoose: () => void }`
  - `interface MentionMenuHandle extends MenuHandle { setItems(items: MentionMenuItem[], footer?: string): void; moveSelection(delta: number): void; confirm(): boolean }`
  - `function openMentionMenu(anchorEl: HTMLElement, onClose?: () => void): MentionMenuHandle`
  - `interface MentionToken { start: number; query: string }`
  - `function findMentionToken(text: string, caret: number): MentionToken | null`
  - `interface MentionPickerHandle { isOpen(): boolean; detach(): void }`
  - `function attachMentionPicker(app: App, textarea: HTMLTextAreaElement, anchorEl: HTMLElement, opts: MentionPickerOptions): MentionPickerHandle`
  - `interface MentionPickerOptions { onPickVaultFile(path: string): void; onTextReplaced(value: string): void }`

- [ ] **Step 1: `openMentionMenu` dans `ui-select.ts`**

Ajouter en fin de fichier. Modelé sur `openNotePicker` (`ui-select.ts:1313`), avec trois
différences assumées : pas de champ de recherche interne (la frappe reste dans le
textarea), jamais de vol de focus, et une navigation clavier pilotée de l'extérieur.

```ts
export interface MentionMenuItem {
	label: string;
	/** Sous-titre discret : dossier parent, ou racine externe. */
	sub?: string;
	/** Nom d'icône Lucide (setIcon). */
	icon: string;
	/** Trait de séparation AVANT cette entrée (vault → racines hors vault). */
	separatorBefore?: boolean;
	onChoose: () => void;
}

export interface MentionMenuHandle extends MenuHandle {
	setItems(items: MentionMenuItem[], footer?: string): void;
	moveSelection(delta: number): void;
	/** Valide l'entrée sélectionnée. false si la liste est vide. */
	confirm(): boolean;
}

/*
 * openMentionMenu(anchorEl, onClose)
 * Menu du picker « @ ». Contrairement à openNotePicker, il n'a PAS de champ
 * de recherche et ne prend JAMAIS le focus : la frappe reste dans le
 * textarea, qui pilote le menu via setItems(). Ancré sur le composer (et
 * non sur le caret), conformément à la référence Claude Code où la liste
 * s'affiche au-dessus du prompt.
 */
export function openMentionMenu(anchorEl: HTMLElement, onClose?: () => void): MentionMenuHandle {
	closeAllSelects();

	const menuEl = document.body.createDiv({
		cls: "qbd-select-menu qbd-model-menu qbd-note-picker qbd-mention-menu"
	});
	menuEl.setAttribute("role", "listbox");
	const listEl = menuEl.createDiv({ cls: "qbd-model-menu-list" });
	let footerEl: HTMLElement | null = null;

	let items: MentionMenuItem[] = [];
	let sel = 0;

	function paint(): void {
		listEl.empty();
		items.forEach((item, i) => {
			if (item.separatorBefore) listEl.createDiv({ cls: "qbd-mention-sep" });
			const b = listEl.createEl("button", { cls: "qbd-select-option qbd-note-picker-item" });
			b.type = "button";
			b.setAttribute("role", "option");
			if (i === sel) b.addClass("is-selected");
			const ic = b.createSpan({ cls: "qbd-action-menu-icon" });
			setIcon(ic, item.icon);
			const body = b.createDiv({ cls: "qbd-action-menu-body" });
			body.createSpan({ cls: "qbd-select-option-label", text: item.label });
			if (item.sub) body.createSpan({ cls: "qbd-action-menu-sub", text: item.sub });
			// mousedown, pas click : le textarea ne doit jamais perdre le focus.
			b.addEventListener("mousedown", (e) => {
				e.preventDefault();
				closeMenu();
				item.onChoose();
			});
			b.addEventListener("mouseenter", () => { sel = i; paintSelection(); });
		});
		if (!items.length) {
			listEl.createDiv({ cls: "qbd-model-menu-empty", text: t("ai.mention.noMatch") });
		}
	}

	function paintSelection(): void {
		const opts = Array.from(listEl.querySelectorAll(".qbd-select-option"));
		opts.forEach((el, i) => el.toggleClass("is-selected", i === sel));
		const cur = opts[sel] as HTMLElement | undefined;
		if (cur) cur.scrollIntoView({ block: "nearest" });
	}

	function position(): void {
		const rect = anchorEl.getBoundingClientRect();
		menuEl.style.visibility = "hidden";
		menuEl.style.top = "0px";
		menuEl.style.left = "0px";
		const mr = menuEl.getBoundingClientRect();
		const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
		// Référence : la liste s'affiche AU-DESSUS du prompt. On ne bascule
		// en dessous que si le haut manque de place.
		const above = rect.top - 4 - mr.height;
		const top = above >= 8 ? above : rect.bottom + 4;
		menuEl.style.left = left + "px";
		menuEl.style.top = top + "px";
		menuEl.style.visibility = "";
	}

	function closeMenu(): void {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
		if (onClose) onClose();
	}

	function onDocDown(e: MouseEvent): void {
		const n = e.target as Node | null;
		if ((n && anchorEl.contains(n)) || (n && menuEl.contains(n))) return;
		closeMenu();
	}

	function onScroll(e: Event): void {
		const n = e.target as Node | null;
		if (n && menuEl.contains(n)) return;
		closeMenu();
	}

	openMenus.add(closeMenu);
	document.addEventListener("mousedown", onDocDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return {
		close: closeMenu,
		setItems(next: MentionMenuItem[], footer?: string) {
			items = next;
			sel = 0;
			paint();
			if (footerEl) { footerEl.remove(); footerEl = null; }
			if (footer) footerEl = menuEl.createDiv({ cls: "qbd-mention-footer", text: footer });
			position();
		},
		moveSelection(delta: number) {
			if (!items.length) return;
			sel = (sel + delta + items.length) % items.length;
			paintSelection();
		},
		confirm(): boolean {
			const item = items[sel];
			if (!item) return false;
			closeMenu();
			item.onChoose();
			return true;
		},
	};
}
```

Note : `openMenus`, `closeAllSelects`, `setIcon` et `t` sont déjà importés/définis en tête
de `ui-select.ts`. Ne pas les réimporter.

- [ ] **Step 2: Créer `mention-picker.ts`**

```ts
import { App, TFolder } from "obsidian";
import { FileEntry, listVaultFolder, searchVault } from "./file-sources";
import { MentionMenuHandle, MentionMenuItem, openMentionMenu } from "./ui-select";
import { t } from "../i18n";

export interface MentionToken {
	/** Index du « @ » dans le texte. */
	start: number;
	/** Ce qui suit le « @ » jusqu'au caret. */
	query: string;
}

/* Token « @… » actif juste avant le caret, ou null.
   Le « @ » doit être en DÉBUT DE MOT (début du champ, ou précédé d'un
   espace / tabulation / saut de ligne) : « ahmed@gmail.com » n'ouvre donc
   rien. Les espaces sont autorisés DANS le token (410 des 443 notes du
   vault Personal ont un espace dans leur chemin) ; c'est l'absence de
   résultat qui ferme le menu, pas l'espace. Remontée bornée à 200
   caractères pour ne pas scanner un prompt entier à chaque frappe. */
export function findMentionToken(text: string, caret: number): MentionToken | null {
	for (let i = caret - 1; i >= 0 && caret - i <= 200; i--) {
		const ch = text[i];
		if (ch === "\n") return null;
		if (ch !== "@") continue;
		const before = i > 0 ? text[i - 1] : "";
		if (i === 0 || before === " " || before === "\t" || before === "\n") {
			return { start: i, query: text.slice(i + 1, caret) };
		}
		return null; // « @ » collé à un mot : ce n'est pas une mention
	}
	return null;
}

export interface MentionPickerOptions {
	/** Attache un fichier du vault (→ attachNoteVaultFile dans ai.ts). */
	onPickVaultFile(path: string): void;
	/** Le texte du textarea a été réécrit (token retiré / complété). */
	onTextReplaced(value: string): void;
}

export interface MentionPickerHandle {
	/** Le handler Entrée d'ai.ts s'en sert pour ne pas envoyer le prompt. */
	isOpen(): boolean;
	detach(): void;
}

function iconFor(entry: FileEntry): string {
	if (entry.isFolder) return "folder";
	const ext = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
	if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image";
	if (ext === "pdf") return "file-type-2";
	return "file-text";
}

/* Branche le picker « @ » sur le textarea du composer.
   anchorEl = le composer (la liste s'affiche au-dessus, comme dans la
   référence), surtout PAS le caret. */
export function attachMentionPicker(
	app: App,
	textarea: HTMLTextAreaElement,
	anchorEl: HTMLElement,
	opts: MentionPickerOptions
): MentionPickerHandle {
	let menu: MentionMenuHandle | null = null;

	function close(): void {
		if (menu) { const m = menu; menu = null; m.close(); }
	}

	/* Remplace le token « @… » par `replacement` et repositionne le caret
	   juste après. Mute le textarea SANS re-render (le render d'ai.ts
	   reconstruit le DOM et perdrait le caret). */
	function replaceToken(token: MentionToken, replacement: string): void {
		const v = textarea.value;
		const caret = textarea.selectionStart ?? v.length;
		const next = v.slice(0, token.start) + replacement + v.slice(caret);
		textarea.value = next;
		const pos = token.start + replacement.length;
		textarea.setSelectionRange(pos, pos);
		opts.onTextReplaced(next);
	}

	function entriesFor(query: string): FileEntry[] {
		// Token vide ou finissant par « / » → on LISTE ce dossier.
		// Sinon → recherche fuzzy TOUJOURS GLOBALE (jamais restreinte au
		// dossier courant : décision d'Ahmed).
		if (!query) return listVaultFolder(app, "");
		if (query.endsWith("/")) return listVaultFolder(app, query.slice(0, -1));
		return searchVault(app, query);
	}

	function itemsFor(token: MentionToken, entries: FileEntry[]): MentionMenuItem[] {
		return entries.slice(0, 30).map(entry => ({
			label: entry.isFolder ? entry.name + "/" : entry.name,
			sub: entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : undefined,
			icon: iconFor(entry),
			onChoose: () => {
				if (entry.isFolder) {
					// Dossier → on descend dedans, on n'attache jamais.
					replaceToken(token, "@" + entry.path + "/");
					refresh();
					return;
				}
				replaceToken(token, "");
				opts.onPickVaultFile(entry.path);
			},
		}));
	}

	function refresh(): void {
		const token = findMentionToken(textarea.value, textarea.selectionStart ?? 0);
		if (!token) { close(); return; }
		const entries = entriesFor(token.query);
		// Un espace qui ne mène nulle part termine le token.
		if (!entries.length && token.query.includes(" ")) { close(); return; }
		if (!menu) menu = openMentionMenu(anchorEl, () => { menu = null; });
		menu.setItems(itemsFor(token, entries));
	}

	function onInput(): void { refresh(); }

	function onKeyDown(e: KeyboardEvent): void {
		if (!menu) return;
		if (e.key === "ArrowDown") { e.preventDefault(); menu.moveSelection(1); return; }
		if (e.key === "ArrowUp") { e.preventDefault(); menu.moveSelection(-1); return; }
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
		if (e.key === "Enter" || e.key === "Tab") {
			if (e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			menu.confirm();
		}
	}

	function onBlur(): void { close(); }

	textarea.addEventListener("input", onInput);
	// capture: true → passe AVANT le handler Entrée d'ai.ts et celui de la
	// dictée, tous deux attachés en bubble sur le même textarea.
	textarea.addEventListener("keydown", onKeyDown, true);
	textarea.addEventListener("blur", onBlur);

	return {
		isOpen: () => menu !== null,
		detach() {
			textarea.removeEventListener("input", onInput);
			textarea.removeEventListener("keydown", onKeyDown, true);
			textarea.removeEventListener("blur", onBlur);
			close();
		},
	};
}
```

- [ ] **Step 3: Garde dans la dictée (`voice-input.ts`)**

La dictée s'arme sur `keydown` Espace ; le picker doit pouvoir taper des espaces. Modifier
la signature (`voice-input.ts:70`) :

```ts
export interface VoiceInputOptions {
	/** Vrai quand un autre consommateur (picker « @ ») possède le clavier. */
	isBlocked?: () => boolean;
}

export function attach(
	ctx: DashboardCtx,
	textarea: HTMLTextAreaElement,
	opts: VoiceInputOptions = {}
): VoiceInputHandle {
```

Puis, en **première ligne** de `onKeyDown` (`voice-input.ts:255`) :

```ts
	function onKeyDown(e: KeyboardEvent): void {
		// Picker de mentions ouvert : la frappe lui appartient (un espace
		// dans « @Cours Java » ne doit pas armer la dictée).
		if (opts.isBlocked && opts.isBlocked()) return;
```

- [ ] **Step 4: Greffe dans `ai.ts`**

Autour de `ai.ts:563-594`. Déclarer la référence **avant** `voiceInput.attach` pour que la
garde puisse la lire par closure :

```ts
		const composerInput = composer.createEl("textarea", { cls: "qbd-ai-composer-input" });
		// Picker « @ » : déclaré avant la dictée pour que celle-ci puisse
		// interroger son état (les deux écoutent le même textarea).
		let mentions: MentionPickerHandle | null = null;
		// Dictée vocale push-to-talk (opt-in — réglages « Saisie vocale »).
		voiceInput.attach(ctx, composerInput, { isBlocked: () => !!mentions && mentions.isOpen() });
```

Puis, juste après `requestAnimationFrame(autoGrow);` (`ai.ts:594`) :

```ts
		mentions = attachMentionPicker(ctx.app, composerInput, composer, {
			onPickVaultFile: (path) => { void attachVaultPath(path); },
			onTextReplaced: (value) => {
				composerText = value;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
			},
		});
```

Et dans le handler Entrée existant (`ai.ts:589-593`), ajouter la garde explicite plutôt que
de dépendre de l'ordre d'attachement :

```ts
		composerInput.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
			if (mentions && mentions.isOpen()) return; // le picker gère Entrée
			e.preventDefault();
			if (phase !== "loading" && canGenerate()) startGeneration(containerRef);
		});
```

Imports à ajouter en tête d'`ai.ts` : `attachMentionPicker`, `MentionPickerHandle` depuis
`./mention-picker`. Vérifier que `TFile` est déjà importé depuis `obsidian` (il l'est :
`attachNoteVaultFile(file: TFile)`).

- [ ] **Step 4 bis: Router la sélection du vault selon le type de fichier**

**Ne PAS envoyer tout le vault dans `attachNoteVaultFile`** : celle-ci fait `vault.read()`,
donc une **lecture texte**. Un `.png` ou un `.pdf` du vault y deviendrait du binaire
illisible injecté dans le prompt. Le picker propose ces formats (`isAttachable` les
autorise), il faut donc les router comme le fait `addComposerFiles` pour un drop.

Ajouter dans `ai.ts`, à côté d'`attachNoteVaultFile` :

```ts
	/* MIME d'après l'extension. Nécessaire quand on fabrique un File depuis
	   le disque ou le vault : addComposerFiles teste file.type EN PREMIER
	   pour les images, et un File sans type finirait en chip texte. */
	function mimeForName(name: string): string {
		const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
		if (ext === "pdf") return "application/pdf";
		if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) {
			return "image/" + (ext === "jpg" ? "jpeg" : ext);
		}
		return "text/plain";
	}

	/* Attache un fichier du VAULT choisi via « @ ». Les notes passent par
	   attachNoteVaultFile (qui dédoublonne par path et garde le lien vers la
	   note) ; les PDF et images passent par addComposerFiles, seule à savoir
	   extraire un PDF et router une image vers la vision. */
	async function attachVaultPath(path: string): Promise<void> {
		const f = ctx.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		const ext = f.extension.toLowerCase();
		if (ext === "md" || ext === "txt") { await attachNoteVaultFile(f); return; }
		try {
			const buf = await ctx.app.vault.readBinary(f);
			const file = new File([new Uint8Array(buf)], f.name, { type: mimeForName(f.name) });
			await addComposerFiles([file]);
		} catch (e) {
			new Notice(t("ai.notice.noteReadFailed", { name: f.name }));
		}
	}
```

Note sur les extensions : `file-sources.ts` liste aussi `.csv`, `.json`, `.yaml`, etc.
Elles sont bien attachables par cette route (MIME `text/plain` → branche `text/*`
d'`addComposerFiles`), alors qu'un envoi direct à `attachNoteVaultFile` les aurait lues
sans dédoublonnage cohérent. Le routage ci-dessus est donc ce qui rend la promesse
d'`isAttachable` (« ne jamais proposer ce qu'on refusera ») réellement tenable.

- [ ] **Step 5: Clés i18n**

`src/i18n/en/ai.ts` (référence) :

```ts
	"ai.mention.noMatch": "No matching file",
```

`src/i18n/fr/ai.ts` :

```ts
	"ai.mention.noMatch": "Aucun fichier correspondant",
```

- [ ] **Step 6: CSS**

Dans `src/assets/css/dashboard/dashboard-ai.css`. Le menu réutilise le socle
`.qbd-select-menu` / `.qbd-note-picker` ; ne styler que le delta.

```css
/* Menu du picker « @ » : pas de champ de recherche interne, la frappe
   reste dans le composer. Largeur alignée sur le composer. */
.qbd-mention-menu {
	max-height: 280px;
	overflow-y: auto;
	min-width: 320px;
}
.qbd-mention-footer {
	padding: 6px 10px;
	font-size: 11px;
	color: var(--text-muted);
	border-top: 1px solid var(--background-modifier-border);
}
/* Frontière vault ↔ dossiers hors vault dans la liste initiale. */
.qbd-mention-sep {
	height: 1px;
	margin: 4px 8px;
	background: var(--background-modifier-border);
}
```

- [ ] **Step 7: Vérifier la compilation**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 8: Build vers le vault de test UNIQUEMENT**

```bash
npm run build
```

- [ ] **Step 9: Test manuel dans Obsidian (le vrai gate)**

Recharger : `obsidian plugin:reload id=quiz-blocks vault=Efrei` (préciser `vault=` :
Ahmed a plusieurs vaults ouverts, sinon le reload cible la mauvaise fenêtre). Ouvrir le
dashboard, page « Générer », puis vérifier **chaque** ligne :

| Cas | Attendu |
|---|---|
| Taper `@` | Menu au-dessus du composer, racine du vault `Efrei`, fichiers et dossiers mélangés en ordre alphabétique |
| Un fichier non attachable (`.zip`, `.canvas`…) | **Absent** de la liste |
| Taper `ahmed@gmail.com` | Aucun menu |
| Flèches haut/bas | La sélection bouge, la liste défile |
| `@<un dossier>/` | Descend : le menu liste le contenu de ce dossier |
| `@<dossier>/<lettres>` | Trouve la note même si elle est plus profonde (recherche globale) |
| Un nom AVEC ESPACE (452/455 notes d'`Efrei` en ont) | Trouve la note, **et le micro ne se déclenche pas** |
| Entrée sur un fichier `.md` | Chip ajoutée, `@…` retiré du texte, **prompt non envoyé** |
| Attacher une IMAGE du vault | **Vignette d'image**, pas une chip texte : la preuve que `attachVaultPath` route par type au lieu de faire un `vault.read()` binaire |
| Entrée sans menu ouvert | Le prompt part (comportement d'origine intact) |
| Échap | Ferme le menu, le texte reste |
| Clic sur une entrée | Attache sans que le composer perde le focus |

- [ ] **Step 10: Commit**

```bash
git add src/dashboard/ui-select.ts src/dashboard/mention-picker.ts src/dashboard/voice-input.ts src/dashboard/ai.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts src/assets/css/dashboard/dashboard-ai.css
git commit -m "feat(ai): picker de mentions @ sur le vault"
```

---

### Task 3: Correctif du caret perdu au re-render

Bug **préexistant** (menu `+`, drag & drop) que le `@` rend criant : `render()` reconstruit
le textarea et le re-focus (`ai.ts:776`) ne restaure pas `selectionStart`. Attacher au
milieu d'une phrase renvoie donc le curseur à la fin.

**Files:**
- Modify: `src/dashboard/ai.ts` (état du composer, `render`, ~776)

**Interfaces:**
- Consumes: rien.
- Produces: caret préservé pour **tous** les chemins d'attachement.

- [ ] **Step 1: Mémoriser la position du caret**

Près de la déclaration de `composerText` (état de closure du module), ajouter :

```ts
	/* Caret du composer, préservé à travers les render() : render détruit et
	   recrée le textarea, et sans ça tout attachement (chip, image, mention)
	   renvoie le curseur en fin de texte. */
	let composerCaret: number | null = null;
```

- [ ] **Step 2: Le capturer à chaque frappe**

Dans le listener `input` (`ai.ts:573`) :

```ts
		composerInput.addEventListener("input", (e) => {
			const ta = e.target as HTMLTextAreaElement;
			composerText = ta.value;
			composerCaret = ta.selectionStart;
			autoGrow();
			updateGenerateBtn(generateBtnRef);
		});
```

Et dans `onTextReplaced` du picker (Task 2, Step 4) :

```ts
			onTextReplaced: (value) => {
				composerText = value;
				composerCaret = composerInput.selectionStart;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
			},
```

- [ ] **Step 3: Le restaurer après le render**

Au point de re-focus (`ai.ts:776`) :

```ts
				if (composerInput.isConnected) {
					composerInput.focus({ preventScroll: true });
					if (composerCaret !== null) {
						const p = Math.min(composerCaret, composerInput.value.length);
						composerInput.setSelectionRange(p, p);
					}
				}
```

- [ ] **Step 4: Vérifier la compilation**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 5: Test manuel**

```bash
npm run build
```
Puis `obsidian plugin:reload id=quiz-blocks vault=Efrei`.

| Cas | Attendu |
|---|---|
| Écrire « Fais un quiz dessus », replacer le curseur après « quiz », attacher via `@` | Le curseur reste après « quiz », pas à la fin |
| Idem via le menu `+` → « Ajouter des notes » | Idem (le bug préexistant est corrigé) |
| Idem en glissant un PDF sur le composer | Idem |

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ai.ts
git commit -m "fix(ai): préserve le caret du composer à travers les re-render"
```

---

### Task 4: Réglage des racines externes

**Files:**
- Modify: `src/plugin.ts` (interface ~41-68, defaults ~70-105, SettingTab ~577)
- Modify: `src/types/dashboard-ctx.ts` (`AiSettings`, ~68)
- Modify: `src/i18n/en/settings.ts`, `src/i18n/fr/settings.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `settings.aiMentionExtraFolders: string[]`, lisible depuis `ai.ts` via `AiSettings`.

- [ ] **Step 1: Déclarer le réglage**

Dans `QuizBlocksSettings` (`plugin.ts:41`) :

```ts
	/** Dossiers hors vault proposés par le picker « @ » (desktop uniquement). */
	aiMentionExtraFolders: string[];
```

Dans `DEFAULT_SETTINGS` (`plugin.ts:70`) :

```ts
	// Vide par défaut : le « @ » se limite au vault tant qu'Ahmed n'ajoute rien.
	aiMentionExtraFolders: [],
```

**Aucune migration impérative** : l'`Object.assign({}, DEFAULT_SETTINGS, data || {})` de
`loadSettings()` (`plugin.ts:1055`) suffit pour une clé nouvelle.

Dans `AiSettings` (`src/types/dashboard-ctx.ts`, vers la l. 68, à côté de
`hotkeyAddFiles?` / `hotkeyAddNotes?`) :

```ts
	aiMentionExtraFolders?: string[];
```

- [ ] **Step 2: Section du SettingTab**

Dans `QuizBlocksSettingTab.display()`, juste après le réglage « Ollama URL »
(`plugin.ts:577`), et **masquée sur mobile** :

```ts
		// Dossiers hors vault pour le picker « @ » (fs → desktop uniquement ;
		// le plugin reste isDesktopOnly: false, la section disparaît juste).
		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName(t("settings.ai.mentionFolders.name"))
				.setDesc(t("settings.ai.mentionFolders.desc"));
			const list = containerEl.createDiv({ cls: "qbd-settings-folder-list" });
			const paint = () => {
				list.empty();
				for (const [i, dir] of this.plugin.settings.aiMentionExtraFolders.entries()) {
					new Setting(list)
						.setName(dir)
						.addExtraButton(b => b
							.setIcon("trash-2")
							.setTooltip(t("settings.ai.mentionFolders.remove"))
							.onClick(async () => {
								this.plugin.settings.aiMentionExtraFolders.splice(i, 1);
								await this.plugin.saveSettings();
								paint();
							}));
				}
			};
			paint();
			new Setting(containerEl)
				.addText(txt => {
					txt.setPlaceholder("C:\\Users\\...\\Downloads");
					txt.inputEl.addEventListener("keydown", async (e) => {
						if (e.key !== "Enter") return;
						const dir = txt.getValue().trim();
						if (!dir) return;
						const fs = require("fs") as typeof import("fs");
						let ok = false;
						try { ok = fs.statSync(dir).isDirectory(); } catch (err) { ok = false; }
						if (!ok) { new Notice(t("settings.ai.mentionFolders.invalid", { dir })); return; }
						if (this.plugin.settings.aiMentionExtraFolders.includes(dir)) { txt.setValue(""); return; }
						this.plugin.settings.aiMentionExtraFolders.push(dir);
						await this.plugin.saveSettings();
						txt.setValue("");
						paint();
					});
				});
		}
```

- [ ] **Step 3: Clés i18n**

`src/i18n/en/settings.ts` :

```ts
	"settings.ai.mentionFolders.name": "Folders outside the vault",
	"settings.ai.mentionFolders.desc": "Folders the “@” picker also searches, on top of your vault. Press Enter to add. Desktop only.",
	"settings.ai.mentionFolders.remove": "Remove this folder",
	"settings.ai.mentionFolders.invalid": "Not a folder: {dir}",
```

`src/i18n/fr/settings.ts` :

```ts
	"settings.ai.mentionFolders.name": "Dossiers hors du coffre",
	"settings.ai.mentionFolders.desc": "Dossiers que le picker « @ » cherche en plus de votre coffre. Entrée pour ajouter. Ordinateur uniquement.",
	"settings.ai.mentionFolders.remove": "Retirer ce dossier",
	"settings.ai.mentionFolders.invalid": "Ce n'est pas un dossier : {dir}",
```

- [ ] **Step 4: Vérifier la compilation**

Run: `npm run check`
Expected: exit 0. Une clé française manquante casserait la compilation (typage
`Record<keyof typeof EN_X, string>`) : c'est voulu.

- [ ] **Step 5: Test manuel**

```bash
npm run build
```

| Cas | Attendu |
|---|---|
| Réglages → section IA | « Dossiers hors du coffre » visible |
| Saisir `C:\Users\Ahmed\Downloads\quiz-test-externe` + Entrée | Ajouté à la liste |
| Saisir `C:\chemin\bidon` + Entrée | Notice « Ce n'est pas un dossier », rien d'ajouté |
| Saisir un chemin de FICHIER + Entrée | Même refus (`isDirectory()` faux) |
| Bouton corbeille | Retire l'entrée, persiste après redémarrage |

- [ ] **Step 6: Commit**

```bash
git add src/plugin.ts src/types/dashboard-ctx.ts src/i18n/en/settings.ts src/i18n/fr/settings.ts
git commit -m "feat(ai): réglage des dossiers hors vault pour le picker @"
```

---

### Task 5: Racines externes dans le picker

**Files:**
- Modify: `src/dashboard/file-sources.ts`
- Modify: `src/dashboard/mention-picker.ts`
- Modify: `src/dashboard/ai.ts` (attachement d'un fichier externe)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`

**Interfaces:**
- Consumes: `FileEntry`, `isAttachable`, `settings.aiMentionExtraFolders` (Task 4).
- Produces:
  - `function listExternalRoots(roots: string[]): FileEntry[]`
  - `function listExternalFolder(dirPath: string): FileEntry[]`
  - `function searchExternal(roots: string[], query: string): { entries: FileEntry[]; truncated: string[] }`
  - `function primeExternalIndex(roots: string[]): void`

- [ ] **Step 1: Ajouter la source externe à `file-sources.ts`**

```ts
/* ── Racines hors vault (desktop uniquement) ──
   fs est requis PARESSEUSEMENT, dans la fonction, derrière
   Platform.isDesktopApp : le plugin doit rester isDesktopOnly: false et se
   charger sur mobile (cf. le pattern d'ai-client.ts / ai-providers.ts). */

/** Gardes anti-explosion : un utilisateur peut pointer C:\ ou un dossier de projets. */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 20000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".obsidian"]);

interface ExternalIndex { entries: FileEntry[]; mtimeMs: number; truncated: boolean }
const externalCache = new Map<string, ExternalIndex>();

function baseName(p: string): string {
	const norm = p.replace(/[\\/]+$/, "");
	const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
	return i < 0 ? norm : norm.slice(i + 1);
}

/** Les racines configurées, en entrées listables (fin de la liste initiale). */
export function listExternalRoots(roots: string[]): FileEntry[] {
	if (!Platform.isDesktopApp) return [];
	return roots.map(r => ({
		name: baseName(r), path: r, isFolder: true, source: "external" as const, rootLabel: baseName(r),
	}));
}

/** Contenu d'un dossier externe. readdir du SEUL dossier affiché : le coût
    ne dépend pas de la taille du disque. */
export function listExternalFolder(dirPath: string): FileEntry[] {
	if (!Platform.isDesktopApp) return [];
	const fs = require("fs") as typeof import("fs");
	let dirents: import("fs").Dirent[];
	try { dirents = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (e) { return []; }
	return dirents
		.filter(d => !d.name.startsWith("."))
		.filter(d => d.isDirectory() ? !SKIP_DIRS.has(d.name) : isAttachable(d.name))
		.map(d => ({
			name: d.name,
			path: dirPath.replace(/[\\/]+$/, "") + "/" + d.name,
			isFolder: d.isDirectory(),
			source: "external" as const,
			rootLabel: baseName(dirPath),
		}))
		.sort(compareEntries);
}

function walk(root: string): ExternalIndex {
	const fs = require("fs") as typeof import("fs");
	const entries: FileEntry[] = [];
	let truncated = false;
	const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
	while (stack.length) {
		const cur = stack.pop();
		if (!cur) break;
		if (cur.depth > MAX_DEPTH) { truncated = true; continue; }
		let dirents: import("fs").Dirent[];
		try { dirents = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch (e) { continue; }
		for (const d of dirents) {
			if (entries.length >= MAX_ENTRIES) { truncated = true; break; }
			if (d.name.startsWith(".")) continue;
			const full = cur.dir.replace(/[\\/]+$/, "") + "/" + d.name;
			if (d.isDirectory()) {
				if (SKIP_DIRS.has(d.name)) continue;
				entries.push({ name: d.name, path: full, isFolder: true, source: "external", rootLabel: baseName(root) });
				stack.push({ dir: full, depth: cur.depth + 1 });
			} else if (isAttachable(d.name)) {
				entries.push({ name: d.name, path: full, isFolder: false, source: "external", rootLabel: baseName(root) });
			}
		}
	}
	let mtimeMs = 0;
	try { mtimeMs = fs.statSync(root).mtimeMs; } catch (e) { mtimeMs = 0; }
	return { entries, mtimeMs, truncated };
}

function indexOf(root: string): ExternalIndex | null {
	if (!Platform.isDesktopApp) return null;
	const fs = require("fs") as typeof import("fs");
	let mtimeMs = 0;
	try { mtimeMs = fs.statSync(root).mtimeMs; } catch (e) { return null; }
	const hit = externalCache.get(root);
	if (hit && hit.mtimeMs === mtimeMs) return hit;
	const fresh = walk(root);
	externalCache.set(root, fresh);
	return fresh;
}

/** Préchauffe l'index (première ouverture du picker) : le vault s'affiche
    tout de suite, le disque se greffe ensuite. */
export function primeExternalIndex(roots: string[]): void {
	if (!Platform.isDesktopApp) return;
	for (const r of roots) setTimeout(() => indexOf(r), 0);
}

/** Recherche fuzzy dans TOUTES les racines, intégralement (décision
    d'Ahmed). `truncated` nomme les racines où une garde a coupé : on ne
    tronque jamais en silence. */
export function searchExternal(roots: string[], query: string): { entries: FileEntry[]; truncated: string[] } {
	if (!Platform.isDesktopApp) return { entries: [], truncated: [] };
	const fuzzy = prepareFuzzySearch(query);
	const scored: { entry: FileEntry; score: number }[] = [];
	const truncated: string[] = [];
	for (const root of roots) {
		const idx = indexOf(root);
		if (!idx) continue;
		if (idx.truncated) truncated.push(baseName(root));
		for (const entry of idx.entries) {
			const r = fuzzy(entry.path);
			if (r) scored.push({ entry, score: r.score });
		}
	}
	scored.sort((a, b) => b.score - a.score);
	return { entries: scored.map(x => x.entry), truncated };
}
```

Ajouter `Platform` à l'import `obsidian` en tête du module.

- [ ] **Step 2: Brancher dans `mention-picker.ts`**

Étendre `MentionPickerOptions` :

```ts
export interface MentionPickerOptions {
	onPickVaultFile(path: string): void;
	/** Attache un fichier hors vault par chemin absolu. */
	onPickExternalFile(path: string): void;
	onTextReplaced(value: string): void;
	/** Racines configurées, lues au rendu (le réglage peut changer). */
	getExtraRoots(): string[];
}
```

Remplacer `entriesFor` et adapter `refresh` :

```ts
	function entriesFor(query: string): { entries: FileEntry[]; footer?: string } {
		const roots = opts.getExtraRoots();
		// Token vide → racine du vault, puis les racines externes en fin de
		// liste (elles ont leur icône propre).
		if (!query) {
			return { entries: [...listVaultFolder(app, ""), ...listExternalRoots(roots)] };
		}
		// Token finissant par « / » → on liste ce dossier.
		if (query.endsWith("/")) {
			const dir = query.slice(0, -1);
			const external = roots.some(r => dir === r || dir.startsWith(r + "/"));
			return { entries: external ? listExternalFolder(dir) : listVaultFolder(app, dir) };
		}
		// Sinon : recherche TOUJOURS globale, vault + toutes les racines.
		const ext = searchExternal(roots, query);
		const entries = [...searchVault(app, query), ...ext.entries];
		const footer = ext.truncated.length
			? t("ai.mention.truncated", { roots: ext.truncated.join(", ") })
			: undefined;
		return { entries, footer };
	}
```

Dans `refresh`, passer le footer et préchauffer à la première ouverture :

```ts
	function refresh(): void {
		const token = findMentionToken(textarea.value, textarea.selectionStart ?? 0);
		if (!token) { close(); return; }
		const { entries, footer } = entriesFor(token.query);
		if (!entries.length && token.query.includes(" ")) { close(); return; }
		if (!menu) {
			primeExternalIndex(opts.getExtraRoots());
			menu = openMentionMenu(anchorEl, () => { menu = null; });
		}
		menu.setItems(itemsFor(token, entries), footer);
	}
```

Dans `itemsFor`, router l'attachement selon la source et marquer les entrées externes :

```ts
	function itemsFor(token: MentionToken, entries: FileEntry[]): MentionMenuItem[] {
		const shown = entries.slice(0, 30);
		// Trait de séparation devant la PREMIÈRE entrée hors vault (la liste
		// initiale place les racines externes en fin).
		const firstExternal = shown.findIndex(e => e.source === "external");
		return shown.map((entry, i) => ({
			label: entry.isFolder ? entry.name + "/" : entry.name,
			sub: entry.source === "external"
				? entry.rootLabel
				: (entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : undefined),
			icon: entry.source === "external" && entry.isFolder ? "corner-up-right" : iconFor(entry),
			separatorBefore: i > 0 && i === firstExternal,
			onChoose: () => {
				if (entry.isFolder) {
					replaceToken(token, "@" + entry.path + "/");
					refresh();
					return;
				}
				replaceToken(token, "");
				if (entry.source === "external") opts.onPickExternalFile(entry.path);
				else opts.onPickVaultFile(entry.path);
			},
		}));
	}
```

Imports à ajouter : `listExternalFolder`, `listExternalRoots`, `primeExternalIndex`,
`searchExternal` depuis `./file-sources`.

- [ ] **Step 3: Attacher un fichier externe dans `ai.ts`**

`addComposerFiles` prend des `File[]` (venus d'un input ou d'un drop). Pour un chemin
absolu, lire l'octet-stream via `fs` et fabriquer un `File`, puis réutiliser la plomberie
existante **sans la dupliquer** (elle gère déjà images / PDF / texte) :

```ts
	/* Attache un fichier hors vault (picker « @ »). On fabrique un File à
	   partir du disque pour réutiliser addComposerFiles tel quel : images,
	   PDF et texte y sont déjà routés. Desktop uniquement (fs). */
	async function attachExternalPath(path: string): Promise<void> {
		if (!Platform.isDesktopApp) return;
		const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
		if (noteAttachments.some(n => n.name === name)) {
			new Notice(t("ai.notice.noteAlreadyAttached", { name }));
			return;
		}
		try {
			const fs = require("fs") as typeof import("fs");
			const buf = fs.readFileSync(path);
			// mimeForName vient de la Task 2 : addComposerFiles teste file.type
			// EN PREMIER pour les images, un File sans type finirait en chip
			// texte au lieu d'une vignette.
			const file = new File([new Uint8Array(buf)], name, { type: mimeForName(name) });
			await addComposerFiles([file]);
		} catch (e) {
			new Notice(t("ai.notice.noteReadFailed", { name }));
		}
	}
```

`mimeForName` est déjà défini dans `ai.ts` par la Task 2 (Step 4 bis) : le réutiliser tel
quel, ne pas en écrire une seconde copie.

Puis brancher dans l'appel à `attachMentionPicker` (Task 2, Step 4) :

```ts
			onPickExternalFile: (path) => { void attachExternalPath(path); },
			// Lu au rendu (le réglage peut changer sans rouvrir la vue).
			// Accesseur vérifié le 2026-07-16 : ai.ts lit « ctx.plugin.settings.<clé> »
			// (cf. ai.ts:165), il n'existe PAS de ctx.settings() dans ce module.
			getExtraRoots: () => ctx.plugin.settings.aiMentionExtraFolders || [],
```

- [ ] **Step 4: Clés i18n**

`src/i18n/en/ai.ts` :

```ts
	"ai.mention.truncated": "Too many files in {roots} — search may be incomplete",
```

`src/i18n/fr/ai.ts` :

```ts
	"ai.mention.truncated": "Trop de fichiers dans {roots} — la recherche peut être incomplète",
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 6: Test manuel**

```bash
npm run build
```
Réglages → ajouter `C:\Users\Ahmed\Downloads\quiz-test-externe`.

| Cas | Attendu |
|---|---|
| Taper `@` | `quiz-test-externe/` en fin de liste, icône distincte |
| Descendre dedans | Contenu réel, `.exe` masqué, `sous-dossier/` présent |
| Chercher un mot du PDF externe | Le PDF remonte, sous-titre = nom de la racine |
| Attacher le PDF | Chip ajoutée, texte extrait (générer un quiz pour le prouver) |
| Attacher une image externe | Vignette (et non chip texte) : le MIME est correct |
| Retirer la racine des réglages | Elle disparaît du picker sans redémarrage |

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/file-sources.ts src/dashboard/mention-picker.ts src/dashboard/ai.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts
git commit -m "feat(ai): racines hors vault dans le picker @ (desktop)"
```

---

### Task 6: Couverture d'états et vérification finale

**Files:**
- Modify: selon les défauts trouvés.

**Interfaces:**
- Consumes: tout.
- Produces: une feature vérifiée, prête à être fusionnée par Fable 5.

- [ ] **Step 1: Revue des états frères (skill `senior-dev:state-coverage`)**

Énumérer et statuer sur **chaque** état, pas seulement le chemin heureux :

| État | À vérifier |
|---|---|
| Vault vide / dossier vide | Message « aucun fichier », pas de menu fantôme |
| Aucune racine externe configurée | Aucun séparateur, aucune entrée externe |
| Racine configurée puis supprimée du disque | Pas de crash, entrée ignorée |
| Dictée activée vs désactivée | Espace dans `@` inoffensif dans les deux cas |
| Thème clair vs sombre | Menu lisible, `is-selected` visible |
| Génération en cours (`phase === "loading"`) | Le `@` s'ouvre-t-il ? Entrée ne doit pas relancer |
| Éditeur embarqué de la page « Générer » | Le composer y est réutilisé : le `@` ne casse rien |
| Chip déjà attachée, re-sélection du même fichier | Notice « déjà attachée », pas de doublon |

- [ ] **Step 2: Vérifier le mobile (règle absolue)**

```bash
grep -n "isDesktopOnly" src/assets/manifest.json
```
Attendu : `"isDesktopOnly": false`.

```bash
grep -n "require(" src/dashboard/file-sources.ts
```
Attendu : **aucun `require` au niveau module**, tous à l'intérieur de fonctions gardées par
`Platform.isDesktopApp`.

Test réel : ouvrir un vault sur le Xiaomi (Obsidian Android) ou à défaut émuler. Attendu : le plugin **se charge**, le `@` liste le vault, aucune racine externe,
aucune erreur en console.

- [ ] **Step 3: Vérification finale (skill `superpowers:verification-before-completion`)**

```bash
npm run check
git log --oneline main..feat/mention-picker
git diff --stat main..feat/mention-picker
```
Attendu : typecheck vert, commits lisibles, aucun fichier hors périmètre touché.

- [ ] **Step 4: Confirmer que les vaults d'Ahmed sont intacts**

```bash
git -C C:/dev/obsidian-quiz-blocks status --short
```
Attendu : uniquement `?? CLAUDE.md` (pas de nous). Vérifier que le `main.js` déployé dans
Efrei / Personal / Troubleshooting / الإسلام n'a pas notre code (mtime inchangé depuis le
build de Fable 5).

- [ ] **Step 5: Rapport à Ahmed**

Résumer : ce qui marche (avec la preuve du test manuel) et les écarts assumés vs la
référence (tableau de la spec). Le merge sur `main` et le push sont faits par le
contrôleur après cette tâche, pas par toi.

## Notes d'exécution

- **Les numéros de ligne d'`ai.ts` bougent** : Fable 5 y a fait 6 commits pendant la
  conception. Relocaliser avec `grep -n` avant chaque greffe plutôt que de faire confiance
  aux lignes citées ici.
- **`render()` reconstruit tout le composer** : ne jamais garder de référence DOM entre
  deux rendus. Le picker est réattaché à chaque `render`, c'est voulu.
- Après un build, recharger via `obsidian plugin:reload id=quiz-blocks vault=Efrei` en
  précisant **toujours** `vault=` (plusieurs vaults ouverts chez Ahmed).
