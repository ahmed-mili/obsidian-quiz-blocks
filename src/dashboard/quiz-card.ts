import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { openActionMenu } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";

/* Tag de type de quiz (calculé au scan) → clé de traduction, résolue au rendu.
   Table explicite plutôt qu'une clé construite par concaténation : `t()` n'accepte
   qu'une TransKey littérale, donc un tag orphelin est une erreur de compilation. */
const QUIZ_TYPE_KEYS: Record<QuizTypeTag, TransKey> = {
	mixed: "dashboard.quizType.mixed",
	single: "dashboard.quizType.single",
	multiple: "dashboard.quizType.multiple",
	text: "dashboard.quizType.text",
	ordering: "dashboard.quizType.ordering",
	matching: "dashboard.quizType.matching"
};

/** Libellé traduit du type d'un quiz (partagé par la carte et la vue Détail). */
export function quizTypeLabel(tag: QuizTypeTag): string {
	return t(QUIZ_TYPE_KEYS[tag]);
}

/* ══════════════════════════════════════════════════════════
   QUIZ CARD — composant carte partagé (home + quizzes)
   État lisible (pastille couleur + icône), accent coloré par état,
   progression affichée seulement en cours.
   `onOpen(quiz)` est appelé au clic sur la carte (navigation laissée
   à l'appelant). En haut à droite : chevron `chevron-right` ornemental
   par défaut (comportement historique) ; SI `opts.onPlay` est fourni,
   un bouton lecture rond le remplace et lance le quiz directement au
   clic (stoppe la propagation — ne doit PAS aussi déclencher `onOpen`).
   Opt-in par appelant (périmètre Ahmed 2026-07-17 : seul « Mes quiz »
   passe `onPlay` ; l'accueil garde le chevron pour l'instant) — même
   patron que `showPath` juste en dessous. */

export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void,
	/* showPath (défaut true) : sous-titre dossier parent affiché sur TOUTE
	   carte, y compris quand l'appelant affiche déjà le dossier au-dessus
	   (arbre de « Mes quiz ») — répétition assumée, comme StudySmarter
	   (référence Ahmed, 2026-07-17). Option conservée pour un appelant futur
	   qui voudrait la masquer, mais aucun ne le fait plus aujourd'hui.
	   onPlay : callback de lancement direct, construite par l'appelant à
	   partir de SON `ctx.app` (renderQuizCard n'a pas accès à `app` — même
	   patron que `onOpen`, pas de nouveau paramètre positionnel). */
	/* menu (opt-in, même patron que onPlay) : items du menu ⋯ façon
	   StudySmarter, bâtis par l'appelant AU CLIC (les stats peuvent avoir
	   changé depuis le rendu de la carte). Non fourni = pas de bouton ⋯. */
	opts?: { showPath?: boolean; onPlay?: (quiz: QuizIndexEntry) => void; menu?: (quiz: QuizIndexEntry) => ActionMenuItem[] }
): HTMLDivElement {
	const card = container.createDiv({ cls: "qbd-quiz-card" });
	card.dataset.path = quiz.path;

	// ── État du quiz (source unique de vérité pour pastille + couleurs) ──
	const total = quiz.questions || (stats && stats.totalQuestions) || 0;
	const done = stats ? stats.questionsDone : 0;
	const best = stats ? stats.bestScore : 0;
	const pct = total > 0 ? Math.round(done / total * 100) : 0;

	// `state` reste un identifiant (suffixe de classe CSS) ; seul `stateLabel`
	// est traduit — et il l'est ici, à chaque rendu de carte.
	let state: string, stateLabel: string, stateIcon: string;
	if (stats && total > 0 && done >= total) {
		if (best >= 80) { state = "mastered"; stateLabel = t("dashboard.card.mastered"); stateIcon = "circle-check"; }
		else { state = "review"; stateLabel = t("dashboard.card.review"); stateIcon = "rotate-ccw"; }
	} else if (done > 0) {
		state = "progress"; stateLabel = t("dashboard.card.progress", { pct }); stateIcon = "rotate-cw";
	} else {
		state = "fresh"; stateLabel = t("dashboard.card.fresh"); stateIcon = "circle-play";
	}

	// Barre d'accent colorée par état
	card.createDiv({ cls: `qbd-quiz-card-accent qbd-quiz-card-accent--${state}` });

	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// En-tête : pastille d'état + chevron (ou bouton lecture, cf. plus bas)
	const head = body.createDiv({ cls: "qbd-quiz-card-head" });
	const pill = head.createDiv({ cls: `qbd-quiz-card-status qbd-quiz-card-status--${state}` });
	const sIcon = pill.createSpan({ cls: "qbd-quiz-card-status-icon" });
	setIcon(sIcon, stateIcon);
	pill.createSpan({ text: stateLabel });
	// opts.onPlay non fourni = comportement HISTORIQUE strictement inchangé :
	// chevron ornemental révélé au survol (même patron que `showPath` — un
	// appelant opte, l'autre ne bouge pas). Périmètre actuel (Ahmed,
	// 2026-07-17) : seul « Mes quiz » (quizzes.ts) passe `onPlay` ; l'accueil
	// (home.ts) garde le chevron, le bouton lecture viendra plus tard.
	if (opts?.onPlay) {
		const onPlay = opts.onPlay;
		// Bouton lecture rond — lance le quiz directement, sans passer par la
		// fiche. Pas d'aria-label (Obsidian en ferait une infobulle native
		// flottante, cf. ai.ts) : un `title` traduit suffit, le bouton n'a pas
		// de texte visible pour porter un nom accessible implicite.
		const playBtn = head.createEl("button", { cls: "qbd-quiz-card-play" });
		playBtn.type = "button";
		playBtn.title = t("dashboard.detail.play");
		setIcon(playBtn, "play");
		playBtn.addEventListener("click", (e) => {
			// Empêche le clic de remonter à la carte : sinon on lancerait le
			// quiz ET on ouvrirait la fiche (deux actions pour un seul clic).
			e.stopPropagation();
			onPlay(quiz);
		});
	} else {
		const openEl = head.createSpan({ cls: "qbd-quiz-card-open" });
		setIcon(openEl, "chevron-right");
	}

	// Titre
	body.createEl("p", { cls: "qbd-quiz-card-title", text: quiz.title });

	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà.
	// N'affiche que le DOSSIER PARENT (dernier segment), jamais le chemin
	// complet ni l'extension : le nom de fichier est déjà le titre juste
	// au-dessus, et le préfixe de dossiers commun à toutes les cartes
	// n'apprend rien — seul le dernier dossier identifie « d'où ça sort »
	// (défaut relevé par Ahmed à l'écran, 2026-07-17 : 3 lignes de
	// monospace, préfixe répété sur chaque carte). Racine du vault → aucun
	// dossier parent, donc aucune ligne (pas de texte vide, pas de placeholder).
	if (opts?.showPath !== false) {
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		const parentFolder = segs.length > 0 ? segs[segs.length - 1] : null;
		if (parentFolder) {
			const pathEl = body.createEl("p", { cls: "qbd-quiz-card-path" });
			pathEl.createSpan({ text: parentFolder });
		}
	}

	// Barre de progression — seulement quand c'est en cours (sinon bruit)
	if (state === "progress") {
		const progressWrapper = body.createDiv({ cls: "qbd-quiz-card-progress-wrap" });
		const progressBg = progressWrapper.createDiv({ cls: "qbd-quiz-card-progress-bg" });
		const progressFill = progressBg.createDiv({ cls: "qbd-quiz-card-progress-fill" });
		progressFill.style.width = `${pct}%`;
	}

	// Meta : nombre de questions + type + meilleur score (si joué)
	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: quiz.questions })
	});
	const badge = meta.createEl("span", { cls: "qbd-quiz-card-badge" });
	badge.textContent = quizTypeLabel(quiz.quizType);

	if (stats && best > 0) {
		const scoreColor = best >= 80 ? "var(--color-green, #4ade80)"
			: best >= 60 ? "var(--color-yellow, #facc15)"
			: "var(--color-red, #f87171)";
		const scoreSpan = meta.createEl("span", { cls: "qbd-quiz-card-score-value" });
		scoreSpan.style.color = scoreColor;
		scoreSpan.textContent = t("dashboard.card.best", { score: best });
	}

	// Bouton ⋯ en bout de ligne meta (position StudySmarter : coin bas droit).
	// stopPropagation : ouvrir le menu ne doit PAS aussi ouvrir la fiche.
	if (opts?.menu) {
		const menu = opts.menu;
		const moreBtn = meta.createEl("button", { cls: "qbd-card-more" });
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openActionMenu(moreBtn, menu(quiz));
		});
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}
