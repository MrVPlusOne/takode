import type { MarkdownReportMessage } from "../markdown-report.js";

/** Synthetic source-linked daily report; no copied user or company data. */
export function makeMarkdownReportFixture(): MarkdownReportMessage {
  return {
    type: "markdown_report",
    id: "report-fixture",
    timestamp: 1791000000000,
    threadKey: "q-42",
    questId: "q-42",
    source: {
      sessionId: "report-host",
      reportId: "report-fixture",
      sourcePath: "/project/reports/daily.md",
      sha256: "a".repeat(64),
      responsibleWorkerId: "report-worker",
      responsibleWorkerLabel: "Report worker",
    },
    content:
      "# Daily engineering report\n\nComplete source-linked findings.\n\n" +
      Array.from(
        { length: 35 },
        (_, i) =>
          `## Finding ${i + 1}\n\nThe cache expires after **one hour**. Follow-up ${i + 1} remains open.\n\n- Evidence: [source ${i + 1}](https://example.com/updates/${i + 1})\n- Context: [discussion](quest:q-42) and [module](file:src/cache.ts:12)\n\n| Check | Result |\n| --- | --- |\n| Review | Pending |\n`,
      ).join("\n") +
      "\nFinal source detail retained.\n",
  };
}
