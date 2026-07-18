import { setIcon, TFile } from "obsidian";
import JSON5 from "json5";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizTypeLabel } from "./quiz-card";
import { openQuizForPlay, openQuizInEditor } from "./quiz-open";

/* ══════════════════════════════════════════════════════════
   DETAIL VIEW — Dashboard
   Top bar (retour, titre, Modifier, Lancer) + 2 colonnes (stats + questions)
══════════════════════════════════════════════════════════ */

/** Aperçu minimal d'une question brute lue du JSON5 (loadQuestionPreviews). */
interface RawQuestionPreview {
	examMode?: boolean;
	prompt?: string;
	title?: string;
}

export interface DetailHandlers {
	render(container: HTMLElement, quiz: QuizIndexEntry): void;
}

export function createDetailHandlers(ctx: DashboardCtx): DetailHandlers {

	function render(container: HTMLElement, quiz: QuizIndexEntry): void {
		container.empty();

		const stats = ctx.statsStore ? ctx.statsStore.getRecord(quiz.path) : null;
		const quizStat: QuizStatRecord = stats || { bestScore: 0, questionsDone: 0, totalQuestions: quiz.questions, lastPlayed: 0, attempts: 0 };

		const pct = quizStat.totalQuestions > 0
			? Math.round(quizStat.questionsDone / quizStat.totalQuestions * 100)
			: 0;

		// ── Top bar ──
		const topbar = container.createDiv({ cls: "qbd-detail-topbar" });

		const backBtn = topbar.createEl("button", { cls: "qbd-btn qbd-btn--subtle" });
		const backIcon = backBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(backIcon, "arrow-left");
		backBtn.addEventListener("click", () => ctx.navigate(ctx.view.previousView || "home"));

		const topbarInfo = topbar.createDiv({ cls: "qbd-detail-topbar-info" });
		topbarInfo.createEl("p", { cls: "qbd-detail-title", text: quiz.title });
		const pathEl = topbarInfo.createEl("p", { cls: "qbd-detail-path" });
		pathEl.createSpan({ text: quiz.path });

		const editBtn = topbar.createEl("button", { cls: "qbd-btn qbd-btn--subtle" });
		const editIcon = editBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(editIcon, "edit");
		editBtn.createSpan({ text: t("dashboard.detail.edit") });
		editBtn.addEventListener("click", () => { void openQuizInEditor(ctx.app, quiz); });

		const playBtn = topbar.createEl("button", { cls: "qbd-btn qbd-btn--primary" });
		const playIcon = playBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(playIcon, "play");
		playBtn.createSpan({ text: t("dashboard.detail.play") });
		playBtn.addEventListener("click", () => openQuizForPlay(ctx.app, quiz));

		// ── Body (2 colonnes) ──
		const body = container.createDiv({ cls: "qbd-detail-body" });

		// Colonne stats
		const statsCol = body.createDiv({ cls: "qbd-detail-stats-col" });

		// Ring progress
		const ringCard = statsCol.createDiv({ cls: "qbd-detail-ring-card" });
		const ringSvg = createRingSVG(pct, "var(--interactive-accent, #7c3aed)", 72, 6);
		ringCard.appendChild(ringSvg);
		const ringInfo = ringCard.createDiv({ cls: "qbd-detail-ring-info" });
		ringInfo.createEl("p", { cls: "qbd-detail-ring-pct", text: `${pct}%` });
		// L'accord se joue sur le TOTAL (« 0/1 question », « 3/10 questions »).
		ringInfo.createEl("p", {
			cls: "qbd-detail-ring-label",
			text: t(quizStat.totalQuestions === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther",
				{ done: quizStat.questionsDone, total: quizStat.totalQuestions })
		});

		// Stat items — construits DANS render : libellés traduits à chaque rendu.
		const statItems: Array<{ label: string; value: string; color: string }> = [
			{ label: t("dashboard.detail.statBest"), value: quizStat.bestScore > 0 ? `${quizStat.bestScore}%` : "—", color: quizStat.bestScore >= 80 ? "var(--color-green)" : quizStat.bestScore >= 60 ? "var(--color-yellow)" : "var(--text-muted)" },
			{ label: t("dashboard.detail.statType"), value: quizTypeLabel(quiz.quizType), color: "var(--text-muted)" },
			{ label: t("dashboard.detail.statLast"), value: ctx.statsStore ? ctx.statsStore.formatRelativeTime(quizStat.lastPlayed) : "—", color: "var(--text-muted)" },
			{ label: t("dashboard.detail.statAttempts"), value: String(quizStat.attempts), color: "var(--text-muted)" }
		];

		for (const item of statItems) {
			const card = statsCol.createDiv({ cls: "qbd-detail-stat-card" });
			card.createEl("p", { cls: "qbd-detail-stat-label", text: item.label });
			const value = card.createEl("p", { cls: "qbd-detail-stat-value", text: item.value });
			if (item.color) value.style.color = item.color;
		}

		// Colonne questions (aperçu)
		const questionsCol = body.createDiv({ cls: "qbd-detail-questions-col" });
		questionsCol.createEl("p", { cls: "qbd-detail-section-title", text: t("dashboard.detail.questionsTitle") });

		// Charger les questions depuis le fichier
		loadQuestionPreviews(questionsCol, quiz, quizStat);
	}

	async function loadQuestionPreviews(container: HTMLElement, quiz: QuizIndexEntry, quizStat: QuizStatRecord): Promise<void> {
		const wrapper = container.createDiv({ cls: "qbd-detail-questions-list" });

		try {
			const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
			if (!file || !(file instanceof TFile)) {
				wrapper.createEl("p", { cls: "qbd-empty-hint", text: t("dashboard.detail.fileNotFound") });
				return;
			}

			const content = await ctx.app.vault.read(file);
			const startIdx = content.indexOf("```quiz-blocks");
			if (startIdx === -1) {
				wrapper.createEl("p", { cls: "qbd-empty-hint", text: t("dashboard.detail.noBlock") });
				return;
			}

			const afterStart = content.indexOf('\n', startIdx + "```quiz-blocks".length);
			const closingFence = content.indexOf('\n```', afterStart + 1);
			const source = content.substring(afterStart + 1, closingFence).trim();

			const parsed: unknown = JSON5.parse(source);
			if (!Array.isArray(parsed)) throw new Error("Le contenu du bloc quiz-blocks doit être un tableau.");
			const questions = parsed.filter((q): q is RawQuestionPreview => {
				if (!q || typeof q !== "object") return false;
				return !(q as RawQuestionPreview).examMode;
			});

			const maxPreview = Math.min(questions.length, 5);
			for (let i = 0; i < maxPreview; i++) {
				const q = questions[i];
				const item = wrapper.createDiv({ cls: "qbd-detail-question-item" });
				const num = item.createDiv({ cls: "qbd-detail-question-num" });
				num.textContent = String(i + 1);
				item.createSpan({ cls: "qbd-detail-question-text", text: q.prompt || q.title || t("dashboard.detail.questionFallback", { n: i + 1 }) });

				if (quizStat.questionsDone > i) {
					const check = item.createSpan({ cls: "qbd-detail-question-check" });
					setIcon(check, "check");
				}
			}

			if (questions.length > 5) {
				const extra = questions.length - 5;
				const more = wrapper.createEl("button", {
					cls: "qbd-detail-more-btn",
					text: t(extra === 1 ? "dashboard.detail.moreOne" : "dashboard.detail.moreOther", { count: extra })
				});
				more.addEventListener("click", () => { void openQuizInEditor(ctx.app, quiz); });
			}
		} catch {
			wrapper.createEl("p", { cls: "qbd-empty-hint", text: t("dashboard.detail.loadError") });
		}
	}

	function createRingSVG(pct: number, color: string, size: number, sw: number): SVGSVGElement {
		const r = (size - sw * 2) / 2;
		const circ = 2 * Math.PI * r;

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.style.transform = "rotate(-90deg)";
		svg.style.flexShrink = "0";

		const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		bgCircle.setAttribute("cx", String(size / 2));
		bgCircle.setAttribute("cy", String(size / 2));
		bgCircle.setAttribute("r", String(r));
		bgCircle.setAttribute("fill", "none");
		bgCircle.setAttribute("stroke", "var(--background-modifier-border, #2a2a3e)");
		bgCircle.setAttribute("stroke-width", String(sw));
		svg.appendChild(bgCircle);

		const fgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		fgCircle.setAttribute("cx", String(size / 2));
		fgCircle.setAttribute("cy", String(size / 2));
		fgCircle.setAttribute("r", String(r));
		fgCircle.setAttribute("fill", "none");
		fgCircle.setAttribute("stroke", color);
		fgCircle.setAttribute("stroke-width", String(sw));
		fgCircle.setAttribute("stroke-dasharray", String(circ));
		fgCircle.setAttribute("stroke-dashoffset", String(circ * (1 - pct / 100)));
		fgCircle.setAttribute("stroke-linecap", "round");
		svg.appendChild(fgCircle);

		return svg;
	}

	return { render };
}
