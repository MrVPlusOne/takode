import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_MARKDOWN_REPORT_BYTES, validateMarkdownReportContent } from "../shared/markdown-report.js";

/** Read once from an open file descriptor, bounding bytes before decoding or uploading. */
export async function readMarkdownReportFile(path: string): Promise<{ sourcePath: string; content: string }> {
  const sourcePath = resolve(path);
  const file = await open(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error("The report source must be a regular file.");
    const buffer = Buffer.alloc(MAX_MARKDOWN_REPORT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_MARKDOWN_REPORT_BYTES) throw new Error("Markdown report exceeds 2 MiB; nothing was published.");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
    validateMarkdownReportContent(content);
    return { sourcePath, content };
  } finally {
    await file.close();
  }
}
