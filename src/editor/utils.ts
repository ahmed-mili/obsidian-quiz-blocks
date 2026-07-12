import { setIcon } from "obsidian";
import type { ResourceButton } from "../types/quiz";

export type QuestionTypeKey = "single" | "multi" | "ordering" | "matching" | "text" | "cmd" | "powershell" | "bash";

interface QuizTypeDef {
	key: QuestionTypeKey;
	label: string;
	lucide: string;
	desc: string;
}

const Q_TYPES: QuizTypeDef[] = [
	{ key: "single", label: "Choix unique", lucide: "circle-dot", desc: "Une seule bonne réponse" },
	{ key: "multi", label: "Choix multiple", lucide: "check-square", desc: "Plusieurs bonnes réponses" },
	{ key: "ordering", label: "Classement", lucide: "arrow-up-down", desc: "Ordonner les éléments" },
	{ key: "matching", label: "Association", lucide: "link", desc: "Associer lignes et choix" },
	{ key: "text", label: "Texte libre", lucide: "type", desc: "Textarea classique" },
	{ key: "cmd", label: "Terminal CMD", lucide: "terminal", desc: "Invite de commandes Windows" },
	{ key: "powershell", label: "PowerShell", lucide: "terminal-square", desc: "Terminal PowerShell" },
	{ key: "bash", label: "Terminal Bash", lucide: "terminal", desc: "Terminal Linux/Bash" },
];

interface ReactBridge {
	React: unknown;
	ReactDOM: unknown;
}

function loadReact(): ReactBridge {
	if (typeof window.React !== 'undefined' && typeof window.ReactDOM !== 'undefined') {
		return { React: window.React, ReactDOM: window.ReactDOM };
	}
	return { React: null, ReactDOM: null };
}

function _setIcon(el: HTMLElement, name: string): void { try { setIcon(el, name); } catch (_) { /* noop */ } }
function _iconSpan(parent: HTMLElement, name: string, cls?: string): HTMLSpanElement { const s = parent.createSpan({ cls: cls || "qb-icon" }); _setIcon(s, name); return s; }

/** Question en cours d'édition côté éditeur — champs internes (_type/_id) en plus des champs de données. */
export interface DraftQuestion {
	_type: QuestionTypeKey;
	_id: string;
	title: string;
	prompt: string;
	hint: string;
	explain: string;
	resourceButton: ResourceButton | null;
	_useHtmlPrompt: boolean;
	options?: string[];
	correctIndex?: number;
	correctIndices?: number[];
	slots?: string[];
	possibilities?: string[];
	correctOrder?: number[];
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
	placeholder?: string;
	acceptedAnswers?: string[];
	caseSensitive?: boolean;
	commandPrefix?: string;
	/** Énoncé/explication en HTML pré-rendu (édition mode HTML + fallback import). */
	_promptHtml?: string;
	_explainHtml?: string;
	/** Titre modifié manuellement (bloque la renumérotation auto "Question N"). */
	_userModifiedTitle?: boolean;
	/** Clés inconnues préservées au round-trip import→export (editor/modals.js convertToInternalFormat). */
	_extraFields?: Record<string, unknown>;
	/** Gabarit guidé de l'éditeur math (miroir de TextQuestion.answerTemplate). */
	answerTemplate?: string;
}

function makeDefault(type: QuestionTypeKey): DraftQuestion {
	const b: DraftQuestion = { _type: type, _id: Math.random().toString(36).slice(2, 10), title: "", prompt: "", hint: "", explain: "", resourceButton: null, _useHtmlPrompt: false };
	switch (type) {
		case "single": return { ...b, options: ["", ""], correctIndex: 0 };
		case "multi": return { ...b, options: ["", ""], correctIndices: [] };
		case "ordering": return { ...b, slots: ["Étape 1", "Étape 2"], possibilities: ["", ""], correctOrder: [0, 1] };
		case "matching": return { ...b, rows: ["", ""], choices: ["", ""], correctMap: [0, 0] };
		case "text": return { ...b, placeholder: "Votre réponse...", acceptedAnswers: [""], caseSensitive: false };
		case "cmd": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false, commandPrefix: "C:\\>" };
		case "powershell": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false, commandPrefix: "PS>" };
		case "bash": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false };
		default: return b;
	}
}

function md2html(src?: string | null): string {
	if (!src) return "";
	let text = String(src);

	// Étape 0: Convertir les anciennes balises <br> en \n pour compatibilité
	text = text.replace(/<br\s*\/?>/gi, '\n');

	// Étape 1: Extraire les blocs de code AVANT toute échappement HTML
	// Utiliser un placeholder qui ne contient PAS de < ou > pour éviter l'échappement
	const codeBlocks: string[] = [];
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match: string, _lang: string, code: string) => {
		const idx = codeBlocks.length;
		const placeholder = `__CODEBLOCK_${idx}__`;
		// Stocker le code et échapper son contenu pour HTML immédiatement
		codeBlocks.push(escHtml(code.trim()).replace(/\n/g, "<br>"));
		return placeholder;
	});

	// Étape 2: Échapper les caractères HTML du reste du texte
	text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	// Étape 3: Convertir le markdown en HTML
	text = text
		.replace(/^### (.+)$/gm, "<h3>$1</h3>")
		.replace(/^## (.+)$/gm, "<h2>$1</h2>")
		.replace(/^# (.+)$/gm, "<h1>$1</h1>")
		.replace(/`([^`\n]+)`/g, "<code>$1</code>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/^- (.+)$/gm, "<li>$1</li>")
		.replace(/(<li>.*<\/li>\n?)+/g, m => "<ul>" + m + "</ul>")
		.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
		.replace(/(<blockquote>.*<\/blockquote>\n?)+/g, m => m.replace(/<\/blockquote>\n?<blockquote>/g, "\n"))
		.replace(/!\[\[([^\]]+)\]\]/g, "<img src=\"$1\" class=\"qb-md-img\" />")
		.replace(/\n{2,}/g, "</p><p>")
		.replace(/\n/g, "<br>");

	// Étape 4: Réinsérer les blocs de code (placeholder n'a pas été échappé car pas de < >)
	codeBlocks.forEach((escapedCode, i) => {
		const placeholder = `__CODEBLOCK_${i}__`;
		text = text.replace(placeholder, `<pre><code>${escapedCode}</code></pre>`);
	});

	return text;
}

function escHtml(s?: unknown): string { return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

function esc5(s?: unknown): string {
	return String(s ?? "")
		.replace(/\\/g, "\\\\")    // Échapper les antislashs d'abord
		.replace(/'/g, "\\'")          // Échapper les apostrophes (car on utilise ' pour délimiter)
		.replace(/\r/g, "\\r")        // Échapper les retours chariot
		.replace(/\n/g, "\\n");        // Échapper les sauts de ligne
	// Note: Les chevrons < > ne sont PAS échappés avec \ car ce n'est pas
	// valide en JSON5. Ils sont déjà échappés en HTML entities (&lt; &gt;)
	// par md2html() avant d'appeler esc5().
}

export { Q_TYPES, loadReact, _setIcon, _iconSpan, makeDefault, md2html, escHtml, esc5 };
