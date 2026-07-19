import { Modal, Notice, Platform, TFile, normalizePath, setIcon, setTooltip } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { ModuleGroup } from "./quiz-modules";
import { buildZip } from "./zip";
import type { ZipEntry } from "./zip";

/* ══════════════════════════════════════════════════════════
   SHARE — modal « Partager » calqué sur StudySmarter (capture Ahmed
   2026-07-19) : une rangée d'apps. Pour l'instant DISCORD (vrai logo
   Simple Icons) + « Enregistrer le zip » en repli. On n'a pas de lien
   mais un zip : aucune app ne permet de joindre un fichier à un message
   par automatisation, donc le maximum faisable (choix Ahmed) = générer
   le zip, le COPIER dans le presse-papier (Windows) et ouvrir Discord ;
   l'utilisateur fait Ctrl+V + Entrée. Desktop Windows ; dégrade ailleurs
   (partage natif / enregistrement), jamais de blocage.
══════════════════════════════════════════════════════════ */

/** Logo Discord — Simple Icons (path unique, fill), couleur de marque blurple. */
const DISCORD_PATH = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

function fillIcon(parent: HTMLElement, path: string): void {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "currentColor");
	const p = document.createElementNS(NS, "path");
	p.setAttribute("d", path);
	svg.appendChild(p);
	parent.appendChild(svg);
}

/** Octets du zip d'un module + nom de base assaini (null si aucun quiz lisible). */
async function buildModuleZipBytes(ctx: DashboardCtx, group: ModuleGroup): Promise<{ bytes: Uint8Array; base: string } | null> {
	const entries: ZipEntry[] = [];
	for (const q of group.quizzes) {
		const file = ctx.app.vault.getAbstractFileByPath(q.path);
		if (file instanceof TFile) entries.push({ name: file.name, content: await ctx.app.vault.read(file) });
	}
	if (entries.length === 0) { new Notice(t("dashboard.detail.fileNotFound")); return null; }
	const base = (group.name || "quizzes").replace(/[\\/:*?"<>|]/g, "-").trim() || "quizzes";
	return { bytes: buildZip(entries), base };
}

/** « Enregistrer le zip » : Téléchargements (desktop, révélé) / racine (mobile). */
async function saveModuleZip(ctx: DashboardCtx, group: ModuleGroup): Promise<void> {
	const z = await buildModuleZipBytes(ctx, group);
	if (!z) return;
	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const dest = path.join(os.homedir(), "Downloads", `${z.base}.zip`);
		fs.writeFileSync(dest, z.bytes);
		(require("electron") as { shell: { showItemInFolder(p: string): void } }).shell.showItemInFolder(dest);
		new Notice(t("dashboard.quizzes.zipSaved", { path: dest }));
	} else {
		const dest = normalizePath(`${z.base}.zip`);
		await ctx.app.vault.adapter.writeBinary(dest, z.bytes.buffer as ArrayBuffer);
		new Notice(t("dashboard.quizzes.zipSaved", { path: dest }));
	}
}

/** Partage d'un module. PRIORITÉ au partage NATIF du système
    (`navigator.share` avec fichier) : sur mobile, il ouvre la feuille « Partager
    avec » → l'utilisateur choisit Discord, qui affiche son écran contact +
    message + envoyer. Cette API est ABSENTE d'Obsidian desktop (Electron ne
    l'expose pas, vérifié) → repli desktop = presse-papier + ouverture de Discord
    (Ctrl+V + Entrée). Dernier repli : enregistrer le zip. */
async function shareViaDiscord(ctx: DashboardCtx, group: ModuleGroup): Promise<void> {
	const z = await buildModuleZipBytes(ctx, group);
	if (!z) return;

	// 1. Partage natif du système (mobile) — l'expérience « Partager avec ».
	const file = new File([z.bytes as BlobPart], `${z.base}.zip`, { type: "application/zip" });
	const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
	if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
		try { await nav.share({ files: [file], title: z.base }); } catch { /* annulé par l'utilisateur */ }
		return;
	}

	// 2. Desktop (pas de Web Share) : zip → presse-papier → ouvrir Discord.
	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const cp = require("child_process") as typeof import("child_process");
		const dest = path.join(os.tmpdir(), `${z.base}.zip`);
		fs.writeFileSync(dest, z.bytes);
		try {
			cp.execFileSync("powershell", ["-NoProfile", "-Command", `Set-Clipboard -LiteralPath ${JSON.stringify(dest)}`]);
		} catch { /* pas Windows / PowerShell indispo */ }
		const shell = (require("electron") as { shell: { openExternal(u: string): Promise<void> } }).shell;
		shell.openExternal("discord://").catch(() => shell.openExternal("https://discord.com/channels/@me"));
		new Notice(t("dashboard.quizzes.discordReady"));
		return;
	}

	// 3. Repli ultime : enregistrer le zip.
	await saveModuleZip(ctx, group);
}

export class ShareModal extends Modal {
	constructor(private ctx: DashboardCtx, private group: ModuleGroup) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-share-modal");
		this.titleEl.setText(t("dashboard.quizzes.shareTitle"));
		const c = this.contentEl;
		c.createEl("p", { cls: "qbd-share-hint", text: t("dashboard.quizzes.shareHint") });
		const row = c.createDiv({ cls: "qbd-share-apps" });
		// Ligne de feedback (vide au repos), remplie au clic Discord (desktop).
		const feedback = c.createDiv({ cls: "qbd-share-feedback" });

		// ── Discord ──
		const discord = row.createEl("button", { cls: "qbd-share-app qbd-share-app--discord" });
		discord.type = "button";
		const dIcon = discord.createDiv({ cls: "qbd-share-app-icon" });
		fillIcon(dIcon, DISCORD_PATH);
		// Desktop = presse-papier (Discord ne prend pas le fichier directement,
		// exactement comme la feuille Windows) : badge « copie » + infobulle au
		// survol pour l'annoncer, comme StudySmarter/Windows mais thémé.
		if (Platform.isDesktopApp) {
			const badge = dIcon.createDiv({ cls: "qbd-share-app-badge" });
			setIcon(badge, "copy");
			setTooltip(discord, t("dashboard.quizzes.shareCopyHint"));
		}
		discord.createSpan({ cls: "qbd-share-app-label", text: "Discord" });
		discord.addEventListener("click", () => {
			void shareViaDiscord(this.ctx, this.group);
			if (Platform.isDesktopApp) {
				// Confirmation « copié » : le badge passe au vert (is-copied) + une
				// ligne message sous les apps, puis fermeture douce.
				discord.addClass("is-copied");
				setIcon(dIcon.querySelector(".qbd-share-app-badge") as HTMLElement, "check");
				feedback.empty();
				const fi = feedback.createSpan({ cls: "qbd-share-feedback-icon" });
				setIcon(fi, "check");
				feedback.createSpan({ text: t("dashboard.quizzes.shareCopiedToast") });
				feedback.addClass("is-visible");
				window.setTimeout(() => this.close(), 2600);
			} else {
				this.close();
			}
		});

		// ── Enregistrer le zip ──
		const save = row.createEl("button", { cls: "qbd-share-app" });
		save.type = "button";
		const sIcon = save.createDiv({ cls: "qbd-share-app-icon" });
		setIcon(sIcon, "download");
		save.createSpan({ cls: "qbd-share-app-label", text: t("dashboard.quizzes.shareSave") });
		save.addEventListener("click", () => { this.close(); void saveModuleZip(this.ctx, this.group); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
