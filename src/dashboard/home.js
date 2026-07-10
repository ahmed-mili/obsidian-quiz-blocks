'use strict';

/* ══════════════════════════════════════════════════════════
   HOME VIEW — Dashboard
   Header + stats grid + sections "À reprendre" / "Complétés"
══════════════════════════════════════════════════════════ */

function createHomeHandlers(ctx) {

	function render(container) {
		container.empty();

		const quizzes = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── Premier usage : aucun quiz → onboarding guidé ──
		if (quizzes.length === 0) {
			renderOnboarding(container);
			return;
		}

		// ── Classement des quiz par état (utilisé par le hero + les sections) ──
		const inProgress = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone > 0 && s.questionsDone < q.questions;
		});
		const notStarted = quizzes.filter(q => {
			const s = stats[q.path];
			return !s || s.questionsDone === 0;
		});
		const completed = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone >= q.questions;
		});

		// ── Header ──
		const header = container.createDiv({ cls: "qbd-home-header" });
		const headerLeft = header.createDiv({ cls: "qbd-home-header-left" });
		headerLeft.createEl("h2", { cls: "qbd-home-title", text: "Quiz Blocks" });

		// Sous-titre orientant : annonce les deux actions principales. (La note
		// active reste dans le footer de la sidebar, et la vue Générer la relit.)
		const subtitle = inProgress.length > 0
			? "Reprenez un quiz en cours ou générez-en un nouveau."
			: "Choisissez un quiz à réviser ou générez-en un nouveau.";
		headerLeft.createEl("p", { cls: "qbd-home-subtitle", text: subtitle });

		const genBtn = header.createEl("button", { cls: "qbd-btn qbd-btn--primary" });
		const genIcon = genBtn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(genIcon, "sparkles");
		genBtn.createSpan({ text: "Générer un quiz" });
		genBtn.addEventListener("click", () => ctx.navigate("ai"));

		// ── Reprendre : dernier quiz en cours (action primaire du returning user) ──
		const resumeQuiz = inProgress
			.slice()
			.sort((a, b) => {
				const la = (stats[a.path] && stats[a.path].lastPlayed) || 0;
				const lb = (stats[b.path] && stats[b.path].lastPlayed) || 0;
				return lb - la;
			})[0];
		if (resumeQuiz) {
			renderResumeHero(container, resumeQuiz, stats[resumeQuiz.path]);
		}

		// ── Stats grid ──
		const statsGrid = container.createDiv({ cls: "qbd-home-stats" });

		const totalQuestions = ctx.scanner ? ctx.scanner.getTotalQuestions() : 0;
		const mastered = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.bestScore >= 80;
		}).length;

		const statCards = [
			{ label: "Quiz créés", value: String(quizzes.length), sub: "dans le vault", icon: "layers" },
			{ label: "Questions totales", value: String(totalQuestions), sub: "toutes notes", icon: "list" },
			{
				label: "Maîtrisés", value: `${mastered}/${quizzes.length}`, sub: "score ≥ 80%",
				icon: "award", highlight: true,
				meter: quizzes.length > 0 ? mastered / quizzes.length : 0
			}
		];

		for (const card of statCards) {
			const el = statsGrid.createDiv({ cls: `qbd-stat-card${card.highlight ? " qbd-stat-card--highlight" : ""}` });
			const head = el.createDiv({ cls: "qbd-stat-head" });
			const icon = head.createSpan({ cls: "qbd-stat-icon" });
			obsidian.setIcon(icon, card.icon);
			head.createEl("p", { cls: "qbd-stat-label", text: card.label });
			el.createEl("p", { cls: "qbd-stat-value", text: card.value });
			if (typeof card.meter === "number") {
				const meter = el.createDiv({ cls: "qbd-stat-meter" });
				const fill = meter.createDiv({ cls: "qbd-stat-meter-fill" });
				fill.style.width = `${Math.round(card.meter * 100)}%`;
			}
			el.createEl("p", { cls: "qbd-stat-sub", text: card.sub });
		}

		// ── Sections de quiz ──
		// À faire (en cours + à commencer)
		if (inProgress.length > 0 || notStarted.length > 0) {
			const section = container.createDiv({ cls: "qbd-home-section" });
			const sectionHeader = section.createDiv({ cls: "qbd-home-section-header" });
			const todoTitle = sectionHeader.createEl("p", { cls: "qbd-home-section-title" });
			const todoIcon = todoTitle.createSpan({ cls: "qbd-home-section-title-icon" });
			obsidian.setIcon(todoIcon, "list-todo");
			todoTitle.createSpan({ text: "À faire" });

			const seeAll = sectionHeader.createEl("button", { cls: "qbd-btn qbd-btn--subtle" });
			seeAll.createSpan({ text: "Voir tout" });
			const chevron = seeAll.createSpan({ cls: "qbd-btn-icon qbd-btn-icon--sm" });
			obsidian.setIcon(chevron, "chevron-right");
			seeAll.addEventListener("click", () => ctx.navigate("quizzes"));

			const grid = section.createDiv({ cls: "qbd-home-grid" });
			for (const quiz of [...inProgress, ...notStarted]) {
				renderQuizCard(grid, quiz, stats[quiz.path]);
			}
		}

		// Complétés
		if (completed.length > 0) {
			const section = container.createDiv({ cls: "qbd-home-section" });
			const doneTitle = section.createEl("p", { cls: "qbd-home-section-title" });
			const doneIcon = doneTitle.createSpan({ cls: "qbd-home-section-title-icon" });
			obsidian.setIcon(doneIcon, "circle-check");
			doneTitle.createSpan({ text: "Complétés" });

			const grid = section.createDiv({ cls: "qbd-home-grid" });
			for (const quiz of completed) {
				renderQuizCard(grid, quiz, stats[quiz.path]);
			}
		}

	}

	function renderResumeHero(container, quiz, stats) {
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;
		const pct = total > 0 ? Math.round(done / total * 100) : 0;

		const hero = container.createDiv({ cls: "qbd-resume-hero" });
		const open = () => ctx.navigate("detail", { quiz });
		hero.addEventListener("click", open);

		const info = hero.createDiv({ cls: "qbd-resume-info" });

		const label = info.createDiv({ cls: "qbd-resume-label" });
		const labelIcon = label.createSpan({ cls: "qbd-resume-label-icon" });
		obsidian.setIcon(labelIcon, "history");
		label.createSpan({ text: "Reprendre là où vous en étiez" });

		info.createEl("p", { cls: "qbd-resume-title", text: quiz.title });

		const progress = info.createDiv({ cls: "qbd-resume-progress" });
		const bar = progress.createDiv({ cls: "qbd-resume-bar" });
		const fill = bar.createDiv({ cls: "qbd-resume-bar-fill" });
		fill.style.width = `${pct}%`;
		progress.createEl("span", { cls: "qbd-resume-progress-text", text: `${done}/${total} questions · ${pct}%` });

		const btn = hero.createEl("button", { cls: "qbd-btn qbd-btn--primary qbd-resume-btn" });
		const btnIcon = btn.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(btnIcon, "play");
		btn.createSpan({ text: "Reprendre" });
		btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
	}

	function renderOnboarding(container) {
		const wrap = container.createDiv({ cls: "qbd-onboarding" });

		const icon = wrap.createDiv({ cls: "qbd-onboarding-icon" });
		obsidian.setIcon(icon, "graduation-cap");

		wrap.createEl("h2", { cls: "qbd-onboarding-title", text: "Bienvenue dans Quiz Blocks" });
		wrap.createEl("p", {
			cls: "qbd-onboarding-lead",
			text: "Transformez vos notes en quiz interactifs — QCM, texte à compléter, association — pour réviser et vous auto-évaluer."
		});

		// Action primaire évidente
		const primary = wrap.createEl("button", { cls: "qbd-btn qbd-btn--primary qbd-btn--lg" });
		const pIcon = primary.createSpan({ cls: "qbd-btn-icon" });
		obsidian.setIcon(pIcon, "sparkles");
		primary.createSpan({ text: "Générer mon premier quiz" });
		primary.addEventListener("click", () => ctx.navigate("ai"));

		// Séparateur
		const divider = wrap.createDiv({ cls: "qbd-onboarding-divider" });
		divider.createSpan({ text: "ou" });

		// Méthode manuelle (divulgation progressive)
		const manual = wrap.createDiv({ cls: "qbd-onboarding-manual" });
		const manualHead = manual.createDiv({ cls: "qbd-onboarding-manual-head" });
		const mIcon = manualHead.createSpan({ cls: "qbd-onboarding-manual-icon" });
		obsidian.setIcon(mIcon, "code");
		manualHead.createSpan({ text: "Créer un quiz à la main" });

		manual.createEl("p", {
			cls: "qbd-onboarding-manual-desc",
			text: "Ajoutez un bloc de code quiz-blocks dans n'importe quelle note :"
		});

		const CODE_SAMPLE = [
			"```quiz-blocks",
			"[",
			"  {",
			"    title: 'Ma première question',",
			"    prompt: 'Quelle est la capitale de la France ?',",
			"    options: ['Lyon', 'Paris', 'Marseille'],",
			"    correctIndex: 1,",
			"  }",
			"]",
			"```"
		].join("\n");

		const codeWrap = manual.createDiv({ cls: "qbd-onboarding-code-wrap" });
		const pre = codeWrap.createEl("pre", { cls: "qbd-onboarding-code" });
		pre.createEl("code", { text: CODE_SAMPLE });

		const copyBtn = codeWrap.createEl("button", { cls: "qbd-onboarding-copy", attr: { "aria-label": "Copier le bloc" } });
		const copyIcon = copyBtn.createSpan({ cls: "qbd-btn-icon qbd-btn-icon--sm" });
		obsidian.setIcon(copyIcon, "copy");
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(CODE_SAMPLE);
				copyIcon.empty();
				obsidian.setIcon(copyIcon, "check");
				window.setTimeout(() => { copyIcon.empty(); obsidian.setIcon(copyIcon, "copy"); }, 1500);
			} catch (e) { /* clipboard indisponible : sans effet */ }
		});
	}

	function renderQuizCard(container, quiz, stats) {
		return renderSharedQuizCard(container, quiz, stats, (q) => ctx.navigate("detail", { quiz: q }));
	}

	return { render };
}

const obsidian = require("obsidian");
const renderSharedQuizCard = require("./quiz-card");
module.exports = createHomeHandlers;