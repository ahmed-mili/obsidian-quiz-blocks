import { Platform } from "obsidian";
import type { ChildProcess } from "child_process";
import type { Plugin } from "obsidian";
import type { AiSettings } from "../types/dashboard-ctx";
import {
	resolveClaudeModel,
	resolveCodexModel,
	resolveEffort,
	getCodexModels,
	buildChildEnv,
	isOllamaCloudModel,
} from "./ai-providers";

/* ══════════════════════════════════════════════════════════
   AI CLIENT — Claude Code + Ollama
   Claude: via le CLI Claude Code (compte Pro/Max/Team/Enterprise,
   aucune clé API). Prompt passé par stdin, sortie JSON.
   Ollama: fetch() pour lire les corps d'erreur. Multimodal pour images.
══════════════════════════════════════════════════════════ */

/** Hôte plugin attendu par createAiClient (seul `settings` est lu). */
export type AiPlugin = Plugin & { settings: AiSettings };

/** Image jointe à la génération (vision). */
export interface ImagePayload {
	base64: string;
	mediaType?: string;
}

/** Options de génération (nombre, type, source, images). */
export interface GenerateOptions {
	count?: number;
	type?: string;
	source?: string;
	images?: ImagePayload[];
}

/** Client IA — retour de createAiClient(plugin). */
export interface AiClient {
	generate(prompt: string, options?: GenerateOptions): Promise<unknown[]>;
	abort(): void;
}

/** Erreur d'exécution CLI enrichie (child_process.exec). */
type ExecError = Error & {
	code?: string | number;
	stderr?: string;
	stdout?: string;
	killed?: boolean;
};

export function createAiClient(plugin: AiPlugin): AiClient {
	const DEFAULT_MODELS: Record<string, string> = {
		"claude-code": "sonnet",
		codex: "gpt-5.6-terra",
		ollama: "glm-5.2:cloud",
	};

	// ── Annulation (bouton stop / Esc) ──
	// Chaque appel CLI/HTTP enregistre sa fonction d'arrêt ici ; abort()
	// l'invoque. L'erreur qui en résulte (process tué, fetch avorté) est
	// traduite en erreur marquée `aborted` que l'UI traite comme un retour
	// à l'état initial, pas comme une erreur.
	let abortCurrent: (() => void) | null = null;
	let aborted = false;

	function killTree(child: ChildProcess): void {
		// Windows : taskkill /T /F sur le PID précis tue tout l'arbre
		// (codex/claude spawnent des enfants) ; ailleurs SIGTERM suffit.
		try {
			if (process.platform === "win32") {
				(require("child_process") as typeof import("child_process")).exec("taskkill /pid " + child.pid + " /T /F", { windowsHide: true });
			} else {
				child.kill("SIGTERM");
			}
		} catch (e) { /* best effort */ }
	}

	async function generate(prompt: string, options: GenerateOptions = {}): Promise<unknown[]> {
		aborted = false;
		try {
			return await generateInner(prompt, options);
		} catch (err) {
			if (aborted) {
				const e = new Error("Génération annulée") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
		}
	}

	async function generateInner(prompt: string, options: GenerateOptions = {}): Promise<unknown[]> {
		const { count = 5, type = "Mixte", source = "topic", images = [] } = options;
		const provider = plugin.settings.aiProvider || "claude-code";
		let model = plugin.settings.aiModel || DEFAULT_MODELS[provider];
		// Fable 5 masqué après le 19 juillet → retombe sur le défaut Claude
		if (provider === "claude-code") {
			model = resolveClaudeModel(model);
		}
		// Codex : si le modèle persisté n'est pas dans la liste réelle du
		// compte (~/.codex/models_cache.json — ex. bascule récente de
		// provider, slug retiré), retombe sur le défaut Codex.
		if (provider === "codex") {
			model = resolveCodexModel(model);
		}

		const typeInstruction = type === "Mixte"
			? "un mélange de questions à choix unique, choix multiple et texte libre"
			: type === "Choix unique"
			? "des questions à choix unique (une seule bonne réponse)"
			: type === "Choix multiple"
			? "des questions à choix multiple (plusieurs bonnes réponses)"
			: "des questions à réponse texte libre";

		const systemPrompt = `Tu es un générateur de quiz. Génère exactement ${count} questions de quiz sous forme de tableau JSON5. Chaque question doit avoir :
	- title: titre court de la question
	- prompt: énoncé complet de la question
	- options: tableau des options (pour choix unique/multiple, 3-5 options)
	- correctIndex: index de la bonne réponse (pour choix unique)
	- correctIndices: tableau des index des bonnes réponses (pour choix multiple)
	- multiSelect: true si choix multiple
	- type: "text" pour texte libre, absent sinon
	- answer: réponse attendue (pour texte libre)
	- mathInput: true pour une question texte dont la réponse est une expression mathématique (l'élève répondra dans un ÉDITEUR D'ÉQUATIONS visuel)
	- answerTemplate: gabarit LaTeX pré-écrit dans le champ de réponse d'une question mathInput, avec \\\\placeholder{} pour chaque trou à remplir (ex: 'x = \\\\placeholder{}' ; deux solutions : 'x_1 = \\\\placeholder{},\\\\; x_2 = \\\\placeholder{}'). RÈGLES pour mathInput : l'énoncé ne donne JAMAIS d'instructions de format de réponse (pas de « sous forme de fraction », « séparées par une virgule », « ex: 1/2 ») — l'éditeur d'équations rend tout cela inutile ; préfère un answerTemplate qui guide ; les acceptedAnswers sont le contenu COMPLET du champ une fois le gabarit rempli, en LaTeX (ex: 'x_1 = \\\\frac{1}{2},\\\\; x_2 = 3'), et ajoute si pertinent des variantes (ordre inversé des solutions)
	- learn: un paragraphe de leçon explicative qui enseigne le concept avant la question (optionnel mais recommandé pour les quiz éducatifs)

	MATHÉMATIQUES : toute expression mathématique (formule, fonction, équation, intégrale, fraction, exposant, symbole grec…) s'écrit OBLIGATOIREMENT en LaTeX délimité par des dollars, comme dans Obsidian : $f(x) = x^3$ en ligne, $$\\int_0^2 2x\\,dx$$ pour une formule isolée. Jamais de pseudo-notation type f(x) = x^3 ou ∫ de 0 à 2 hors des dollars. Cela vaut pour title, prompt, options, answer, learn et explain. IMPORTANT : dans les chaînes JSON5, DOUBLE chaque backslash — LaTeX (écris '$\\\\frac{a}{b}$' pour obtenir \\frac) comme chemins Windows (écris 'C:\\\\Users\\\\dev') — un backslash simple serait détruit par le parseur.

	Le dernier élément du tableau peut être un objet de configuration de mode (sans champ prompt) :
	  - { mode: "exam", examDurationMinutes: 10, examAutoSubmit: true, examShowTimer: true } pour un mode examen chronométré
	  - { mode: "learn", examDurationMinutes: 10, examAutoSubmit: true, examShowTimer: true } pour un mode apprentissage avec transition vers examen
	  - { mode: "learn" } pour un mode apprentissage sans examen
	  - { learnMode: true } comme raccourci pour mode: "learn"
	  - { examMode: true } comme raccourci pour mode: "exam"

	Génère ${typeInstruction}. Réponds UNIQUEMENT avec le tableau JSON5, sans explication ni formatage.`;

		const userPrompt = source === "topic"
			? `Génère un quiz sur le sujet : ${prompt}`
			: source === "text"
			? `Génère un quiz basé sur ce texte :\n\n${prompt}`
			: `Génère un quiz basé sur les images fournies : ${prompt}`;

		if (provider === "ollama") {
			// Un seul endpoint local : sert les modèles locaux ET cloud (:cloud).
			// Clé optionnelle (le daemon connecté via `ollama signin` n'en a pas
			// besoin) ; envoyée en Authorization si l'utilisateur en a défini une.
			const ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
			const key = (plugin.settings.aiOllamaCloudKey || "").trim();
			const authHeader: Record<string, string> = key ? { "Authorization": "Bearer " + key } : {};
			// Effort réel : niveau `think` (low/medium/high/max) passé à l'API
			// pour les modèles à raisonnement (ignoré sinon, cf. callOllama).
			const effort = resolveEffort("ollama", plugin.settings.aiEffort);
			return callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images, effort);
		} else if (provider === "codex") {
			// Effort clampé aux niveaux supportés par CE modèle (ex. ultra
			// persisté + gpt-5.5 → xhigh), sinon le CLI rejetterait la valeur.
			const effort = resolveEffort("codex", plugin.settings.aiEffort, model);
			// Mode Fast (éclair du popover effort) : service tier « priority »,
			// seulement si CE modèle l'expose (cf. models_cache service_tiers).
			const m = getCodexModels().find(x => x.value === model);
			const fast = !!plugin.settings.aiCodexFast && !!(m && m.fast);
			return callCodex(model, systemPrompt, userPrompt, images, effort, fast);
		} else {
			return callClaudeCode(model, systemPrompt, userPrompt, images);
		}
	}

	/* ── Claude via le CLI Claude Code (compte par abonnement) ──
	   Aucune clé API : réutilise la session du CLI connecté au
	   compte Pro/Max/Team/Enterprise. Prompt complet par stdin
	   (aucun échappement d'argument), sortie --output-format json. */
	async function callClaudeCode(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<unknown[]> {
		if (!Platform.isDesktopApp) {
			throw new Error("La génération via Claude est disponible sur desktop uniquement.");
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error("Nom de modèle Claude invalide : " + model);
		}

		const cp = require("child_process") as typeof import("child_process");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		// Images : écrites en fichiers temporaires que Claude lit
		// avec le tool Read (multimodal, read-only)
		let tools = '""';
		let imageNote = "";
		let tmpDir: string | null = null;
		if (images.length > 0) {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-"));
			const paths = images.map((img, i) => {
				const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
				const p = path.join(tmpDir as string, "image-" + (i + 1) + "." + ext);
				fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
				return p;
			});
			tools = '"Read"';
			imageNote = "\n\nLis d'abord ces images avec le tool Read, puis base le quiz sur leur contenu :\n" +
				paths.map(p => "- " + p).join("\n");
		}

		const fullPrompt = systemPrompt + "\n\n" + userPrompt + imageNote;
		const cmd = "claude -p --output-format json --model " + model +
			" --tools " + tools + " --no-session-persistence --setting-sources \"\"";

		let stdout: string;
		try {
			stdout = await new Promise<string>((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: 180000,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						const e = err as ExecError;
						e.stderr = stderr;
						e.stdout = out;
						reject(e);
					} else {
						resolve(out);
					}
				});
				abortCurrent = () => { aborted = true; killTree(child); };
				child.stdin!.write(fullPrompt);
				child.stdin!.end();
			});
		} catch (err) {
			const e = err as ExecError;
			console.error("[quiz-blocks] Claude Code error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error("Claude Code n'est pas installé. Installez-le depuis claude.com/claude-code puis connectez-vous avec /login.");
			}
			if (e.killed || detail.includes("etimedout")) {
				throw new Error("Claude n'a pas répondu dans le délai imparti (3 min). Réessayez.");
			}
			if (detail.includes("login") || detail.includes("api key") || detail.includes("authentication") || detail.includes("credential")) {
				throw new Error("Compte Claude non connecté. Dans un terminal, lancez \"claude\" puis /login avec votre compte Pro/Max/Team/Enterprise.");
			}
			throw new Error("Erreur Claude Code : " + (e.stderr || e.message).trim().slice(0, 300));
		} finally {
			if (tmpDir) {
				try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
			}
		}

		let data: { is_error?: boolean; result?: string };
		try {
			data = JSON.parse(stdout);
		} catch (e) {
			throw new Error("Réponse Claude Code illisible. Réessayez.");
		}

		if (data.is_error) {
			const msg = String(data.result || "Erreur inconnue");
			const msgLower = msg.toLowerCase();
			if (msgLower.includes("login") || msgLower.includes("api key") || msgLower.includes("credential")) {
				throw new Error("Compte Claude non connecté. Dans un terminal, lancez \"claude\" puis /login avec votre compte Pro/Max/Team/Enterprise.");
			}
			if (msgLower.includes("rate limit") || msgLower.includes("usage limit")) {
				throw new Error("Limite d'utilisation de votre abonnement Claude atteinte. Réessayez plus tard.");
			}
			throw new Error("Erreur Claude : " + msg.slice(0, 300));
		}

		const content = data.result || "";
		if (!content.trim()) {
			throw new Error("Claude n'a retourné aucune réponse. Réessayez ou changez de modèle.");
		}

		console.log("[quiz-blocks] Claude Code success - response length:", content.length);
		return parseQuizResponse(content);
	}

	/* ── ChatGPT via le CLI Codex (abonnement ChatGPT) ──
	   `codex exec` en non-interactif : prompt par stdin, modèle via -m,
	   effort de raisonnement via -c model_reasoning_effort=…, réponse finale
	   écrite dans un fichier (-o) pour un parsing propre. Sandbox read-only et
	   --ignore-user-config isolent la génération (pas de MCP/hooks perso). */
	async function callCodex(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false): Promise<unknown[]> {
		if (!Platform.isDesktopApp) {
			throw new Error("La génération via ChatGPT (Codex) est disponible sur desktop uniquement.");
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error("Nom de modèle Codex invalide : " + model);
		}
		const effortVal = /^[a-z]+$/.test(effort) ? effort : "medium";

		const cp = require("child_process") as typeof import("child_process");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-codex-"));
		const outFile = path.join(tmpDir, "last-message.txt");

		// Images : fichiers temporaires attachés au prompt initial via -i
		let imageArgs = "";
		if (images.length > 0) {
			const paths = images.map((img, i) => {
				const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
				const p = path.join(tmpDir, "image-" + (i + 1) + "." + ext);
				fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
				return p;
			});
			imageArgs = paths.map(p => ' -i "' + p + '"').join("");
		}

		const fullPrompt = systemPrompt + "\n\n" + userPrompt;
		const cmd = "codex exec -m " + model +
			" -c model_reasoning_effort=" + effortVal +
			// Fast (1.5x speed, more usage) : service tier « priority » — la
			// valeur vient de models_cache.json (service_tiers[].id).
			(fast ? " -c service_tier=priority" : "") +
			" -s read-only --skip-git-repo-check --ignore-user-config" +
			" -C \"" + os.homedir() + "\"" +
			" -o \"" + outFile + "\"" + imageArgs;

		let raw: string;
		try {
			const stdout = await new Promise<string>((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: 180000,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						const e = err as ExecError;
						e.stderr = stderr;
						e.stdout = out;
						reject(e);
					} else {
						resolve(out);
					}
				});
				abortCurrent = () => { aborted = true; killTree(child); };
				child.stdin!.write(fullPrompt);
				child.stdin!.end();
			});
			// Le fichier -o contient la réponse finale nette ; fallback stdout.
			raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : (stdout || "");
		} catch (err) {
			const e = err as ExecError;
			console.error("[quiz-blocks] Codex error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error("Codex n'est pas installé. Installez-le (npm i -g @openai/codex) puis connectez-vous avec « codex login ».");
			}
			if (e.killed || detail.includes("etimedout")) {
				throw new Error("ChatGPT (Codex) n'a pas répondu dans le délai imparti (3 min). Réessayez.");
			}
			if (detail.includes("not logged in") || detail.includes("login") || detail.includes("unauthorized") || detail.includes("401") || detail.includes("credential") || detail.includes("authenticat")) {
				throw new Error("Compte ChatGPT non connecté. Dans un terminal, lancez « codex login ».");
			}
			if (detail.includes("usage limit") || detail.includes("rate limit") || detail.includes("quota")) {
				throw new Error("Limite d'utilisation de votre abonnement ChatGPT atteinte. Réessayez plus tard.");
			}
			throw new Error("Erreur Codex : " + (e.stderr || e.message).trim().slice(0, 300));
		} finally {
			try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
		}

		if (!raw || !raw.trim()) {
			throw new Error("ChatGPT (Codex) n'a retourné aucune réponse. Réessayez ou changez de modèle.");
		}
		console.log("[quiz-blocks] Codex success - response length:", raw.length);
		return parseQuizResponse(raw);
	}

	async function callOllama(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null): Promise<unknown[]> {
		if (!ollamaUrl) {
			ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
		}
		authHeaders = authHeaders || {};

		// Annulation : un AbortController couvre les fetch de ce call.
		const ac = new AbortController();
		abortCurrent = () => { aborted = true; try { ac.abort(); } catch (e) { /* déjà avorté */ } };

		// ── Step 1 : serveur joignable ? Un modèle cloud (:cloud) tourne à la
		// demande via le daemon connecté (absent de /api/tags) → on ne vérifie
		// PAS qu'il est installé ; un modèle local, si. ──
		const isCloud = isOllamaCloudModel(model);
		let installedModels: string[] = [];
		let tagModels: Array<{ name: string; capabilities?: string[] }> = [];
		try {
			const tagsResp = await fetch(`${ollamaUrl}/api/tags`, { method: "GET", headers: authHeaders, signal: ac.signal });
			if (!tagsResp.ok) {
				throw new Error("ollama_unreachable");
			}
			const tagsData = await tagsResp.json() as { models?: Array<{ name: string; capabilities?: string[] }> };
			tagModels = tagsData?.models || [];
			installedModels = tagModels.map(m => m.name);
			console.log("[quiz-blocks] Ollama installed models:", installedModels.join(", "));

			if (!isCloud) {
				// Check if model is installed — Ollama model names may include :latest
				const modelBase = model.replace(/:latest$/, "");
				const isInstalled = installedModels.some(m => {
					const mBase = m.replace(/:latest$/, "");
					return mBase === modelBase || mBase.startsWith(modelBase + ":");
				});

				if (!isInstalled) {
					throw new Error(
						"Le modèle \"" + model + "\" n'est pas installé.\n" +
						"Exécutez dans un terminal : ollama pull " + model + "\n" +
						"Modèles disponibles : " + (installedModels.length > 0 ? installedModels.join(", ") : "aucun")
					);
				}
			}
		} catch (err) {
			const e = err as Error;
			if (e.message === "ollama_unreachable" || !e.message.startsWith("Le modèle")) {
				throw new Error(
					"Impossible de contacter Ollama sur " + ollamaUrl + ".\n" +
					"Vérifiez que le serveur est démarré (ollama serve)."
				);
			}
			throw err;
		}

		// Le modèle expose-t-il un raisonnement (`think`) ? Cloud → oui (le param
		// est ignoré sans erreur si le modèle ne raisonne pas, vérifié) ; local →
		// capability « thinking » lue de /api/tags. Statut prix jamais figé ici.
		let supportsThinking: boolean;
		if (isCloud) {
			supportsThinking = true;
		} else {
			const norm = model.replace(/:latest$/, "");
			const found = tagModels.find(m => {
				const mb = m.name.replace(/:latest$/, "");
				return mb === norm || mb.startsWith(norm + ":");
			});
			supportsThinking = !!(found && (found.capabilities || []).includes("thinking"));
		}
		const thinkLevel = (supportsThinking && effort) ? effort : null;
		if (thinkLevel) console.log("[quiz-blocks] Ollama think level:", thinkLevel);

		// ── Step 2: Call /api/chat for better instruction following ──
		// Use fetch() to read error response bodies (requestUrl hides them)
		// Build user message with images for multimodal support
		const userMessage = {
			role: "user",
			content: userPrompt,
			...(images.length > 0 ? { images: images.map(img => img.base64) } : {})
		};

		let data: { error?: unknown; message?: { content?: string } };
		try {
			const resp = await fetch(`${ollamaUrl}/api/chat`, {
				method: "POST",
				signal: ac.signal,
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: systemPrompt },
						userMessage
					],
					stream: false,
					...(thinkLevel ? { think: thinkLevel } : {}),
					format: {
						type: "object",
						properties: {
							questions: {
								type: "array",
								items: {
									type: "object",
									properties: {
										title: { type: "string" },
										prompt: { type: "string" },
										options: { type: "array", items: { type: "string" } },
										correctIndex: { type: "number" },
										correctIndices: { type: "array", items: { type: "number" } },
										multiSelect: { type: "boolean" },
										type: { type: "string" },
										answer: { type: "string" },
									learn: { type: "string" }
									},
									required: ["title", "prompt"]
								}
							}
						},
						required: ["questions"]
					}
				})
			});

			data = await resp.json();

			if (!resp.ok) {
				const rawErr: unknown = data?.error;
				const errMsg: unknown = typeof rawErr === "string" ? rawErr : (rawErr || ("Erreur " + resp.status));
				console.error("[quiz-blocks] Ollama error:", resp.status, errMsg);

				// Specific known errors — show clear French message
				const errLower = typeof errMsg === "string" ? errMsg.toLowerCase() : "";
				if (errLower.includes("more system memory") || errLower.includes("not enough memory") || errLower.includes("out of memory")) {
					const memMatch = typeof errMsg === "string" ? errMsg.match(/(\d+[\.,]?\d*)\s*GiB/g) : null;
					const detail = memMatch ? " (" + memMatch.join(" / ") + ")" : "";
					throw new Error("Mémoire insuffisante pour ce modèle" + detail + ".\nChoisissez un modèle plus petit dans la liste.");
				}
				if (errLower.includes("not found") || errLower.includes("model not found")) {
					throw new Error("Le modèle \"" + model + "\" n’est pas installé.\nExécutez : ollama pull " + model);
				}
				// Modèle cloud réservé à un abonnement (Ollama Pro/Max) : 403
				// « requires a subscription ». Distinct d'un défaut de connexion.
				if (errLower.includes("subscription") || errLower.includes("upgrade for access")) {
					throw new Error("Ce modèle nécessite un abonnement Ollama : https://ollama.com/upgrade");
				}
				if (isCloud && (resp.status === 401 || resp.status === 403 || errLower.includes("sign in") || errLower.includes("signin") || errLower.includes("unauthorized") || errLower.includes("authenticat") || errLower.includes("api key"))) {
					throw new Error("Modèle cloud Ollama : le daemon n'est pas connecté à votre compte.\nDans un terminal : ollama signin");
				}
				throw new Error("Erreur Ollama (" + resp.status + ") : " + String(errMsg));
			}
		} catch (err) {
			const e = err as Error;
			if (e.message.startsWith("Le modèle") || e.message.startsWith("Mémoire insuffisante") || e.message.startsWith("Erreur Ollama") || e.message.startsWith("Impossible de contacter") || e.message.startsWith("Modèle cloud") || e.message.startsWith("Ce modèle nécessite")) {
				throw err;
			}
			throw new Error("Impossible de contacter Ollama sur " + ollamaUrl + ". Vérifiez que le serveur est démarré.");
		}

		if (data.error) {
			const errMsg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
			throw new Error("Erreur Ollama : " + errMsg);
		}

		const content = data?.message?.content || "";
		if (!content.trim()) {
			throw new Error("Ollama n'a retourné aucune réponse. Vérifiez que le modèle est installé.");
		}

		console.log("[quiz-blocks] Ollama response length:", content.length);
		return parseOllamaResponse(content);
	}

	/* Les modèles écrivent le LaTeX avec des backslashes SIMPLES dans les
	   chaînes JSON5 ($\frac$, $\int$) — or JSON5 transforme \f en form
	   feed, \t en tab, AVALE le backslash des séquences inconnues
	   (\int → int) et JETTE une SyntaxError sur \x/\u non-hex ($\xi$,
	   \underline) : LaTeX détruit AVANT le parse, irréparable après
	   (baselines gemma4 + review multi-angles 2026-07-11). Réparation
	   SCOPÉE AUX SEGMENTS MATH de la chaîne brute : dans $...$ / $$...$$
	   TOUT backslash simple est du LaTeX (aucun échappement JSON n'y est
	   légitime) → doublé, paires déjà correctes préservées ; hors
	   segments, RIEN n'est touché (\n, \t, \" restent des échappements
	   voulus — un placeholder « col1\tcol2 » garde sa tabulation, et
	   \right/\neq/\xi ne peuvent plus être corrompus puisqu'ils vivent
	   dans les dollars). */
	function repairLatexBackslashes(source: string): string {
		// Segments : $$...$$ d'abord (sauts de ligne possibles), puis
		// $...$ inline (mêmes gardes anti-dollar-monétaire que le rendu :
		// collé au contenu des deux côtés, pas de \n).
		const mathFixed = source.replace(/\$\$[^$]+?\$\$|\$(?!\s)[^$\n]*?[^$\s]\$/g, (seg: string) =>
			// L'alternative (\\\\) consomme les paires correctes en
			// premier — sans elle le 2e backslash de « \\frac » (modèle
			// qui échappe bien) produirait « \\\frac » → form feed.
			seg.replace(/(\\\\)|\\([a-zA-Z,;! ])/g,
				(m: string, pair: string | undefined, ch: string | undefined) => pair ? pair : "\\\\" + ch));
		// Hors math : SEULS les \x/\u NON suivis d'hexa valide sont
		// doublés — un \xGG/\uGGGG invalide fait JETER JSON5.parse
		// (SyntaxError), donc ce doublement ne peut jamais casser un
		// échappement légitime. Sauve les chemins Windows des quiz cmd
		// (« cd C:\utils », « C:\x64 ») : sans ça, génération perdue.
		// (\t/\n dans « C:\temp\new » restent indécidables — le prompt
		// système exige désormais les backslashes doublés partout.)
		return mathFixed
			.replace(/(\\\\)|\\x(?![0-9a-fA-F]{2})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\x")
			.replace(/(\\\\)|\\u(?![0-9a-fA-F]{4})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\u");
	}

	function parseOllamaResponse(content: string): unknown[] {
		let cleaned = content.trim();

		// Try to extract JSON from markdown code blocks
		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}
		cleaned = repairLatexBackslashes(cleaned);

		// Ollama with format: structured JSON wraps the array in an object
		// e.g. { "questions": [...] }
		try {
			const JSON5 = require("json5") as typeof import("json5");
			const parsed: unknown = JSON5.parse(cleaned);

			// If it's an object with a "questions" key, extract the array
			if (parsed && !Array.isArray(parsed) && Array.isArray((parsed as { questions?: unknown }).questions)) {
				return (parsed as { questions: unknown[] }).questions;
			}

			if (Array.isArray(parsed)) {
				return parsed;
			}

			throw new Error("Format inattendu");
		} catch (err) {
			// Try the generic parser as fallback
			return parseQuizResponse(content);
		}
	}

	function parseQuizResponse(content: string): unknown[] {
		let cleaned = content.trim();

		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}
		cleaned = repairLatexBackslashes(cleaned);

		const JSON5 = require("json5") as typeof import("json5");
		const parsed: unknown = JSON5.parse(cleaned);

		if (!Array.isArray(parsed)) {
			throw new Error("La réponse IA n'est pas un tableau de questions.");
		}

		return parsed;
	}

	return { generate, abort: () => { if (abortCurrent) abortCurrent(); } };
}
