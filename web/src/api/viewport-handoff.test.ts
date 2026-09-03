import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchViewportHandoffSession, fetchViewportHandoffThread, putViewportHandoff } from "./viewport-handoff.js";
import {
  VIEWPORT_HANDOFF_VERSION,
  type ViewportHandoffRecord,
  type ViewportHandoffSessionState,
  type ViewportHandoffWriteRequest,
} from "../../shared/viewport-handoff.js";

function position(anchorMessageId = "message-1") {
  return {
    scrollTop: 420,
    scrollHeight: 2_000,
    isAtBottom: false,
    anchorMessageId,
    anchorTurnId: "turn-1",
    anchorOffsetTop: 72,
  };
}

function record(threadKey = "main", revision = 3): ViewportHandoffRecord {
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    threadKey,
    revision,
    sourceId: "browser-1/page-1",
    departureId: "departure-1",
    activityAt: 5_000,
    updatedAt: 5_000,
    position: position(),
  };
}

function state(threadKey = "main", revision = 3): ViewportHandoffSessionState {
  const updatedAt = 5_000 + revision;
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    sessionId: "session-1",
    revision,
    updatedAt,
    selectedThreadKey: threadKey,
    selectedThreadRevision: revision,
    selectedThreadActivityAt: updatedAt,
    selectedThreadUpdatedAt: updatedAt,
    handoffs: { [threadKey]: record(threadKey, revision) },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("viewport handoff API", () => {
  it("loads full-session and normalized per-thread state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: state(), serverNow: 5_100 }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: state("q-2035", 4),
            threadKey: "q-2035",
            record: record("q-2035", 4),
            serverNow: 5_200,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sessionResponse = await fetchViewportHandoffSession("session-1");
    const threadResponse = await fetchViewportHandoffThread("session-1", "Q-2035");

    expect(sessionResponse.state.revision).toBe(3);
    expect(threadResponse.threadKey).toBe("q-2035");
    expect(threadResponse.record?.revision).toBe(4);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/sessions/session-1/viewport-handoff",
      "/api/sessions/session-1/viewport-handoff?threadKey=q-2035",
    ]);
  });

  it("sends a bounded PUT with keepalive and validates the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: "accepted", state: state("main", 4), record: record("main", 4), serverNow: 5_300 }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const request: ViewportHandoffWriteRequest = {
      baseRevision: 3,
      baseSelectedThreadRevision: 3,
      lastDeliberateActivityAt: 5_150,
      lastSelectionActivityAt: 5_175,
      sourceId: "browser-1/page-1",
      departureId: "departure-2",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position(),
    };

    const response = await putViewportHandoff("session-1", request, { keepalive: true });

    expect(response.status).toBe("accepted");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/viewport-handoff",
      expect.objectContaining({
        method: "PUT",
        keepalive: true,
        body: JSON.stringify(request),
      }),
    );
  });

  it("fails closed on a mismatched thread response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ state: state(), threadKey: "main", record: record("main"), serverNow: 5_100 }),
            { status: 200 },
          ),
        ),
    );

    await expect(fetchViewportHandoffThread("session-1", "q-2035")).rejects.toThrow(
      "Viewport handoff thread response is invalid",
    );
  });
});
