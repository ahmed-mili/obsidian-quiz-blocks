import { App } from "obsidian";
import { FileEntry, listVaultFolder, searchVault } from "./file-sources";
import { MentionMenuHandle, MentionMenuItem, openMentionMenu } from "./ui-select";

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
