import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";

const SCOPE = '[data-chat-selection-scope="true"]';

/** Capture the selected occurrence, including when the same words appear repeatedly in a message. */
export function captureAnnotationSource(
  range: Range | null,
): Pick<ConversationAnnotation, "sourceMessageId" | "sourceAnchor"> {
  if (!range) return {};
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const message = element?.closest<HTMLElement>("[data-message-id]");
  if (!message) return {};
  const sourceMessageId = message.dataset.messageId;
  const scopes = Array.from(message.querySelectorAll<HTMLElement>(SCOPE));
  const scopeIndex = scopes.findIndex(
    (scope) => scope.contains(range.startContainer) && scope.contains(range.endContainer),
  );
  if (scopeIndex < 0) return { sourceMessageId };
  const prefix = document.createRange();
  prefix.selectNodeContents(scopes[scopeIndex]);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  return { sourceMessageId, ...(text ? { sourceAnchor: { scopeIndex, start, end: start + text.length, text } } : {}) };
}

/** Resolve only a verified occurrence; old annotations without offsets require a unique literal match. */
export function resolveAnnotationRange(root: HTMLElement, annotation: ConversationAnnotation): Range | null {
  const scopes = Array.from(root.querySelectorAll<HTMLElement>(SCOPE));
  const anchor = annotation.sourceAnchor;
  if (anchor) {
    const scope = scopes[anchor.scopeIndex];
    if (!scope || scope.textContent?.slice(anchor.start, anchor.end) !== anchor.text) return null;
    return textRange(scope, anchor.start, anchor.end);
  }
  let match: Range | null = null;
  for (const scope of scopes) {
    const text = scope.textContent ?? "";
    const start = text.indexOf(annotation.selectedText);
    if (start < 0) continue;
    if (match || text.indexOf(annotation.selectedText, start + 1) >= 0) return null;
    match = textRange(scope, start, start + annotation.selectedText.length);
  }
  return match;
}

export interface PassageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Measure selected text only: element rectangles can duplicate descendants or span whole blocks. */
export function annotationPassageRects(range: Range): PassageRect[] {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: PassageRect[] = [];
  for (let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent!.length);
    if (!part.collapsed) rects.push(...Array.from(part.getClientRects?.() ?? []));
  }
  return mergePassageRects(rects);
}

/** Join adjoining inline fragments on one visual line, preserving gaps between columns and lines. */
export function mergePassageRects(rects: readonly PassageRect[]): PassageRect[] {
  const lines: { top: number; bottom: number; rects: PassageRect[] }[] = [];
  for (const rect of [...rects].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top)) {
    const bottom = rect.top + rect.height;
    const line = lines.find(
      (candidate) =>
        Math.min(candidate.bottom, bottom) - Math.max(candidate.top, rect.top) >=
        Math.min(candidate.bottom - candidate.top, rect.height) * 0.6,
    );
    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, bottom);
      line.rects.push(rect);
    } else lines.push({ top: rect.top, bottom, rects: [rect] });
  }
  return lines.flatMap((line) => {
    const merged: PassageRect[] = [];
    for (const rect of line.rects.sort((a, b) => a.left - b.left)) {
      const previous = merged.at(-1);
      if (previous && rect.left <= previous.left + previous.width + 1) {
        previous.width = Math.max(previous.left + previous.width, rect.left + rect.width) - previous.left;
      } else merged.push({ left: rect.left, top: line.top, width: rect.width, height: line.bottom - line.top });
    }
    return merged;
  });
}

/** One filled path paints overlapping ranges once, without internal outlines or darker intersections. */
export function annotationHighlightPath(rects: readonly PassageRect[]): string {
  return rects.map((r) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join(" ");
}

function textRange(scope: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}
