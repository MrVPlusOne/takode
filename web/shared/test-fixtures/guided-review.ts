import {
  checkGuidedReviewCoverage,
  formatGuidedReviewMarkdown,
  parseGuidedReviewDiff,
  withGuidedReviewSnippets,
  type GuidedReviewMap,
  type GuidedReviewMeta,
} from "../guided-review.js";
import type { MarkdownReportMessage } from "../markdown-report.js";

/**
 * A synthetic two-commit change (no copied user code): a new retry helper, a modified client that
 * uses it, and its test. Line numbers in the map below match this diff exactly.
 */
export const GUIDED_REVIEW_FIXTURE_DIFF = `diff --git a/src/retry.ts b/src/retry.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/retry.ts
@@ -0,0 +1,13 @@
+/** Retry a request until it succeeds, waiting longer each time. */
+export async function withRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
+  let lastError: unknown;
+  for (let attempt = 0; attempt < attempts; attempt++) {
+    try {
+      return await run();
+    } catch (error) {
+      lastError = error;
+      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
+    }
+  }
+  throw lastError;
+}
diff --git a/src/client.ts b/src/client.ts
index 2222222..3333333 100644
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,8 +1,10 @@
 import { fetchJson } from "./http.js";
+import { withRetry } from "./retry.js";
 
 export async function loadProfile(id: string) {
-  const profile = await fetchJson(\`/profiles/\${id}\`);
+  const profile = await withRetry(() => fetchJson(\`/profiles/\${id}\`));
+  // Cached for a day: profiles rarely change.
+  profileCache.set(id, profile, { ttlMs: 86_400_000 });
   return profile;
 }
-
-export const PROFILE_TIMEOUT_MS = 5_000;
+export const PROFILE_TIMEOUT_MS = 15_000;
diff --git a/src/retry.test.ts b/src/retry.test.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/src/retry.test.ts
@@ -0,0 +1,6 @@
+import { expect, it } from "vitest";
+import { withRetry } from "./retry.js";
+
+it("returns the first success", async () => {
+  expect(await withRetry(async () => 7)).toBe(7);
+});
`;

export const GUIDED_REVIEW_FIXTURE_MAP: GuidedReviewMap = {
  title: "Retry profile loads and cache profiles",
  overview:
    "Adds a **retry helper** and uses it for profile loads, caches profiles for a day and triples the timeout. Tests pass. **2 things need your decision**, 1 is worth a careful look, the rest is summarized.",
  stops: [
    {
      tier: "decide",
      title: "Up to 4 attempts with growing waits",
      note: "A failing profile load now takes up to 3.5 s of waiting before it fails, and retries every error, including 404s.",
      question: "Retry every error up to 4 times?",
      answers: ["Keep", "Only network errors", "Ask me"],
      code: [{ path: "src/retry.ts", lines: [2, 13] }],
    },
    {
      tier: "decide",
      title: "Profiles cached for a day",
      note: "Profile edits can take up to a day to show. Nothing clears the cache on edit.",
      question: "Cache profiles for a day?",
      answers: ["Keep a day", "One hour", "No cache"],
      code: [{ path: "src/client.ts", lines: [5, 7] }],
    },
    {
      tier: "check",
      title: "Timeout tripled to 15 seconds",
      note: "Combined with retries, a dead server now holds a profile load for about a minute.",
      code: [{ path: "src/client.ts", lines: [10, 10] }],
    },
    {
      tier: "checked",
      title: "The helper's comment",
      note: "Matches what the code does.",
      code: [{ path: "src/retry.ts", lines: [1, 1] }],
    },
  ],
  summaries: [
    { title: "Import", text: "The client imports the helper.", paths: ["src/client.ts"] },
    {
      title: "Tests",
      text: "One test for the first success. Not covered: retries and waits.",
      paths: ["src/retry.test.ts"],
    },
  ],
};

/** The review as published: its map, range and counts, computed from the fixture diff. */
export function makeGuidedReviewMetaFixture(): GuidedReviewMeta {
  const files = parseGuidedReviewDiff(GUIDED_REVIEW_FIXTURE_DIFF);
  const { stats } = checkGuidedReviewCoverage(GUIDED_REVIEW_FIXTURE_MAP, files);
  return {
    reviewId: "review-fixture",
    map: withGuidedReviewSnippets(GUIDED_REVIEW_FIXTURE_MAP, files),
    range: {
      repo: "profiles",
      base: "a".repeat(40),
      head: "b".repeat(40),
      commits: [
        { sha: "c".repeat(40), subject: "feat(client): retry profile loads" },
        { sha: "b".repeat(40), subject: "feat(client): cache profiles for a day" },
      ],
      repoPaths: ["/repos/profiles"],
    },
    stats,
  };
}

/** The report message a published fixture review appears as. */
export function makeGuidedReviewReportFixture(): MarkdownReportMessage {
  const meta = makeGuidedReviewMetaFixture();
  return {
    type: "markdown_report",
    id: "guided-review-report",
    timestamp: 1791000000000,
    threadKey: "q-42",
    questId: "q-42",
    content: formatGuidedReviewMarkdown(meta),
    source: {
      sessionId: "review-host",
      reportId: "guided-review-report",
      sourcePath: "/tmp/review-map.json",
      sha256: "d".repeat(64),
    },
    guidedReview: meta,
  };
}
