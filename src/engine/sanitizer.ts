import type { TAbstractFile, TFile } from "obsidian";
import type { EngineCtx } from "../types/engine-ctx";
import type { QuestionBase } from "../types/quiz";

/** Spec `![[lien|100x50|alt]]` décomposée (buildEmbedImgHtml, resolveObsidianEmbedFile). */
interface ParsedEmbedSpec {
	linkPath: string;
	width: number | null;
	height: number | null;
	alt: string;
}

interface EmbedClassOptions {
	wrapClass?: string;
	imgClass?: string;
}

export interface SanitizerHandlers {
	escapeHtmlAttr(value: unknown): string;
	escapeHtmlText(value: unknown): string;
	unescapeHtmlText(value: unknown): string;
	isSafeQuizUrl(value: unknown, opts?: { image?: boolean }): boolean;
	unwrapQuizHtmlElement(node: ChildNode | null | undefined): void;
	sanitizeQuizHtml(html: unknown): string;
	renderInlineQuizHtml(raw: unknown): string;
	resourceButtonHtml(q: QuestionBase | null | undefined): string;
	resolveObsidianEmbedFile(linkPath: unknown): TAbstractFile | null;
	parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec;
	buildEmbedImgHtml(embedSpec: unknown, opts?: EmbedClassOptions): string;
	restoreAllowedInlineTags(html: unknown): string;
	renderTextWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	renderHintWithCodeAndEmbeds(raw: unknown): string;
	renderRawHtmlWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	replaceObsidianEmbedsInHtml(html: unknown, opts?: EmbedClassOptions): string;
}

export function createSanitizer(ctx: EngineCtx): SanitizerHandlers {
	const QUIZ_HTML_ALLOWED_TAGS = new Set([
		"a", "b", "blockquote", "br", "center", "code", "details", "div", "em", "font",
		"h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark",
		"ol", "p", "pre", "samp", "small", "span", "strong", "sub", "summary", "sup",
		"table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
	]);

	const QUIZ_HTML_DROP_TAGS = new Set([
		"script", "style", "iframe", "object", "embed", "link", "meta"
	]);

	const QUIZ_HTML_GLOBAL_ATTRS = new Set([
		"class", "title", "role", "aria-label", "aria-hidden", "tabindex"
	]);

	const QUIZ_HTML_TAG_ATTRS: Record<string, Set<string>> = {
		a: new Set(["href", "target", "rel"]),
		img: new Set(["src", "alt", "width", "height"]),
		td: new Set(["colspan", "rowspan"]),
		th: new Set(["colspan", "rowspan"]),
		font: new Set(["color"])
	};

	function escapeHtmlAttr(value: unknown): string {
		return String(value ?? "")
			.replace(/\&/g, "\&amp;")
			.replace(/"/g, "\&quot;")
			.replace(/'/g, "\&#39;")
			.replace(/\</g, "\&lt;")
			.replace(/\>/g, "\&gt;");
	}

	function escapeHtmlText(value: unknown): string {
		return String(value ?? "")
			.replace(/\&/g, "\&amp;")
			.replace(/\</g, "\&lt;")
			.replace(/\>/g, "\&gt;")
			.replace(/"/g, "\&quot;")
			.replace(/'/g, "\&#39;");
	}

	function unescapeHtmlText(value: unknown): string {
		return String(value ?? "")
			.replace(/\&lt;/g, "<")
			.replace(/\&gt;/g, ">")
			.replace(/\&quot;/g, '"')
			.replace(/\&#39;/g, "'")
			.replace(/\&amp;/g, "&");
	}

	function isSafeQuizUrl(value: unknown, { image = false }: { image?: boolean } = {}): boolean {
		const raw = String(value ?? "").trim();
		if (!raw) return false;

		if (
			raw.startsWith("#") ||
			raw.startsWith("/") ||
			raw.startsWith("./") ||
			raw.startsWith("../")
		) {
			return true;
		}

		if (/^(https?:|mailto:|tel:|obsidian:|app:|file:|blob:)/i.test(raw)) {
			return true;
		}

		if (image && /^data:image\//i.test(raw)) {
			return true;
		}

		return false;
	}

	function unwrapQuizHtmlElement(node: ChildNode | null | undefined): void {
		const parent = node?.parentNode ?? null;
		if (!parent || !node) return;

		let first: ChildNode | null;
		while ((first = node.firstChild)) {
			parent.insertBefore(first, node);
		}
		parent.removeChild(node);
	}

	function sanitizeQuizHtml(html: unknown): string {
		const tpl = document.createElement("template");
		tpl.innerHTML = String(html ?? "");

		const walk = (node: ChildNode | null | undefined): void => {
			if (!node) return;

			if (node.nodeType === Node.COMMENT_NODE) {
				node.remove();
				return;
			}

			if (node.nodeType !== Node.ELEMENT_NODE) return;

			// Narrowing sûr : nodeType === ELEMENT_NODE garantit un Element (TS ne
			// corrèle pas nodeType et le type ChildNode automatiquement).
			const el = node as Element;

			const tag = el.tagName.toLowerCase();

			if (QUIZ_HTML_DROP_TAGS.has(tag)) {
				el.remove();
				return;
			}

			if (!QUIZ_HTML_ALLOWED_TAGS.has(tag)) {
				unwrapQuizHtmlElement(el);
				return;
			}

			const allowedAttrs = QUIZ_HTML_TAG_ATTRS[tag] || new Set<string>();

			Array.from(el.attributes).forEach(attr => {
				const name = attr.name.toLowerCase();
				const value = attr.value;

				if (name.startsWith("on") || name === "style") {
					el.removeAttribute(attr.name);
					return;
				}

				if (!QUIZ_HTML_GLOBAL_ATTRS.has(name) && !allowedAttrs.has(name)) {
					el.removeAttribute(attr.name);
					return;
				}

				if (
					(name === "href" || name === "src") &&
					!isSafeQuizUrl(value, { image: name === "src" && tag === "img" })
				) {
					el.removeAttribute(attr.name);
					return;
				}

				if (
					(name === "width" || name === "height" || name === "colspan" || name === "rowspan") &&
					!/^\d{1,4}$/.test(String(value).trim())
				) {
					el.removeAttribute(attr.name);
					return;
				}

				if (name === "target" && !/^_(self|blank)$/.test(String(value).trim())) {
					el.removeAttribute(attr.name);
					return;
				}
			});

			if (tag === "a" && el.getAttribute("target") === "_blank") {
				el.setAttribute("rel", "noopener noreferrer");
			}

			Array.from(el.childNodes).forEach(walk);
		};

		Array.from(tpl.content.childNodes).forEach(walk);
		return tpl.innerHTML;
	}

	function renderInlineQuizHtml(raw: unknown): string {
		return restoreAllowedInlineTags(
			escapeHtmlText(String(raw ?? "")).replace(/\n/g, "<br>")
		);
	}

	function resourceButtonHtml(q: QuestionBase | null | undefined): string {
		const rb = q?.resourceButton;
		if (!rb || !rb.label || !rb.fileName) return "";
		return `<button class="quiz-resource-btn" type="button" data-resource-file="${escapeHtmlAttr(rb.fileName)}"><span class="quiz-resource-btn-icon" aria-hidden="true">${ctx.lucideIcons?.paperclip || "⬇" }</span><span class="quiz-resource-btn-label">${escapeHtmlText(rb.label)}</span></button>`;
	}

	function resolveObsidianEmbedFile(linkPath: unknown): TAbstractFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;

		const currentFilePath = ctx.sourcePath || "";

		try {
			if (ctx.app?.metadataCache?.getFirstLinkpathDest) {
				const f = ctx.app.metadataCache.getFirstLinkpathDest(raw, currentFilePath);
				if (f) return f;
			}
		} catch (e) {
			console.warn("[Quiz] resolveObsidianEmbedFile erreur:", e);
		}

		try {
			const f2 = ctx.app?.vault?.getAbstractFileByPath?.(raw);
			if (f2) return f2;
		} catch (e) {
			console.warn("[Quiz] getAbstractFileByPath erreur:", e);
		}

		return null;
	}

	function parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec {
		const s = String(spec ?? "").trim();
		const parts = s.split("|");
		const linkPath = (parts[0] || "").trim();
		let width: number | null = null, height: number | null = null, alt = "";
		if (parts.length >= 2) {
			const p = (parts[1] || "").trim();
			if (/^\d+$/.test(p)) width = Number(p);
			else if (/^\d+x\d+$/i.test(p)) {
				const [w, h] = p.toLowerCase().split("x").map(n => Number(n));
				if (Number.isFinite(w)) width = w;
				if (Number.isFinite(h)) height = h;
			} else alt = p;
		}
		return { linkPath, width, height, alt };
	}

	function buildEmbedImgHtml(embedSpec: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		const parsed = parseObsidianEmbedSpec(embedSpec);
		const file = resolveObsidianEmbedFile(parsed.linkPath);
		if (file && typeof ctx.app?.vault?.getResourcePath === "function") {
			// file est un TAbstractFile (peut être un TFolder si getAbstractFileByPath
			// a résolu un dossier) : le JS original ne vérifiait jamais instanceof TFile
			// avant d'appeler getResourcePath — comportement runtime préservé tel quel.
			const src = ctx.app.vault.getResourcePath(file as TFile);
			const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
			const heightAttr = parsed.height ? ` height="${parsed.height}"` : "";
			const altAttr = escapeHtmlAttr(parsed.alt || file.name || "Image");
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${src}" alt="${altAttr}" loading="eager"${widthAttr}${heightAttr}></div>`;
		}
		return `<code>${escapeHtmlText(`![[${embedSpec}]]`)}</code>`;
	}

	function restoreAllowedInlineTags(html: unknown): string {
		return String(html ?? "")
			.replace(/\&lt;br\s*\/?\&gt;/gi, "<br>")
			.replace(/\&lt;(\/?)code\&gt;/gi, "<$1code>")
			.replace(/\&lt;(\/?)(strong|b|em|i|u|mark|kbd|samp|small|sub|sup)\&gt;/gi, "<$1$2>");
	}

	function renderTextWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		const text = String(raw ?? "");
		const embedRe = /!\[\[([^\]]+)\]\]/g;

		let html = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = embedRe.exec(text)) !== null) {
			const before = text.slice(lastIndex, match.index);

			if (before) {
				html += restoreAllowedInlineTags(
					escapeHtmlText(before).replace(/\n/g, "<br>")
				);
			}

			html += buildEmbedImgHtml(match[1], { wrapClass, imgClass });
			lastIndex = match.index + match[0].length;
		}

		const tail = text.slice(lastIndex);

		if (tail) {
			html += restoreAllowedInlineTags(
				escapeHtmlText(tail).replace(/\n/g, "<br>")
			);
		}

		return html;
	}

	function renderHintWithCodeAndEmbeds(raw: unknown): string {
		return renderTextWithEmbeds(raw, {
			wrapClass: "quiz-hint-embed-wrap",
			imgClass: "quiz-hint-embed"
		});
	}

	function renderRawHtmlWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		return renderTextWithEmbeds(raw, { wrapClass, imgClass });
	}

	function replaceObsidianEmbedsInHtml(html: unknown, { wrapClass = "quiz-explain-embed-wrap", imgClass = "quiz-explain-embed" }: EmbedClassOptions = {}): string {
		// NE PAS faire unescapeHtmlText ici car cela casserait l'affichage
		// des entités HTML comme &gt; qui doivent rester comme &gt; pour être
		// affichées comme > par le navigateur, pas interprétées comme des balises
		const content = String(html ?? "");
		return content.replace(/!\[\[([^\]]+)\]\]/g, (_: string, spec: string) => buildEmbedImgHtml(spec, { wrapClass, imgClass }));
	}

	return {
		escapeHtmlAttr,
		escapeHtmlText,
		unescapeHtmlText,
		isSafeQuizUrl,
		unwrapQuizHtmlElement,
		sanitizeQuizHtml,
		renderInlineQuizHtml,
		resourceButtonHtml,
		resolveObsidianEmbedFile,
		parseObsidianEmbedSpec,
		buildEmbedImgHtml,
		restoreAllowedInlineTags,
		renderTextWithEmbeds,
		renderHintWithCodeAndEmbeds,
		renderRawHtmlWithEmbeds,
		replaceObsidianEmbedsInHtml
	};
}
