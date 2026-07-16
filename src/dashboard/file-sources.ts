import { App, Platform, TAbstractFile, TFolder, prepareFuzzySearch } from "obsidian";

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
