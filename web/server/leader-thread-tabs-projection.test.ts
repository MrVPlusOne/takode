import { describe, expect, it, vi } from "vitest";
import {
  LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
  isLeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { threadStatusMessageIdHash, type LeaderThreadStatus } from "../shared/thread-status-marker.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import { notifyUser } from "./bridge/session-notification-controller.js";
import type { BoardRow, SessionAttentionRecord, SessionNotification } from "./session-types.js";
import {
  buildLeaderThreadTabsProjectionValue,
  createLeaderThreadTabsProjectionDefinition,
} from "./leader-thread-tabs-projection.js";

function boardRow(questId: string, status: string, overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    questId,
    title: `Title ${questId}`,
    status,
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function notification(
  id: string,
  category: "needs-input" | "review",
  threadKey: string,
  overrides: Partial<SessionNotification> = {},
): SessionNotification {
  return {
    id,
    category,
    summary: `${category} ${threadKey}`,
    timestamp: 30,
    messageId: `message-${id}`,
    threadKey,
    questId: threadKey,
    done: false,
    ...overrides,
  };
}

function status(threadKey: string, kind: LeaderThreadStatus["kind"]): LeaderThreadStatus {
  return {
    kind,
    label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
    threadKey,
    questId: threadKey,
    summary: `${kind} ${threadKey}`,
    messageId: `assistant-${threadKey}`,
    timestamp: 40,
    updatedAt: 40,
  };
}

function attentionRecord(threadKey: string, overrides: Partial<SessionAttentionRecord> = {}): SessionAttentionRecord {
  return {
    id: `attention-${threadKey}`,
    leaderSessionId: "leader",
    type: "quest_reopened_or_rework",
    source: { kind: "message", id: `message-${threadKey}`, questId: threadKey },
    questId: threadKey,
    threadKey,
    title: `Attention ${threadKey}`,
    summary: `Attention for ${threadKey}`,
    actionLabel: "Open",
    priority: "milestone",
    state: "reopened",
    createdAt: 30,
    updatedAt: 30,
    route: { threadKey, questId: threadKey },
    chipEligible: false,
    ledgerEligible: true,
    dedupeKey: `attention-${threadKey}`,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "leader",
    backendType: "codex",
    state: { isOrchestrator: true } as unknown as Session["state"],
    board: new Map(),
    completedBoard: new Map(),
    notifications: [],
    attentionRecords: [],
    pendingPermissions: new Map(),
    messageHistory: [],
    notificationCounter: 0,
    lastReadAt: 0,
    attentionReason: null,
    ...overrides,
  } as unknown as Session;
}

describe("leader thread tabs projection derivation", () => {
  it("derives tombstone-aware active and needs-input candidates with semantic tab state", () => {
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-3", "q-4"],
          closedThreadTombstones: [{ threadKey: "q-5", closedAt: 50 }],
          updatedAt: 25,
        },
        leaderThreadStatuses: { "q-3": status("q-3", "waiting") },
      } as unknown as Session["state"],
      board: new Map([
        [
          "q-1",
          boardRow("q-1", "WORKING", {
            journey: { mode: "active", phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1 },
          }),
        ],
        ["q-4", boardRow("q-4", "PROPOSED")],
      ]),
      completedBoard: new Map([["q-3", boardRow("q-3", "MEMORY", { completedAt: 24 })]]),
      notifications: [
        notification("needs", "needs-input", "q-2", { timestamp: 31 }),
        notification("closed", "needs-input", "q-5", { timestamp: 30 }),
        notification("ready", "review", "q-3", { timestamp: 32 }),
      ],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabState?.orderedOpenThreadKeys).toEqual(["q-1", "q-2", "q-3", "q-4"]);
    expect(value.tabs).toEqual([
      expect.objectContaining({
        threadKey: "q-1",
        active: true,
        queued: false,
        proposed: false,
        completed: false,
        canClose: false,
        journey: expect.objectContaining({ currentPhaseId: "work", activePhaseIndex: 1, phaseCount: 3 }),
      }),
      expect.objectContaining({
        threadKey: "q-2",
        title: "needs-input q-2",
        attention: expect.objectContaining({ needsInput: true }),
        canClose: true,
      }),
      expect.objectContaining({ threadKey: "q-3", completed: true, canClose: true }),
      expect.objectContaining({ threadKey: "q-4", proposed: true, queued: false, active: false, canClose: false }),
    ]);
    expect(value.tabState?.orderedOpenThreadKeys).not.toContain("q-5");
    expect(value.threadStatuses["q-3"]).toMatchObject({ kind: "waiting", threadKey: "q-3" });
    expect(value.tabs[2]?.attention).toMatchObject({ reviewUnread: true });
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
    // Projection backfill is read-only; raw durable state is changed only by a producer mutation.
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-3", "q-4"]);
  });

  it("keeps all fifty tabs and relevant statuses below the explicit 64 KiB wire ceiling", () => {
    const keys = Array.from({ length: 50 }, (_, index) => `q-${index + 1}`);
    const rows = keys.map((key, index) =>
      boardRow(key, "WORKING", {
        title: `${"界".repeat(LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH - 8)} ${index}`,
        createdAt: index + 1,
        updatedAt: index + 100,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
        },
      }),
    );
    const statuses = Object.fromEntries(keys.map((key) => [key, status(key, "ready")])) as Record<
      string,
      LeaderThreadStatus
    >;
    const longReadyMessageId =
      "ready-" + "m".repeat(LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH - "ready-".length);
    for (const item of Object.values(statuses)) {
      item.summary = "界".repeat(200);
      item.messageId = longReadyMessageId;
    }
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: keys,
          closedThreadTombstones: keys.map((key, index) => ({ threadKey: `q-${index + 101}`, closedAt: index })),
          updatedAt: 100,
        },
        leaderThreadStatuses: statuses,
      } as unknown as Session["state"],
      board: new Map(rows.map((row) => [row.questId, row])),
    });

    const value = buildLeaderThreadTabsProjectionValue(session);
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    expect(value.tabs).toHaveLength(50);
    expect(Object.keys(value.threadStatuses)).toHaveLength(50);
    expect(bytes).toBeLessThanOrEqual(LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES);
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
    expect(value.threadStatuses["q-1"]?.messageId).toBe(longReadyMessageId);
    expect(
      value.tabs.some(
        (tab) => tab.title === null || tab.title.length < LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
      ) || Object.values(value.threadStatuses).some((item) => item.summary.length < 200),
    ).toBe(true);
  });

  it("uses a stable full-ID fingerprint only when pathological payloads need identity compaction", () => {
    const keys = Array.from({ length: 50 }, (_, index) =>
      `q-${String(index).padStart(2, "0")}${"9".repeat(76)}`.slice(0, 80),
    );
    const fullMessageId = "界".repeat(LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH);
    const statuses = Object.fromEntries(
      keys.map((key) => [
        key,
        {
          ...status(key, "ready"),
          questId: key,
          summary: "界".repeat(200),
          messageId: fullMessageId,
        },
      ]),
    );
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: keys,
          closedThreadTombstones: keys.map((_, index) => ({
            threadKey: `q-8${String(index).padStart(2, "0")}${"7".repeat(75)}`.slice(0, 80),
            closedAt: index,
          })),
          updatedAt: 100,
        },
        leaderThreadStatuses: statuses,
      } as unknown as Session["state"],
      board: new Map(
        keys.map((key, index) => [
          key,
          boardRow(key, "界".repeat(80), { title: "界".repeat(160), createdAt: index + 1, updatedAt: index + 2 }),
        ]),
      ),
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThanOrEqual(
      LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
    );
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
    expect(value.threadStatuses[keys[0]!]!).toMatchObject({
      messageId: "",
      messageIdHash: threadStatusMessageIdHash(fullMessageId),
    });
  });

  it("authorizes the definition only for visible leader sources", () => {
    const leader = makeSession();
    const worker = makeSession({ id: "worker", state: { isOrchestrator: false } as unknown as Session["state"] });
    const sessions = new Map([
      [leader.id, leader],
      [worker.id, worker],
    ]);
    const definition = createLeaderThreadTabsProjectionDefinition<{}>({
      getSession: (id) => sessions.get(id),
      isLeaderSession: (session) => session.state.isOrchestrator === true,
      authorizeSubscription: () => true,
    });

    expect(definition.resolveSource("leader")).toBe(leader);
    expect(definition.resolveSource("worker")).toBeUndefined();
    expect(definition.authorizeSubscription({}, "leader", leader)).toBe(true);
  });
});

describe("leader thread tabs projection parity regressions", () => {
  it("repairs an already-open active board tab into the left prefix unless newer explicit order wins", () => {
    const board = new Map([
      ["q-active", boardRow("q-active", "WORKING", { createdAt: 30, updatedAt: 40, threadTabActivatedAt: 30 })],
    ]);
    const staleOrder = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-old-a", "q-active", "q-old-b"],
      closedThreadTombstones: [],
      updatedAt: 40,
    };

    const repaired = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board,
        state: { isOrchestrator: true, leaderOpenThreadTabs: staleOrder } as unknown as Session["state"],
      }),
    );
    expect(repaired.tabState?.orderedOpenThreadKeys).toEqual(["q-active", "q-old-a", "q-old-b"]);

    const explicitlyOrdered = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board,
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: { ...staleOrder, explicitOrderUpdatedAt: 35 },
        } as unknown as Session["state"],
      }),
    );
    expect(explicitlyOrdered.tabState).toMatchObject({
      orderedOpenThreadKeys: ["q-old-a", "q-active", "q-old-b"],
      explicitOrderUpdatedAt: 35,
    });
  });

  it("projects active attention and review tabs around active, queued, and proposed board tabs", () => {
    const session = makeSession({
      board: new Map([
        ["q-active", boardRow("q-active", "WORKING", { createdAt: 10, updatedAt: 100 })],
        ["q-queued", boardRow("q-queued", "QUEUED", { createdAt: 20, updatedAt: 20 })],
        ["q-proposed", boardRow("q-proposed", "PROPOSED", { createdAt: 30, updatedAt: 30 })],
      ]),
      attentionRecords: [
        attentionRecord("q-review", {
          id: "review-q-review",
          type: "review_ready",
          source: { kind: "notification", id: "notification-q-review", questId: "q-review" },
          title: "Review q-review",
          summary: "Review is ready",
          actionLabel: "Review",
          priority: "review",
          state: "unresolved",
          createdAt: 200,
          updatedAt: 200,
          dedupeKey: "review-q-review",
        }),
        attentionRecord("q-rework", {
          id: "rework-q-rework",
          createdAt: 300,
          updatedAt: 300,
          dedupeKey: "rework-q-rework",
        }),
      ],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual([
      "q-rework",
      "q-active",
      "q-review",
      "q-queued",
      "q-proposed",
    ]);
    expect(value.tabs.find((tab) => tab.threadKey === "q-rework")).toMatchObject({
      canClose: true,
      attention: { reviewUnread: false },
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-review")).toMatchObject({
      canClose: true,
      attention: { reviewUnread: true },
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-queued")).toMatchObject({
      active: false,
      queued: true,
      proposed: false,
      canClose: false,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-proposed")).toMatchObject({
      active: false,
      queued: false,
      proposed: true,
      canClose: false,
    });
  });

  it("surfaces producer-shaped message-derived rework attention", () => {
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [],
          updatedAt: 20,
        },
      } as unknown as Session["state"],
      messageHistory: [
        {
          type: "user_message",
          id: "u-rework",
          content: "Please ask the agent to fix the rough edge.",
          timestamp: 30,
          threadRefs: [{ threadKey: "q-5", questId: "q-5", source: "explicit" }],
        } as Session["messageHistory"][number],
      ],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-5", "q-1"]);
    expect(value.tabs[0]).toMatchObject({
      threadKey: "q-5",
      title: "q-5: rework requested",
      canClose: true,
    });
  });

  it("preserves newer producer-authored server-candidate order", () => {
    const needsFirst = buildLeaderThreadTabsProjectionValue(
      makeSession({
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: {
            version: 1,
            orderedOpenThreadKeys: ["q-need", "q-active"],
            closedThreadTombstones: [],
            updatedAt: 30,
          },
        } as unknown as Session["state"],
        board: new Map([["q-active", boardRow("q-active", "WORKING", { createdAt: 10, updatedAt: 20 })]]),
        notifications: [notification("need", "needs-input", "q-need", { timestamp: 30 })],
      }),
    );
    expect(needsFirst.tabs.map((tab) => tab.threadKey)).toEqual(["q-need", "q-active"]);

    const reactivatedFirst = buildLeaderThreadTabsProjectionValue(
      makeSession({
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: {
            version: 1,
            orderedOpenThreadKeys: ["q-b", "q-a"],
            closedThreadTombstones: [],
            updatedAt: 40,
          },
        } as unknown as Session["state"],
        board: new Map([
          ["q-a", boardRow("q-a", "WORKING", { createdAt: 10, updatedAt: 20 })],
          ["q-b", boardRow("q-b", "WORKING", { createdAt: 15, updatedAt: 40, threadTabActivatedAt: 40 })],
        ]),
      }),
    );
    expect(reactivatedFirst.tabs.map((tab) => tab.threadKey)).toEqual(["q-b", "q-a"]);
  });

  it("keeps an unresolved review unread when its active board tab is synthesized on cold state", () => {
    const value = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board: new Map([["q-cold", boardRow("q-cold", "WORKING", { createdAt: 10, updatedAt: 20 })]]),
        notifications: [notification("cold-review", "review", "q-cold", { timestamp: 30 })],
      }),
    );

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-cold"]);
    expect(value.tabs[0]).toMatchObject({
      threadKey: "q-cold",
      active: true,
      attention: { reviewUnread: true, updatedAt: 30 },
    });
  });
});

describe("needs-input leader tab authority", () => {
  it("surfaces a newly created routed needs-input tab once while respecting newer close tombstones", () => {
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [{ threadKey: "q-3", closedAt: Date.now() + 60_000 }],
          updatedAt: 10,
        },
      } as unknown as Session["state"],
    });
    const persistSession = vi.fn();
    const deps = {
      persistSession,
      getLauncherSessionInfo: () => ({ isOrchestrator: true }),
      isHerdedWorkerSession: () => false,
      broadcastToBrowsers: vi.fn(),
    };

    notifyUser(session, "needs-input", "Choose an option", deps, {
      threadRoute: { threadKey: "q-2", questId: "q-2" },
    });
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-2", "q-1"]);

    notifyUser(session, "needs-input", "Closed target prompt", deps, {
      threadRoute: { threadKey: "q-3", questId: "q-3" },
    });
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-2", "q-1"]);
    expect(persistSession).toHaveBeenCalled();
  });
});
