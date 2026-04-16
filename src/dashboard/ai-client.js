'use strict';

/* ══════════════════════════════════════════════════════════
   AI CLIENT — Anthropic + Ollama
   Anthropic: fetch() avec header anti-CORS. Vision API pour images.
   Ollama: fetch() pour lire les corps d'erreur. Multimodal pour images.
══════════════════════════════════════════════════════════ */

function createAiClient(plugin) {
	const DEFAULT_MODELS = {
		anthropic: "claude-sonnet-4-20250514",
		ollama: "qwen3:14b",
		"ollama-cloud": "qwen3:14b",
	};

	async function generate(prompt, options = {}) {
		const { count = 5, type = "Mixte", source = "topic", images = [] } = options;
		const provider = plugin.settings.aiProvider || "anthropic";
		const apiKey = (plugin.settings.aiApiKey || "").trim();
		const model = plugin.settings.aiModel || DEFAULT_MODELS[provider];

		if (provider === "anthropic" && !apiKey) {
			throw new Error("Clé API Anthropic non configurée. Allez dans les paramètres du plugin.");
		}
		if (provider === "ollama-cloud" && !(plugin.settings.aiOllamaCloudKey || "").trim()) {
			throw new Error("Clé API Ollama Cloud non configurée. Allez dans les paramètres du plugin.");
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
	- correctIndexes: tableau des index des bonnes réponses (pour choix multiple)
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

		if (provider === "ollama" || provider === "ollama-cloud") {
			const ollamaUrl = provider === "ollama-cloud"
				? "https://ollama.com"
				: (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
			const authHeader = provider === "ollama-cloud"
				? { "Authorization": "Bearer " + (plugin.settings.aiOllamaCloudKey || "").trim() }
				: {};
			return callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images);
		} else {
			return callAnthropic(apiKey, model, systemPrompt, userPrompt, images);
		}
	}

	async function callAnthropic(apiKey, model, systemPrompt, userPrompt, images = []) {
		// Use fetch() directly — Obsidian runs in Electron where fetch bypasses CORS
		// This is the same approach used by obsidian-copilot and other working plugins
		const headers = {
			"Content-Type": "application/json",
			"anthropic-version": "2023-06-01",
			"anthropic-dangerous-direct-browser-access": "true",
			"x-api-key": apiKey
		};

		// ── Step 1: Verify API key and check available models ──
		let availableModels = [];
		try {
			const modelsResp = await fetch("https://api.anthropic.com/v1/models?limit=100", {
				method: "GET",
				headers
			});
			if (modelsResp.ok) {
				const modelsData = await modelsResp.json();
				availableModels = (modelsData?.data || []).map(m => m.id);
				console.log("[quiz-blocks] Available models:", availableModels.join(", "));

				if (!availableModels.includes(model)) {
					const fallback = availableModels.find(m => m.includes("sonnet")) || availableModels[0];
					console.log("[quiz-blocks] Model", model, "not available, falling back to:", fallback);
					model = fallback;
				}
			} else {
				console.warn("[quiz-blocks] Could not list models:", modelsResp.status);
				if (modelsResp.status === 401 || modelsResp.status === 403) {
					throw new Error("Clé API Anthropic invalide. Vérifiez sur console.anthropic.com/settings/keys");
				}
			}
		} catch (err) {
			if (err.message.includes("Clé API")) throw err;
			console.warn("[quiz-blocks] Model list request failed:", err.message);
		}

		// ── Step 2: Build user content (text + images for Vision API) ──
		const userContent = images.length > 0
			? [
				...images.map(img => ({
					type: "image",
					source: {
						type: "base64",
						media_type: img.mediaType,
						data: img.base64
					}
				})),
				{ type: "text", text: userPrompt }
			]
			: userPrompt;

		// ── Step 3: Call Messages API ──
		const attempts = [
			{
				label: "with system param",
				body: {
					model,
					max_tokens: 4096,
					system: systemPrompt,
					messages: [{ role: "user", content: userContent }]
				}
			},
			{
				label: "system merged into user",
				body: {
					model,
					max_tokens: 4096,
					messages: [{ role: "user", content: images.length > 0
						? [...images.map(img => ({
							type: "image",
							source: {
								type: "base64",
								media_type: img.mediaType,
								data: img.base64
							}
						})), { type: "text", text: systemPrompt + "\n\n" + userPrompt }]
						: systemPrompt + "\n\n" + userPrompt }]
				}
			}
		];

		for (let i = 0; i < attempts.length; i++) {
			const attempt = attempts[i];
			console.log("[quiz-blocks] Attempt", i + 1, "(", attempt.label, ") with model:", model);

			try {
				const resp = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers,
					body: JSON.stringify(attempt.body)
				});

				const data = await resp.json();

				// If we got a non-2xx status, check for errors
				if (!resp.ok) {
					const errMsg = data?.error?.message || data?.error?.type || JSON.stringify(data?.error || {});
					const status = resp.status;
					console.error("[quiz-blocks] Attempt", i + 1, "failed:", status, errMsg);

					// Specific known errors — show clear French message
					const errLower = errMsg.toLowerCase();
					if (errLower.includes("credit balance") || errLower.includes("billing") || errLower.includes("plan")) {
						throw new Error("Crédits insuffisants. Allez sur console.anthropic.com/settings/plans pour recharger votre compte.");
					}
					if (status === 401 || status === 403) {
						throw new Error("Clé API Anthropic invalide. Vérifiez sur console.anthropic.com/settings/keys");
					}
					if (status === 429) {
						throw new Error("Limite de requêtes atteinte. Réessayez dans quelques instants.");
					}

					// 400 — try next attempt only for potential format issues
					if (status === 400 && i < attempts.length - 1) {
						continue;
					}

					throw new Error(
						"Erreur Anthropic (" + status + ") : " + errMsg
					);
				}

				// Success!
				const content = data?.content?.[0]?.text || "";
				if (!content.trim()) {
					throw new Error("L'IA n'a retourné aucune réponse. Réessayez ou changez de modèle.");
				}

				console.log("[quiz-blocks] Success with", attempt.label, "- response length:", content.length);
				return parseQuizResponse(content);

			} catch (err) {
				// If it's an error we threw, re-throw it
				if (err.message.startsWith("Crédits") || err.message.startsWith("Clé API") || err.message.startsWith("Limite") || err.message.startsWith("Erreur Anthropic")) {
					throw err;
				}
				// Network error
				if (i < attempts.length - 1) continue;
				throw new Error("Impossible de contacter l'API Anthropic : " + err.message);
			}
		}
	}

	async function callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeaders, images = []) {
		if (!ollamaUrl) {
			ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
		}
		authHeaders = authHeaders || {};

		// ── Step 1: Check server is running and model is available ──
		let installedModels = [];
		try {
			const tagsResp = await fetch(`${ollamaUrl}/api/tags`, { method: "GET", headers: authHeaders });
			if (!tagsResp.ok) {
				throw new Error("ollama_unreachable");
			}
			const tagsData = await tagsResp.json();
			installedModels = (tagsData?.models || []).map(m => m.name);
			console.log("[quiz-blocks] Ollama installed models:", installedModels.join(", "));

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
		} catch (err) {
			if (err.message === "ollama_unreachable" || !err.message.startsWith("Le modèle")) {
				throw new Error(
					"Impossible de contacter Ollama sur " + ollamaUrl + ".\n" +
					"Vérifiez que le serveur est démarré (ollama serve)."
				);
			}
			throw err;
		}

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
										correctIndexes: { type: "array", items: { type: "number" } },
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
				throw new Error("Erreur Ollama (" + resp.status + ") : " + errMsg);
			}
		} catch (err) {
			if (err.message.startsWith("Le modèle") || err.message.startsWith("Mémoire insuffisante") || err.message.startsWith("Erreur Ollama") || err.message.startsWith("Impossible de contacter")) {
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