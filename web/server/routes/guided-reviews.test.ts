import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuidedReviewRoutes } from "./guided-reviews.js";
import type { RouteContext } from "./context.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { GUIDED_REVIEW_FIXTURE_DIFF, GUIDED_REVIEW_FIXTURE_MAP } from "../../shared/test-fixtures/guided-review.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A route over one leader session; nothing touches real data. */
async function harness() {
  const history: BrowserIncomingMessage[] = [];
  const host = { id: "review-host", messageHistory: history, state: {}, notifications: [] };
  const broadcast = vi.fn();
  const ctx = {
    authenticateTakodeCaller: (c: any) =>
      c.req.header("x-agent") === "valid"
        ? { callerId: host.id, caller: { sessionId: host.id, archived: false } }
        : { response: c.json({ error: "unauthorized" }, 403) },
    resolveId: (id: string) => id,
    launcher: { getSession: () => ({ isOrchestrator: true, archived: false }) },
    wsBridge: {
      getSession: (id: string) => (id === host.id ? host : null),
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
  const publish = (body: Record<string, unknown>, agent = true) =>
    api.request("/takode/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(agent ? { "x-agent": "valid" } : {}) },
      body: JSON.stringify(body),
    });
  return { api, host, history, broadcast, publish };
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
      "Choose main or an exact quest thread.",
    );
    expect((await (await publish({ ...validBody, range: { ...validBody.range, head: "HEAD" } })).json()).error).toBe(
      "The range needs full base and head commit SHAs.",
    );
    expect(history).toEqual([]);
  });
});
