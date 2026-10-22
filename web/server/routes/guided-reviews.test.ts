import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuidedReviewRoutes } from "./guided-reviews.js";
import type { RouteContext } from "./context.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { GuidedReviewStore } from "../guided-review-store.js";
import { GUIDED_REVIEW_FIXTURE_DIFF, GUIDED_REVIEW_FIXTURE_MAP } from "../../shared/test-fixtures/guided-review.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A route over one leader session and a store in a temporary folder; nothing touches real data. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "guided-review-"));
  roots.push(root);
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
  const api = createGuidedReviewRoutes(ctx, new GuidedReviewStore(root));
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
  it("publishes a complete map as a report carrying the review, and serves its diff on demand", async () => {
    const { api, history, broadcast, publish } = await harness();
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

    // History holds the small map and the Markdown version; the diff stays out of history.
    expect(history).toHaveLength(1);
    const message = history[0] as Extract<BrowserIncomingMessage, { type: "markdown_report" }>;
    expect(message).toMatchObject({ type: "markdown_report", threadKey: "q-42", questId: "q-42" });
    expect(message.guidedReview).toMatchObject({ reviewId: receipt.reviewId, range: { repo: "profiles" } });
    expect(message.guidedReview!.map).not.toHaveProperty("base");
    expect(message.content).toContain("# Guided review: Retry profile loads and cache profiles");
    expect(JSON.stringify(message)).not.toContain("withRetry<T>");
    expect(broadcast).toHaveBeenCalledWith("review-host", message);

    const diff = await api.request(`/guided-reviews/${receipt.reviewId}`);
    expect(await diff.json()).toEqual({ diff: GUIDED_REVIEW_FIXTURE_DIFF });
    expect((await api.request("/guided-reviews/..%2Fsecrets")).status).toBe(404);
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
