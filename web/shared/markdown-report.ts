/** Maximum UTF-8 source size; reports are rejected whole, never shortened. */
export const MAX_MARKDOWN_REPORT_BYTES = 2 * 1024 * 1024;

export interface MarkdownReportSource {
  sessionId: string;
  reportId: string;
  sourcePath: string;
  sha256: string;
  /** Worker whose session context resolves the report's Takode `file:` links. */
  responsibleWorkerId?: string;
}

/** An immutable publication, independent of provider turns and answer coverage. */
export interface MarkdownReportMessage {
  type: "markdown_report";
  id: string;
  timestamp: number;
  content: string;
  source: MarkdownReportSource;
  threadKey: string;
  questId?: string;
  /** Present when the report is a guided review; `content` is then its Markdown version. */
  guidedReview?: import("./guided-review.js").GuidedReviewMeta;
  /** The library artifact this report is, added when sent to browsers. */
  artifacts?: import("./artifact-library.js").ArtifactMessageMarker[];
}

export function validateMarkdownReportContent(content: unknown): asserts content is string {
  if (typeof content !== "string" || !content.trim() || content.includes("\0")) {
    throw new Error("A report must contain non-empty UTF-8 Markdown text.");
  }
  if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(content)) !== content) {
    throw new Error("A report must contain valid UTF-8 text.");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_MARKDOWN_REPORT_BYTES) {
    throw new Error("Markdown report exceeds 2 MiB; nothing was published.");
  }
}
