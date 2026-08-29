import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerGlobalRecentAsksRoute } from "./global-recent-asks-route.js";

function makeBridgeSession(options: { searchDataOnly?: boolean; hidden?: boolean } = {}) {
  return {
    state: { hidden: options.hidden },
    searchDataOnly: options.searchDataOnly === true,
    messageHistory: [
      { type: "user_message", id: "u1", content: "Inspect the recent asks modal", timestamp: 10, threadKey: "q-1" },
      {
        type: "leader_user_message",
        id: "a1",
        content: "The design is ready",
        timestamp: 20,
        threadKey: "q-1",
      },
    ],
    notifications: [],
    isGenerating: false,
    activeTurnRoute: null,
    userMessageIdsThisTurn: [],
    queuedTurnUserMessageIds: [],
    pendingCodexInputs: [],
  };
}

describe("GET /sessions/recent-asks", () => {
  it("returns bounded server-authored groups with session-space and quest orientation", async () => {
    const api = new Hono();
    const sessions = [
      { sessionId: "s1", sessionNum: 1, name: "Leader", state: "connected", treeGroupId: "work", isOrchestrator: true },
      { sessionId: "archived", sessionNum: 2, name: "Archived", state: "exited", archived: true },
    ];
    const bridge = new Map([
      ["s1", makeBridgeSession()],
      ["archived", makeBridgeSession({ searchDataOnly: true })],
    ]);
    registerGlobalRecentAsksRoute(api, {
      launcher: {
        listSessions: () => sessions,
        getSessionNum: (id: string) => sessions.find((session) => session.sessionId === id)?.sessionNum ?? null,
      } as never,
      wsBridge: { getSession: (id: string) => bridge.get(id) } as never,
      getTreeGroupState: async () => ({
        groups: [
          { id: "default", name: "Default" },
          { id: "work", name: "Work" },
        ],
        assignments: {},
        nodeOrder: {},
      }),
      listQuests: (async () => [
        {
          questId: "q-1",
          id: "q-1-v1",
          version: 1,
          title: "Recent asks",
          description: "Build it",
          status: "in_progress",
          createdAt: 1,
          sessionId: "worker",
          claimedAt: 1,
        },
      ]) as never,
    });

    const response = await api.request("/sessions/recent-asks?filter=all&limit=50&q=does-not-match");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.query).toBe("");
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      sessionId: "s1",
      sessionSpaceId: "work",
      sessionSpaceName: "Work",
      ownerThreadKey: "q-1",
      questTitle: "Recent asks",
      status: "responded",
    });
    expect(body.coverageNotice).toContain("archived sessions");
  });

  it("uses canonical read filtering and still works when quest enrichment is unavailable", async () => {
    const api = new Hono();
    const bridgeSession: any = makeBridgeSession();
    bridgeSession.notifications = [
      { id: "review", category: "review", timestamp: 25, messageId: "a1", done: false, threadKey: "q-1" },
    ];
    bridgeSession.lastReadAt = 30;
    bridgeSession.pendingPermissions = new Map();
    registerGlobalRecentAsksRoute(api, {
      launcher: {
        listSessions: () => [{ sessionId: "s1", sessionNum: 1, name: "Leader", state: "connected" }],
        getSessionNum: () => 1,
      } as never,
      wsBridge: { getSession: () => bridgeSession } as never,
      getTreeGroupState: async () => ({ groups: [{ id: "default", name: "Default" }], assignments: {}, nodeOrder: {} }),
      listQuests: (async () => {
        throw new Error("quest store unavailable");
      }) as never,
    });

    const response = await api.request("/sessions/recent-asks");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups[0]?.status).toBe("responded");
  });
});
