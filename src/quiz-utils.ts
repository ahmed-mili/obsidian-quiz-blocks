import JSON5 from "json5";
import type { QuizQuestion, ExamOptions } from "./types/quiz";

/** Mode d'un quiz, lu dans l'objet de configuration optionnel en fin de tableau. */
type QuizMode = "learn" | "exam" | "quiz";

/**
 * Objet de configuration optionnel placé en dernier élément du tableau JSON5
 * d'un bloc quiz-blocks (mode examen/learn) — pas une question, distingué par
 * l'absence de `prompt` et la présence d'un des champs mode (extractExamOptions).
 */
interface QuizModeConfig {
	examMode?: boolean;
	learnMode?: boolean;
	mode?: string;
	examDurationMinutes?: number;
	examAutoSubmit?: boolean;
	examShowTimer?: boolean;
}

function parseQuizSource(source?: string | null): QuizQuestion[] {
	const raw = String(source ?? "").trim();

	if (raw.length === 0) return [];

	let parsed: unknown;
	try {
		parsed = JSON5.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Log détaillé pour déboguer
		console.error("[Quiz Blocks] JSON5 parse error:", message);
		if (message && message.includes("position")) {
			const match = message.match(/position (\d+)/);
			if (match) {
				const pos = parseInt(match[1]);
				console.error("[Quiz Blocks] Caractère à la position", pos + ":", raw.charAt(pos));
				console.error("[Quiz Blocks] Contexte:", raw.substring(Math.max(0, pos - 30), pos + 30));
			}
		}
		throw new Error("Le bloc ```quiz-blocks doit contenir un tableau JSON5 valide.");
	}

	if (!Array.isArray(parsed)) {
		throw new Error("Le contenu du bloc quiz-blocks doit être un tableau.");
	}

	return parsed as QuizQuestion[];
}

function extractExamOptions(quizArray: QuizQuestion[]): {
	questions: QuizQuestion[];
	quizMode: QuizMode;
	examOptions: ExamOptions | null;
	learnExamOptions: ExamOptions | null;
} {
	if (!Array.isArray(quizArray) || quizArray.length === 0) return { questions: quizArray, quizMode: "quiz", examOptions: null, learnExamOptions: null };

	const lastItem = quizArray[quizArray.length - 1] as (QuizQuestion & QuizModeConfig) | undefined;
	const isConfigObject = lastItem && typeof lastItem === "object" && !lastItem.prompt && (lastItem.examMode === true || lastItem.learnMode === true || typeof lastItem.mode === "string");

	if (isConfigObject && lastItem) {
		// Déterminer le mode : "learn" | "exam" | "quiz"
		let mode = typeof lastItem.mode === "string" ? lastItem.mode : "";
		if (!mode) {
			if (lastItem.examMode === true) mode = "exam";
			else if (lastItem.learnMode === true) mode = "learn";
			else mode = "quiz";
		}
		const quizMode: QuizMode = (mode === "learn" || mode === "exam" || mode === "quiz") ? mode : "quiz";

		// Construction des options d'examen
		const buildExamOpts = (): ExamOptions => ({
			durationMinutes: Math.max(1, Math.min(180, Number(lastItem.examDurationMinutes) || 10)),
			autoSubmit: lastItem.examAutoSubmit !== false,
			showTimer: lastItem.examShowTimer !== false
		});

		// Options d'examen (mode exam actif)
		let examOptions: ExamOptions | null = null;
		if (quizMode === "exam") {
			examOptions = buildExamOpts();
		}

		// Options d'examen pour le mode learn (utilisé par "Passer l'examen")
		let learnExamOptions: ExamOptions | null = null;
		if (quizMode === "learn" && lastItem.examDurationMinutes != null) {
			learnExamOptions = buildExamOpts();
		}

		return {
			questions: quizArray.slice(0, -1),
			quizMode,
			examOptions,
			learnExamOptions
		};
	}

	return { questions: quizArray, quizMode: "quiz", examOptions: null, learnExamOptions: null };
}

function renderParagraph(container: HTMLElement, text?: string | null): HTMLParagraphElement {
	return container.createEl("p", {
		text: String(text ?? "")
	});
}

export { parseQuizSource, extractExamOptions, renderParagraph };
