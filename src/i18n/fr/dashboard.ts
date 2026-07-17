import type { EN_DASHBOARD } from "../en/dashboard";

/* Domaine « dashboard » — français. */
export const FR_DASHBOARD: Record<keyof typeof EN_DASHBOARD, string> = {
	/* ── Commun ── */
	"dashboard.common.questionsOne": "{count} question",
	"dashboard.common.questionsOther": "{count} questions",
	"dashboard.common.questionsOfOne": "{done}/{total} question",
	"dashboard.common.questionsOfOther": "{done}/{total} questions",

	/* ── Sidebar ── */
	"dashboard.nav.home": "Accueil",
	"dashboard.nav.quizzes": "Mes quiz",
	"dashboard.nav.generate": "Générer",
	"dashboard.nav.settings": "Réglages",

	/* ── Accueil ── */
	"dashboard.home.subtitleResume": "Reprenez un quiz en cours ou générez-en un nouveau.",
	"dashboard.home.subtitleStart": "Choisissez un quiz à réviser ou générez-en un nouveau.",
	"dashboard.home.generate": "Générer un quiz",
	"dashboard.home.statQuizzes": "Quiz créés",
	"dashboard.home.statQuizzesSub": "dans le vault",
	"dashboard.home.statQuestions": "Questions totales",
	"dashboard.home.statQuestionsSub": "toutes notes",
	"dashboard.home.statMastered": "Maîtrisés",
	"dashboard.home.statMasteredSub": "score ≥ 80%",
	"dashboard.home.todo": "À faire",
	"dashboard.home.seeAll": "Voir tout",
	"dashboard.home.completed": "Complétés",
	"dashboard.home.resumeLabel": "Reprendre là où vous en étiez",
	"dashboard.home.resumeProgress": "{questions} · {pct}%",
	"dashboard.home.resumeBtn": "Reprendre",

	/* ── Onboarding ── */
	"dashboard.onboarding.title": "Bienvenue dans Quiz Blocks",
	"dashboard.onboarding.lead": "Transformez vos notes en quiz interactifs — QCM, texte à compléter, association — pour réviser et vous auto-évaluer.",
	"dashboard.onboarding.generate": "Générer mon premier quiz",
	"dashboard.onboarding.or": "ou",
	"dashboard.onboarding.manualTitle": "Créer un quiz à la main",
	"dashboard.onboarding.manualDesc": "Ajoutez un bloc de code quiz-blocks dans n'importe quelle note :",
	"dashboard.onboarding.copy": "Copier le bloc",
	/* ⚠️ Jamais d'apostrophe dans ces 2 valeurs (injectées dans du JSON5 entre
	   apostrophes simples) — cf. le commentaire du dictionnaire anglais. */
	"dashboard.onboarding.sampleTitle": "Ma première question",
	"dashboard.onboarding.samplePrompt": "Quelle est la capitale de la France ?",

	/* ── Mes quiz ── */
	"dashboard.quizzes.title": "Mes quiz",
	"dashboard.quizzes.new": "Nouveau",
	"dashboard.quizzes.search": "Rechercher…",
	"dashboard.quizzes.filterAll": "Tous",
	"dashboard.quizzes.filterProgress": "En cours",
	"dashboard.quizzes.filterMastered": "Maîtrisés",
	"dashboard.quizzes.filterFresh": "Non commencés",
	"dashboard.quizzes.empty": "Aucun quiz trouvé",
	"dashboard.quizzes.noFolder": "Sans dossier",
	"dashboard.quizzes.folderCountOne": "{count} quiz",
	"dashboard.quizzes.folderCountOther": "{count} quiz",
	"dashboard.quizzes.folderMasteredOne": "{count} maîtrisé",
	"dashboard.quizzes.folderMasteredOther": "{count} maîtrisés",

	/* ── Regroupement ── */
	"dashboard.quizzes.groupByModule": "Par module",
	"dashboard.quizzes.groupByUE": "Par UE",
	"dashboard.quizzes.groupByActivity": "Par activité",
	"dashboard.quizzes.groupByType": "Par type",
	"dashboard.quizzes.recentWeek": "7 derniers jours",
	"dashboard.quizzes.recentMonth": "30 derniers jours",
	"dashboard.quizzes.recentOlder": "Plus ancien",

	/* ── Carte de quiz ── */
	"dashboard.card.mastered": "Maîtrisé",
	"dashboard.card.review": "À revoir",
	"dashboard.card.progress": "En cours · {pct}%",
	"dashboard.card.fresh": "À commencer",
	"dashboard.card.best": "Meilleur {score}%",

	/* ── Type de quiz ── */
	"dashboard.quizType.mixed": "Mixte",
	"dashboard.quizType.single": "Choix unique",
	"dashboard.quizType.multiple": "Choix multiple",
	"dashboard.quizType.text": "Texte libre",
	"dashboard.quizType.ordering": "Ordonnancement",
	"dashboard.quizType.matching": "Association",

	/* ── Temps relatif ── */
	"dashboard.time.justNow": "À l'instant",
	"dashboard.time.minutes": "il y a {n} min",
	"dashboard.time.hours": "il y a {n}h",
	"dashboard.time.days": "il y a {n}j",
	"dashboard.time.monthsOne": "il y a {n} mois",
	"dashboard.time.monthsOther": "il y a {n} mois",
	"dashboard.time.overYear": "il y a plus d'un an",

	/* ── Détail ── */
	"dashboard.detail.edit": "Modifier",
	"dashboard.detail.play": "Lancer",
	"dashboard.detail.statBest": "Meilleur score",
	"dashboard.detail.statType": "Type",
	"dashboard.detail.statLast": "Dernière fois",
	"dashboard.detail.statAttempts": "Tentatives",
	"dashboard.detail.questionsTitle": "Aperçu des questions",
	"dashboard.detail.fileNotFound": "Fichier introuvable",
	"dashboard.detail.noBlock": "Aucun bloc quiz-blocks trouvé",
	"dashboard.detail.loadError": "Impossible de charger les questions",
	"dashboard.detail.questionFallback": "Question {n}",
	"dashboard.detail.moreOne": "+{count} question de plus",
	"dashboard.detail.moreOther": "+{count} questions de plus",
	"dashboard.detail.noBlockInNote": "Aucun bloc quiz-blocks trouvé dans cette note",
	"dashboard.detail.opened": "Quiz ouvert : {name}",
	"dashboard.detail.openError": "Erreur lors de l'ouverture",

	/* ── ui-select ── */
	"dashboard.select.placeholder": "Sélectionner…",
	"dashboard.select.findModel": "Rechercher un modèle…",
	"dashboard.select.noModel": "Aucun modèle",
	"dashboard.select.effort": "Effort",
	"dashboard.select.effortFlyoutHelp": "Un effort plus élevé signifie des réponses plus approfondies, mais prend plus de temps et consomme vos limites plus rapidement.",
	"dashboard.select.effortDefault": "Par défaut",
	"dashboard.select.moreModels": "Plus de modèles",
	"dashboard.select.effortHelp": "Un effort plus élevé génère des réponses plus complètes, mais prend plus de temps et utilise vos limites plus rapidement.",
	"dashboard.select.effortFaster": "Plus rapide",
	"dashboard.select.effortSmarter": "Plus intelligent",
	"dashboard.select.fastAria": "Rapide (vitesse 1.5x)",
	"dashboard.select.fastSpeed": "Vitesse 1.5x",
	"dashboard.select.fastUsage": "Consomme plus",
	"dashboard.select.usageWarning": "Consomme vos limites plus rapidement",
	"dashboard.select.optionsQuestions": "Questions",
	"dashboard.select.optionsType": "Type",
	"dashboard.select.optionsCustom": "Personnalisé",
	"dashboard.select.noteSearch": "Rechercher une note…",
	"dashboard.select.noteOpen": "Notes ouvertes",
	"dashboard.select.noteAll": "Toutes les notes",
	"dashboard.select.noteNotFound": "Aucune note trouvée",
	"dashboard.select.noteEmpty": "Aucune note ouverte — tapez pour chercher",
};
