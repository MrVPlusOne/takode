/**
 * The model behind the rich-text text box: a `contenteditable` element whose content is always a
 * plain string, drawn as one `<div>` per line. The string stays the draft, exactly as in a
 * textarea, so drafts, voice input, autocomplete and sending are unchanged; the lines only decide
 * how it looks (plain, or with its Markdown styled).
 *
 * The browser edits the element itself (typing, IME, spell fixes, deleting across lines), and
 * afterwards {@link reconcile} reads the text back with {@link readText} and redraws only the
 * lines whose drawing no longer matches. Typing inside a line usually leaves it matching, so the
 * DOM, the caret and an input method's state stay untouched.
 */

/** One drawn line: its classes and inner HTML. */
export interface LineDrawing {
  className: string;
  html: string;
}

/** Draws every line of `text`; lines may depend on the ones before (a code fence). */
export type LineRenderer = (lines: string[]) => LineDrawing[];

/** A point in the DOM, as a selection holds it. */
export interface DomPoint {
  node: Node;
  offset: number;
}

/** Plain lines: the text and nothing else, an empty line holding a `<br>` so it has a height. */
export const plainLines: LineRenderer = (lines) =>
  lines.map((line) => ({ className: "rt-line", html: line ? escapeHtml(line) : "<br>" }));

/**
 * Reads the text of `root` and the text offsets of `points`, whatever shape the browser left the
 * DOM in: each block element is a line, a `<br>` ends a line unless it is the last thing in its
 * block (there it only gives an empty line its height), and text is text. A point the walk never
 * meets (outside `root`) comes back as -1.
 */
export function readText(root: Node, points: DomPoint[] = []): { text: string; offsets: number[] } {
  const lines: string[] = [];
  let line: string | null = null;
  let done = 0; // length of the finished lines, with their line breaks
  const offsets = points.map(() => -1);
  const here = (extra = 0) => done + (line?.length ?? 0) + extra;
  const mark = (node: Node, offset: number, at: number) => {
    points.forEach((point, index) => {
      if (point.node === node && point.offset === offset && offsets[index] === -1) offsets[index] = at;
    });
  };
  const end = () => {
    if (line === null) return;
    lines.push(line);
    done += line.length + 1;
    line = null;
  };
  const visit = (node: Node) => {
    const children = Array.from(node.childNodes);
    children.forEach((child, index) => {
      mark(node, index, here());
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        line ??= "";
        points.forEach((point, i) => {
          if (point.node === child && offsets[i] === -1) offsets[i] = here(Math.min(point.offset, data.length));
        });
        line += data;
        return;
      }
      if (child.nodeName === "BR") {
        const placeholder = isLastInBlock(child);
        // A caret after a placeholder `<br>` is still on its line.
        if (placeholder) mark(node, index + 1, here());
        line ??= "";
        if (placeholder) end();
        else {
          lines.push(line);
          done += line.length + 1;
          line = "";
        }
        return;
      }
      const block = isBlock(child);
      if (block) end();
      visit(child);
      if (block) end();
    });
    mark(node, children.length, here());
  };
  visit(root);
  end();
  // The last line break counted in `done` doesn't exist; a point at the very end can't exceed it.
  const text = lines.join("\n");
  return { text, offsets: offsets.map((offset) => Math.min(offset, text.length)) };
}

/**
 * Where text offset `index` is in a box drawn by {@link reconcile}: in its line's text, at the end
 * of the text before it (so typing there continues that text), or at an empty line's start.
 */
export function domPointAt(root: HTMLElement, index: number): DomPoint {
  const lines = Array.from(root.children);
  let left = Math.max(0, index);
  for (const [lineIndex, line] of lines.entries()) {
    const length = readText(line).text.length;
    if (left > length && lineIndex < lines.length - 1) {
      left -= length + 1;
      continue;
    }
    left = Math.min(left, length);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let first: Text | null = null;
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
      first ??= text;
      if (left <= text.data.length && (left > 0 || text === first)) return { node: text, offset: left };
      left -= text.data.length;
    }
    return { node: line, offset: 0 };
  }
  return { node: root, offset: 0 };
}

/**
 * Makes `root` draw `text` with `render`, touching only lines whose element, classes or HTML
 * differ, and returns whether anything changed. Lines the browser just edited and that still
 * match are left alone.
 */
export function reconcile(root: HTMLElement, text: string, render: LineRenderer): boolean {
  const drawings = render(text.split("\n"));
  let changed = false;
  // Stray nodes the browser put straight in the box (text typed into an emptied box) go; their
  // text is already in `text`.
  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLDivElement) continue;
    child.remove();
    changed = true;
  }
  drawings.forEach((drawing, index) => {
    let line = root.children[index] as HTMLElement | undefined;
    if (!line) {
      line = document.createElement("div");
      root.append(line);
    }
    if (line.className !== drawing.className) {
      line.className = drawing.className;
      changed = true;
    }
    if (line.innerHTML !== drawing.html) {
      line.innerHTML = drawing.html;
      changed = true;
    }
  });
  while (root.children.length > drawings.length) {
    root.lastElementChild!.remove();
    changed = true;
  }
  return changed;
}

/** Escapes text for HTML the way the browser serializes a text node, so drawings compare exactly. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

const BLOCKS = new Set(["DIV", "P", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);

function isBlock(node: Node): boolean {
  return BLOCKS.has(node.nodeName);
}

/** Whether nothing with text or a line break follows `node` inside its block. */
function isLastInBlock(node: Node): boolean {
  for (let current: Node | null = node; current && !isBlock(current); current = current.parentNode) {
    for (let next = current.nextSibling; next; next = next.nextSibling) {
      if (next.nodeType === Node.TEXT_NODE ? (next as Text).data.length > 0 : true) return false;
    }
    if (current.parentNode && isBlock(current.parentNode)) return true;
  }
  return true;
}

/**
 * The subset of a textarea's API the composer uses, given to the rich-text box's element so code
 * written for a textarea (autocomplete, voice insertion at the caret, undo, paste, type-to-compose)
 * works on it unchanged. Offsets count characters of the plain text, as in a textarea.
 */
export interface TextBoxApi {
  value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  setRangeText(text: string, start: number, end: number, mode?: SelectionMode): void;
  select(): void;
}

export type RichTextBoxElement = HTMLDivElement & TextBoxApi;

/**
 * Gives `root` the {@link TextBoxApi}, drawing with whatever `render()` returns at the time. The
 * selection is remembered while focus is elsewhere (on the mic button, say), as a textarea's is,
 * and a programmatic `focus()` puts the caret back there. Returns a function that removes it.
 */
export function installTextBoxApi(root: HTMLDivElement, render: () => LineRenderer): () => void {
  let saved = { start: 0, end: 0 };
  const inside = () => {
    const selection = root.ownerDocument.getSelection();
    if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode))
      return null;
    const range = selection.getRangeAt(0);
    const [start = 0, end = 0] = readText(root, [
      { node: range.startContainer, offset: range.startOffset },
      { node: range.endContainer, offset: range.endOffset },
    ]).offsets;
    return { start, end };
  };
  const current = () => inside() ?? saved;
  const place = (start: number, end: number) => {
    const length = readText(root).text.length;
    saved = { start: Math.min(start, length), end: Math.min(Math.max(start, end), length) };
    if (root.ownerDocument.activeElement !== root) return;
    const from = domPointAt(root, saved.start);
    const to = domPointAt(root, saved.end);
    root.ownerDocument.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
    revealCaret(root, to);
  };
  const remember = () => {
    const selection = inside();
    if (selection) saved = selection;
  };
  root.ownerDocument.addEventListener("selectionchange", remember);
  const nativeFocus = root.focus.bind(root);
  const api: TextBoxApi & Pick<HTMLElement, "focus"> = {
    get value() {
      return readText(root).text;
    },
    set value(text: string) {
      reconcile(root, text, render());
      place(text.length, text.length);
    },
    get selectionStart() {
      return current().start;
    },
    get selectionEnd() {
      return current().end;
    },
    setSelectionRange: (start, end) => place(start, end),
    setRangeText(text, start, end, mode = "preserve") {
      const before = readText(root).text;
      const { start: oldStart, end: oldEnd } = current();
      reconcile(root, before.slice(0, start) + text + before.slice(end), render());
      const after = start + text.length;
      if (mode === "end") place(after, after);
      else if (mode === "start") place(start, start);
      else if (mode === "select") place(start, after);
      else {
        const shift = (offset: number) => (offset <= start ? offset : offset >= end ? offset + after - end : start);
        place(shift(oldStart), shift(oldEnd));
      }
    },
    select: () => place(0, readText(root).text.length),
    focus(options?: FocusOptions) {
      const wasFocused = root.ownerDocument.activeElement === root;
      const keep = saved;
      nativeFocus(options);
      if (!wasFocused) place(keep.start, keep.end);
    },
  };
  const keys = Object.keys(Object.getOwnPropertyDescriptors(api));
  Object.defineProperties(root, Object.getOwnPropertyDescriptors(api));
  return () => {
    root.ownerDocument.removeEventListener("selectionchange", remember);
    for (const key of keys) delete (root as unknown as Record<string, unknown>)[key];
  };
}

/** Scrolls `root` (only it, not the page) so the caret at `point` is in view, as a textarea does. */
function revealCaret(root: HTMLElement, point: DomPoint): void {
  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  const caret =
    range.getClientRects()[0] ??
    (point.node instanceof Element ? point.node : point.node.parentElement)?.getBoundingClientRect();
  if (!caret) return;
  const box = root.getBoundingClientRect();
  const style = getComputedStyle(root);
  const top = box.top + root.clientTop + Number.parseFloat(style.paddingTop);
  const bottom = box.top + root.clientTop + root.clientHeight - Number.parseFloat(style.paddingBottom);
  if (caret.bottom > bottom) root.scrollTop += caret.bottom - bottom;
  else if (caret.top < top) root.scrollTop -= top - caret.top;
}
