import { formatDraftPost } from "../draft-posts.js";
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

/** A synthetic two-part Slack draft a leader shared into a quest thread from worker #7. */
export function makeSharedDraftFixture(): MarkdownReportMessage {
  return {
    type: "markdown_report",
    id: "shared-draft-fixture",
    timestamp: 1791000000000,
    threadKey: "q-42",
    questId: "q-42",
    source: {
      sessionId: "report-host",
      reportId: "shared-draft-fixture",
      sourcePath: "Cache rollout update",
      sha256: "b".repeat(64),
    },
    sharedDraft: { artifactId: "artifact-draft", version: 3, sessionId: "draft-worker", sessionNum: 7 },
    content: formatDraftPost({
      title: "Cache rollout update",
      parts: ["Quick update: the profile cache is **on** for all regions.", "Hit rate settled at 92% after a day."],
      destination: { url: "https://example.slack.com/archives/C1/p1", label: "#cache-rollout thread" },
    }),
  };
}
