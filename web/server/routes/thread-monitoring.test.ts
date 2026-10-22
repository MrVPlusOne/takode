import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteContext } from "./context.js";
import type { ThreadMonitoringPage, ThreadMonitoringState } from "../../shared/thread-monitoring.js";
import { registerThreadMonitoringRoutes } from "./thread-monitoring.js";

vi.mock("../quest-store.js", () => ({
  getQuest: vi.fn(async (id: string) => ({
    title: `Task ${id}`,
    // q-7 was filed from the user's request in Main: a side quest answered there.
    ...(id === "q-7"
      ? {
          relationships: {
            startedFrom: { sessionId: "leader", messageId: "request-1", threadKey: "main", timestamp: 1 },
          },
        }
      : {}),
  })),
}));

function fixture() {
  const monitoring: ThreadMonitoringState = { revision: 1, alertVersion: 0, threads: {} };
  const session = {
    id: "leader",
    state: {
      isOrchestrator: true,
      threadMonitoring: monitoring,
      leaderOpenThreadTabs: { orderedOpenThreadKeys: ["q-42"] },
    },
    board: new Map(),
    completedBoard: new Map(),
    messageHistory: [],
  };
  const launcher = {
    sessionId: "leader",
    sessionNum: 12,
    name: "Research",
    archived: false,
    hidden: false,
    isOrchestrator: true,
  };
  const persist = vi.fn();
  const app = new Hono();
  registerThreadMonitoringRoutes(app, {
    launcher: { listSessions: () => [launcher], getSession: () => launcher },
    wsBridge: { getSession: () => session, persistSessionById: persist },
    resolveId: (id: string) => id,
  } as unknown as RouteContext);
  const act = (threadKey: string, action: string, resultId?: string) =>
    app.request(`/sessions/leader/thread-monitoring/${threadKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, resultId }),
    });
  return { app, session, launcher, persist, act };
}

describe("monitoring commands and global list", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses launcher role before the first leader output populates bridge metadata", async () => {
    const { act, app, session } = fixture();
    session.state.isOrchestrator = false;
    expect((await act("q-42", "track")).status).toBe(200);
    expect(await (await app.request("/thread-monitoring?filter=all")).json()).toMatchObject({ total: 1 });
  });

  it("shows an ordinary quest's current Ready result at once but not a side quest's", async () => {
    // A side quest's Ready only marks it done; its result is answered where the user asked,
    // so turning Notify Me on must not pull the user into its tab with that old marker.
    const { act, session } = fixture();
    session.state.leaderOpenThreadTabs.orderedOpenThreadKeys.push("q-7");
    (session.messageHistory as unknown[]).push({
      type: "user_message",
      id: "request-1",
      content: "Compare the two runs.",
      timestamp: 1,
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u1",
      threadKey: "main",
    });
    const ready = (threadKey: string) => ({
      kind: "ready",
      label: "Thread Ready",
      threadKey,
      questId: threadKey,
      summary: "done",
      messageId: `ready-${threadKey}`,
      timestamp: 2,
      updatedAt: 2,
    });
    Object.assign(session.state, { leaderThreadStatuses: { "q-7": ready("q-7"), "q-42": ready("q-42") } });
    expect((await act("q-7", "track")).status).toBe(200);
    expect((await act("q-42", "track")).status).toBe(200);
    expect(session.state.threadMonitoring.threads["q-7"]?.pending).toBeNull();
    expect(session.state.threadMonitoring.threads["q-42"]?.pending).toMatchObject({ messageId: "ready-q-42" });
  });

  it("keeps quiet tracked tasks discoverable and broadcasts mutations through persistence", async () => {
    const { act, app, persist } = fixture();
    expect((await act("q-42", "track")).status).toBe(200);
    expect(persist).toHaveBeenCalledWith("leader");
    expect(await (await app.request("/thread-monitoring")).json()).toMatchObject({ entries: [], total: 0 });
    const all = (await (await app.request("/thread-monitoring?filter=all")).json()) as ThreadMonitoringPage;
    expect(all.entries).toMatchObject([{ title: "Task q-42", sessionName: "Research", pending: null }]);
  });

  it("pages closed tracked targets beyond the tab cap and excludes archives without erasing state", async () => {
    // None of these watches is an open tab; global discoverability must not use the open-tab projection.
    const { app, session, launcher } = fixture();
    for (let index = 1; index <= 75; index++)
      session.state.threadMonitoring.threads[`q-${index}`] = {
        trackedAt: index,
        afterHistoryIndex: index,
        pending: { id: String(index), messageId: `result-${index}`, timestamp: index, summary: "Ready" },
      };
    const first = (await (await app.request("/thread-monitoring")).json()) as ThreadMonitoringPage;
    const second = (await (await app.request("/thread-monitoring?offset=50")).json()) as ThreadMonitoringPage;
    expect(first).toMatchObject({ total: 75, nextOffset: 50 });
    expect(first.entries).toHaveLength(50);
    expect(second.entries).toHaveLength(25);
    expect(second.nextOffset).toBeNull();
    launcher.archived = true;
    expect(await (await app.request("/thread-monitoring")).json()).toMatchObject({ total: 0 });
    launcher.archived = false;
    expect(await (await app.request("/thread-monitoring")).json()).toMatchObject({ total: 75 });
  });

  it("does not clear a newer result from a stale acknowledgement and can stop a closed watch", async () => {
    const { act, session } = fixture();
    await act("q-42", "track");
    session.state.threadMonitoring.threads["q-42"].pending = {
      id: "20",
      messageId: "new",
      timestamp: 20,
      summary: "New",
    };
    session.state.leaderOpenThreadTabs.orderedOpenThreadKeys = [];
    expect(await (await act("q-42", "acknowledge", "19")).json()).toMatchObject({ changed: false });
    expect(session.state.threadMonitoring.threads["q-42"].pending?.id).toBe("20");
    await act("q-42", "acknowledge", "20");
    expect(session.state.threadMonitoring.threads["q-42"].pending).toBeNull();
    await act("q-42", "untrack");
    expect(session.state.threadMonitoring.threads["q-42"]).toBeUndefined();
  });

  it("rejects Main, All, unknown targets, invalid commands, and archived mutations", async () => {
    const { act, app, launcher } = fixture();
    expect((await act("main", "track")).status).toBe(400);
    expect((await act("all", "track")).status).toBe(400);
    expect((await act("q-999", "track")).status).toBe(409);
    expect((await act("q-42", "rename")).status).toBe(400);
    expect((await app.request("/thread-monitoring?offset=-1")).status).toBe(400);
    launcher.archived = true;
    expect((await act("q-42", "track")).status).toBe(409);
  });
});
