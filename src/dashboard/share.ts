import { Modal, Notice, Platform, TFile, normalizePath, setIcon, setTooltip } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { ModuleGroup } from "./quiz-modules";
import type { QuizIndexEntry } from "./scanner";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import { buildZip } from "./zip";
import type { ZipEntry } from "./zip";

/* ══════════════════════════════════════════════════════════
   SHARE — modal « Partager » calqué sur StudySmarter (capture Ahmed
   2026-07-19) : une rangée d'apps. DISCORD (vrai logo Simple Icons) +
   « Enregistrer » en repli. On n'a pas de lien mais un FICHIER (zip d'un
   dossier entier, ou .md d'un quiz seul) : aucune app ne permet de joindre
   un fichier à un message par automatisation, donc le maximum faisable
   (choix Ahmed) = le COPIER dans le presse-papier (Windows) et amener
   Discord au premier plan ; l'utilisateur fait Ctrl+V + Entrée. Desktop
   Windows ; dégrade ailleurs (partage natif / enregistrement), jamais de
   blocage.
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

/* ── Sources de partage : dossier (zip) ou quiz seul (.md) ── */

/** Fichier prêt à partager, nom déjà assaini. */
interface SharePayload {
	fileName: string;
	bytes: Uint8Array;
	/** MIME du partage natif mobile. */
	mime: string;
}

/** Ce que le modal doit savoir : son titre + comment produire le fichier. */
export interface ShareSource {
	titleKey: TransKey;
	build(): Promise<SharePayload | null>;
}

function sanitizeBase(name: string, fallback: string): string {
	return (name || fallback).replace(/[\\/:*?"<>|]/g, "-").trim() || fallback;
}

/** Dossier entier → zip de ses notes (null si aucun quiz lisible). */
export function moduleShareSource(ctx: DashboardCtx, group: ModuleGroup): ShareSource {
	return {
		titleKey: "dashboard.quizzes.shareTitle",
		async build() {
			const entries: ZipEntry[] = [];
			for (const q of group.quizzes) {
				const file = ctx.app.vault.getAbstractFileByPath(q.path);
				if (file instanceof TFile) entries.push({ name: file.name, content: await ctx.app.vault.read(file) });
			}
			if (entries.length === 0) { new Notice(t("dashboard.detail.fileNotFound")); return null; }
			return { fileName: `${sanitizeBase(group.name, "quizzes")}.zip`, bytes: buildZip(entries), mime: "application/zip" };
		},
	};
}

/** Quiz seul → note .md réduite à son bloc ```quiz-blocks``` (importable telle
    quelle : le destinataire la dépose dans son vault ou passe par « Import »). */
export function quizShareSource(ctx: DashboardCtx, quiz: QuizIndexEntry): ShareSource {
	return {
		titleKey: "dashboard.quizzes.shareQuizTitle",
		async build() {
			const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
			if (!file || !(file instanceof TFile)) { new Notice(t("dashboard.detail.fileNotFound")); return null; }
			const content = await ctx.app.vault.read(file);
			const match = content.match(QUIZ_BLOCK_RE);
			if (!match) { new Notice(t("dashboard.detail.noBlockInNote")); return null; }
			const md = match[0].replace(/\r\n/g, "\n") + "\n";
			return { fileName: `${sanitizeBase(quiz.title, "quiz")}.md`, bytes: new TextEncoder().encode(md), mime: "text/markdown" };
		},
	};
}

/* ── « Enregistrer » : Téléchargements (desktop, révélé) / racine (mobile). ── */

async function saveShared(ctx: DashboardCtx, source: ShareSource): Promise<void> {
	const payload = await source.build();
	if (!payload) return;
	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const dest = path.join(os.homedir(), "Downloads", payload.fileName);
		fs.writeFileSync(dest, payload.bytes);
		(require("electron") as { shell: { showItemInFolder(p: string): void } }).shell.showItemInFolder(dest);
		new Notice(t("dashboard.quizzes.fileSaved", { path: dest }));
	} else {
		const dest = normalizePath(payload.fileName);
		await ctx.app.vault.adapter.writeBinary(dest, payload.bytes.buffer as ArrayBuffer);
		new Notice(t("dashboard.quizzes.fileSaved", { path: dest }));
	}
}

/* ── Activation de Discord (Windows) ──
   CAUSE RACINE mesurée (2026-07-19, GetForegroundWindow/EnumWindows) : quand
   Discord est réduit dans le tray, sa fenêtre principale (Chrome_WidgetWin_1)
   est CACHÉE → `Process.MainWindowHandle` vaut 0, et NI `discord://` NI
   `Update.exe --processStart` ne la ré-affichent (l'instance ignore le signal
   single-instance) ; de plus l'instance Discord, process d'arrière-plan, n'a
   pas le droit Windows de se mettre elle-même au premier plan. Donc on ne
   délègue plus RIEN à Discord : on trouve sa fenêtre par EnumWindows (même
   cachée), on la ré-affiche (SW_RESTORE si iconique, SW_SHOW sinon — jamais
   de SW_RESTORE sur une fenêtre visible : ça dé-maximiserait) et on la force
   au premier plan (SetForegroundWindow, puis SwitchToThisWindow en secours si
   la restriction de focus a mordu). Le tout en C# compilé (Add-Type) : fiable
   en PowerShell 5.1 comme 7. Discord fermé → lancement par Update.exe (le
   lanceur du raccourci officiel), la boucle d'attente attrape la fenêtre au
   démarrage (15 s). Script passé en -EncodedCommand : aucun escaping shell. */

function buildDiscordScript(dest: string): string {
	const destPs = dest.replace(/'/g, "''");
	return `$ErrorActionPreference = 'SilentlyContinue'
Set-Clipboard -LiteralPath '${destPs}'
if (-not (Get-Process Discord -ErrorAction SilentlyContinue)) {
	$up = Join-Path $env:LOCALAPPDATA 'Discord\\Update.exe'
	if (Test-Path $up) { Start-Process $up -ArgumentList '--processStart','Discord.exe' }
	else { try { Start-Process 'discord://' } catch { Start-Process 'https://discord.com/channels/@me' } }
}
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace QuizBlocks {
	public static class DiscordFocus {
		delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
		[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
		[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
		[DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
		[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
		[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
		[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
		[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
		[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
		[DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
		[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
		[DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
		[DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
		[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
		[StructLayout(LayoutKind.Sequential)] struct RECT { public int L; public int T; public int R; public int B; }
		[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
		static IntPtr Find() {
			var pids = new System.Collections.Generic.HashSet<int>();
			foreach (var p in Process.GetProcessesByName("Discord")) pids.Add(p.Id);
			if (pids.Count == 0) return IntPtr.Zero;
			IntPtr found = IntPtr.Zero;
			EnumWindows(delegate(IntPtr h, IntPtr l) {
				uint pid; GetWindowThreadProcessId(h, out pid);
				if (!pids.Contains((int)pid)) return true;
				var c = new StringBuilder(64); GetClassName(h, c, 64);
				if (c.ToString() != "Chrome_WidgetWin_1") return true;
				// Écarte le SPLASH du démarrage (« Discord Updater », ~300 px,
				// même classe) : fenêtre éphémère, l'activer raterait la vraie.
				// La principale a un min-width ~940 ; iconique = principale
				// d'office (le rect d'une fenêtre iconique ment sur sa taille).
				if (!IsIconic(h)) {
					RECT r; GetWindowRect(h, out r);
					if (r.R - r.L < 500) return true;
				}
				found = h; return false;
			}, IntPtr.Zero);
			return found;
		}
		public static void Activate(int timeoutMs) {
			int end = Environment.TickCount + timeoutMs;
			IntPtr h = IntPtr.Zero;
			while (Environment.TickCount < end) {
				h = Find();
				if (h != IntPtr.Zero) break;
				System.Threading.Thread.Sleep(150);
			}
			if (h == IntPtr.Zero) return;
			if (IsIconic(h)) ShowWindow(h, 9);
			else if (!IsWindowVisible(h)) ShowWindow(h, 5);
			// Escalade mesurée contre la restriction de focus de Windows (un
			// process d'arrière-plan ne peut pas voler le premier plan) : essai
			// direct, puis frappe Alt simulée (satisfait « a reçu le dernier
			// input »), puis AttachThreadInput au thread au premier plan, puis
			// SwitchToThisWindow (la voie Alt-Tab) en dernier recours.
			if (Try(h)) return;
			keybd_event(0x12, 0, 0, UIntPtr.Zero);
			keybd_event(0x12, 0, 2, UIntPtr.Zero);
			if (Try(h)) return;
			IntPtr fg = GetForegroundWindow();
			if (fg != IntPtr.Zero) {
				uint pid; uint fgT = GetWindowThreadProcessId(fg, out pid);
				uint curT = GetCurrentThreadId();
				if (fgT != 0 && fgT != curT) {
					AttachThreadInput(curT, fgT, true);
					BringWindowToTop(h);
					SetForegroundWindow(h);
					AttachThreadInput(curT, fgT, false);
					System.Threading.Thread.Sleep(60);
					if (GetForegroundWindow() == h) return;
				}
			}
			SwitchToThisWindow(h, true);
		}
		static bool Try(IntPtr h) {
			SetForegroundWindow(h);
			System.Threading.Thread.Sleep(60);
			return GetForegroundWindow() == h;
		}
	}
}
'@
[QuizBlocks.DiscordFocus]::Activate(15000)
`;
}

/* ── Partage. PRIORITÉ au partage NATIF du système (`navigator.share` avec
   fichier) : sur mobile il ouvre la feuille « Partager avec » → l'utilisateur
   choisit Discord. Cette API est ABSENTE d'Obsidian desktop (Electron ne
   l'expose pas, vérifié) → repli desktop = presse-papier + Discord au premier
   plan (Ctrl+V + Entrée). Dernier repli : enregistrer le fichier. ── */

async function shareViaDiscord(ctx: DashboardCtx, source: ShareSource): Promise<void> {
	const payload = await source.build();
	if (!payload) return;

	// 1. Partage natif du système (mobile) — l'expérience « Partager avec ».
	const file = new File([payload.bytes as BlobPart], payload.fileName, { type: payload.mime });
	const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
	if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
		try { await nav.share({ files: [file], title: payload.fileName }); } catch { /* annulé par l'utilisateur */ }
		return;
	}

	// 2. Desktop : fichier → presse-papier + Discord au premier plan (script
	//    asynchrone, fenêtre cachée — la Notice part tout de suite).
	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const cp = require("child_process") as typeof import("child_process");
		const dest = path.join(os.tmpdir(), payload.fileName);
		fs.writeFileSync(dest, payload.bytes);
		try {
			const encoded = Buffer.from(buildDiscordScript(dest), "utf16le").toString("base64");
			cp.execFile("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { windowsHide: true }, () => { /* fire-and-forget */ });
		} catch { /* pas Windows / PowerShell indispo */ }
		new Notice(t("dashboard.quizzes.discordReady"));
		return;
	}

	// 3. Repli ultime : enregistrer le fichier.
	await saveShared(ctx, source);
}

export class ShareModal extends Modal {
	constructor(private ctx: DashboardCtx, private source: ShareSource) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-share-modal");
		this.titleEl.setText(t(this.source.titleKey));
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
			void shareViaDiscord(this.ctx, this.source);
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

		// ── Enregistrer le fichier ──
		const save = row.createEl("button", { cls: "qbd-share-app" });
		save.type = "button";
		const sIcon = save.createDiv({ cls: "qbd-share-app-icon" });
		setIcon(sIcon, "download");
		save.createSpan({ cls: "qbd-share-app-label", text: t("dashboard.quizzes.shareSave") });
		save.addEventListener("click", () => { this.close(); void saveShared(this.ctx, this.source); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
