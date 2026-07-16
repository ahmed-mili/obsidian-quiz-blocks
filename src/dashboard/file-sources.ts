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
