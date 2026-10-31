/**
 * A saved user comment paired with the exact text selected from a conversation. The comment is
 * empty for a passage taken along without one (Ask in new thread): the message asks about it.
 */
export interface ConversationAnnotation {
  id: string;
  selectedText: string;
  comment: string;
  sourceMessageId?: string;
  reportSource?: import("./markdown-report.js").MarkdownReportSource;
  /** The slide of a slide deck the comment is on. */
  slide?: AnnotationSlide;
  /** Rendered-text offsets within one source Markdown scope; text verifies the anchor after remounts. */
  sourceAnchor?: { scopeIndex: number; start: number; end: number; text: string };
}

/** A comment's slide: its number (from 1) and title, and whether it is on the whole slide rather than a passage. */
export interface AnnotationSlide {
  number: number;
  title: string;
  /** Set when the comment is on the slide as a whole; `selectedText` then just names the slide. */
  whole?: boolean;
}

/** The original composer payload when annotations accompany a question answer. */
export interface AnnotationMessage {
  content: string;
  annotations: ConversationAnnotation[];
}

export function readAnnotationMessage(value: unknown): AnnotationMessage | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || typeof (value as AnnotationMessage).content !== "string") {
    throw new Error("Invalid annotated answer.");
  }
  const message = value as AnnotationMessage;
  return { content: message.content, annotations: readConversationAnnotations(message.annotations) };
}

/** Validate attachment structure without changing the user's quotation or comment. */
export function readConversationAnnotations(value: unknown): ConversationAnnotation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Annotations must be an array.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.selectedText !== "string" ||
      !entry.selectedText.trim() ||
      typeof entry.comment !== "string" ||
      (entry.sourceMessageId !== undefined && typeof entry.sourceMessageId !== "string")
    )
      throw new Error("Each annotation needs a unique ID, selected text, and a comment string.");
    ids.add(entry.id);
    const anchor = entry.sourceAnchor;
    const report = entry.reportSource;
    if (
      report !== undefined &&
      (!report ||
        typeof report.sessionId !== "string" ||
        typeof report.reportId !== "string" ||
        typeof report.sourcePath !== "string" ||
        typeof report.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(report.sha256) ||
        (report.responsibleWorkerId !== undefined && typeof report.responsibleWorkerId !== "string"))
    ) {
      throw new Error("Invalid report source.");
    }
    const slide = entry.slide;
    if (
      slide !== undefined &&
      (!slide ||
        !Number.isSafeInteger(slide.number) ||
        slide.number < 1 ||
        typeof slide.title !== "string" ||
        (slide.whole !== undefined && typeof slide.whole !== "boolean"))
    ) {
      throw new Error("Invalid annotation slide.");
    }
    if (
      anchor !== undefined &&
      (!anchor ||
        !Number.isSafeInteger(anchor.scopeIndex) ||
        anchor.scopeIndex < 0 ||
        !Number.isSafeInteger(anchor.start) ||
        anchor.start < 0 ||
        !Number.isSafeInteger(anchor.end) ||
        anchor.end <= anchor.start ||
        typeof anchor.text !== "string" ||
        anchor.text.length !== anchor.end - anchor.start)
    )
      throw new Error("Invalid annotation source anchor.");
    return {
      id: entry.id,
      selectedText: entry.selectedText,
      comment: entry.comment,
      ...(report
        ? {
            reportSource: {
              sessionId: report.sessionId,
              reportId: report.reportId,
              sourcePath: report.sourcePath,
              sha256: report.sha256,
              ...(report.responsibleWorkerId ? { responsibleWorkerId: report.responsibleWorkerId } : {}),
            },
          }
        : {}),
      ...(slide
        ? { slide: { number: slide.number, title: slide.title, ...(slide.whole ? { whole: true } : {}) } }
        : {}),
      ...(entry.sourceMessageId !== undefined ? { sourceMessageId: entry.sourceMessageId } : {}),
      ...(anchor
        ? { sourceAnchor: { scopeIndex: anchor.scopeIndex, start: anchor.start, end: anchor.end, text: anchor.text } }
        : {}),
    };
  });
}

/**
 * Format the agent-facing user message; attachment identity stays in structured metadata.
 * Report comments name only the report's source file, which is what the agent can open, and
 * only once per run of consecutive comments on the same report (and slide, for a deck); report
 * and session IDs and the digest stay in `reportSource`. A comment on a whole slide quotes nothing.
 */
export function formatAnnotatedMessage(content: string, annotations?: readonly ConversationAnnotation[]): string {
  if (!annotations?.length) return content;
  const comments = annotations
    .map((annotation, index) => {
      const target = annotationTarget(annotation);
      const header =
        target && target.key !== annotationTarget(annotations[index - 1])?.key ? `On ${target.text}:\n` : "";
      const quote = annotation.slide?.whole
        ? ""
        : annotation.selectedText
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n") + "\n";
      // A passage taken along without a comment is just quoted; the message says what to do with it.
      return annotation.comment.trim()
        ? `${header}${quote}[comment ${index + 1}] ${annotation.comment}`
        : `${header}${quote}`.trimEnd();
    })
    .join("\n\n");
  return content.trim() ? `${comments}\n\n---\n${content}` : comments;
}

/** What a comment is on, as the agent reads it (a report, or one slide of a deck), and a key telling targets apart. */
function annotationTarget(annotation: ConversationAnnotation | undefined): { text: string; key: string } | null {
  const report = annotation?.reportSource;
  if (!report) return null;
  const slide = annotation.slide;
  return {
    text: slide
      ? `slide ${slide.number}${slide.title ? ` ("${slide.title}")` : ""} of report ${report.sourcePath}`
      : `report ${report.sourcePath}`,
    key: JSON.stringify([report.sessionId, report.reportId, slide?.number]),
  };
}
