/**
 * The guided review the demo's last chapter opens: the change for "Search ignores accents", as
 * the leader would publish it. The map and the diff are prepared by the same shared code the
 * server uses when publishing a review, so the review page shows it exactly as a real one.
 */
import type { ArtifactDetail, ArtifactVersionContent } from "../../shared/artifact-library.js";
import {
  formatGuidedReviewMarkdown,
  parseGuidedReviewDiff,
  prepareGuidedReview,
  type GuidedReviewMap,
  type GuidedReviewMeta,
} from "../../shared/guided-review.js";

export const ACCENT_REVIEW_ARTIFACT_ID = "5ea2c4e1-7d1b-4c1a-9a4e-2f0d3c8b6a71";
export const ACCENT_REVIEW_ID = "4b8e1f6a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

/** The change, as `git diff` prints it. */
export const ACCENT_REVIEW_DIFF = `diff --git a/src/search/normalize.ts b/src/search/normalize.ts
new file mode 100644
index 0000000..3f2a9c1
--- /dev/null
+++ b/src/search/normalize.ts
@@ -0,0 +1,17 @@
+/**
+ * Folds text for matching: lowercase, with accents removed, so "Café" and
+ * "cafe" compare equal. Letters that are letters of their own, such as "ß"
+ * and "ø", are kept as they are.
+ */
+export function searchKey(text: string): string {
+  return text
+    .normalize("NFD")
+    .replace(/\\p{Diacritic}/gu, "")
+    .toLowerCase();
+}
+
+/** Whether \`text\` contains \`query\`, both folded the same way. */
+export function containsFolded(text: string, query: string): boolean {
+  const folded = searchKey(query).trim();
+  return folded === "" || searchKey(text).includes(folded);
+}
diff --git a/src/search/filter.ts b/src/search/filter.ts
index 8c41d02..b7e3a55 100644
--- a/src/search/filter.ts
+++ b/src/search/filter.ts
@@ -1,6 +1,6 @@
 import type { Transaction } from "../ledger";
+import { containsFolded } from "./normalize";
 
 export function matchesQuery(t: Transaction, query: string): boolean {
-  const q = query.toLowerCase();
-  return t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
+  return containsFolded(t.description, query) || containsFolded(t.category, query);
 }
diff --git a/test/search.test.ts b/test/search.test.ts
new file mode 100644
index 0000000..d91e2b7
--- /dev/null
+++ b/test/search.test.ts
@@ -0,0 +1,13 @@
+import { expect, test } from "bun:test";
+import { matchesQuery } from "../src/search/filter";
+
+const cafe = { description: "Café Lumière", category: "Eating out" } as never;
+
+test("search ignores accents", () => {
+  expect(matchesQuery(cafe, "cafe")).toBe(true);
+  expect(matchesQuery(cafe, "CAFÉ")).toBe(true);
+});
+
+test("a different word still doesn't match", () => {
+  expect(matchesQuery(cafe, "cake")).toBe(false);
+});
`;

const MAP: GuidedReviewMap = {
  title: "Search ignores accents",
  overview:
    'Search now matches words whatever their accents: "cafe" finds "Café Lumière", and "CAFÉ" does too. One small helper folds text for matching, and search uses it on both the query and the transactions. This is the change from [q-25](quest:q-25).\n\n' +
    "**What the review found.** The change does what the tester asked, and all 41 tests pass. It leaves you one question: letters that are separate letters rather than accented ones still don't match.",
  stops: [
    {
      tier: "decide",
      title: "Letters that look alike but aren't accents",
      note: 'The helper removes accents, so "Café" matches "cafe" and "Zürich" matches "zurich". Letters that are letters of their own still don\'t match: "ß" doesn\'t match "ss", and "ø" doesn\'t match "o". Banks spell some merchants both ways ("Straße" and "Strasse"). Matching those too is a small change to this one function.',
      code: [{ path: "src/search/normalize.ts", lines: [1, 17] }],
      question: "Should search also match ß with ss and ø with o?",
      answers: ["Keep as is", "Match those too", "Talk it through"],
    },
    {
      tier: "check",
      title: "Both sides are folded the same way",
      note: 'The query and the transaction text go through the same helper, so typing an accent ("café") still finds a plain "cafe", and the category filter matches the same way.',
      code: [{ path: "src/search/filter.ts", lines: [5, 5] }],
    },
    {
      tier: "checked",
      title: "Tests",
      note: 'Two new tests: an accented and a capitalized query both find "Café Lumière", and a different word still doesn\'t match. All 41 tests pass at this commit.',
      code: [{ path: "test/search.test.ts", lines: [1, 13] }],
    },
  ],
  summaries: [
    {
      title: "Using the helper",
      text: "The search filter imports the new helpers.",
      paths: ["src/search/filter.ts"],
    },
  ],
};

/** The review as the server publishes it: stops carry their code and summaries their files. */
export function accentReview(publishedAt: number, leaderId: string, threadKey: string) {
  const files = parseGuidedReviewDiff(ACCENT_REVIEW_DIFF);
  const prepared = prepareGuidedReview(MAP, files);
  const meta: GuidedReviewMeta = {
    reviewId: ACCENT_REVIEW_ID,
    map: prepared.map,
    range: {
      repo: "pocket-ledger",
      base: "3e1c9a7f0b2d4c6e8a0b1c2d3e4f5a6b7c8d9e0f",
      head: "9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c",
      commits: [{ sha: "9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c", subject: "fix: search ignores accents" }],
    },
    stats: prepared.stats,
  };
  const markdown = formatGuidedReviewMarkdown(meta);
  const source = { sessionId: leaderId, messageId: `review-${ACCENT_REVIEW_ID}`, threadKey, at: publishedAt };
  const version = { n: 1, at: publishedAt, bytes: markdown.length, kept: true, source };
  const detail: ArtifactDetail = {
    id: ACCENT_REVIEW_ARTIFACT_ID,
    kind: "review",
    title: MAP.title,
    space: "Pocket Ledger",
    sessionId: leaderId,
    threadKey,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    starred: false,
    versionCount: 1,
    latest: version,
    preview: markdown.slice(0, 240),
    excerpt: markdown.slice(0, 600),
    versions: [version],
  };
  const content: ArtifactVersionContent = {
    kind: "review",
    markdown,
    review: { messageId: source.messageId, sessionId: leaderId, threadKey, questId: "q-25", meta },
  };
  return { problems: prepared.problems, detail, content, files };
}
