/** Maximum UTF-8 source size; reports are rejected whole, never shortened. */
export const MAX_MARKDOWN_REPORT_BYTES = 2 * 1024 * 1024;

export interface MarkdownReportSource {
  sessionId: string;
  reportId: string;
  sourcePath: string;
  sha256: string;
  responsibleWorkerId?: string;
  responsibleWorkerLabel?: string;
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
