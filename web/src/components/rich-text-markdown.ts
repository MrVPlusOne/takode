import { TRANSCRIPTION_TAG } from "../../shared/transcription-tag.js";
import { splitPlainTakodeReferences } from "./composer-reference-utils.js";
import { escapeHtml, type LineDrawing, type LineRenderer } from "./rich-text-box.js";

/**
 * Basic Markdown drawn as you type, the text itself unchanged: the marks stay in the text, dimmed,
 * and what they mark takes its style (bold, italic, code, strikethrough, links, headings, quotes,
 * lists, code blocks). Two marks are drawn differently in their own space: a list's "-", "*" or
 * "+" shows as a bullet, the way Slack turns "* " into one, and a quote's ">" gives way to the
 * quote's bar (one per level), with a wrapped quote's later lines indented under its first. Both stay those characters in the draft, so undo, copying and sending see exactly
 * what was typed. The "[transcribed]" line that dictation adds is drawn as a grey label.
 *
 * Quest and session references (`q-12`, `#34`) are drawn as highlighted links, recognised as the
 * feed recognises them when the message is sent ({@link splitPlainTakodeReferences}); in code they
 * stay code.
 */
export const markdownLines: LineRenderer = (lines) => {
  let fence: string | null = null;
  return lines.map((line, index): LineDrawing => {
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null;
      return { className: fenceMark && fence === null ? "rt-line md-fence" : "rt-line md-code", html: plain(line) };
    }
    if (fenceMark) {
      fence = fenceMark;
      return { className: "rt-line md-fence", html: plain(line) };
    }
    if (index === lines.length - 1 && line === TRANSCRIPTION_TAG) {
      return { className: "rt-line", html: `<span class="md-tag">${escapeHtml(line)}</span>` };
    }
    return blockLine(line);
  });
};

/** Draws a run of plain prose: escaped text with its quest and session references highlighted. */
function prose(text: string): string {
  return splitPlainTakodeReferences(text)
    .map((part) =>
      part.kind === "text" ? escapeHtml(part.text) : `<span class="md-ref">${escapeHtml(part.text)}</span>`,
    )
    .join("");
}

function blockLine(line: string): LineDrawing {
  if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) return { className: "rt-line md-rule", html: mark(line) };
  const heading = /^(#{1,6})( +)(.*)$/.exec(line);
  if (heading) {
    const [, hashes, space, rest] = heading;
    return { className: `rt-line md-h md-h${hashes!.length}`, html: mark(hashes! + space!) + inline(rest!) };
  }
  const quote = /^( {0,3}(?:> ?)+)(.*)$/.exec(line);
  if (quote) {
    // One bar per level, up to three; the marks give way to the bars in a fixed space per level,
    // so a wrapped quote's later lines line up under its first.
    const depth = Math.min(3, quote[1]!.split(">").length - 1);
    return {
      className: `rt-line md-quote md-quote-${depth}`,
      html: `<span class="md-mark md-quote-mark">${escapeHtml(quote[1]!)}</span>` + inline(quote[2]!),
    };
  }
  const bullet = /^( *)([-*+])( +)(.*)$/.exec(line);
  if (bullet) {
    const [, indent, sign, space, rest] = bullet;
    return {
      className: "rt-line md-item",
      html:
        escapeHtml(indent!) +
        `<span class="md-bullet">${escapeHtml(sign!)}</span>` +
        escapeHtml(space!) +
        inline(rest!),
    };
  }
  const numbered = /^( *)(\d{1,9}[.)])( +)(.*)$/.exec(line);
  if (numbered) {
    const [, indent, number, space, rest] = numbered;
    return {
      className: "rt-line md-item",
      html:
        escapeHtml(indent!) +
        `<span class="md-number">${escapeHtml(number!)}</span>` +
        escapeHtml(space!) +
        inline(rest!),
    };
  }
  return { className: "rt-line", html: line ? inline(line) : "<br>" };
}

/**
 * Inline styles, earliest match first. Code spans take nothing inside; bold, italic and
 * strikethrough may hold each other. Emphasis needs text right inside its marks ("a * b" is not
 * italic), and underscores only count at word edges, so snake_case stays plain.
 */
const INLINE =
  /(`+)([^`]+?)\1(?!`)|(\*\*|__)(?=\S)(.+?)(?<=\S)\3|~~(?=\S)(.+?)(?<=\S)~~|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])|\[([^\]\n]+)\]\(([^()\s]+)\)/gu;

function inline(text: string): string {
  if (!text) return "";
  let html = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, ticks, code, strongMark, strong, strike, star, under, label, url] = match;
    html += prose(text.slice(last, match.index));
    last = match.index + whole.length;
    if (ticks) html += mark(ticks) + `<span class="md-code-span">${escapeHtml(code!)}</span>` + mark(ticks);
    else if (strongMark) html += wrap(strongMark, "md-strong", inline(strong!));
    else if (strike !== undefined) html += wrap("~~", "md-strike", inline(strike));
    else if (star !== undefined) html += wrap("*", "md-em", inline(star));
    else if (under !== undefined) html += wrap("_", "md-em", inline(under));
    else html += mark("[") + `<span class="md-link">${inline(label!)}</span>` + mark(`](${url})`);
  }
  return html + prose(text.slice(last));
}

function wrap(marks: string, className: string, inner: string): string {
  return mark(marks) + `<span class="${className}">${inner}</span>` + mark(marks);
}

function mark(text: string): string {
  return `<span class="md-mark">${escapeHtml(text)}</span>`;
}

function plain(line: string): string {
  return line ? escapeHtml(line) : "<br>";
}
