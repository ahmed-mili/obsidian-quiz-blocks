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
	if (b) b.style.opacity = "";
}

/* MathLive pousse l'app en posant un padding-bottom INLINE sur <body>
   à l'ouverture du clavier. Si le hide est court-circuité (reload du
   plugin clavier ouvert, erreur interne), ce padding reste orphelin :
   grande bande vide sous l'app (baseline Ahmed 2026-07-11, 313px).
   À appeler quand AUCUN clavier n'est visible. */
/* Retire la poussée de l'app par le clavier — MÊME clavier visible
   (mode overlay) : le padding inline du body ET le mémo du singleton. */
function suppressKeyboardPush() {
	if (document.body.style.paddingBottom) document.body.style.paddingBottom = "";
	const kb = window.mathVirtualKeyboard;
	if (kb && kb.originalContainerBottomPadding) {
		try { kb.originalContainerBottomPadding = null; } catch (e) { /* best effort */ }
	}
}

/* ── Clavier FLOTTANT déplaçable (référence : clavier visuel Windows,
   demande Ahmed 2026-07-11). Le DOM du clavier est DÉTRUIT à chaque
   hide → tout est (ré)appliqué après chaque show : classe flottante,
   position mémorisée (session), poignée de drag + bouton fermer. ── */
let __kbPos = null; // { left, top } mémorisée pour la session
let __kbDragging = false; // drag en cours : ne pas fermer le clavier
let __lastMathfield = null; // dernier champ focalisé (refocus post-drag)

function clampKbPos(left, top, w, h) {
	return {
		left: Math.min(Math.max(8, left), window.innerWidth - w - 8),
		top: Math.min(Math.max(8, top), window.innerHeight - h - 8),
	};
}

function makeKeyboardFloating(attempt = 0) {
	const backdrop = document.querySelector(".ML__keyboard.is-visible .MLK__backdrop");
	if (!backdrop) {
		// Le show peut poser is-visible une frame plus tard : retenter
		// brièvement (10 frames max) avant d'abandonner.
		if (attempt < 10) requestAnimationFrame(() => makeKeyboardFloating(attempt + 1));
		return;
	}
	if (backdrop.classList.contains("qbd-kb-floating")) return;
	backdrop.classList.add("qbd-kb-floating");

	// Position : mémorisée (revient EXACTEMENT où l'utilisateur l'a
	// laissée — clamp avec les dimensions MÉMORISÉES au drop, jamais
	// celles du clavier en cours d'animation, faussées), sinon centré
	// bas (marge 14px).
	requestAnimationFrame(() => {
		if (__kbPos) {
			const pos = clampKbPos(__kbPos.left, __kbPos.top, __kbPos.w || 880, __kbPos.h || 330);
			backdrop.style.left = pos.left + "px";
			backdrop.style.top = pos.top + "px";
			return;
		}
		const r = backdrop.getBoundingClientRect();
		backdrop.style.left = Math.round((window.innerWidth - r.width) / 2) + "px";
		backdrop.style.top = Math.round(window.innerHeight - r.height - 14) + "px";
	});

	// Poignée de drag + fermer.
	const handle = document.createElement("div");
	handle.className = "qbd-kb-handle";
	const grip = document.createElement("span");
	grip.className = "qbd-kb-handle-grip";
	require("obsidian").setIcon(grip, "grip-horizontal");
	const close = document.createElement("button");
	close.type = "button";
	close.className = "qbd-kb-handle-close";
	close.setAttribute("aria-label", "Fermer le clavier");
	require("obsidian").setIcon(close, "x");
	close.addEventListener("click", () => hideKeyboardSoftly());
	handle.append(grip, close);
	backdrop.prepend(handle);

	// Drag depuis N'IMPORTE QUELLE zone non interactive du clavier
	// (référence clavier visuel Windows — demande Ahmed) : le listener
	// vit sur le BACKDROP en phase capture (le « sink » MathLive
	// avalerait l'événement sinon). Touches/onglets/toolbar/variantes
	// restent cliquables ; tout le reste (poignée, bordures, espaces
	// entre touches) déplace. Le blur du champ pendant le drag est
	// neutralisé par __kbDragging, focus rendu au relâchement.
	const INTERACTIVE = ".MLK__keycap, .MLK__shift, [data-command], button, [role=button], .MLK__toolbar *, .MLK__variant-panel, .layer-switch, .qbd-kb-handle-close";
	backdrop.addEventListener("pointerdown", (e) => {
		if (e.target.closest(INTERACTIVE)) return;
		e.preventDefault();
		e.stopPropagation();
		__kbDragging = true;
		cancelKeyboardExit();
		try { backdrop.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		const r = backdrop.getBoundingClientRect();
		backdrop.classList.add("is-dragging");
		// CURSEUR FIGÉ pendant tout le drag (demande Ahmed : « il reste
		// collé à l'endroit où j'avais cliqué ») : Pointer Lock — le
		// curseur système ne bouge plus, le clavier se déplace via les
		// mouvements RELATIFS (movementX/Y). À la sortie du lock, le
		// curseur réapparaît exactement au point du clic. Clamp CONTINU
		// aux bords (comportement validé), positions cumulées clampées
		// pour un retour de bord immédiat (pas d'effet élastique).
		let curLeft = r.left;
		let curTop = r.top;
		const dx = e.clientX - r.left;
		const dy = e.clientY - r.top;
		let locked = false;
		try {
			backdrop.requestPointerLock();
			locked = true;
		} catch (err) { /* fallback : drag classique par offset */ }

		const onMove = (ev) => {
			if (document.pointerLockElement === backdrop) {
				curLeft += ev.movementX;
				curTop += ev.movementY;
			} else {
				// Lock refusé/perdu : suivi classique par position absolue.
				curLeft = ev.clientX - dx;
				curTop = ev.clientY - dy;
			}
			const pos = clampKbPos(curLeft, curTop, r.width, r.height);
			curLeft = pos.left;
			curTop = pos.top;
			backdrop.style.left = pos.left + "px";
			backdrop.style.top = pos.top + "px";
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onUp);
			if (locked && document.pointerLockElement === backdrop) {
				try { document.exitPointerLock(); } catch (err) { /* best effort */ }
			}
			backdrop.classList.remove("is-dragging");
			const rr = backdrop.getBoundingClientRect();
			__kbPos = {
				left: Math.round(rr.left), top: Math.round(rr.top),
				w: Math.round(rr.width), h: Math.round(rr.height),
			};
			__kbDragging = false;
			// Rendre le focus au champ : la saisie continue sans re-clic.
			if (__lastMathfield && __lastMathfield.isConnected) __lastMathfield.focus();
		};
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onUp);
	}, { capture: true });
}

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
	// Fondu seul : en mode flottant le transform est interdit (résidus
	// MathLive → positions décalées), l'opacité suffit.
	b.style.opacity = "0";
	if (__kbExitTimer) clearTimeout(__kbExitTimer);
	__kbExitTimer = window.setTimeout(() => {
		__kbExitTimer = 0;
		b.style.opacity = "";
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
			__lastMathfield = mf;
			cancelKeyboardExit();
			try { window.mathVirtualKeyboard?.show({ animate: true }); } catch (e) { /* transitoire */ }
			// OVERLAY, pas poussée : MathLive contracte l'app (padding
			// body) → zone morte sans wallpaper derrière le clavier
			// (capture Ahmed). On retire la poussée : le clavier (fixed)
			// recouvre le bas de l'app et son verre floute du VRAI
			// contenu. Le champ est recentré s'il tombe dessous.
			requestAnimationFrame(() => {
				suppressKeyboardPush();
				makeKeyboardFloating();
				const kbTop = document.querySelector(".ML__keyboard.is-visible .MLK__backdrop")?.getBoundingClientRect().top;
				const r = mf.getBoundingClientRect();
				if (kbTop && r.bottom > kbTop) mf.scrollIntoView({ block: "center", behavior: "smooth" });
			});
		});
		mf.addEventListener("focusout", () => {
			// Blur causé par la saisie de la poignée de drag : ignorer,
			// le clavier reste ouvert et le champ sera refocalisé au drop.
			if (__kbDragging) return;
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
