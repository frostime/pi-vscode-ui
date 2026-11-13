// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Load the upstream rule declaration for every UI consumer.
/// <reference path="../../../types/markdown-it-image.d.ts" />
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import imageRule from "markdown-it/lib/rules_inline/image.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

import { parseFileHref, parseFileReference, type FileReference } from "../../../../shared/files/fileReferences.js";
import { renderDiffHtml } from "../diffPresentation.js";

const katexCache = new Map<string, string>();
const KATEX_CACHE_LIMIT = 256;

type KatexRender = (source: string, options: {
  displayMode: boolean;
  throwOnError: boolean;
  output: "html";
  strict: "ignore";
}) => string;

let katexRender: KatexRender | null = null;
let katexLoad: Promise<void> | null = null;

/** Lazy-load KaTeX so it stays out of the webview entry chunk. */
export function ensureKatex(): Promise<void> {
  if (katexRender) return Promise.resolve();
  katexLoad ??= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([mod]) => {
    katexRender = mod.default.renderToString.bind(mod.default);
  });
  return katexLoad;
}

export function isKatexReady(): boolean {
  return katexRender !== null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderKatex(source: string, displayMode: boolean): string {
  const key = `${displayMode ? "d" : "i"}\0${source}`;
  const cached = katexCache.get(key);
  if (cached !== undefined) return cached;

  let html: string;
  if (!katexRender) {
    // Placeholder until ensureKatex() finishes; MarkdownHtml re-renders after load.
    html = `<code class="math-fallback">${escapeHtml(source)}</code>`;
  } else {
    try {
      html = katexRender(source, {
        displayMode,
        throwOnError: false,
        output: "html",
        strict: "ignore",
      });
    } catch {
      html = `<code class="math-fallback">${escapeHtml(source)}</code>`;
    }
  }

  // Only cache successful KaTeX output; placeholders must refresh after load.
  if (katexRender) {
    if (katexCache.size >= KATEX_CACHE_LIMIT) {
      const first = katexCache.keys().next().value;
      if (first !== undefined) katexCache.delete(first);
    }
    katexCache.set(key, html);
  }
  return html;
}

function isEscaped(src: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && src[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function findClosing(
  src: string,
  start: number,
  delimiter: string,
  allowNewline: boolean,
): number {
  for (let i = start; i < src.length; i += 1) {
    if (!allowNewline && src[i] === "\n") return -1;
    if (src.startsWith(delimiter, i) && !isEscaped(src, i)) return i;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== "$" && src[start] !== "\\") return false;

  let open = "";
  let close = "";

  if (src.startsWith("$$", start) && !isEscaped(src, start)) {
    // Display math is handled by the block rule.
    return false;
  }
  if (src.startsWith("\\(", start) && !isEscaped(src, start)) {
    open = "\\(";
    close = "\\)";
  } else if (src[start] === "$" && !isEscaped(src, start) && src[start + 1] !== "$") {
    // Reject `$ 4` and currency-like opens; require non-space after `$`.
    if (src[start + 1] === undefined || /\s/.test(src[start + 1]!)) return false;
    open = "$";
    close = "$";
  } else {
    return false;
  }

  const contentStart = start + open.length;
  const contentEnd = findClosing(src, contentStart, close, open !== "$");
  if (contentEnd < 0) return false;

  const content = src.slice(contentStart, contentEnd);
  if (!content || (open === "$" && (content.startsWith(" ") || content.endsWith(" ")))) return false;
  // `$20.00` style: digit immediately after closing `$`.
  if (open === "$" && src[contentEnd + 1] !== undefined && /\d/.test(src[contentEnd + 1]!)) return false;

  if (!silent) {
    const token = state.push("math_inline", "span", 0);
    token.markup = open;
    token.content = content;
  }

  state.pos = contentEnd + close.length;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  const line = state.src.slice(startPos, max);

  let open = "";
  let close = "";
  let inlineRest = "";

  if (line.startsWith("$$")) {
    open = "$$";
    close = "$$";
    inlineRest = line.slice(2);
  } else if (line.startsWith("\\[")) {
    open = "\\[";
    close = "\\]";
    inlineRest = line.slice(2);
  } else {
    return false;
  }

  if (silent) return true;

  // Single-line display math: $$...$$ or \[...\]
  if (inlineRest.includes(close)) {
    const end = inlineRest.indexOf(close);
    const content = inlineRest.slice(0, end).trim();
    const after = inlineRest.slice(end + close.length).trim();
    if (after) return false;
    const token = state.push("math_block", "div", 0);
    token.block = true;
    token.markup = open;
    token.content = content;
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  let nextLine = startLine + 1;
  const body: string[] = inlineRest ? [inlineRest] : [];
  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!;
    const lineEnd = state.eMarks[nextLine]!;
    const current = state.src.slice(lineStart, lineEnd);
    const closeAt = current.indexOf(close);
    if (closeAt >= 0) {
      const before = current.slice(0, closeAt);
      if (before.trim()) body.push(before);
      const after = current.slice(closeAt + close.length).trim();
      if (after) return false;
      const token = state.push("math_block", "div", 0);
      token.block = true;
      token.markup = open;
      token.content = body.join("\n").trim();
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    }
    body.push(current);
    nextLine += 1;
  }

  return false;
}

function applyMathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) => renderKatex(tokens[idx]!.content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderKatex(tokens[idx]!.content, true)}</div>\n`;
}

function fileReferenceAttributes(reference: FileReference): string {
  return [
    `href="#"`,
    `class="file-link"`,
    `data-file-path="${escapeHtml(reference.path)}"`,
    ...(reference.line === undefined ? [] : [`data-file-line="${reference.line}"`]),
    ...(reference.column === undefined ? [] : [`data-file-column="${reference.column}"`]),
    ...(reference.endLine === undefined ? [] : [`data-file-end-line="${reference.endLine}"`]),
  ].join(" ");
}

function applyImagePlugin(md: MarkdownIt): void {
  const validateLink = md.validateLink.bind(md);
  // markdown-it rejects file: destinations before rendering. Relax that check
  // only while parsing image syntax; ordinary links retain the existing policy.
  md.inline.ruler.at("image", (state, silent) => {
    state.md.validateLink = (url) => /^file:/i.test(url) || validateLink(url);
    try {
      return imageRule(state, silent);
    } finally {
      state.md.validateLink = validateLink;
    }
  });

  md.renderer.rules.image = (tokens, idx, options, env) => {
    const token = tokens[idx]!;
    const source = token.attrGet("src") ?? "";
    const title = token.attrGet("title");
    const alt = md.renderer.renderInlineAsText(token.children ?? [], options, env);
    return [
      `<span data-markdown-image="true"`,
      ` data-image-source="${escapeHtml(source)}"`,
      ` data-image-alt="${escapeHtml(alt)}"`,
      ...(title ? [` data-image-title="${escapeHtml(title)}"`] : []),
      `></span>`,
    ].join("");
  };
}

function applyFileLinkPlugin(md: MarkdownIt): void {
  md.renderer.rules.code_inline = (tokens, idx) => {
    const content = tokens[idx]!.content;
    const reference = parseFileReference(content);
    const code = `<code>${escapeHtml(content)}</code>`;
    return reference ? `<a ${fileReferenceAttributes(reference)}>${code}</a>` : code;
  };

  md.renderer.rules.link_open = (tokens, idx, options, _env, renderer) => {
    const token = tokens[idx]!;
    const href = token.attrGet("href");
    const reference = href ? parseFileHref(href) : null;
    if (reference) {
      token.attrSet("href", "#");
      token.attrJoin("class", "file-link");
      token.attrSet("data-file-path", reference.path);
      if (reference.line !== undefined) token.attrSet("data-file-line", String(reference.line));
      if (reference.column !== undefined) token.attrSet("data-file-column", String(reference.column));
      if (reference.endLine !== undefined) token.attrSet("data-file-end-line", String(reference.endLine));
    }
    return renderer.renderToken(tokens, idx, options);
  };
}

// Prose-like fenced blocks read better wrapped; everything else scrolls horizontally.
const WRAP_LANGUAGES = new Set(["txt", "text", "plaintext", "md", "markdown", "tex", "latex"]);

/**
 * Fence chrome: the outer `pre` clips and hosts hover chrome; the inner
 * `.code-scroll` scrolls so the copy button stays fixed while code moves.
 */
function renderFenceHtml(code: string, language: string): string {
  const normalizedLanguage = language.toLowerCase();
  const isDiff = normalizedLanguage === "diff" || normalizedLanguage === "patch";
  const highlighted = isDiff
    ? renderDiffHtml(code)
    : language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : escapeHtml(code);
  const wrapClass = WRAP_LANGUAGES.has(normalizedLanguage) ? " wrap" : "";
  const languageClass = isDiff ? " language-diff" : "";
  return `<pre class="hljs${wrapClass}${languageClass}"><span class="code-scroll"><code>${highlighted}</code></span></pre>`;
}

const markdown: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: renderFenceHtml,
});

// Indented code blocks bypass `highlight`; share the fence chrome so scrolling and
// the copy button behave the same.
markdown.renderer.rules.code_block = (tokens, idx) => renderFenceHtml(tokens[idx]!.content, "");

markdown.linkify.set({ fuzzyLink: false });
applyMathPlugin(markdown);
applyImagePlugin(markdown);
applyFileLinkPlugin(markdown);

export function renderMarkdownHtml(content: string): string {
  return DOMPurify.sanitize(markdown.render(content), {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      "target",
      "rel",
      "class",
      "style",
      "aria-hidden",
      "data-file-path",
      "data-file-line",
      "data-file-column",
      "data-file-end-line",
      "data-markdown-image",
      "data-image-source",
      "data-image-alt",
      "data-image-title",
    ],
    ADD_TAGS: ["annotation", "semantics"],
  });
}

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignobject"],
    ADD_ATTR: [
      "class",
      "style",
      "viewBox",
      "xmlns",
      "xmlns:xlink",
      "xlink:href",
      "marker-end",
      "marker-start",
      "marker-mid",
      "aria-roledescription",
      "aria-labelledby",
      "aria-describedby",
      "role",
      "focusable",
      "dominant-baseline",
      "transform",
      "d",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "text-anchor",
      "font-size",
      "font-family",
      "width",
      "height",
      "x",
      "y",
      "dx",
      "dy",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "x1",
      "x2",
      "y1",
      "y2",
      "points",
      "id",
      "clip-path",
      "mask",
      "opacity",
    ],
  });
}

/**
 * DOMPurify strips HTML-namespace children inside SVG-namespace parents
 * (Mermaid puts every node/edge label in `foreignObject > div > span`), so the
 * label subtree is sanitized separately in HTML mode and spliced back in.
 */
function restoreForeignObjectLabels(cleaned: string, original: string): string {
  const cleanedDoc = new DOMParser().parseFromString(cleaned, "text/html");
  const originalDoc = new DOMParser().parseFromString(original, "text/html");
  const cleanedHosts = [...cleanedDoc.querySelectorAll("foreignObject")];
  const originalHosts = [...originalDoc.querySelectorAll("foreignObject")];
  if (cleanedHosts.length !== originalHosts.length) return cleaned; // fail closed, labels stay empty
  for (let i = 0; i < cleanedHosts.length; i += 1) {
    // A style sheet inside a label would apply to the whole document.
    const labelHtml = DOMPurify.sanitize(originalHosts[i]!.innerHTML, { FORBID_TAGS: ["style"] });
    cleanedHosts[i]!.innerHTML = labelHtml;
  }
  return cleanedDoc.body.innerHTML;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const RESOURCE_ATTRIBUTES = ["src", "href", "xlink:href", "poster", "background"];
// URL lists and beacon targets have no use in a diagram; they go whatever they contain.
const REMOVED_ATTRIBUTES = ["srcset", "ping"];
// Each pattern below is linear in its input: Mermaid passes label styles through
// unchanged, so an attacker chooses up to its 50 000 character limit of this text.
const CSS_RESOURCE_HINT = /url\(|image-set\(|@import|\\/i;
const CSS_IMPORT = /@import\b[^;]*;?/gi;
const CSS_IMAGE_SET = /(?:-webkit-)?image-set\([^;}]*/gi;
// `url(` that is not a same-document fragment or inline data, through its closing parenthesis.
const CSS_EXTERNAL_URL = /\burl\((?!\s*(?:["']\s*)?(?:#|data:))[^)]*\)?/gi;
// An unterminated comment runs to the end, as it does in a style sheet.
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const CSS_ESCAPE = /\\([0-9a-f]{1,6})\s?|\\([^\n])/gi;

function hasExternalCssResource(css: string): boolean {
  // Global patterns keep a cursor between `test` calls; `search` does not.
  return css.search(CSS_IMPORT) >= 0 || css.search(CSS_IMAGE_SET) >= 0 || css.search(CSS_EXTERNAL_URL) >= 0;
}

/**
 * Replaces references to external resources in Mermaid CSS; same-document fragments
 * (`url(#arrowhead)`) and inline `data:` stay. Returns null when a reference is
 * hidden behind comments or escapes (`u\72l(`), so the caller can drop the style.
 */
function neutralizeCssResources(css: string): string | null {
  const neutralized = css.replace(CSS_IMPORT, "").replace(CSS_IMAGE_SET, "none").replace(CSS_EXTERNAL_URL, "none");
  const decoded = neutralized.replace(CSS_COMMENT, "").replace(CSS_ESCAPE, (_escape, hex: string | undefined, literal: string | undefined) => {
    if (hex === undefined) return literal ?? "";
    const codePoint = Number.parseInt(hex, 16);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
  });
  return hasExternalCssResource(decoded) ? null : neutralized;
}

/** Fail closed: never return unsanitized Mermaid output. */
export function sanitizeMermaidSvg(svg: string): string | null {
  const cleaned = sanitizeSvg(svg);
  if (!cleaned.includes("<svg")) return null;
  const restored = restoreForeignObjectLabels(cleaned, svg);

  // The Webview's CSP grants no remote origin, so nothing here can reach the network
  // even if it survives. Removing resource references anyway keeps sanitized output
  // inert by itself: only an explicit click on a link may leave the document.
  const document = new DOMParser().parseFromString(restored, "text/html");
  const root = document.querySelector("svg");
  if (!root) return null;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    const name = element.localName.toLowerCase();
    if (name === "style") {
      // Only an SVG style sheet is serialized with its text escaped. An HTML one is
      // written raw, where editing the text could assemble markup nothing sanitized.
      if (element.namespaceURI !== SVG_NAMESPACE) {
        element.remove();
        continue;
      }
      const css = neutralizeCssResources(element.textContent ?? "");
      if (css === null || css.includes("<")) return null;
      element.textContent = css;
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (REMOVED_ATTRIBUTES.includes(attributeName)) {
        element.removeAttribute(attribute.name);
      } else if (RESOURCE_ATTRIBUTES.includes(attributeName)) {
        const navigation = name === "a" && (attributeName === "href" || attributeName === "xlink:href");
        if (!navigation && value && !value.startsWith("#") && !value.startsWith("data:")) {
          element.removeAttribute(attribute.name);
        }
      } else if (CSS_RESOURCE_HINT.test(value)) {
        // Inline styles and presentation attributes (`fill`, `filter`, `mask`, …).
        const css = neutralizeCssResources(value);
        if (css === null) element.removeAttribute(attribute.name);
        else if (css !== attribute.value) element.setAttribute(attribute.name, css);
      }
    }
  }
  return root.outerHTML;
}
