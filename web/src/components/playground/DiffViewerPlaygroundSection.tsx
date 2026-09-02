import { DiffStatsSummary, DiffTotalStats } from "../DiffStatsSummary.js";
import { DiffViewer } from "../DiffViewer.js";
import { Card, Section } from "./shared.js";

export function PlaygroundDiffViewerSection() {
  return (
    <>
      {/* ─── Diff Viewer ──────────────────────────────── */}
      <Section
        title="Diff Viewer"
        description="Code-first multi-file rendering, split statistics, word-level highlighting, sticky headers, and source-backed expansion"
      >
        <div className="space-y-4 max-w-3xl">
          <Card label="Edit diff (compact mode)">
            <DiffViewer
              oldText={"export function formatDate(d: Date) {\n  return d.toISOString();\n}"}
              newText={
                'export function formatDate(d: Date, locale = "en-US") {\n  return d.toLocaleDateString(locale, {\n    year: "numeric",\n    month: "short",\n    day: "numeric",\n  });\n}'
              }
              fileName="src/utils/format.ts"
              mode="compact"
            />
          </Card>
          <Card label="New file diff (compact mode)">
            <DiffViewer
              newText={
                'export const config = {\n  apiUrl: "https://api.example.com",\n  timeout: 5000,\n  retries: 3,\n  debug: process.env.NODE_ENV !== "production",\n};\n'
              }
              fileName="src/config.ts"
              mode="compact"
            />
          </Card>
          <Card label="Git diff (full mode with line numbers)">
            <DiffViewer
              unifiedDiff={`diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -1,8 +1,12 @@
-import { getSession } from "./session";
+import { verifyToken } from "./jwt";
+import type { Request, Response, NextFunction } from "express";

-export function authMiddleware(req, res, next) {
-  const session = getSession(req);
-  if (!session?.userId) {
+export function authMiddleware(req: Request, res: Response, next: NextFunction) {
+  const header = req.headers.authorization;
+  if (!header?.startsWith("Bearer ")) {
     return res.status(401).json({ error: "Unauthorized" });
   }
-  req.userId = session.userId;
+  const token = header.slice(7);
+  const payload = verifyToken(token);
+  if (!payload) return res.status(401).json({ error: "Invalid token" });
+  req.userId = payload.userId;
   next();
 }`}
              mode="full"
            />
          </Card>
          <Card label="Sticky collapsible file headers">
            <div className="max-h-64 overflow-auto">
              <DiffViewer
                unifiedDiff={`diff --git a/src/routes/long-handler.ts b/src/routes/long-handler.ts
--- a/src/routes/long-handler.ts
+++ b/src/routes/long-handler.ts
@@ -1,8 +1,10 @@
 import { Router } from "express";
 const router = Router();

-router.get("/sessions/:id/diff", async (req, res) => loadDiff(req.params.id).then(res.json));
+router.get("/sessions/:id/diff", async (req, res) => {
+  const diff = await loadDiff(req.params.id, { includeContents: true, preserveWhitespace: true, expandRenames: true });
+  const longLineProbe = "session-diff-horizontal-scroll-" + "${"segment-".repeat(18)}" + "END";
+  res.json(diff);
+});
 export default router;
diff --git a/src/routes/summary.ts b/src/routes/summary.ts
--- a/src/routes/summary.ts
+++ b/src/routes/summary.ts
@@ -1,4 +1,5 @@
 export function summarize(files: string[]) {
-  return files.join(", ");
+  return files.map((file) => file.replace(process.cwd(), ".")).join(", ");
 }
+export const summaryVersion = 2;`}
                mode="full"
                showLineNumbers
                stickyFileHeaders
                collapsibleFiles
              />
            </div>
          </Card>
          <Card label="Code commit modal: code first with split stats">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <DiffTotalStats
                stats={{ additions: 3, deletions: 1 }}
                verbose
                className="gap-3"
                testId="playground-quest-commit-diff-stats-overall"
              />
              <DiffStatsSummary
                splitStats={{
                  code: { additions: 2, deletions: 1 },
                  tests: { additions: 1, deletions: 0 },
                }}
                testId="playground-quest-commit-diff-stats"
              />
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="playground-code-only-stats">
              <span className="text-[10px] text-cc-muted">Code-only grouped statistics</span>
              <DiffStatsSummary
                splitStats={{
                  code: { additions: 7, deletions: 0 },
                  tests: { additions: 0, deletions: 0 },
                }}
                testId="playground-code-only-diff-stats"
              />
            </div>
            <div
              data-testid="playground-quest-commit-diff-slot"
              className="quest-commit-diff-scroll h-64 min-h-0 overflow-auto bg-cc-bg/40 px-4 pb-4 pt-0"
            >
              <div className="quest-commit-diff-content flex flex-col gap-3">
                <DiffViewer
                  unifiedDiff={`diff --git a/web/server/quest-cli-memory-commit-flags.test.ts b/web/server/quest-cli-memory-commit-flags.test.ts
--- a/web/server/quest-cli-memory-commit-flags.test.ts
+++ b/web/server/quest-cli-memory-commit-flags.test.ts
@@ -48,3 +48,4 @@ function readJson(req: IncomingMessage): Promise<JsonObject> {
   return new Promise((resolve) => {
+    const chunks: string[] = [];
     req.on("end", resolve);
   });
diff --git a/web/server/quest-cli-memory-commit-flags.ts b/web/server/quest-cli-memory-commit-flags.ts
--- a/web/server/quest-cli-memory-commit-flags.ts
+++ b/web/server/quest-cli-memory-commit-flags.ts
@@ -18,3 +18,4 @@ export function parseFlags(args: string[]) {
-  return parseArgs(args);
+  const parsed = parseArgs(args);
+  return validateFlags(parsed);
 }`}
                  mode="full"
                  showLineNumbers
                  stickyFileHeaders
                  collapsibleFiles
                />
              </div>
            </div>
          </Card>
          <Card label="Code commit modal loading footprint">
            <div
              data-testid="playground-quest-commit-loading-slot"
              className="quest-commit-diff-scroll h-64 min-h-0 overflow-auto bg-cc-bg/40 px-4 pb-4 pt-0"
            >
              <div className="flex h-full min-h-48 items-center justify-center text-sm text-cc-muted">
                Loading commit diff...
              </div>
            </div>
          </Card>
          <Card label="Unified diff with expandable gap between hunks">
            <DiffViewer
              unifiedDiff={`diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,5 +1,5 @@
 export const config = {
-  apiUrl: "https://api.example.com",
+  apiUrl: "https://api.v2.example.com",
   timeout: 5000,
   retries: 3,
   debug: false,
@@ -25,5 +25,5 @@
 export function getHeaders() {
   return {
-    "Content-Type": "application/json",
+    "Content-Type": "application/json; charset=utf-8",
     Authorization: getAuthToken(),
   };`}
              mode="full"
            />
          </Card>
          <Card label="No changes">
            <DiffViewer oldText="same content" newText="same content" />
          </Card>
        </div>
      </Section>
    </>
  );
}
