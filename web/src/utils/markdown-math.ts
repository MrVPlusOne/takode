import type { Element, Parent as HastParent, Root as HastRoot } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import type { VFile } from "vfile";

interface MarkdownPosition {
  start?: { offset?: number };
  end?: { offset?: number };
}

type MarkdownHastChild =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties?: Record<string, unknown>;
      children?: MarkdownHastChild[];
    };

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
  position?: MarkdownPosition;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: MarkdownHastChild[];
  };
}

interface MathSourceMarkers {
  inlinePadding: string;
  literalBackslash: string;
  mathDollar: string;
}

interface BackslashDelimiter {
  kind: "inline" | "display";
  start: number;
  close: number;
}

export interface PreparedMarkdownMathSource {
  originalText: string;
  renderText: string;
  markers: MathSourceMarkers | null;
  backslashPairs: Map<string, BackslashDelimiter>;
  baselineImageAlts: Map<string, string>;
  preserveBackslashLiterals: boolean;
}

/** Avoid a second Markdown parse for exceptionally large streaming payloads. */
export const MAX_BACKSLASH_COMPAT_SOURCE_LENGTH = 32 * 1024;
/** Bound KaTeX input because maxSize does not bound generated DOM size. */
export const MAX_MATH_SOURCE_LENGTH = 2048;
/** Bound aggregate KaTeX input per rendered Markdown surface. */
export const MAX_TOTAL_MATH_SOURCE_LENGTH = 8192;

const compatibilityParser =
  typeof remarkGfm === "function"
    ? unified().use(remarkParse).use(remarkGfm).freeze()
    : unified().use(remarkParse).freeze();
const HARD_PROTECTED_MARKDOWN_NODES = new Set([
  "code",
  "inlineCode",
  "definition",
  "image",
  "imageReference",
  "yaml",
  "toml",
]);
const HARD_PROTECTION = 1;
const SOFT_PROTECTION = 2;
const STRUCTURAL_SCOPE_NODES = new Set(["blockquote", "listItem", "tableCell"]);

/**
 * Prepare renderer-only Markdown for remark-math without mutating stored text.
 *
 * A CommonMark/GFM preparse supplies exact prose/protected ranges, so code,
 * HTML, definitions, images, autolinks, and link destinations remain owned by
 * Markdown. The compatibility scan is then one forward pass over those ranges.
 * Every replacement preserves UTF-16 length, keeping second-parse positions
 * aligned with the untouched source used by copy and fallback paths.
 */
export function prepareMarkdownMathSource(originalText: string): PreparedMarkdownMathSource {
  const backslashPairs = new Map<string, BackslashDelimiter>();
  const baselineImageAlts = new Map<string, string>();
  const hasBackslashCandidate = hasBackslashMathCandidate(originalText);
  const needsImageBaseline = originalText.includes("![") && originalText.includes("$");
  const unchanged = (preserveBackslashLiterals: boolean): PreparedMarkdownMathSource => ({
    originalText,
    renderText: originalText,
    markers: null,
    backslashPairs,
    baselineImageAlts,
    preserveBackslashLiterals,
  });

  if (!hasBackslashCandidate && !needsImageBaseline) return unchanged(false);
  if (originalText.length > MAX_BACKSLASH_COMPAT_SOURCE_LENGTH) return unchanged(hasBackslashCandidate);

  const tree = parseCompatibilityTree(originalText);
  if (!tree) return unchanged(hasBackslashCandidate);
  collectBaselineImageAlts(tree, baselineImageAlts);
  if (!hasBackslashCandidate) return unchanged(false);

  const markers = chooseMathSourceMarkers(originalText);
  if (!markers) return unchanged(true);

  const { protection, structuralScopes, chunkScopes } = findMarkdownProtection(tree, originalText);
  const { pairs, unmatchedBackslashes } = findBackslashMathDelimiters(
    originalText,
    protection,
    structuralScopes,
    chunkScopes,
  );
  if (pairs.length === 0 && unmatchedBackslashes.size === 0) {
    return {
      originalText,
      renderText: originalText,
      markers,
      backslashPairs,
      baselineImageAlts,
      preserveBackslashLiterals: false,
    };
  }

  const characters = originalText.split("");
  for (const backslashIndex of unmatchedBackslashes) characters[backslashIndex] = markers.literalBackslash;

  for (const pair of pairs) {
    const end = pair.close + 2;
    backslashPairs.set(`${pair.start}:${end}`, pair);

    if (pair.kind === "inline") {
      characters[pair.start] = "$";
      characters[pair.start + 1] = markers.inlinePadding;
      characters[pair.close] = markers.inlinePadding;
      characters[pair.close + 1] = "$";
    } else {
      characters[pair.start] = "$";
      characters[pair.start + 1] = "$";
      characters[pair.close] = "$";
      characters[pair.close + 1] = "$";
    }

    // Dollar signs inside a backslash-delimited formula belong to TeX, not to
    // a nested remark-math delimiter.
    for (let index = pair.start + 2; index < pair.close; index += 1) {
      if (characters[index] === "$") characters[index] = markers.mathDollar;
    }
  }

  return {
    originalText,
    renderText: characters.join(""),
    markers,
    backslashPairs,
    baselineImageAlts,
    preserveBackslashLiterals: false,
  };
}

function hasBackslashMathCandidate(source: string): boolean {
  return source.includes("\\(") || source.includes("\\)") || source.includes("\\[") || source.includes("\\]");
}

function parseCompatibilityTree(source: string): MarkdownNode | null {
  try {
    return compatibilityParser.parse(source) as MarkdownNode;
  } catch {
    return null;
  }
}

function collectBaselineImageAlts(node: MarkdownNode, target: Map<string, string>): void {
  if ((node.type === "image" || node.type === "imageReference") && typeof node.alt === "string") {
    const key = nodePositionKey(node);
    if (key) target.set(key, node.alt);
  }
  for (const child of node.children ?? []) collectBaselineImageAlts(child, target);
}

function chooseMathSourceMarkers(source: string): MathSourceMarkers | null {
  const usedCodeUnits = new Uint8Array(0x10000);
  for (let index = 0; index < source.length; index += 1) usedCodeUnits[source.charCodeAt(index)] = 1;

  const selected: string[] = [];
  const collectRange = (start: number, end: number): void => {
    for (let codeUnit = start; codeUnit <= end && selected.length < 3; codeUnit += 1) {
      if (!usedCodeUnits[codeUnit]) selected.push(String.fromCharCode(codeUnit));
    }
  };

  collectRange(0xe000, 0xf8ff);
  // Unicode noncharacters are valid string code units and give a bounded,
  // nonthrowing fallback when a payload deliberately occupies the BMP PUA.
  collectRange(0xfdd0, 0xfdef);
  if (selected.length < 3) return null;

  return { inlinePadding: selected[0], literalBackslash: selected[1], mathDollar: selected[2] };
}

function findMarkdownProtection(
  tree: MarkdownNode,
  source: string,
): { protection: Uint8Array; structuralScopes: Int32Array; chunkScopes: Int32Array } {
  const protection = new Uint8Array(source.length);
  const structuralScopes = new Int32Array(source.length);
  protectMarkdownNodes(tree, source, protection);
  assignStructuralScopes(tree, structuralScopes, { nextId: 1 });
  return { protection, structuralScopes, chunkScopes: buildChunkScopes(source) };
}

function assignStructuralScopes(node: MarkdownNode, scopes: Int32Array, state: { nextId: number }): void {
  if (STRUCTURAL_SCOPE_NODES.has(node.type)) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") scopes.fill(state.nextId++, start, end);
  }
  for (const child of node.children ?? []) assignStructuralScopes(child, scopes, state);
}

function buildChunkScopes(source: string): Int32Array {
  const scopes = new Int32Array(source.length);
  let lineStart = 0;
  let nextScope = 1;
  let activeScope = 0;

  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline + 1;
    const line = source.slice(lineStart, newline === -1 ? source.length : newline).replace(/\r$/, "");
    if (/^[ \t]*$/.test(line)) {
      activeScope = 0;
    } else {
      if (activeScope === 0) activeScope = nextScope++;
      scopes.fill(activeScope, lineStart, lineEnd);
    }
    lineStart = lineEnd;
  }

  return scopes;
}

function protectMarkdownNodes(node: MarkdownNode, source: string, protection: Uint8Array): void {
  if (HARD_PROTECTED_MARKDOWN_NODES.has(node.type)) {
    markNodeRange(protection, node, HARD_PROTECTION);
    return;
  }

  if (node.type === "html") {
    markNodeRange(protection, node, SOFT_PROTECTION);
    return;
  }

  if (node.type === "link" || node.type === "linkReference") {
    if (isAutolinkNode(node, source)) {
      markNodeRange(protection, node, SOFT_PROTECTION);
      return;
    }

    const suffixStart = node.children?.at(-1)?.position?.end?.offset;
    const end = node.position?.end?.offset;
    if (typeof suffixStart === "number" && typeof end === "number") {
      protection.fill(SOFT_PROTECTION, suffixStart, end);
    }
  }

  for (const child of node.children ?? []) protectMarkdownNodes(child, source, protection);
}

function isAutolinkNode(node: MarkdownNode, source: string): boolean {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return false;

  const raw = source.slice(start, end);
  if (raw.startsWith("<") && raw.endsWith(">")) return true;

  const onlyChild = node.children?.length === 1 ? node.children[0] : null;
  return (
    onlyChild?.type === "text" && onlyChild.position?.start?.offset === start && onlyChild.position?.end?.offset === end
  );
}

function isStandaloneDisplayDelimiterLine(source: string, delimiterStart: number): boolean {
  const lineStart = source.lastIndexOf("\n", delimiterStart - 1) + 1;
  let prefix = source.slice(lineStart, delimiterStart);

  while (prefix) {
    const quote = prefix.match(/^[ \t]{0,3}>[ \t]?/);
    if (quote) {
      prefix = prefix.slice(quote[0].length);
      continue;
    }
    const list = prefix.match(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/);
    if (list) {
      prefix = prefix.slice(list[0].length);
      continue;
    }
    break;
  }

  const newline = source.indexOf("\n", delimiterStart + 2);
  const lineEnd = newline === -1 ? source.length : newline;
  const suffix = source.slice(delimiterStart + 2, lineEnd).replace(/\r$/, "");
  return /^[ \t]*$/.test(prefix) && /^[ \t]*$/.test(suffix);
}

function markNodeRange(target: Uint8Array, node: MarkdownNode, value: number): void {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number") target.fill(value, start, end);
}

function nodePositionKey(node: MarkdownNode): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? `${start}:${end}` : null;
}

function findBackslashMathDelimiters(
  source: string,
  protectedCharacters: Uint8Array,
  structuralScopes: Int32Array,
  chunkScopes: Int32Array,
): { pairs: BackslashDelimiter[]; unmatchedBackslashes: Set<number> } {
  const pairs: BackslashDelimiter[] = [];
  const unmatchedBackslashes = new Set<number>();
  let open: {
    kind: BackslashDelimiter["kind"];
    start: number;
    structuralScopeId: number;
    chunkScopeId: number;
    standaloneDisplayLine: boolean;
  } | null = null;
  let precedingBackslashes = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (
      open &&
      (open.structuralScopeId
        ? structuralScopes[index] !== open.structuralScopeId
        : chunkScopes[index] !== open.chunkScopeId)
    ) {
      unmatchedBackslashes.add(open.start);
      open = null;
    }

    const protection = protectedCharacters[index];
    if (protection === HARD_PROTECTION) {
      if (open) unmatchedBackslashes.add(open.start);
      open = null;
      precedingBackslashes = 0;
      continue;
    }
    if (protection === SOFT_PROTECTION) {
      precedingBackslashes = 0;
      continue;
    }

    if (source[index] !== "\\") {
      precedingBackslashes = 0;
      continue;
    }

    const escaped = precedingBackslashes % 2 === 1;
    const next = protectedCharacters[index + 1] ? undefined : source[index + 1];
    const kind = next === "(" || next === ")" ? "inline" : next === "[" || next === "]" ? "display" : null;
    if (escaped || !kind) {
      precedingBackslashes += 1;
      continue;
    }

    const isOpening = next === "(" || next === "[";
    if (isOpening) {
      if (open) unmatchedBackslashes.add(index);
      else {
        open = {
          kind,
          start: index,
          structuralScopeId: structuralScopes[index],
          chunkScopeId: chunkScopes[index],
          standaloneDisplayLine: kind === "display" && isStandaloneDisplayDelimiterLine(source, index),
        };
      }
    } else if (open?.kind === kind) {
      const crossesLine =
        source.slice(open.start, index).includes("\n") || source.slice(open.start, index).includes("\r");
      if (
        kind === "display" &&
        crossesLine &&
        (!open.standaloneDisplayLine || !isStandaloneDisplayDelimiterLine(source, index))
      ) {
        unmatchedBackslashes.add(open.start);
        unmatchedBackslashes.add(index);
      } else {
        pairs.push({ kind, start: open.start, close: index });
      }
      open = null;
    } else {
      unmatchedBackslashes.add(index);
    }

    index += 1;
    precedingBackslashes = 0;
  }

  if (open) unmatchedBackslashes.add(open.start);
  return { pairs, unmatchedBackslashes };
}

/** Restore exact source metadata, malformed literals, and KaTeX input bounds. */
export function remarkMathSourceCompatibility(this: Processor, prepared: PreparedMarkdownMathSource) {
  return (tree: unknown, _file: VFile): void => normalizeMathNodes(tree as MarkdownNode, prepared);
}

function normalizeMathNodes(tree: MarkdownNode, prepared: PreparedMarkdownMathSource): void {
  visitMarkdownParent(tree, prepared, { totalMathSourceLength: 0 });
}

function visitMarkdownParent(
  parent: MarkdownNode,
  prepared: PreparedMarkdownMathSource,
  budget: { totalMathSourceLength: number },
): void {
  if (!parent.children) return;

  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child.type === "image" || child.type === "imageReference") restoreImageAltSource(child, prepared);

    if (child.type === "inlineMath" || child.type === "math") {
      restoreMathValue(child, prepared.markers);
      const rawSource = resolveMathSource(child, prepared);
      if (!rawSource) continue;

      if (
        child.type === "math" &&
        rawSource.startsWith("$$") &&
        !hasClosingDisplayFence(child, prepared.originalText)
      ) {
        parent.children[index] = createLiteralDisplayParagraph(
          flowMathLiteralSource(child, prepared.originalText),
          child.position,
        );
        continue;
      }

      if (child.type === "inlineMath") {
        if (rawSource.startsWith("$") && rawSource.endsWith("$")) {
          const delimiterSize = countLeadingCharacter(rawSource, "$");
          if (delimiterSize === 1 && !isSafeSingleDollarMath(rawSource, child, prepared.originalText)) {
            parent.children[index] = { type: "text", value: rawSource, position: child.position };
            continue;
          }
          setInlineMathDisplayMode(child, delimiterSize >= 2);
        } else if (rawSource.startsWith("\\[")) {
          setInlineMathDisplayMode(child, true);
        } else if (rawSource.startsWith("\\(")) {
          setInlineMathDisplayMode(child, false);
        }
      }

      const mathLength = child.value?.length ?? rawSource.length;
      if (
        mathLength > MAX_MATH_SOURCE_LENGTH ||
        budget.totalMathSourceLength + mathLength > MAX_TOTAL_MATH_SOURCE_LENGTH
      ) {
        parent.children[index] = createLiteralMathNode(child, rawSource);
        continue;
      }
      budget.totalMathSourceLength += mathLength;

      attachMathSource(child, rawSource);
      continue;
    }

    restorePreparedNodeValue(child, prepared.markers);
    if (prepared.preserveBackslashLiterals && child.type === "text") {
      restoreFallbackBackslashLiterals(child, prepared.originalText);
    }
    visitMarkdownParent(child, prepared, budget);
  }
}

function restorePreparedNodeValue(node: MarkdownNode, markers: MathSourceMarkers | null): void {
  if (markers && node.value && containsMathMarker(node.value, markers)) {
    node.value = restorePreparedLiteral(node.value, markers);
  }
}

function restoreMathValue(node: MarkdownNode, markers: MathSourceMarkers | null): void {
  if (!markers) return;
  const restored = restoreMathMarkers(node.value ?? "", markers).replaceAll(markers.inlinePadding, "");
  node.value = restored;
  const textChild = node.data?.hChildren?.find(
    (child): child is Extract<MarkdownHastChild, { type: "text" }> => child.type === "text",
  );
  if (textChild) textChild.value = restored;
}

function restorePreparedLiteral(value: string, markers: MathSourceMarkers): string {
  return restoreMathMarkers(
    value.replaceAll(`$${markers.inlinePadding}`, "\\(").replaceAll(`${markers.inlinePadding}$`, "\\)"),
    markers,
  ).replaceAll(markers.inlinePadding, "");
}

function containsMathMarker(value: string, markers: MathSourceMarkers): boolean {
  return (
    value.includes(markers.inlinePadding) ||
    value.includes(markers.literalBackslash) ||
    value.includes(markers.mathDollar)
  );
}

function restoreMathMarkers(value: string, markers: MathSourceMarkers): string {
  return value.replaceAll(markers.literalBackslash, "\\").replaceAll(markers.mathDollar, "$");
}

function resolveMathSource(node: MarkdownNode, prepared: PreparedMarkdownMathSource): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;

  const rawSource = prepared.originalText.slice(start, end);
  const backslashPair = prepared.backslashPairs.get(`${start}:${end}`);
  if (backslashPair) return logicalBackslashMathSource(rawSource, node.value ?? "", backslashPair.kind);
  if (node.type === "math") return logicalDollarFlowSource(rawSource, node.value ?? "");
  return rawSource;
}

function logicalBackslashMathSource(rawSource: string, value: string, kind: BackslashDelimiter["kind"]): string {
  if (!rawSource.includes("\n") && !rawSource.includes("\r")) return rawSource;

  const rawBody = rawSource.slice(2, -2).replace(/\r\n?|\n/g, "\n");
  const comparableBody = kind === "display" ? rawBody.replace(/^\n/, "").replace(/\n$/, "") : rawBody;
  if (comparableBody === value) return rawSource;

  return kind === "display" ? `\\[\n${value}\n\\]` : `\\(${value}\\)`;
}

function logicalDollarFlowSource(rawSource: string, value: string): string {
  const normalized = rawSource.replace(/\r\n?|\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length >= 2 && lines.slice(1, -1).join("\n") === value) return rawSource;

  const openingLine = lines[0] ?? "$$";
  const openingSize = countLeadingCharacter(openingLine, "$");
  const closingMatch = (lines.at(-1) ?? "").match(new RegExp(`(\\${"$"}{${Math.max(openingSize, 2)},}[ \\t]*)$`));
  const closing = closingMatch?.[1] ?? "$".repeat(Math.max(openingSize, 2));
  return `${openingLine}\n${value}${value ? "\n" : ""}${closing}`;
}

function hasClosingDisplayFence(node: MarkdownNode, source: string): boolean {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return false;

  const openingSize = countLeadingCharacter(source.slice(start), "$");
  if (openingSize < 2) return false;

  const lineStart = Math.max(source.lastIndexOf("\n", Math.max(start, end - 1)) + 1, 0);
  const endLine = source.slice(lineStart, end).replace(/\r$/, "");
  const closingMatch = endLine.match(new RegExp(`(\\${"$"}{${openingSize},})[ \\t]*$`));
  if (!closingMatch) return false;

  const prefix = endLine.slice(0, closingMatch.index);
  if (!/^[\t >]*$/.test(prefix)) return false;

  const finalValueLine =
    (node.value ?? "")
      .replace(/\r\n?|\n/g, "\n")
      .split("\n")
      .at(-1)
      ?.trim() ?? "";
  return !new RegExp(`\\${"$"}{${openingSize},}[ \t]*$`).test(finalValueLine);
}

function flowMathLiteralSource(node: MarkdownNode, source: string): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return node.value ?? "";

  const rawSource = source.slice(start, end);
  const normalized = rawSource.replace(/\r\n?|\n/g, "\n");
  const openingLine = normalized.split("\n")[0] ?? "$$";
  const value = node.value ?? "";
  return `${openingLine}${value ? `\n${value}` : ""}`;
}

function restoreImageAltSource(node: MarkdownNode, prepared: PreparedMarkdownMathSource): void {
  const key = nodePositionKey(node);
  const baselineAlt = key ? prepared.baselineImageAlts.get(key) : undefined;
  if (baselineAlt == null) return;

  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return;

  const rawAlt = extractRawImageAlt(prepared.originalText.slice(start, end));
  if (rawAlt != null) node.alt = restoreBackslashDelimiterEscapes(baselineAlt, rawAlt, true);
}

function extractRawImageAlt(rawImage: string): string | null {
  if (!rawImage.startsWith("![")) return null;

  let depth = 1;
  let slashRun = 0;
  for (let index = 2; index < rawImage.length; index += 1) {
    const character = rawImage[index];
    const escaped = slashRun % 2 === 1;
    if (character === "\\") {
      slashRun += 1;
      continue;
    }
    if (!escaped && character === "[") depth += 1;
    if (!escaped && character === "]") {
      depth -= 1;
      if (depth === 0) return rawImage.slice(2, index);
    }
    slashRun = 0;
  }
  return null;
}

function restoreFallbackBackslashLiterals(node: MarkdownNode, source: string): void {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || node.value == null) return;
  node.value = restoreBackslashDelimiterEscapes(node.value, source.slice(start, end));
}

function allBackslashDelimiterPositions(source: string): Uint8Array {
  const positions = new Uint8Array(source.length);
  let slashRun = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      const next = source[index + 1];
      if (slashRun % 2 === 0 && (next === "(" || next === ")" || next === "[" || next === "]")) positions[index] = 1;
      slashRun += 1;
    } else {
      slashRun = 0;
    }
  }
  return positions;
}

function matchedBackslashDelimiterPositions(source: string): Uint8Array {
  const positions = new Uint8Array(source.length);
  let open: { kind: "inline" | "display"; start: number } | null = null;
  let slashRun = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\\") {
      slashRun = 0;
      continue;
    }

    const escaped = slashRun % 2 === 1;
    const next = source[index + 1];
    const kind = next === "(" || next === ")" ? "inline" : next === "[" || next === "]" ? "display" : null;
    if (!escaped && kind) {
      const isOpening = next === "(" || next === "[";
      if (isOpening && !open) open = { kind, start: index };
      else if (!isOpening && open?.kind === kind) {
        positions[open.start] = 1;
        positions[index] = 1;
        open = null;
      }
      index += 1;
      slashRun = 0;
      continue;
    }

    slashRun += 1;
  }

  return positions;
}

function restoreBackslashDelimiterEscapes(value: string, rawSource: string, matchedPairsOnly = false): string {
  const delimiterBackslashes = matchedPairsOnly
    ? matchedBackslashDelimiterPositions(rawSource)
    : allBackslashDelimiterPositions(rawSource);
  let result = "";
  let rawIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    const character = value[valueIndex];
    let matched = false;

    while (rawIndex < rawSource.length) {
      if (delimiterBackslashes[rawIndex] && rawSource[rawIndex + 1] === character) {
        result += `\\${character}`;
        rawIndex += 2;
        matched = true;
        break;
      }
      if (character === "\n" && rawSource[rawIndex] === "\r") {
        result += "\n";
        rawIndex += rawSource[rawIndex + 1] === "\n" ? 2 : 1;
        matched = true;
        break;
      }
      if (rawSource[rawIndex] === character) {
        result += character;
        rawIndex += 1;
        matched = true;
        break;
      }
      rawIndex += 1;
    }

    if (!matched) result += character;
  }

  return result;
}

function createLiteralMathNode(node: MarkdownNode, rawSource: string): MarkdownNode {
  return node.type === "math"
    ? createLiteralDisplayParagraph(rawSource, node.position)
    : { type: "text", value: rawSource, position: node.position };
}

function createLiteralDisplayParagraph(rawSource: string, position: MarkdownPosition | undefined): MarkdownNode {
  const lines = rawSource.split(/\r?\n|\r/);
  const children: MarkdownNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) children.push({ type: "break" });
    if (lines[index]) children.push({ type: "text", value: lines[index] });
  }
  return { type: "paragraph", children, position };
}

function countLeadingCharacter(value: string, character: string): number {
  let index = 0;
  while (value[index] === character) index += 1;
  return index;
}

function isSafeSingleDollarMath(rawSource: string, node: MarkdownNode, fullSource: string): boolean {
  const body = rawSource.slice(1, -1);
  if (!body || /^\s/.test(body) || /\s$/.test(body)) return false;

  const endOffset = node.position?.end?.offset;
  const nextCharacter = typeof endOffset === "number" ? fullSource[endOffset] : undefined;
  return !nextCharacter || !/\d/.test(nextCharacter);
}

function setInlineMathDisplayMode(node: MarkdownNode, display: boolean): void {
  const properties = node.data?.hProperties;
  if (!properties) return;

  const classes = Array.isArray(properties.className) ? properties.className.map(String) : [];
  properties.className = [
    ...classes.filter((className) => className !== "math-inline" && className !== "math-display"),
    display ? "math-display" : "math-inline",
  ];
}

function attachMathSource(node: MarkdownNode, rawSource: string): void {
  if (node.type === "inlineMath") {
    const properties = node.data?.hProperties;
    if (properties) properties["data-math-source"] = rawSource;
    return;
  }

  const codeElement = node.data?.hChildren?.find(
    (child): child is Extract<MarkdownHastChild, { type: "element" }> =>
      child.type === "element" && child.tagName === "code",
  );
  if (!codeElement) return;
  const properties = codeElement.properties || (codeElement.properties = {});
  properties["data-math-source"] = rawSource;
}

/** Final invariant: selected source-absent markers may never reach rendered DOM. */
export function rehypeRestorePreparedMathMarkers(prepared: PreparedMarkdownMathSource) {
  return (tree: HastRoot): void => {
    if (prepared.markers) restoreHastMarkers(tree, prepared.markers);
  };
}

function restoreHastMarkers(parent: HastParent, markers: MathSourceMarkers): void {
  for (const child of parent.children) {
    if (child.type === "text") {
      if (containsMathMarker(child.value, markers)) child.value = restorePreparedLiteral(child.value, markers);
      continue;
    }
    if (child.type !== "element") continue;

    for (const [name, value] of Object.entries(child.properties)) {
      if (typeof value === "string" && containsMathMarker(value, markers)) {
        child.properties[name] = restorePreparedLiteral(value, markers);
      }
    }
    restoreHastMarkers(child, markers);
  }
}

/** Wrap math output so copy/quote paths retain the exact original delimiters. */
export function rehypeWrapMathSource() {
  return (tree: HastRoot): void => {
    wrapMathChildren(tree);
  };
}

function wrapMathChildren(parent: HastParent): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child.type !== "element") continue;

    const scope = getMathScope(child);
    if (scope) {
      const source = readStringProperty(scope.code.properties, "data-math-source");
      if (source) {
        const wrapper: Element = {
          type: "element",
          tagName: "span",
          properties: {
            className: ["takode-math", scope.display ? "takode-math-display" : "takode-math-inline"],
            "data-math-source": source,
          },
          children: [child],
          position: child.position,
        };
        parent.children[index] = wrapper;
        continue;
      }
    }

    wrapMathChildren(child);
  }
}

function getMathScope(element: Element): { code: Element; display: boolean } | null {
  const directClasses = readClassNames(element.properties);
  if (element.tagName === "code" && isMathClasses(directClasses)) {
    return { code: element, display: directClasses.includes("math-display") };
  }

  if (element.tagName !== "pre") return null;
  const code = element.children.find(
    (child): child is Element =>
      child.type === "element" && child.tagName === "code" && isMathClasses(readClassNames(child.properties)),
  );
  if (!code) return null;
  return { code, display: true };
}

function isMathClasses(classes: string[]): boolean {
  return classes.includes("language-math") || classes.includes("math-inline") || classes.includes("math-display");
}

function readClassNames(properties: Element["properties"]): string[] {
  const className = properties.className;
  return Array.isArray(className) ? className.map(String) : [];
}

function readStringProperty(properties: Element["properties"], name: string): string | null {
  const value = properties[name];
  return typeof value === "string" ? value : null;
}

/** Replace KaTeX parse/limit failures with the exact readable source token. */
export function rehypeRestoreMathErrors() {
  return (tree: HastRoot): void => {
    restoreMathErrors(tree);
  };
}

function restoreMathErrors(parent: HastParent): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;

    const classes = readClassNames(child.properties);
    if (classes.includes("takode-math")) {
      const source = readStringProperty(child.properties, "data-math-source");
      if (source && hasMathRenderError(child)) {
        child.properties.className = [...classes, "takode-math-error"];
        child.children = [{ type: "text", value: source }];
        continue;
      }
    }

    restoreMathErrors(child);
  }
}

function hasMathRenderError(parent: HastParent, inheritedErrorColor = false): boolean {
  for (const child of parent.children) {
    if (child.type !== "element") continue;

    const classes = readClassNames(child.properties);
    if (classes.includes("katex-error")) return true;

    const errorColor = inheritedErrorColor || hasKatexErrorColor(child.properties);
    if (errorColor && child.tagName === "mtext" && hastTextContent(child).trimStart().startsWith("\\")) {
      return true;
    }
    if (hasMathRenderError(child, errorColor)) return true;
  }
  return false;
}

function hasKatexErrorColor(properties: Element["properties"]): boolean {
  const style = readStringProperty(properties, "style") ?? "";
  const mathColor = readStringProperty(properties, "mathColor") ?? readStringProperty(properties, "mathcolor") ?? "";
  return /(?:^|;)\s*color:\s*#cc0000(?:;|$)/i.test(style) || mathColor.toLowerCase() === "#cc0000";
}

function hastTextContent(parent: HastParent): string {
  let result = "";
  for (const child of parent.children) {
    result += child.type === "text" ? child.value : child.type === "element" ? hastTextContent(child) : "";
  }
  return result;
}

export const KATEX_RENDER_OPTIONS = {
  trust: false,
  strict: "warn" as const,
  output: "htmlAndMathml" as const,
  maxExpand: 1000,
  maxSize: 20,
};
