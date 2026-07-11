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
	// Le flag vit à la racine (moteur, JSON5 brut) ou dans _extraFields
	// (objet normalisé de l'éditeur — clé inconnue préservée).
	const flag = q.mathInput ?? (q._extraFields && q._extraFields.mathInput);
	if (flag === true) return true;
	if (flag === false) return false;
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

/* Fermeture DOUCE du clavier virtuel : hide() de MathLive détruit le
   DOM immédiatement (vérifié : backdrop absent 30 ms après l'appel) →
   aucune transition possible. On anime NOUS-MÊMES la sortie (les
   transitions CSS de math-input.css s'appliquent aux styles inline)
   puis on hide réellement. Un re-focus pendant la sortie l'annule. */
let __kbExitTimer = 0;

function cancelKeyboardExit() {
	if (!__kbExitTimer) return;
	clearTimeout(__kbExitTimer);
	__kbExitTimer = 0;
	const b = document.querySelector(".ML__keyboard .MLK__backdrop");
	if (b) { b.style.opacity = ""; b.style.transform = ""; }
}

/* MathLive pousse l'app en posant un padding-bottom INLINE sur <body>
   à l'ouverture du clavier. Si le hide est court-circuité (reload du
   plugin clavier ouvert, erreur interne), ce padding reste orphelin :
   grande bande vide sous l'app (baseline Ahmed 2026-07-11, 313px).
   À appeler quand AUCUN clavier n'est visible. */
function clearKeyboardBodyPadding() {
	if (document.querySelector(".ML__keyboard.is-visible")) return;
	if (document.body.style.paddingBottom) document.body.style.paddingBottom = "";
	// Le singleton MathLive MÉMORISE le « padding original » et le
	// restaure à chaque hide (et l'ADDITIONNE au show suivant) : un
	// résidu pollué s'auto-entretient — 313 → 625 → … (mesuré). Purger
	// aussi le mémo.
	const kb = window.mathVirtualKeyboard;
	if (kb && kb.originalContainerBottomPadding) {
		try { kb.originalContainerBottomPadding = null; } catch (e) { /* lecture seule ? tant pis */ }
	}
}

function hideKeyboardSoftly() {
	const b = document.querySelector(".ML__keyboard.is-visible .MLK__backdrop");
	if (!b) {
		try { window.mathVirtualKeyboard?.hide({ animate: false }); } catch (e) { /* déjà fermé */ }
		clearKeyboardBodyPadding();
		return;
	}
	b.style.opacity = "0";
	b.style.transform = "translateY(105%)";
	if (__kbExitTimer) clearTimeout(__kbExitTimer);
	__kbExitTimer = window.setTimeout(() => {
		__kbExitTimer = 0;
		b.style.opacity = "";
		b.style.transform = "";
		try { window.mathVirtualKeyboard?.hide({ animate: false }); } catch (e) { /* transitoire */ }
		clearKeyboardBodyPadding();
	}, 260);
}

let __mathliveConfigured = false;

function configureMathlive() {
	if (__mathliveConfigured) return;
	const lib = require("mathlive");
	// PIÈGE reload plugin : customElements.define('math-field') ne peut
	// arriver qu'UNE fois par page — après un disable/enable, l'élément
	// enregistré reste la classe de l'ANCIEN bundle. document.createElement
	// utilise l'enregistrée : c'est ELLE qu'il faut configurer, sinon
	// fontsDirectory retombe sur './fonts' (requêtes mortes, erreurs au
	// focus/blur). Un redémarrage complet d'Obsidian reste l'état propre.
	const MFE = customElements.get("math-field") || lib.MathfieldElement;
	// Fonts fournies par styles.css (data-URI au build) ; null = MathLive
	// ne tente AUCUN chargement (doc officielle). Sons désactivés.
	MFE.fontsDirectory = null;
	MFE.soundsDirectory = null;
	// Purge un padding orphelin d'une session précédente (reload plugin
	// pendant que le clavier était ouvert).
	clearKeyboardBodyPadding();
	// Clavier virtuel NATIF MathLive (choix Ahmed 2026-07-11 : « c'est
	// propre ce clavier-là ») — sans l'onglet alphabétique (« abc »,
	// inutile avec un clavier physique) : 123, symboles, grec.
	if (window.mathVirtualKeyboard) {
		window.mathVirtualKeyboard.layouts = ["numeric", "symbols", "greek"];
	}
	__mathliveConfigured = true;
}

/*
 * createMathField(host, {
 *   value?, readOnly?, placeholder?,
 *   onInput?(latex), onEnter?()
 * }) → { el, getValue(), setValue(l), focus(), destroy() }
 * Le clavier virtuel NATIF MathLive s'ouvre automatiquement au focus
 * (demande Ahmed : pas besoin de cliquer le bouton clavier) et se
 * referme au blur. Thème : variables CSS dans math-input.css.
 */
function createMathField(host, opts = {}) {
	configureMathlive();

	const mf = document.createElement("math-field");
	mf.classList.add("quiz-mathfield");
	// Ouverture pilotée par nous (focusin) — pas seulement tactile.
	mf.mathVirtualKeyboardPolicy = "manual";
	// Barre espace active (en mode math l'espace ne fait rien par
	// défaut) : insère une espace fine — neutralisée par
	// normalizeMathAnswer à la correction, purement visuelle.
	mf.mathModeSpace = "\\;";
	if (opts.readOnly) mf.readOnly = true;
	if (opts.placeholder) mf.setAttribute("placeholder", opts.placeholder);
	if (opts.value) {
		mf.setValue(String(opts.value).replace(/^\$\$?|\$\$?$/g, ""));
	} else if (opts.template) {
		// Gabarit guidé (« x = ▯ ») : pré-écrit, l'élève remplit les
		// \placeholder{} (navigation Tab native MathLive).
		mf.setValue(String(opts.template).replace(/^\$\$?|\$\$?$/g, ""));
	}
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

	// Clavier virtuel : ouvert dès qu'on écrit (focus), refermé au blur.
	// try/catch : le show/hide de MathLive peut jeter dans des états
	// transitoires (reload plugin, champ détaché) — dégradation douce.
	if (!opts.readOnly) {
		mf.addEventListener("focusin", () => {
			cancelKeyboardExit();
			try { window.mathVirtualKeyboard?.show({ animate: true }); } catch (e) { /* transitoire */ }
		});
		mf.addEventListener("focusout", () => {
			hideKeyboardSoftly();
		});
	}

	return {
		el: mf,
		getValue: () => mf.getValue("latex"),
		setValue: (l) => mf.setValue(String(l ?? "").replace(/^\$\$?|\$\$?$/g, "")),
		focus: () => mf.focus(),
		destroy: () => {
			mf.remove();
		},
	};
}

module.exports = {
	isMathQuestion, normalizeMathAnswer, matchesMathAnswer,
	createMathField,
};
