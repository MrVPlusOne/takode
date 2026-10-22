import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isAbsolute } from "node:path";
import {
  MAX_GUIDED_REVIEW_DIFF_BYTES,
  checkGuidedReviewCoverage,
  formatGuidedReviewMarkdown,
  parseGuidedReviewDiff,
  parseGuidedReviewMapInput,
  type GuidedReviewMeta,
  type GuidedReviewRange,
} from "../../shared/guided-review.js";
import { GuidedReviewStore } from "../guided-review-store.js";
import { publishSessionReport } from "./markdown-reports.js";
import type { RouteContext } from "./context.js";

const MAX_COMMITS = 500;

/**
 * Guided reviews: `POST /takode/reviews` publishes an agent's review map with the diff Takode's
 * CLI read from git, after checking that the map accounts for every changed line. The review
 * appears as a report in the caller's session; browsers fetch its diff with
 * `GET /guided-reviews/:id` when it is opened.
 */
export function createGuidedReviewRoutes(ctx: RouteContext, store = new GuidedReviewStore()) {
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
      if (typeof body.threadKey !== "string" || !/^(main|q-[1-9]\d*)$/.test(body.threadKey)) {
        throw new Error("Choose main or an exact quest thread.");
      }
      const range = readRange(body.range);
      const files = parseGuidedReviewDiff(body.diff);
      if (!files.length) throw new Error("The range has no changes to review.");
      const { problems, stats } = checkGuidedReviewCoverage(input, files);
      if (problems.length) {
        throw new Error(`The review map does not match the change:\n- ${problems.join("\n- ")}`);
      }
      const { base: _base, head: _head, ...map } = input;
      const reviewId = crypto.randomUUID();
      const meta: GuidedReviewMeta = { reviewId, map, range, stats };
      await store.saveDiff(reviewId, body.diff);
      const receipt = publishSessionReport(ctx, auth.callerId, session, {
        content: formatGuidedReviewMarkdown(meta),
        sourcePath: body.sourcePath,
        threadKey: body.threadKey,
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

  api.get("/guided-reviews/:reviewId", async (c) => {
    const diff = await store.readDiff(c.req.param("reviewId"));
    return diff === null ? c.json({ error: "Review not found" }, 404) : c.json({ diff });
  });
  return api;
}

function readRange(value: unknown): GuidedReviewRange {
  const range = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const sha = (field: unknown) => typeof field === "string" && /^[0-9a-f]{40}$/.test(field);
  if (!sha(range.base) || !sha(range.head)) throw new Error("The range needs full base and head commit SHAs.");
  if (typeof range.repo !== "string" || !range.repo.trim()) throw new Error("The range needs a repository name.");
  const commits = Array.isArray(range.commits) ? range.commits.slice(0, MAX_COMMITS) : [];
  return {
    repo: range.repo.trim(),
    base: range.base as string,
    head: range.head as string,
    commits: commits
      .filter((commit) => sha(commit?.sha) && typeof commit?.subject === "string")
      .map((commit) => ({ sha: commit.sha, subject: commit.subject })),
  };
}
