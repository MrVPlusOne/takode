import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MAX_THREAD_VIEWS, registerSessionThreadViewedRoute } from "./session-thread-viewed-route.js";

// A browser reports that the user viewed a leader's thread (a chat showing it stayed focused for a
// moment). The server keeps the time with the session and refreshes the leader's tab projection,
// whose `userInteractionAt` orders the Threads view on every device.

function makeRoute({
  isOrchestrator = true,
  threadViewedAt,
}: {
  isOrchestrator?: boolean;
  threadViewedAt?: Record<string, number>;
} = {}) {
  const sessionId = "leader-abc";
  const bridgeSession = {
    id: sessionId,
    state: { session_id: sessionId, threadViewedAt },
  };
  const persistSessionById = vi.fn();
  const invalidateLeaderThreadTabsForSession = vi.fn();
  const api = new Hono();
  registerSessionThreadViewedRoute(api, {
    launcher: {
      getSession: vi.fn(() => ({ sessionId, isOrchestrator })),
    } as any,
    wsBridge: {
      getSession: vi.fn((id: string) => (id === sessionId ? bridgeSession : null)),
      persistSessionById,
      getSyncedProjectionController: () => ({
        invalidateLeaderThreadTabsForSession,
      }),
    } as any,
    resolveId: vi.fn((raw: string) => (raw === sessionId || raw === "7" ? sessionId : null)),
  });
  const post = (body: unknown, id = "7") =>
    api.request(`/sessions/${id}/thread-viewed`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  return {
    post,
    bridgeSession,
    persistSessionById,
    invalidateLeaderThreadTabsForSession,
  };
}

describe("session thread viewed route", () => {
  it("records the view by normalized thread key, saves it and refreshes the leader's tabs", async () => {
    const { post, bridgeSession, persistSessionById, invalidateLeaderThreadTabsForSession } = makeRoute();
    const before = Date.now();

    expect((await post({ threadKey: "Q-3149" })).status).toBe(200);
    expect((await post({ threadKey: "topic:2b5fc3db" })).status).toBe(200);

    const viewed = bridgeSession.state.threadViewedAt!;
    expect(Object.keys(viewed).sort()).toEqual(["q-3149", "topic:2b5fc3db"]);
    expect(viewed["q-3149"]).toBeGreaterThanOrEqual(before);
    expect(persistSessionById).toHaveBeenCalledWith("leader-abc");
    expect(invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith("leader-abc");
  });

  it("refuses what is not a leader's thread", async () => {
    // A worker has no threads to order, and an address that names no thread records nothing.
    const worker = makeRoute({ isOrchestrator: false });
    expect((await worker.post({ threadKey: "q-1" })).status).toBe(400);
    const leader = makeRoute();
    expect((await leader.post({ threadKey: "not a thread" })).status).toBe(400);
    expect((await leader.post({})).status).toBe(400);
    expect((await leader.post({ threadKey: "q-1" }, "unknown")).status).toBe(404);
    expect(leader.persistSessionById).not.toHaveBeenCalled();
  });

  it("keeps only the newest views", async () => {
    // Views of long-gone threads are dropped first, so the saved session stays small.
    const old = Object.fromEntries(Array.from({ length: MAX_THREAD_VIEWS }, (_, i) => [`q-${i + 1}`, i + 1]));
    const { post, bridgeSession } = makeRoute({ threadViewedAt: old });
    await post({ threadKey: "q-9999" });
    const viewed = bridgeSession.state.threadViewedAt!;
    expect(Object.keys(viewed)).toHaveLength(MAX_THREAD_VIEWS);
    expect(viewed["q-9999"]).toBeDefined();
    expect(viewed["q-1"]).toBeUndefined();
  });
});
