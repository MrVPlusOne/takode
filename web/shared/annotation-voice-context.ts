import { readConversationAnnotations, type ConversationAnnotation } from "./conversation-annotations.js";

export interface AnnotationVoiceContext {
  activeId: string;
  activeNumber?: number;
  selectedText: string;
  mainComposerText: string;
  otherAnnotations: (ConversationAnnotation & { number?: number })[];
}

/** Parse the dedicated reference input without normalizing its text. */
export function readAnnotationVoiceContext(value: unknown): AnnotationVoiceContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid annotation voice context.");
  const context = value as Record<string, unknown>;
  if (
    typeof context.activeId !== "string" ||
    typeof context.selectedText !== "string" ||
    typeof context.mainComposerText !== "string"
  )
    throw new Error("Invalid annotation voice context.");
  return {
    activeId: context.activeId,
    activeNumber: readReferenceNumber(context.activeNumber),
    selectedText: context.selectedText,
    mainComposerText: context.mainComposerText,
    otherAnnotations: readConversationAnnotations(context.otherAnnotations).map((annotation, index) => ({
      ...annotation,
      number: readReferenceNumber((context.otherAnnotations as Record<string, unknown>[])[index].number),
    })),
  };
}

function readReferenceNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new Error("Invalid annotation number.");
}

/**
 * The comment's read-only context for voice input, as tagged text blocks: the passage the comment is on,
 * the main message draft and the other comments. Long texts are cut in the middle so the whole fits
 * `maxChars`; the last other comments are dropped only when even their labels do not fit.
 * The comment being written is not included: the prompts carry it whole. Saved annotations are never modified.
 */
export function buildAnnotationVoiceReference(context: AnnotationVoiceContext, maxChars = 9000) {
  let retained = context.otherAnnotations.length;
  const render = (limit: number) => {
    let shortened = retained < context.otherAnnotations.length;
    const excerpt = (text: string, weight = 1) => {
      const keep = limit * weight;
      if (text.length <= keep) return text;
      shortened = true;
      const head = Math.ceil(keep / 2);
      return `${text.slice(0, head)}\n[${text.length - keep} characters omitted from voice context]\n${keep - head ? text.slice(-(keep - head)) : ""}`;
    };
    const number = context.activeNumber ? ` comment="${context.activeNumber}"` : "";
    const blocks = [`<COMMENTED_TEXT${number}>\n${excerpt(context.selectedText, 4)}\n</COMMENTED_TEXT>`];
    if (context.mainComposerText.trim())
      blocks.push(`<MAIN_COMPOSER_TEXT>\n${excerpt(context.mainComposerText, 3)}\n</MAIN_COMPOSER_TEXT>`);
    const others = context.otherAnnotations
      .slice(0, retained)
      .map(
        (annotation, index) =>
          `Comment ${annotation.number ?? index + 1} on "${excerpt(annotation.selectedText)}":\n${excerpt(annotation.comment)}`,
      );
    const omitted = context.otherAnnotations.length - retained;
    if (omitted) others.push(`(${omitted} more comments omitted)`);
    if (others.length) blocks.push(`<OTHER_COMMENTS>\n${others.join("\n\n")}\n</OTHER_COMMENTS>`);
    return { text: blocks.join("\n\n"), shortened };
  };
  // Every iteration removes an optional comment, so even label-heavy inputs terminate.
  while (retained > 0 && render(0).text.length > maxChars) retained--;
  let low = 0;
  let high = maxChars;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (render(middle).text.length <= maxChars) low = middle;
    else high = middle - 1;
  }
  return render(low);
}
