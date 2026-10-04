import { apiPost } from "./takode-core.js";
import { readMarkdownReportFile } from "./markdown-report-file.js";

export const REPORT_HELP = `Usage: takode report <markdown-file> --thread <main|q-N> [--worker <session>] [--json]

Read an exact local Markdown file under your existing permissions and publish a frozen,
annotatable copy into your own session. The original file and its links are not rewritten.
Files above 2 MiB, invalid UTF-8, and empty files are rejected, never truncated.
--worker records an eligible responsible worker for explicit human follow-up routing.
The receipt contains identity and size only; use takode read for saved content.
`;

export async function handleReport(base: string, args: string[]): Promise<void> {
  let path: string | undefined;
  let threadKey: string | undefined;
  let responsibleWorkerId: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--thread" || arg === "--worker") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--thread") threadKey = value;
      else responsibleWorkerId = value;
    } else if (!arg.startsWith("--") && !path) path = arg;
    else throw new Error(REPORT_HELP);
  }
  if (!path || !threadKey) throw new Error(REPORT_HELP);
  const source = await readMarkdownReportFile(path);
  const receipt = (await apiPost(base, "/takode/reports", {
    ...source,
    threadKey,
    ...(responsibleWorkerId ? { responsibleWorkerId } : {}),
  })) as { reportId: string; sessionId: string; threadKey: string; bytes: number; sha256: string };
  console.log(
    json
      ? JSON.stringify(receipt)
      : `Published report ${receipt.reportId} to ${receipt.threadKey} (${receipt.bytes} bytes). SHA-256 ${receipt.sha256}`,
  );
}
