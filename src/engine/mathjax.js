'use strict';

/* ══════════════════════════════════════════════════════════
   MATHJAX — rendu LaTeX natif Obsidian dans le quiz
   Syntaxe $...$ (inline) et $$...$$ (bloc), rendue via l'API
   officielle d'Obsidian (loadMathJax / renderMath /
   finishRenderMath — docs.obsidian.md, vérifiée 2026-07-11)
   → apparence STRICTEMENT identique aux notes du vault.
   Module partagé moteur + éditeur : exports directs, pas de
   factory ctx (aucune dépendance au contexte du quiz).
══════════════════════════════════════════════════════════ */

// loadMathJax() est mémoïsée : MathJax n'est chargé qu'une fois par
// session, les appels suivants réutilisent la même promesse.
let __mathJaxReady = null;

function ensureMathJax() {
	if (!__mathJaxReady) {
		__mathJaxReady = require("obsidian").loadMathJax();
	}
	return __mathJaxReady;
}

/* $$...$$ (bloc, testé en premier) puis $...$ (inline). Heuristique
   d'Obsidian pour éviter les vrais dollars (« 5$ et 3$ ») : le $
   ouvrant est collé au contenu, le fermant aussi, pas de saut de
   ligne dans un inline. */
const MATH_SEGMENT = /\$\$([^$]+?)\$\$|\$(?!\s)([^$\n]*?[^$\s])\$/g;

function hasMath(text) {
	if (typeof text !== "string" || text.indexOf("$") === -1) return false;
	MATH_SEGMENT.lastIndex = 0;
	return MATH_SEGMENT.test(text);
}

/* Remplace, dans les text nodes sous `root`, chaque segment $...$ /
   $$...$$ par son rendu MathJax. Async (chargement MathJax au premier
   appel) et fire-and-forget : un re-render régénère le HTML source,
   donc jamais de double traitement. Les zones littérales (code, pre,
   textarea, éléments déjà rendus par MathJax) sont ignorées. */
async function mathifyElement(root) {
	if (!root) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!node.nodeValue || node.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
			const p = node.parentElement;
			if (!p || p.closest("code, pre, textarea, script, style, mjx-container, .math")) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		}
	});
	const jobs = [];
	while (walker.nextNode()) {
		if (hasMath(walker.currentNode.nodeValue)) jobs.push(walker.currentNode);
	}
	if (!jobs.length) return;

	await ensureMathJax();
	const { renderMath, finishRenderMath } = require("obsidian");
	for (const node of jobs) {
		// replaceWith exige un parent ; un re-render a pu orpheliner le
		// node pendant le chargement MathJax. (Un container encore détaché
		// du DOM reste traité — l'embed peut monter avant insertion.)
		if (!node.parentNode) continue;
		const text = node.nodeValue;
		const frag = document.createDocumentFragment();
		let last = 0, m;
		MATH_SEGMENT.lastIndex = 0;
		while ((m = MATH_SEGMENT.exec(text))) {
			if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
			const display = m[1] !== undefined;
			try {
				frag.appendChild(renderMath(display ? m[1] : m[2], display));
			} catch (e) {
				// LaTeX invalide → laisser le texte source tel quel.
				frag.appendChild(document.createTextNode(m[0]));
			}
			last = m.index + m[0].length;
		}
		if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
		node.replaceWith(frag);
	}
	// Requis par l'API : flush de la feuille de style MathJax.
	finishRenderMath();
}

module.exports = { mathifyElement, hasMath };
