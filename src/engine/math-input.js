'use strict';

/* ══════════════════════════════════════════════════════════
   MATH INPUT — éditeur d'équations WYSIWYG (MathLive)
   Champ <math-field> pour les réponses des questions texte
   mathématiques : frappe naturelle → math rendue, clic sur un
   élément → édition ciblée, AUCUN code LaTeX visible. Panneau
   de symboles custom façon Overleaf (catégorie par défaut
   déduite de la réponse attendue). Spec :
   docs/superpowers/specs/2026-07-11-math-input-design.md
   Module partagé moteur + éditeur (exports directs).
══════════════════════════════════════════════════════════ */

const { hasMath } = require("./mathjax");

/* Une question texte est « math » si l'IA l'a marquée mathInput, ou si
   son énoncé / une réponse acceptée contient un segment $...$. */
function isMathQuestion(q) {
	if (!q || (q.type !== "text" && q._type !== "text")) return false;
	if (q.mathInput === true) return true;
	if (q.mathInput === false) return false;
	if (hasMath(q.prompt || "") || hasMath(q.promptHtml || q._promptHtml || "")) return true;
	const answers = [...(q.acceptedAnswers || []), ...(q.acceptableAnswers || [])];
	if (typeof q.answer === "string") answers.push(q.answer);
	return answers.some(a => typeof a === "string" && (hasMath(a) || /\\[a-zA-Z]{2,}/.test(a)));
}

/* Normalisation de FORME uniquement (décision Ahmed 2026-07-11 : pas
   d'équivalence symbolique — x\cdot4 ≠ 4x ; chaque forme acceptable est
   listée dans acceptedAnswers). Rend comparables les écritures
   équivalentes d'un MÊME LaTeX. */
function normalizeMathAnswer(latex, { caseSensitive = false } = {}) {
	let s = String(latex ?? "").trim();
	// Dollars des acceptedAnswers d'auteur ($...$) : la valeur comparée
	// est le contenu.
	s = s.replace(/^\$\$?|\$\$?$/g, "");
	// Espaces D'ABORD (sinon « { 1 } » échappe au strip singleton). La
	// transformation est appliquée identiquement aux deux côtés de la
	// comparaison — déterminisme > sémantique (\text{} multi-mots hors
	// périmètre des réponses math).
	s = s.replace(/\s+/g, "");
	// Formes d'écriture sans effet sur le rendu.
	s = s.replace(/\\left(?=[([{|])/g, "").replace(/\\right(?=[)\]}|])/g, "");
	s = s.replace(/\\[,;!:]/g, "");
	s = s.replace(/\\(d|t)frac/g, "\\frac");
	s = s.replace(/\\operatorname\{([a-zA-Z]+)\}/g, "\\$1");
	// Accolades singleton : x^{2} → x^2 (répété pour les imbrications).
	for (let i = 0; i < 3; i++) s = s.replace(/\{([a-zA-Z0-9])\}/g, "$1");
	if (!caseSensitive) s = s.toLowerCase();
	return s;
}

/* La réponse de l'élève (LaTeX MathLive) correspond-elle à une des
   réponses acceptées de la question ? */
function matchesMathAnswer(studentLatex, q) {
	const accepted = [...(q.acceptedAnswers || []), ...(q.acceptableAnswers || [])];
	if (typeof q.answer === "string") accepted.push(q.answer);
	const opts = { caseSensitive: !!q.caseSensitive };
	const student = normalizeMathAnswer(studentLatex, opts);
	if (!student) return false;
	return accepted.some(a => normalizeMathAnswer(a, opts) === student);
}

/* ── Panneau de symboles (référence Overleaf, capture Ahmed) ── */
const PALETTE = [
	{
		id: "base", label: "Bases",
		keys: [
			{ latex: "\\times" }, { latex: "\\div" }, { latex: "\\pm" },
			{ latex: "=" }, { latex: "\\neq" }, { latex: "<" }, { latex: ">" },
			{ latex: "\\leq" }, { latex: "\\geq" }, { insert: "\\placeholder{}%" , show: "\\%" },
		],
	},
	{
		id: "frac", label: "Fractions & exposants",
		keys: [
			{ insert: "\\frac{#@}{#?}", show: "\\frac{a}{b}" },
			{ insert: "#@^{#?}", show: "x^n" },
			{ insert: "#@_{#?}", show: "x_n" },
			{ insert: "#@^2", show: "x^2" },
			{ insert: "\\left|#?\\right|", show: "\\left|x\\right|" },
		],
	},
	{
		id: "roots", label: "Racines",
		keys: [
			{ insert: "\\sqrt{#?}", show: "\\sqrt{x}" },
			{ insert: "\\sqrt[3]{#?}", show: "\\sqrt[3]{x}" },
			{ insert: "\\sqrt[#?]{#?}", show: "\\sqrt[n]{x}" },
		],
	},
	{
		id: "calc", label: "Calcul",
		keys: [
			{ insert: "\\int", show: "\\int" },
			{ insert: "\\int_{#?}^{#?}", show: "\\int_a^b" },
			{ insert: "\\sum_{#?}^{#?}", show: "\\sum" },
			{ insert: "\\lim_{#?\\to#?}", show: "\\lim" },
			{ insert: "\\frac{d}{dx}", show: "\\frac{d}{dx}" },
			{ latex: "\\infty" }, { latex: "\\partial" },
		],
	},
	{
		id: "greek", label: "Grec",
		keys: [
			{ latex: "\\alpha" }, { latex: "\\beta" }, { latex: "\\gamma" },
			{ latex: "\\delta" }, { latex: "\\theta" }, { latex: "\\lambda" },
			{ latex: "\\mu" }, { latex: "\\pi" }, { latex: "\\sigma" },
			{ latex: "\\phi" }, { latex: "\\omega" }, { latex: "\\Delta" },
			{ latex: "\\Omega" },
		],
	},
	{
		id: "rel", label: "Flèches & ensembles",
		keys: [
			{ latex: "\\to" }, { latex: "\\Rightarrow" }, { latex: "\\Leftrightarrow" },
			{ latex: "\\in" }, { latex: "\\notin" }, { latex: "\\subset" },
			{ latex: "\\cup" }, { latex: "\\cap" }, { latex: "\\mathbb{R}" },
			{ latex: "\\mathbb{N}" },
		],
	},
];

/* Catégorie par défaut : celle qui sert à ÉCRIRE la réponse attendue
   (demande explicite d'Ahmed). Analyse de la première réponse acceptée. */
function detectCategory(q) {
	const ref = [...(q.acceptedAnswers || []), typeof q.answer === "string" ? q.answer : ""]
		.filter(Boolean).join(" ");
	if (/\\int|\\sum|\\lim|\\infty|\\partial|\\frac\{d\}/.test(ref)) return "calc";
	if (/\\sqrt/.test(ref)) return "roots";
	if (/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)/i.test(ref)) return "greek";
	if (/\\to|\\Rightarrow|\\in\b|\\subset|\\cup|\\cap|\\mathbb/.test(ref)) return "rel";
	if (/\\frac|\^|_/.test(ref)) return "frac";
	return "base";
}

let __mathliveConfigured = false;

function configureMathlive() {
	if (__mathliveConfigured) return;
	const { MathfieldElement } = require("mathlive");
	// Fonts fournies par styles.css (data-URI au build) ; null = MathLive
	// ne tente AUCUN chargement (doc officielle). Sons désactivés.
	MathfieldElement.fontsDirectory = null;
	MathfieldElement.soundsDirectory = null;
	__mathliveConfigured = true;
}

/*
 * createMathField(host, {
 *   question,            // pour la catégorie par défaut du panneau
 *   value?, readOnly?, placeholder?,
 *   onInput?(latex), onEnter?()
 * }) → { el, panel, getValue(), setValue(l), focus(), destroy() }
 * Le panneau de symboles est monté APRÈS le champ dans `host` et
 * affiché au focus (masqué au blur, sauf clic dans le panneau).
 */
function createMathField(host, opts = {}) {
	configureMathlive();
	const { renderMath } = require("obsidian");

	const mf = document.createElement("math-field");
	mf.classList.add("quiz-mathfield");
	// Pas de clavier plein écran MathLive sur desktop : notre panneau.
	// (Sur tactile, le clavier virtuel MathLive standard reste utile.)
	mf.mathVirtualKeyboardPolicy = "manual";
	// Pas de menu hamburger (il expose « LaTeX » — jamais de code visible).
	try { mf.menuItems = []; } catch (e) { /* API absente sur vieille version */ }
	if (opts.readOnly) mf.readOnly = true;
	if (opts.placeholder) mf.setAttribute("placeholder", opts.placeholder);
	if (opts.value) mf.setValue(String(opts.value).replace(/^\$\$?|\$\$?$/g, ""));
	host.appendChild(mf);

	if (opts.onInput) {
		mf.addEventListener("input", () => opts.onInput(mf.getValue("latex")));
	}
	if (opts.onEnter) {
		mf.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				opts.onEnter();
			}
		});
	}

	// ── Panneau de symboles ──
	let panel = null;
	let hideTimer = 0;
	if (!opts.readOnly) {
		panel = host.createDiv({ cls: "quiz-math-panel" });
		const tabs = panel.createDiv({ cls: "quiz-math-panel-tabs" });
		const keysHost = panel.createDiv({ cls: "quiz-math-panel-keys" });
		let activeCat = opts.question ? detectCategory(opts.question) : "base";

		const renderKeys = () => {
			keysHost.empty();
			const cat = PALETTE.find(c => c.id === activeCat) || PALETTE[0];
			for (const k of cat.keys) {
				const btn = keysHost.createEl("button", { cls: "quiz-math-key" });
				btn.type = "button";
				// Aperçu du symbole rendu par MathJax (jamais de code brut).
				try {
					btn.appendChild(renderMath(k.show || k.latex, false));
				} catch (e) {
					btn.setText(k.show || k.latex);
				}
				// mousedown : insérer SANS voler le focus du champ.
				btn.addEventListener("mousedown", (e) => {
					e.preventDefault();
					mf.executeCommand(["insert", k.insert || k.latex]);
					mf.focus();
				});
			}
			for (const c of PALETTE) {
				const tab = tabs.querySelector(`[data-cat="${c.id}"]`);
				if (tab) tab.classList.toggle("is-active", c.id === activeCat);
			}
		};

		for (const c of PALETTE) {
			const tab = tabs.createEl("button", { cls: "quiz-math-panel-tab", text: c.label });
			tab.type = "button";
			tab.dataset.cat = c.id;
			tab.addEventListener("mousedown", (e) => {
				e.preventDefault();
				activeCat = c.id;
				renderKeys();
				mf.focus();
			});
		}
		renderKeys();
		require("./mathjax").mathifyElement(panel); // au cas où renderMath a différé

		// Visible au focus, masqué au blur (le mousedown du panneau garde
		// le focus sur le champ → pas de fermeture pendant l'usage).
		panel.classList.add("is-hidden");
		mf.addEventListener("focusin", () => {
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
			panel.classList.remove("is-hidden");
		});
		mf.addEventListener("focusout", () => {
			hideTimer = window.setTimeout(() => panel.classList.add("is-hidden"), 120);
		});
	}

	return {
		el: mf,
		panel,
		getValue: () => mf.getValue("latex"),
		setValue: (l) => mf.setValue(String(l ?? "").replace(/^\$\$?|\$\$?$/g, "")),
		focus: () => mf.focus(),
		destroy: () => {
			if (hideTimer) clearTimeout(hideTimer);
			if (panel) panel.remove();
			mf.remove();
		},
	};
}

module.exports = {
	isMathQuestion, normalizeMathAnswer, matchesMathAnswer,
	detectCategory, createMathField, PALETTE,
};
