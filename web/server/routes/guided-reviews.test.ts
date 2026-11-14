import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuidedReviewRoutes } from "./guided-reviews.js";
import type { RouteContext } from "./context.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { SessionDraftsState } from "../../shared/session-drafts.js";
import {
  GUIDED_REVIEW_FIXTURE_DIFF,
  GUIDED_REVIEW_FIXTURE_MAP,
  makeGuidedReviewReportFixture,
} from "../../shared/test-fixtures/guided-review.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A route over a leader ("review-host"), a worker it herds and a worker herded by someone else;
 * nothing touches real data. Requests act as the session named by the x-caller header.
 */
async function harness() {
  const sessions = new Map(
    ["review-host", "worker", "stranger"].map((id) => [
      id,
      { id, messageHistory: [] as BrowserIncomingMessage[], state: {}, notifications: [] },
    ]),
  );
  const info: Record<string, { isOrchestrator: boolean; archived: boolean; herdedBy?: string }> = {
    "review-host": { isOrchestrator: true, archived: false },
    worker: { isOrchestrator: false, archived: false, herdedBy: "review-host" },
    stranger: { isOrchestrator: false, archived: false, herdedBy: "other-leader" },
  };
  const host = sessions.get("review-host")!;
  const history = host.messageHistory;
  const broadcast = vi.fn();
  const ctx = {
    authenticateTakodeCaller: (c: any) => {
      if (c.req.header("x-agent") !== "valid") return { response: c.json({ error: "unauthorized" }, 403) };
      const callerId = c.req.header("x-caller") ?? "review-host";
      return { callerId, caller: { sessionId: callerId, archived: false } };
    },
    resolveId: (id: string) => (sessions.has(id) ? id : null),
    launcher: { getSession: (id: string) => info[id] },
    wsBridge: {
      getSession: (id: string) => sessions.get(id) ?? null,
      persistSessionById: vi.fn(),
      broadcastToSession: broadcast,
      refreshSessionConversation: vi.fn(),
      getSessionNotificationDeps: () => ({
        broadcastToBrowsers: vi.fn(),
        persistSession: vi.fn(),
        promoteLeaderThreadTabForAttention: vi.fn(),
      }),
    },
  } as unknown as RouteContext;
  const api = createGuidedReviewRoutes(ctx);
  const post = (path: string, body: Record<string, unknown>, caller = "review-host", agent = true) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-caller": caller, ...(agent ? { "x-agent": "valid" } : {}) },
      body: JSON.stringify(body),
    });
  const publish = (body: Record<string, unknown>, agent = true) => post("/takode/reviews", body, "review-host", agent);
  return { api, host, history, broadcast, publish, post, sessions };
}

const validBody = {
  map: { base: "main", head: "HEAD", ...GUIDED_REVIEW_FIXTURE_MAP },
  diff: GUIDED_REVIEW_FIXTURE_DIFF,
  range: {
    repo: "profiles",
    base: "a".repeat(40),
    head: "b".repeat(40),
    commits: [{ sha: "c".repeat(40), subject: "feat: x" }],
  },
  sourcePath: "/tmp/review-map.json",
  threadKey: "q-42",
};

describe("guided review publication", () => {
  it("publishes a complete map as a report keeping only its stops' code", async () => {
    const { history, broadcast, publish } = await harness();
    const res = await publish(validBody);
    expect(res.status).toBe(201);
    const receipt = await res.json();
    expect(receipt).toMatchObject({
      threadKey: "q-42",
      files: 3,
      additions: 24,
      deletions: 3,
      linesInStops: 20,
      questions: 2,
    });

    // History holds the map with each stop's code and the Markdown version; summarized code is not kept.
    expect(history).toHaveLength(1);
    const message = history[0] as Extract<BrowserIncomingMessage, { type: "markdown_report" }>;
    expect(message).toMatchObject({ type: "markdown_report", threadKey: "q-42", questId: "q-42" });
    expect(message.guidedReview).toMatchObject({ reviewId: receipt.reviewId, range: { repo: "profiles" } });
    expect(message.guidedReview!.map).not.toHaveProperty("base");
    expect(message.content).toContain("# Guided review: Retry profile loads and cache profiles");
    expect(message.guidedReview!.map.stops[0].code[0].snippet).toContain("withRetry<T>");
    expect(JSON.stringify(message)).not.toContain('it(\\"returns the first success');
    expect(broadcast).toHaveBeenCalledWith("review-host", message);
  });

  it("counts each summary's files from the diff, ignoring counts the agent wrote", async () => {
    // The lines changed per summarized file come from the diff, so an agent can't misstate them.
    const { history, publish } = await harness();
    const summaries = validBody.map.summaries.map((summary) => ({
      ...summary,
      files: [{ path: "src/client.ts", additions: 999, deletions: 0, alsoInStops: false }],
    }));
    const res = await publish({ ...validBody, map: { ...validBody.map, summaries } });
    expect(res.status).toBe(201);
    const message = history[0] as Extract<BrowserIncomingMessage, { type: "markdown_report" }>;
    expect(message.guidedReview!.map.summaries.map((summary) => summary.files)).toEqual([
      [{ path: "src/client.ts", additions: 1, deletions: 0, alsoInStops: true }],
      // The test file is new in the change, which git's header says and the server records.
      [{ path: "src/retry.test.ts", status: "added", additions: 6, deletions: 0, alsoInStops: false }],
    ]);
  });

  it("reads the full change commit by commit from the review's checkouts, trying each in turn", async () => {
    // A throwaway repository; the first recorded checkout is missing, as after a worktree is removed.
    const root = await mkdtemp(join(tmpdir(), "guided-review-repo-"));
    roots.push(root);
    const git = (...args: string[]) =>
      promisify(execFile)("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    await git("init", "-q");
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
    await git("add", ".");
    await git("commit", "-qm", "base");
    await writeFile(join(root, "a.ts"), "export const a = 2;\n");
    await git("commit", "-qam", "change a");
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    const { api, publish } = await harness();
    const range = {
      ...validBody.range,
      commits: [{ sha: head, subject: "change a" }],
      repoPaths: [join(root, "gone"), root],
    };
    const { reviewId } = await (await publish({ ...validBody, range })).json();

    const commit = await (await api.request(`/sessions/review-host/guided-reviews/${reviewId}/commits/${head}`)).json();
    expect(commit).toMatchObject({ available: true, sha: head });
    expect(commit.diff).toContain("+export const a = 2;");
    expect(
      (await api.request(`/sessions/review-host/guided-reviews/${reviewId}/commits/${"e".repeat(40)}`)).status,
    ).toBe(404);
    expect((await api.request(`/sessions/review-host/guided-reviews/missing/commits/${head}`)).status).toBe(404);

    // Without recorded checkouts (reviews published before this), the commit is reported unavailable.
    const { reviewId: older } = await (await publish({ ...validBody, range: { ...range, repoPaths: [] } })).json();
    expect(await (await api.request(`/sessions/review-host/guided-reviews/${older}/commits/${head}`)).json()).toEqual({
      sha: head,
      available: false,
      reason: "repo_unavailable",
    });
  });

  it("reads a stop's file over the range with the whole file as context, for the code around it", async () => {
    // Jiayi (Nov 1): the code around a stop is read from git when the review is viewed, not saved.
    // Only files the stops show can be read; when the commits are gone the reader falls back.
    const root = await mkdtemp(join(tmpdir(), "guided-review-context-"));
    roots.push(root);
    const git = (...args: string[]) =>
      promisify(execFile)("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    await git("init", "-q");
    const lines = Array.from({ length: 30 }, (_, index) => `const line${index + 1} = ${index + 1};`);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/client.ts"), `${lines.join("\n")}\n`);
    await git("add", ".");
    await git("commit", "-qm", "base");
    const base = (await git("rev-parse", "HEAD")).stdout.trim();
    lines[14] = "const line15 = 1500;";
    await writeFile(join(root, "src/client.ts"), `${lines.join("\n")}\n`);
    await git("commit", "-qam", "change");
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    const { api, publish } = await harness();
    const range = { ...validBody.range, base, head, commits: [{ sha: head, subject: "change" }] };
    const published = await publish({ ...validBody, range: { ...range, repoPaths: [join(root, "gone"), root] } });
    const { reviewId } = await published.json();

    const read = (id: string, path: string) =>
      api.request(`/sessions/review-host/guided-reviews/${id}/file-diff?path=${encodeURIComponent(path)}`);
    const live = await (await read(reviewId, "src/client.ts")).json();
    expect(live.available).toBe(true);
    // The whole file comes as context: its first and last lines, around the change.
    expect(live.diff).toContain(" const line1 = 1;");
    expect(live.diff).toContain("+const line15 = 1500;");
    expect(live.diff).toContain(" const line30 = 30;");
    // A path no stop shows is not read.
    expect((await read(reviewId, "secrets.txt")).status).toBe(404);
    // Without a checkout that has the commits, the code is unavailable rather than an error.
    const missing = await publish({ ...validBody, range: { ...range, repoPaths: [join(root, "gone")] } });
    const { reviewId: gone } = await missing.json();
    expect(await (await read(gone, "src/client.ts")).json()).toEqual({
      available: false,
      reason: "commits_not_available",
    });
  });

  it("refuses a map that leaves changed lines out, and publishes nothing", async () => {
    const { history, publish } = await harness();
    const map = { ...validBody.map, summaries: validBody.map.summaries.slice(1) };
    const res = await publish({ ...validBody, map });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "The review map does not match the change:\n- src/client.ts: added lines 2 are in no stop; add the file to a summary or a stop.",
    );
    expect(history).toEqual([]);
  });

  it("requires an authenticated agent and a valid thread and range", async () => {
    const { history, publish } = await harness();
    expect((await publish(validBody, false)).status).toBe(403);
    expect((await (await publish({ ...validBody, threadKey: "q-x" })).json()).error).toBe(
      "Choose main, an exact quest thread or a topic thread.",
    );
    expect((await (await publish({ ...validBody, range: { ...validBody.range, head: "HEAD" } })).json()).error).toBe(
      "The range needs full base and head commit SHAs.",
    );
    expect(history).toEqual([]);
  });

  it("shares a worker's published review into the leader's thread as the same review, reusing its code and git source", async () => {
    // The worker published on its own machine; the leader shares it without any repository.
    const { api, post, sessions, history } = await harness();
    const range = { ...validBody.range, repoPaths: ["/laptop/repos/profiles"] };
    const published = await post("/takode/reviews", { ...validBody, range, threadKey: "main" }, "worker");
    const { reviewId: original } = await published.json();
    const workerReview = sessions.get("worker")!.messageHistory[0] as Extract<
      BrowserIncomingMessage,
      { type: "markdown_report" }
    >;

    const res = await post("/takode/reviews/share", { from: "worker", threadKey: "q-42" });
    expect(res.status).toBe(201);
    const receipt = await res.json();
    expect(receipt).toMatchObject({
      reviewId: original,
      threadKey: "q-42",
      title: "Retry profile loads and cache profiles",
      questions: 2,
    });

    const shared = history[0] as Extract<BrowserIncomingMessage, { type: "markdown_report" }>;
    expect(shared).toMatchObject({ type: "markdown_report", threadKey: "q-42", content: workerReview.content });
    // The share is the same review, so it has one set of answers wherever it is shown.
    expect(shared.source.sessionId).toBe("review-host");
    expect(shared.guidedReview).toMatchObject({
      reviewId: original,
      sharedFrom: { sessionId: "worker", reviewId: original },
      range: { repoPaths: ["/laptop/repos/profiles"] },
    });
    expect(shared.guidedReview!.map.stops[0].code[0].snippet).toContain("withRetry<T>");
    // Full diff from the leader's share looks up the share and reads the original checkout.
    const commit = await api.request(`/sessions/review-host/guided-reviews/${original}/commits/${"c".repeat(40)}`);
    expect(await commit.json()).toMatchObject({ available: false, reason: "commit_not_available" });
  });

  it("sends a shared review's answers to the leader from every place that shows it", async () => {
    // Jiayi (Nov 13): answers typed in the worker's review, opened in a separate window, never
    // reached the leader's shared card, which kept its own. The leader decides what happens with the
    // answers, so once shared, the worker's card, the leader's card and the Library all answer it
    // in the leader's thread.
    const { api, post, sessions } = await harness();
    const { reviewId } = await (await post("/takode/reviews", { ...validBody, threadKey: "main" }, "worker")).json();
    const home = async (sessionId: string) =>
      (await api.request(`/sessions/${sessionId}/guided-reviews/${reviewId}/home`)).json();
    expect(await home("worker")).toEqual({ home: { sessionId: "worker", threadKey: "main" } });

    // Answers typed before the share move with it.
    const worker = sessions.get("worker")! as { drafts?: SessionDraftsState };
    const typed = { revision: 1, clientId: "tab", updatedAt: 1, draft: { answers: { "0": "Only network errors" } } };
    worker.drafts = { revision: 1, guidedReviews: { [reviewId]: typed } };
    await post("/takode/reviews/share", { from: "worker", threadKey: "q-42" });

    const leaderHome = { sessionId: "review-host", threadKey: "q-42", questId: "q-42" };
    const answers = { answers: { "0": "Only network errors" } };
    expect(await home("worker")).toMatchObject({ home: leaderHome, answers: { draft: answers } });
    expect(await home("review-host")).toMatchObject({ home: leaderHome, answers: { draft: answers } });
    expect(worker.drafts?.guidedReviews).toBeUndefined();
    expect(
      (sessions.get("review-host") as { drafts?: SessionDraftsState }).drafts?.guidedReviews?.[reviewId],
    ).toMatchObject({
      draft: answers,
    });
  });

  it("leaves answers already sent where they went when the review is shared afterwards", async () => {
    const { api, post, sessions } = await harness();
    const { reviewId } = await (await post("/takode/reviews", { ...validBody, threadKey: "main" }, "worker")).json();
    const worker = sessions.get("worker")! as { drafts?: SessionDraftsState };
    const sent = { revision: 1, clientId: "tab", updatedAt: 1, draft: { answers: { "0": "Keep" }, sentAt: 5 } };
    worker.drafts = { revision: 1, guidedReviews: { [reviewId]: sent } };
    await post("/takode/reviews/share", { from: "worker", threadKey: "q-42" });
    const res = await api.request(`/sessions/review-host/guided-reviews/${reviewId}/home`);
    expect(await res.json()).toEqual({ home: { sessionId: "worker", threadKey: "main" }, answers: sent });
  });

  it("keeps a share made before shares kept the review's ID answering on its own", async () => {
    // Older shares got their own review ID and their own answers; they keep both.
    const { api, host } = await harness();
    const legacy = makeGuidedReviewReportFixture();
    legacy.guidedReview = {
      ...legacy.guidedReview!,
      reviewId: "copy",
      sharedFrom: { sessionId: "worker", reviewId: "original" },
    };
    host.messageHistory.push({ ...legacy, threadKey: "q-7", questId: "q-7" } as BrowserIncomingMessage);
    const res = await api.request("/sessions/review-host/guided-reviews/copy/home");
    expect(await res.json()).toEqual({ home: { sessionId: "review-host", threadKey: "q-7", questId: "q-7" } });
  });

  it("shares only from the caller's own session or one it herds, and names a missing review", async () => {
    const { post, history } = await harness();
    await post("/takode/reviews", { ...validBody, threadKey: "main" }, "stranger");
    expect((await post("/takode/reviews/share", { from: "stranger", threadKey: "main" })).status).toBe(403);
    const missing = await post("/takode/reviews/share", { from: "worker", threadKey: "main" });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("That session has no guided review.");
    expect((await post("/takode/reviews/share", { from: "nobody", threadKey: "main" })).status).toBe(404);
    expect(history).toEqual([]);
  });
});
