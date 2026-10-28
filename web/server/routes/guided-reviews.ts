import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isAbsolute } from "node:path";
import {
  MAX_GUIDED_REVIEW_DIFF_BYTES,
  formatGuidedReviewMarkdown,
  parseGuidedReviewDiff,
  parseGuidedReviewMapInput,
  prepareGuidedReview,
  type GuidedReviewMeta,
  type GuidedReviewRange,
} from "../../shared/guided-review.js";
import { onMachine } from "../remote-host/host-operations.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { publishSessionReport } from "./markdown-reports.js";
import type { RouteContext } from "./context.js";

const MAX_COMMITS = 500;
const MAX_REPO_PATHS = 3;
/** The same cap the quest commit view uses for one commit's diff. */
const MAX_COMMIT_DIFF_BYTES = 512 * 1024;

/**
 * Guided reviews: `POST /takode/reviews` publishes an agent's review map with the diff Takode's
 * CLI read from git, after checking that the map accounts for every changed line. The review
 * appears as a report in the caller's session and keeps only its stops' code; the full change is
 * read from git commit by commit (`GET /sessions/:id/guided-reviews/:reviewId/commits/:sha`), on
 * the machine the review was published from.
 */
export function createGuidedReviewRoutes(ctx: RouteContext) {
  const api = new Hono();
  api.use("/takode/reviews", bodyLimit({ maxSize: MAX_GUIDED_REVIEW_DIFF_BYTES * 2 + 1024 * 1024 }));
  api.post("/takode/reviews", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const session = ctx.wsBridge.getSession(auth.callerId);
    if (!session || auth.caller.archived) return c.json({ error: "Publishing session is unavailable." }, 409);
    try {
      const body = await c.req.json();
      const input = parseGuidedReviewMapInput(body.map);
      if (typeof body.diff !== "string" || !body.diff.trim()) throw new Error("The range has no changes to review.");
      if (Buffer.byteLength(body.diff, "utf8") > MAX_GUIDED_REVIEW_DIFF_BYTES) {
        throw new Error("The diff is over 8 MiB; review a smaller range.");
      }
      if (typeof body.sourcePath !== "string" || !isAbsolute(body.sourcePath)) {
        throw new Error("An exact absolute map path is required.");
      }
      if (typeof body.threadKey !== "string" || !normalizeThreadTarget(body.threadKey)) {
        throw new Error("Choose main, an exact quest thread or a topic thread.");
      }
      const range = readRange(body.range, ctx.launcher.getSession(auth.callerId)?.hostId);
      const files = parseGuidedReviewDiff(body.diff);
      if (!files.length) throw new Error("The range has no changes to review.");
      const { base: _base, head: _head, ...written } = input;
      const { problems, stats, map } = prepareGuidedReview(written, files);
      if (problems.length) {
        throw new Error(`The review map does not match the change:\n- ${problems.join("\n- ")}`);
      }
      const reviewId = crypto.randomUUID();
      const meta: GuidedReviewMeta = { reviewId, map, range, stats };
      const receipt = publishSessionReport(ctx, auth.callerId, session, {
        content: formatGuidedReviewMarkdown(meta),
        sourcePath: body.sourcePath,
        threadKey: normalizeThreadTarget(body.threadKey)!.threadKey,
        responsibleWorkerId: body.responsibleWorkerId,
        guidedReview: meta,
      });
      if ("error" in receipt) return c.json({ error: receipt.error }, receipt.status);
      return c.json(
        {
          reviewId,
          threadKey: receipt.message.threadKey,
          files: stats.files,
          additions: stats.additions,
          deletions: stats.deletions,
          linesInStops: stats.linesInStops,
          questions: map.stops.filter((stop) => stop.tier === "decide").length,
        },
        201,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid guided review." }, 400);
    }
  });

  // Share a review already published in the caller's own session or a session it herds into one of
  // the caller's threads. The copy reuses the saved snippets and the original range, so Full diff
  // still reads git on the machine it was first published from; answers come to the caller.
  api.post("/takode/reviews/share", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const session = ctx.wsBridge.getSession(auth.callerId);
    if (!session || auth.caller.archived) return c.json({ error: "Publishing session is unavailable." }, 409);
    try {
      const body = await c.req.json();
      if (typeof body.threadKey !== "string" || !normalizeThreadTarget(body.threadKey)) {
        throw new Error("Choose main, an exact quest thread or a topic thread.");
      }
      const fromId = typeof body.from === "string" ? ctx.resolveId(body.from) : null;
      const from = fromId ? ctx.launcher.getSession(fromId) : null;
      if (!fromId || !from) return c.json({ error: `No session ${String(body.from)}.` }, 404);
      if (fromId !== auth.callerId && from.herdedBy !== auth.callerId) {
        return c.json({ error: "You can share reviews only from your own session or a session you herd." }, 403);
      }
      const source = findGuidedReview(ctx.wsBridge.getSession(fromId)?.messageHistory ?? [], body.reviewId);
      if (!source?.guidedReview) {
        const what = typeof body.reviewId === "string" ? `review ${body.reviewId}` : "guided review";
        return c.json({ error: `That session has no ${what}.` }, 404);
      }
      const reviewId = crypto.randomUUID();
      const receipt = publishSessionReport(ctx, auth.callerId, session, {
        content: source.content,
        sourcePath: source.source.sourcePath,
        threadKey: normalizeThreadTarget(body.threadKey)!.threadKey,
        guidedReview: {
          ...source.guidedReview,
          reviewId,
          sharedFrom: { sessionId: fromId, reviewId: source.guidedReview.reviewId },
        },
      });
      if ("error" in receipt) return c.json({ error: receipt.error }, receipt.status);
      const { map } = source.guidedReview;
      return c.json(
        {
          reviewId,
          threadKey: receipt.message.threadKey,
          title: map.title,
          questions: map.stops.filter((stop) => stop.tier === "decide").length,
        },
        201,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid share request." }, 400);
    }
  });

  // One commit of a review's range, read from git like the quest commit view, for the full diff.
  api.get("/sessions/:id/guided-reviews/:reviewId/commits/:sha", async (c) => {
    const sessionId = ctx.resolveId(c.req.param("id"));
    const session = sessionId ? ctx.wsBridge.getSession(sessionId) : null;
    if (!session) return c.json({ error: "Session not found" }, 404);
    const reviewId = c.req.param("reviewId");
    const message = [...session.messageHistory]
      .reverse()
      .find((entry) => entry.type === "markdown_report" && entry.guidedReview?.reviewId === reviewId);
    const range = message?.type === "markdown_report" ? message.guidedReview?.range : undefined;
    if (!range) return c.json({ error: "Review not found" }, 404);
    const sha = c.req.param("sha").toLowerCase();
    if (!range.commits.some((commit) => commit.sha === sha)) {
      return c.json({ error: "Commit is not part of this review" }, 404);
    }
    const includeDiff = c.req.query("includeDiff") !== "false";
    if (!range.repoPaths?.length) return c.json({ sha, available: false, reason: "repo_unavailable" });
    for (const path of range.repoPaths) {
      try {
        const details = await onMachine(
          range.hostId,
          "readCommitDetails",
          path,
          sha,
          includeDiff,
          MAX_COMMIT_DIFF_BYTES,
        );
        return c.json({ ...details, available: true });
      } catch {
        // Try the next checkout; a worktree may be gone while its main checkout still has the commit.
      }
    }
    return c.json({ sha, available: false, reason: "commit_not_available" });
  });
  return api;
}

/** The newest guided review in a history, or the one with the given ID. */
function findGuidedReview(history: readonly BrowserIncomingMessage[], reviewId: unknown) {
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.type !== "markdown_report" || !entry.guidedReview) continue;
    if (typeof reviewId !== "string" || entry.guidedReview.reviewId === reviewId) return entry;
  }
  return undefined;
}

function readRange(value: unknown, hostId: string | undefined): GuidedReviewRange {
  const range = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const sha = (field: unknown) => typeof field === "string" && /^[0-9a-f]{40}$/.test(field);
  if (!sha(range.base) || !sha(range.head)) throw new Error("The range needs full base and head commit SHAs.");
  if (typeof range.repo !== "string" || !range.repo.trim()) throw new Error("The range needs a repository name.");
  const commits = Array.isArray(range.commits) ? range.commits.slice(0, MAX_COMMITS) : [];
  const repoPaths = Array.isArray(range.repoPaths)
    ? range.repoPaths
        .filter((path): path is string => typeof path === "string" && isAbsolute(path))
        .slice(0, MAX_REPO_PATHS)
    : [];
  return {
    repo: range.repo.trim(),
    base: range.base as string,
    head: range.head as string,
    commits: commits
      .filter((commit) => sha(commit?.sha) && typeof commit?.subject === "string")
      .map((commit) => ({ sha: commit.sha, subject: commit.subject })),
    ...(repoPaths.length ? { repoPaths } : {}),
    ...(hostId ? { hostId } : {}),
  };
}
