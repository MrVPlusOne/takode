/**
 * Lightweight HTML fragment → Markdown converter.
 *
 * Designed specifically for HTML produced by react-markdown + remarkGfm,
 * so the tag vocabulary is bounded and predictable. Not a general-purpose
 * HTML-to-markdown library.
 */

/** Depth limit to prevent stack overflow on pathologically nested HTML. */
const MAX_DEPTH = 50;

const MATH_SOURCE_SELECTOR = "[data-math-source]";

/** Return whether a selection intersects rendered math metadata. */
export function rangeContainsMath(range: Range): boolean {
  if (closestMathSource(range.startContainer) || closestMathSource(range.endContainer)) return true;
  try {
    return Boolean(range.cloneContents().querySelector?.(MATH_SOURCE_SELECTOR));
  } catch {
    return false;
  }
}

/** Expand partial formula selections so copy/quote treats each formula atomically. */
export function normalizeMathSelectionRange(range: Range): Range {
  const normalized = range.cloneRange();
  const startMath = closestMathSource(range.startContainer);
  const endMath = closestMathSource(range.endContainer);

  try {
    if (startMath) normalized.setStartBefore(startMath);
    if (endMath) normalized.setEndAfter(endMath);
  } catch {
    return range.cloneRange();
  }

  return normalized;
}

/** Convert a Range's cloned contents into markdown text. */
export function htmlFragmentToMarkdown(range: Range): string {
  const fragment = normalizeMathSelectionRange(range).cloneContents();
  return processNode(fragment, 0).trim();
}

/** Convert a selection to plain text while collapsing KaTeX to one source token. */
export function htmlFragmentToPlainText(range: Range): string {
  const fragment = normalizeMathSelectionRange(range).cloneContents();
  return processPlainNode(fragment, 0).trim();
}

/** Build portable rich HTML without duplicating KaTeX's MathML and visual branches. */
export function htmlFragmentToRichText(range: Range): { html: string; plainText: string } {
  const normalized = normalizeMathSelectionRange(range);
  const fragment = normalized.cloneContents();
  collapseMathForRichText(fragment);

  const container = document.createElement("div");
  container.appendChild(fragment);
  return {
    html: container.innerHTML,
    plainText: htmlFragmentToPlainText(normalized),
  };
}

function closestMathSource(node: Node | null): HTMLElement | null {
  let current = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute("data-math-source")) return current;
    current = current.parentElement;
  }
  return null;
}

function collapseMathForRichText(fragment: DocumentFragment): void {
  for (const wrapper of Array.from(fragment.querySelectorAll<HTMLElement>(MATH_SOURCE_SELECTOR))) {
    const source = wrapper.getAttribute("data-math-source");
    if (source == null) continue;
    const replacement = wrapper.ownerDocument.createElement("span");
    replacement.setAttribute("data-takode-math-source", "true");
    replacement.textContent = source;
    wrapper.replaceWith(replacement);
  }

  collapseUnwrappedKatex(fragment);
}

function collapseUnwrappedKatex(root: ParentNode): void {
  for (const display of Array.from(root.querySelectorAll<HTMLElement>(".katex-display"))) {
    const source = katexAnnotationSource(display);
    if (source == null) continue;
    display.replaceWith(display.ownerDocument.createTextNode(`$$${source}$$`));
  }
  for (const inline of Array.from(root.querySelectorAll<HTMLElement>(".katex"))) {
    const source = katexAnnotationSource(inline);
    if (source == null) continue;
    inline.replaceWith(inline.ownerDocument.createTextNode(`$${source}$`));
  }
}

function katexAnnotationSource(node: ParentNode): string | null {
  return node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null;
}

function mathSourceForElement(node: HTMLElement): string | null {
  const exactSource = node.getAttribute("data-math-source");
  if (exactSource != null) return exactSource;

  if (node.classList.contains("katex-display")) {
    const source = katexAnnotationSource(node);
    return source == null ? null : `$$${source}$$`;
  }
  if (node.classList.contains("katex")) {
    const source = katexAnnotationSource(node);
    return source == null ? null : `$${source}$`;
  }
  if (node.classList.contains("katex-mathml")) {
    const source = katexAnnotationSource(node);
    return source == null ? null : `$${source}$`;
  }
  if (node.classList.contains("katex-html") && node.parentElement?.querySelector(".katex-mathml")) return "";
  return null;
}

/** Convert an arbitrary DOM node (or fragment) to markdown recursively. */
function processNode(node: Node, depth: number): string {
  // Bail out on excessive nesting -- return plain text as fallback
  if (depth > MAX_DEPTH) {
    return node.textContent ?? "";
  }

  // Text node: return content as-is
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  // Document fragment: process all children
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return processChildren(node, depth);
  }

  if (!(node instanceof HTMLElement)) {
    return node.textContent ?? "";
  }

  const mathSource = mathSourceForElement(node);
  if (mathSource != null) return mathSource;

  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case "strong":
    case "b": {
      const inner = processChildren(node, depth);
      return inner ? `**${inner}**` : "";
    }
    case "em":
    case "i": {
      const inner = processChildren(node, depth);
      return inner ? `*${inner}*` : "";
    }
    case "del":
    case "s": {
      const inner = processChildren(node, depth);
      return inner ? `~~${inner}~~` : "";
    }
    case "code": {
      // Check if this is inside a <pre> (block code) -- handled by the pre case
      if (node.parentElement?.tagName.toLowerCase() === "pre") {
        return node.textContent ?? "";
      }
      const inner = node.textContent ?? "";
      return inner ? `\`${inner}\`` : "";
    }
    case "pre": {
      const codeEl = node.querySelector("code");
      const code = codeEl?.textContent ?? node.textContent ?? "";
      const langMatch = codeEl?.className.match(/language-(\w+)/);
      const lang = langMatch?.[1] ?? "";
      // Strip trailing newline that react-markdown appends
      const trimmedCode = code.endsWith("\n") ? code.slice(0, -1) : code;
      return `\n\n\`\`\`${lang}\n${trimmedCode}\n\`\`\`\n\n`;
    }
    case "a": {
      const href = node.getAttribute("href") ?? "";
      const inner = processChildren(node, depth);
      return href ? `[${inner}](${href})` : inner;
    }
    case "img": {
      const alt = node.getAttribute("alt") ?? "";
      const src = node.getAttribute("src") ?? "";
      return `![${alt}](${src})`;
    }
    case "h1":
      return `\n\n# ${processChildren(node, depth)}\n\n`;
    case "h2":
      return `\n\n## ${processChildren(node, depth)}\n\n`;
    case "h3":
      return `\n\n### ${processChildren(node, depth)}\n\n`;
    case "h4":
      return `\n\n#### ${processChildren(node, depth)}\n\n`;
    case "h5":
      return `\n\n##### ${processChildren(node, depth)}\n\n`;
    case "h6":
      return `\n\n###### ${processChildren(node, depth)}\n\n`;
    case "p":
      return `\n\n${processChildren(node, depth)}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "blockquote": {
      const inner = processChildren(node, depth).trim();
      return (
        "\n\n" +
        inner
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") +
        "\n\n"
      );
    }
    case "ul":
      return "\n\n" + processListItems(node, "ul", depth) + "\n\n";
    case "ol":
      return "\n\n" + processListItems(node, "ol", depth) + "\n\n";
    case "li":
      // li is normally handled by processListItems; fallback if encountered directly
      return processChildren(node, depth);
    case "table":
      return "\n\n" + processTable(node, depth) + "\n\n";
    case "thead":
    case "tbody":
    case "tr":
    case "th":
    case "td":
      // These are handled by processTable; fallback to just children
      return processChildren(node, depth);
    case "div":
    case "span":
    case "section":
      return processChildren(node, depth);
    default:
      return processChildren(node, depth);
  }
}

function processPlainNode(node: Node, depth: number): string {
  if (depth > MAX_DEPTH) return node.textContent ?? "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return processPlainChildren(node, depth);
  if (!(node instanceof HTMLElement)) return node.textContent ?? "";

  const mathSource = mathSourceForElement(node);
  if (mathSource != null) return mathSource;

  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "img") return node.getAttribute("alt") ?? "";
  if (tag === "pre") return `\n${node.textContent ?? ""}\n`;
  if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "blockquote" || tag === "section" || tag === "div") {
    return `\n${processPlainChildren(node, depth)}\n`;
  }
  if (tag === "ul" || tag === "ol") return `\n${processPlainList(node, tag, depth)}\n`;
  if (tag === "li") return processPlainChildren(node, depth);
  if (tag === "table") return `\n${processPlainTable(node, depth)}\n`;
  return processPlainChildren(node, depth);
}

function processPlainChildren(node: Node, depth: number): string {
  let result = "";
  for (const child of Array.from(node.childNodes)) result += processPlainNode(child, depth + 1);
  return result;
}

function processPlainList(node: HTMLElement, tag: "ul" | "ol", depth: number): string {
  let index = 1;
  const items: string[] = [];
  for (const child of Array.from(node.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const prefix = tag === "ul" ? "- " : `${index}. `;
    items.push(prefix + processPlainChildren(child, depth + 1).trim());
    index += 1;
  }
  return items.join("\n");
}

function processPlainTable(node: HTMLElement, depth: number): string {
  return Array.from(node.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll<HTMLElement>("th, td"))
        .map((cell) => processPlainChildren(cell, depth + 1).trim())
        .join("\t"),
    )
    .join("\n");
}

function processChildren(node: Node, depth: number): string {
  let result = "";
  for (const child of Array.from(node.childNodes)) {
    result += processNode(child, depth + 1);
  }
  return result;
}

function processListItems(listNode: Node, listType: "ul" | "ol", depth: number): string {
  const items: string[] = [];
  let index = 1;
  for (const child of Array.from(listNode.childNodes)) {
    if (child instanceof HTMLElement && child.tagName.toLowerCase() === "li") {
      const prefix = listType === "ul" ? "- " : `${index}. `;
      const content = processChildren(child, depth + 1).trim();
      items.push(`${prefix}${content}`);
      index++;
    }
  }
  return items.join("\n");
}

function processTable(tableNode: Node, depth: number): string {
  const rows: string[][] = [];
  let headerRow: string[] | null = null;

  // Collect all rows
  const trElements = (tableNode as HTMLElement).querySelectorAll("tr");
  for (const tr of Array.from(trElements)) {
    const cells: string[] = [];
    for (const cell of Array.from(tr.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag === "th" || tag === "td") {
        cells.push(processChildren(cell, depth + 1).trim());
      }
    }
    if (cells.length > 0) {
      // First row with <th> cells is the header
      if (!headerRow && tr.querySelector("th")) {
        headerRow = cells;
      } else {
        rows.push(cells);
      }
    }
  }

  if (!headerRow && rows.length > 0) {
    headerRow = rows.shift()!;
  }

  if (!headerRow) return "";

  const colCount = headerRow.length;
  const lines: string[] = [];
  lines.push("| " + headerRow.join(" | ") + " |");
  lines.push("| " + Array(colCount).fill("---").join(" | ") + " |");
  for (const row of rows) {
    // Pad row to match header column count
    while (row.length < colCount) row.push("");
    lines.push("| " + row.slice(0, colCount).join(" | ") + " |");
  }
  return lines.join("\n");
}
