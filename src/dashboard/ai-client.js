'use strict';

/* ══════════════════════════════════════════════════════════
   AI CLIENT — Claude Code + Ollama
   Claude: via le CLI Claude Code (compte Pro/Max/Team/Enterprise,
   aucune clé API). Prompt passé par stdin, sortie JSON.
   Ollama: fetch() pour lire les corps d'erreur. Multimodal pour images.
══════════════════════════════════════════════════════════ */

function createAiClient(plugin) {
	const DEFAULT_MODELS = {
		"claude-code": "sonnet",
		codex: "gpt-5.6-terra",
		ollama: "glm-5.2:cloud",
	};

	async function generate(prompt, options = {}) {
		const { count = 5, type = "Mixte", source = "topic", images = [] } = options;
		const provider = plugin.settings.aiProvider || "claude-code";
		let model = plugin.settings.aiModel || DEFAULT_MODELS[provider];
		// Fable 5 masqué après le 12 juillet → retombe sur le défaut Claude
		if (provider === "claude-code") {
			model = require("./ai-providers").resolveClaudeModel(model);
		}
		// Codex : si le modèle persisté n'est pas un modèle Codex connu
		// (ex. bascule récente de provider), retombe sur le défaut Codex.
		if (provider === "codex") {
			const { CODEX_MODELS } = require("./ai-providers");
			if (!CODEX_MODELS.some(m => m.value === model)) model = DEFAULT_MODELS.codex;
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
	- learn: un paragraphe de leçon explicative qui enseigne le concept avant la question (optionnel mais recommandé pour les quiz éducatifs)

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
			const authHeader = key ? { "Authorization": "Bearer " + key } : {};
			// Effort réel : niveau `think` (low/medium/high/max) passé à l'API
			// pour les modèles à raisonnement (ignoré sinon, cf. callOllama).
			const effort = require("./ai-providers").resolveEffort("ollama", plugin.settings.aiEffort);
			return callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images, effort);
		} else if (provider === "codex") {
			const { resolveEffort } = require("./ai-providers");
			const effort = resolveEffort("codex", plugin.settings.aiEffort);
			return callCodex(model, systemPrompt, userPrompt, images, effort);
		} else {
			return callClaudeCode(model, systemPrompt, userPrompt, images);
		}
	}

	/* ── Claude via le CLI Claude Code (compte par abonnement) ──
	   Aucune clé API : réutilise la session du CLI connecté au
	   compte Pro/Max/Team/Enterprise. Prompt complet par stdin
	   (aucun échappement d'argument), sortie --output-format json. */
	async function callClaudeCode(model, systemPrompt, userPrompt, images = []) {
		const { Platform } = require("obsidian");
		if (!Platform.isDesktopApp) {
			throw new Error("La génération via Claude est disponible sur desktop uniquement.");
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error("Nom de modèle Claude invalide : " + model);
		}

		const cp = require("child_process");
		const os = require("os");
		const path = require("path");
		const fs = require("fs");
		const { buildChildEnv } = require("./ai-providers");

		// Images : écrites en fichiers temporaires que Claude lit
		// avec le tool Read (multimodal, read-only)
		let tools = '""';
		let imageNote = "";
		let tmpDir = null;
		if (images.length > 0) {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-"));
			const paths = images.map((img, i) => {
				const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
				const p = path.join(tmpDir, "image-" + (i + 1) + "." + ext);
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

		let stdout;
		try {
			stdout = await new Promise((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: 180000,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						err.stderr = stderr;
						err.stdout = out;
						reject(err);
					} else {
						resolve(out);
					}
				});
				child.stdin.write(fullPrompt);
				child.stdin.end();
			});
		} catch (err) {
			console.error("[quiz-blocks] Claude Code error:", err.message, err.stderr || "");
			const detail = ((err.stderr || "") + " " + (err.stdout || "") + " " + err.message).toLowerCase();
			if (err.code === "ENOENT" || err.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error("Claude Code n'est pas installé. Installez-le depuis claude.com/claude-code puis connectez-vous avec /login.");
			}
			if (err.killed || detail.includes("etimedout")) {
				throw new Error("Claude n'a pas répondu dans le délai imparti (3 min). Réessayez.");
			}
			if (detail.includes("login") || detail.includes("api key") || detail.includes("authentication") || detail.includes("credential")) {
				throw new Error("Compte Claude non connecté. Dans un terminal, lancez \"claude\" puis /login avec votre compte Pro/Max/Team/Enterprise.");
			}
			throw new Error("Erreur Claude Code : " + (err.stderr || err.message).trim().slice(0, 300));
		} finally {
			if (tmpDir) {
				try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
			}
		}

		let data;
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
	async function callCodex(model, systemPrompt, userPrompt, images = [], effort = "medium") {
		const { Platform } = require("obsidian");
		if (!Platform.isDesktopApp) {
			throw new Error("La génération via ChatGPT (Codex) est disponible sur desktop uniquement.");
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error("Nom de modèle Codex invalide : " + model);
		}
		const effortVal = /^[a-z]+$/.test(effort) ? effort : "medium";

		const cp = require("child_process");
		const os = require("os");
		const path = require("path");
		const fs = require("fs");
		const { buildChildEnv } = require("./ai-providers");

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
			" -s read-only --skip-git-repo-check --ignore-user-config" +
			" -C \"" + os.homedir() + "\"" +
			" -o \"" + outFile + "\"" + imageArgs;

		let raw;
		try {
			const stdout = await new Promise((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: 180000,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						err.stderr = stderr;
						err.stdout = out;
						reject(err);
					} else {
						resolve(out);
					}
				});
				child.stdin.write(fullPrompt);
				child.stdin.end();
			});
			// Le fichier -o contient la réponse finale nette ; fallback stdout.
			raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : (stdout || "");
		} catch (err) {
			console.error("[quiz-blocks] Codex error:", err.message, err.stderr || "");
			const detail = ((err.stderr || "") + " " + (err.stdout || "") + " " + err.message).toLowerCase();
			if (err.code === "ENOENT" || err.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error("Codex n'est pas installé. Installez-le (npm i -g @openai/codex) puis connectez-vous avec « codex login ».");
			}
			if (err.killed || detail.includes("etimedout")) {
				throw new Error("ChatGPT (Codex) n'a pas répondu dans le délai imparti (3 min). Réessayez.");
			}
			if (detail.includes("not logged in") || detail.includes("login") || detail.includes("unauthorized") || detail.includes("401") || detail.includes("credential") || detail.includes("authenticat")) {
				throw new Error("Compte ChatGPT non connecté. Dans un terminal, lancez « codex login ».");
			}
			if (detail.includes("usage limit") || detail.includes("rate limit") || detail.includes("quota")) {
				throw new Error("Limite d'utilisation de votre abonnement ChatGPT atteinte. Réessayez plus tard.");
			}
			throw new Error("Erreur Codex : " + (err.stderr || err.message).trim().slice(0, 300));
		} finally {
			try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
		}

		if (!raw || !raw.trim()) {
			throw new Error("ChatGPT (Codex) n'a retourné aucune réponse. Réessayez ou changez de modèle.");
		}
		console.log("[quiz-blocks] Codex success - response length:", raw.length);
		return parseQuizResponse(raw);
	}

	async function callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeaders, images = [], effort = null) {
		if (!ollamaUrl) {
			ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
		}
		authHeaders = authHeaders || {};

		// ── Step 1 : serveur joignable ? Un modèle cloud (:cloud) tourne à la
		// demande via le daemon connecté (absent de /api/tags) → on ne vérifie
		// PAS qu'il est installé ; un modèle local, si. ──
		const providers = require("./ai-providers");
		const isCloud = providers.isOllamaCloudModel(model);
		let installedModels = [];
		let tagModels = [];
		try {
			const tagsResp = await fetch(`${ollamaUrl}/api/tags`, { method: "GET", headers: authHeaders });
			if (!tagsResp.ok) {
				throw new Error("ollama_unreachable");
			}
			const tagsData = await tagsResp.json();
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
			if (err.message === "ollama_unreachable" || !err.message.startsWith("Le modèle")) {
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
		let supportsThinking;
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

		let data;
		try {
			const resp = await fetch(`${ollamaUrl}/api/chat`, {
				method: "POST",
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
				const errMsg = typeof data?.error === "string" ? data.error : (data?.error || "Erreur " + resp.status);
				console.error("[quiz-blocks] Ollama error:", resp.status, errMsg);

				// Specific known errors — show clear French message
				const errLower = typeof errMsg === "string" ? errMsg.toLowerCase() : "";
				if (errLower.includes("more system memory") || errLower.includes("not enough memory") || errLower.includes("out of memory")) {
					const memMatch = typeof errMsg === "string" ? errMsg.match(/(\d+[\.,]?\d*)\s*GiB/g) : null;
					const detail = memMatch ? " (" + memMatch.join(" / ") + ")" : "";
					throw new Error("Mémoire insuffisante pour ce modèle" + detail + ".\nChoisissez un modèle plus petit dans la liste.");
				}
				if (errLower.includes("not found") || errLower.includes("model not found")) {
					throw new Error("Le modèle \"" + model + "\" n\u2019est pas installé.\nExécutez : ollama pull " + model);
				}
				// Modèle cloud réservé à un abonnement (Ollama Pro/Max) : 403
				// « requires a subscription ». Distinct d'un défaut de connexion.
				if (errLower.includes("subscription") || errLower.includes("upgrade for access")) {
					throw new Error("Ce modèle nécessite un abonnement Ollama : https://ollama.com/upgrade");
				}
				if (isCloud && (resp.status === 401 || resp.status === 403 || errLower.includes("sign in") || errLower.includes("signin") || errLower.includes("unauthorized") || errLower.includes("authenticat") || errLower.includes("api key"))) {
					throw new Error("Modèle cloud Ollama : le daemon n'est pas connecté à votre compte.\nDans un terminal : ollama signin");
				}
				throw new Error("Erreur Ollama (" + resp.status + ") : " + errMsg);
			}
		} catch (err) {
			if (err.message.startsWith("Le modèle") || err.message.startsWith("Mémoire insuffisante") || err.message.startsWith("Erreur Ollama") || err.message.startsWith("Impossible de contacter") || err.message.startsWith("Modèle cloud") || err.message.startsWith("Ce modèle nécessite")) {
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

	function parseOllamaResponse(content) {
		let cleaned = content.trim();

		// Try to extract JSON from markdown code blocks
		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}

		// Ollama with format: structured JSON wraps the array in an object
		// e.g. { "questions": [...] }
		try {
			const JSON5 = require("json5");
			const parsed = JSON5.parse(cleaned);

			// If it's an object with a "questions" key, extract the array
			if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.questions)) {
				return parsed.questions;
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

	function parseQuizResponse(content) {
		let cleaned = content.trim();

		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}

		const JSON5 = require("json5");
		const parsed = JSON5.parse(cleaned);

		if (!Array.isArray(parsed)) {
			throw new Error("La réponse IA n'est pas un tableau de questions.");
		}

		return parsed;
	}

	return { generate };
}

module.exports = createAiClient;