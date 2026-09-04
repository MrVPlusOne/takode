import { describe, expect, it, vi } from "vitest";
import {
  LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
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
  it("uses durable tab order without continuously rebuilding current candidates", () => {
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
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "memory"],
              activePhaseIndex: 1,
            },
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

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-3", "q-4"]);
    expect(value.tabs).toEqual([
      expect.objectContaining({ threadKey: "q-3", completed: true, canClose: true }),
      expect.objectContaining({
        threadKey: "q-4",
        proposed: true,
        queued: false,
        neverStartedScheduled: true,
        active: false,
        canClose: true,
      }),
    ]);
    expect(value.tabs.map((tab) => tab.threadKey)).not.toContain("q-5");
    expect(value.threadStatuses["q-3"]).toMatchObject({
      kind: "waiting",
      threadKey: "q-3",
    });
    expect(value.tabs[0]?.attention).toMatchObject({ reviewUnread: true });
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
    // Projection backfill is read-only; raw durable state is changed only by a producer mutation.
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-3", "q-4"]);
  });

  it("retains a full-ID hash when normal projection compaction truncates a Codex status anchor", () => {
    // Live Codex assistant IDs can substantially exceed the bounded wire field.
    // Keep the compact display prefix plus a stable full-ID hash so the browser
    // can still correlate the Ready status with the untruncated history row.
    const fullMessageId = `codex-agent-${"Ab+/".repeat(107)}`;
    const ready = status("main", "ready");
    ready.questId = undefined;
    ready.messageId = fullMessageId;
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderThreadStatuses: { main: ready },
      } as unknown as Session["state"],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.threadStatuses.main).toMatchObject({
      kind: "ready",
      threadKey: "main",
      messageId: fullMessageId.slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH),
      messageIdHash: threadStatusMessageIdHash(fullMessageId),
    });
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
  });

  it("derives one bounded initial candidate order before durable tab migration", () => {
    const session = makeSession({
      board: new Map([["q-1", boardRow("q-1", "WORKING")]]),
      notifications: [notification("needs", "needs-input", "q-2", { timestamp: 31 })],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabState).toBeNull();
    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-1", "q-2"]);
    expect(session.state.leaderOpenThreadTabs).toBeUndefined();

    const fullBoard = Array.from({ length: 50 }, (_, index) => boardRow(`q-${index + 1}`, "WORKING"));
    const crowded = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board: new Map(fullBoard.map((row) => [row.questId, row])),
        attentionRecords: [attentionRecord("q-51", { updatedAt: 100 })],
      }),
    );
    expect(crowded.tabs).toHaveLength(50);
    expect(crowded.tabs[0]?.threadKey).toBe("q-51");
    expect(new Set(crowded.tabs.map((tab) => tab.threadKey)).size).toBe(50);
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
          phaseTimings: {
            "0": { startedAt: 1_000 + index * 10_000, endedAt: 2_000 + index * 10_000 },
            "1": { startedAt: 2_000 + index * 10_000 },
          },
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
          closedThreadTombstones: keys.map((key, index) => ({
            threadKey: `q-${index + 101}`,
            closedAt: index,
          })),
          updatedAt: 100,
        },
        leaderThreadStatuses: statuses,
      } as unknown as Session["state"],
      board: new Map(rows.map((row) => [row.questId, row])),
    });

    const value = buildLeaderThreadTabsProjectionValue(session);
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    expect(value.tabs).toHaveLength(50);
    expect(value.tabs.every((tab) => tab.journey?.durationSummary != null)).toBe(true);
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

  it("preserves long Journey structure while compacting only lower-priority duration evidence", () => {
    const keys = Array.from({ length: 50 }, (_, index) => `q-${index + 1}`);
    const phaseIds = Array.from({ length: 74 }, () => "work" as const);
    const phaseTimings = Object.fromEntries(
      phaseIds.map((_, index) => [String(index), { startedAt: index * 10_000 + 1, endedAt: index * 10_000 + 5_001 }]),
    );
    const statuses = Object.fromEntries(
      keys.map((key) => [key, { ...status(key, "ready"), summary: "界".repeat(200) }]),
    );
    const completedBoard = new Map(
      keys.map((key, index) => [
        key,
        boardRow(key, "MEMORY", {
          title: `${"界".repeat(LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH - 8)} ${index}`,
          createdAt: index + 1,
          updatedAt: index + 100,
          completedAt: index + 200,
          journey: {
            mode: "active",
            phaseIds,
            activePhaseIndex: phaseIds.length - 1,
            phaseTimings,
          },
        }),
      ]),
    );
    const value = buildLeaderThreadTabsProjectionValue(
      makeSession({
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: {
            version: 1,
            orderedOpenThreadKeys: keys,
            closedThreadTombstones: [],
            updatedAt: 100,
          },
          leaderThreadStatuses: statuses,
        } as unknown as Session["state"],
        completedBoard,
      }),
    );

    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThanOrEqual(
      LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
    );
    expect(value.tabs).toHaveLength(50);
    expect(value.tabs.every((tab) => tab.journey?.phaseIds.length === phaseIds.length)).toBe(true);
    expect(value.tabs[0]?.journey?.durationSummary).not.toBe(LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED);
    expect(value.tabs.at(-1)?.journey?.durationSummary).toBe(LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED);
    expect(value.tabs.some((tab) => tab.journey?.durationSummary === LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED)).toBe(
      true,
    );
    expect(value.tabs.some((tab) => typeof tab.journey?.durationSummary === "object")).toBe(true);
    const firstOmittedIndex = value.tabs.findIndex(
      (tab) => tab.journey?.durationSummary === LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
    );
    expect(firstOmittedIndex).toBeGreaterThan(0);
    expect(
      value.tabs.slice(0, firstOmittedIndex).every((tab) => typeof tab.journey?.durationSummary === "object"),
    ).toBe(true);
    expect(
      value.tabs
        .slice(firstOmittedIndex)
        .every((tab) => tab.journey?.durationSummary === LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED),
    ).toBe(true);
    expect(isLeaderThreadTabsProjectionValue(value)).toBe(true);
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
          boardRow(key, "界".repeat(80), {
            title: "界".repeat(160),
            createdAt: index + 1,
            updatedAt: index + 2,
          }),
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
    expect(value.tabs[0]).toHaveProperty("neverStartedScheduled", false);
  });

  it("projects q-2012-shaped active timing as closed duration plus current elapsed start", () => {
    const alignmentStartedAt = 1_788_298_097_792;
    const workStartedAt = 1_788_298_234_066;
    const session = makeSession({
      board: new Map([
        [
          "q-2012",
          boardRow("q-2012", "WORKING", {
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "memory"],
              activePhaseIndex: 1,
              currentPhaseId: "work",
              phaseTimings: {
                "0": { startedAt: alignmentStartedAt, endedAt: workStartedAt },
                "1": { startedAt: workStartedAt },
              },
            },
          }),
        ],
      ]),
    });

    expect(buildLeaderThreadTabsProjectionValue(session).tabs[0]?.journey).toMatchObject({
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 1,
      durationSummary: {
        phaseDurationsMs: [workStartedAt - alignmentStartedAt],
        activePhaseStartedAt: workStartedAt,
      },
    });
  });

  it("keeps completed and partial repeated-phase durations stable without an open timer", () => {
    const completedAt = 20_000;
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-repeat"],
          closedThreadTombstones: [],
          updatedAt: completedAt,
        },
      } as unknown as Session["state"],
      completedBoard: new Map([
        [
          "q-repeat",
          boardRow("q-repeat", "WORKING", {
            completedAt,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
              activePhaseIndex: 4,
              currentPhaseId: "memory",
              phaseTimings: {
                "0": { startedAt: 1_000, endedAt: 2_000 },
                "2": { startedAt: 4_000, endedAt: 4_000 },
                "3": { startedAt: 5_000, endedAt: 8_500 },
                "4": { startedAt: 9_000 },
              },
            },
          }),
        ],
      ]),
    });

    const tab = buildLeaderThreadTabsProjectionValue(session).tabs[0];
    expect(tab).toMatchObject({
      completed: true,
      journey: {
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
        durationSummary: {
          phaseDurationsMs: [1_000, null, 0, 3_500],
          activePhaseStartedAt: null,
        },
      },
    });
  });

  it("authorizes the definition only for visible leader sources", () => {
    const leader = makeSession();
    const worker = makeSession({
      id: "worker",
      state: { isOrchestrator: false } as unknown as Session["state"],
    });
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
  it("preserves durable order for already-open tabs across active, completed, and no-op derivations", () => {
    const durableOrder = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-old-a", "q-target", "q-old-b"],
      closedThreadTombstones: [],
      updatedAt: 40,
    };
    const active = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board: new Map([
          [
            "q-target",
            boardRow("q-target", "WORKING", {
              createdAt: 30,
              updatedAt: 50,
              threadTabActivatedAt: 50,
            }),
          ],
        ]),
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: durableOrder,
        } as unknown as Session["state"],
      }),
    );
    expect(active.tabs.map((tab) => tab.threadKey)).toEqual(["q-old-a", "q-target", "q-old-b"]);

    const completed = buildLeaderThreadTabsProjectionValue(
      makeSession({
        completedBoard: new Map([
          [
            "q-target",
            boardRow("q-target", "MEMORY", {
              createdAt: 30,
              updatedAt: 60,
              completedAt: 60,
            }),
          ],
        ]),
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: durableOrder,
        } as unknown as Session["state"],
      }),
    );
    expect(completed.tabs.map((tab) => tab.threadKey)).toEqual(["q-old-a", "q-target", "q-old-b"]);

    const repeated = buildLeaderThreadTabsProjectionValue(
      makeSession({
        board: new Map([
          [
            "q-target",
            boardRow("q-target", "MEMORY", {
              createdAt: 30,
              updatedAt: 70,
              threadTabActivatedAt: 50,
            }),
          ],
        ]),
        state: {
          isOrchestrator: true,
          leaderOpenThreadTabs: durableOrder,
        } as unknown as Session["state"],
      }),
    );
    expect(repeated.tabs.map((tab) => tab.threadKey)).toEqual(["q-old-a", "q-target", "q-old-b"]);
  });

  it("leaves producer-authored persisted priority unchanged during projection", () => {
    // Mixed durable order models attachment-first scheduling plus retained neutral peers.
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [
            "q-completed",
            "q-queued",
            "q-review",
            "q-work",
            "q-requeued",
            "q-proposed",
            "q-memory",
            "q-checkpoint-active",
            "q-checkpoint-parked",
          ],
          closedThreadTombstones: [],
          updatedAt: 100,
        },
      } as unknown as Session["state"],
      board: new Map([
        ["q-queued", boardRow("q-queued", "QUEUED")],
        ["q-work", boardRow("q-work", "WORKING")],
        ["q-requeued", boardRow("q-requeued", "QUEUED", { threadTabActivatedAt: 15 })],
        ["q-proposed", boardRow("q-proposed", "PROPOSED")],
        ["q-memory", boardRow("q-memory", "MEMORY")],
        [
          "q-checkpoint-active",
          boardRow("q-checkpoint-active", "USER_CHECKPOINTING", {
            waitForInput: ["n-1"],
          }),
        ],
        ["q-checkpoint-parked", boardRow("q-checkpoint-parked", "USER_CHECKPOINTING")],
      ]),
      completedBoard: new Map([["q-completed", boardRow("q-completed", "MEMORY", { completedAt: 90 })]]),
      attentionRecords: [attentionRecord("q-review")],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual([
      "q-completed",
      "q-queued",
      "q-review",
      "q-work",
      "q-requeued",
      "q-proposed",
      "q-memory",
      "q-checkpoint-active",
      "q-checkpoint-parked",
    ]);
    expect(value.tabs.find((tab) => tab.threadKey === "q-checkpoint-active")).toMatchObject({
      active: true,
      canClose: false,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-checkpoint-parked")).toMatchObject({
      active: false,
      canClose: true,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-requeued")).toMatchObject({
      queued: true,
      neverStartedScheduled: false,
      canClose: true,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-queued")).toMatchObject({
      queued: true,
      neverStartedScheduled: true,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-proposed")).toMatchObject({
      proposed: true,
      neverStartedScheduled: true,
    });
    // Projection catch-up is read-only; the next explicit command or board
    // mutation materializes this visual order into durable tab state.
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys[1]).toBe("q-queued");
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
          source: {
            kind: "notification",
            id: "notification-q-review",
            questId: "q-review",
          },
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
      neverStartedScheduled: true,
      canClose: true,
    });
    expect(value.tabs.find((tab) => tab.threadKey === "q-proposed")).toMatchObject({
      active: false,
      queued: false,
      proposed: true,
      neverStartedScheduled: true,
      canClose: true,
    });
  });

  it("keeps a dismissed scheduled tab closed across newer attention and routine row updates", () => {
    // Scheduled status fences automatic candidates even when their timestamps advance.
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-active"],
          closedThreadTombstones: [{ threadKey: "q-queued", closedAt: 50 }],
          updatedAt: 50,
        },
      } as unknown as Session["state"],
      board: new Map([
        ["q-active", boardRow("q-active", "WORKING", { createdAt: 1, updatedAt: 10 })],
        ["q-queued", boardRow("q-queued", "QUEUED", { createdAt: 2, updatedAt: 200 })],
      ]),
      attentionRecords: [attentionRecord("q-queued", { createdAt: 200, updatedAt: 200 })],
    });

    const value = buildLeaderThreadTabsProjectionValue(session);

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-active"]);
    expect(session.state.leaderOpenThreadTabs?.closedThreadTombstones).toContainEqual({
      threadKey: "q-queued",
      closedAt: 50,
    });
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-active"]);
  });

  it("surfaces producer-shaped message-derived rework attention", () => {
    const session = makeSession({
      state: { isOrchestrator: true } as unknown as Session["state"],
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

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-5"]);
    expect(value.tabState).toBeNull();
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
          [
            "q-b",
            boardRow("q-b", "WORKING", {
              createdAt: 15,
              updatedAt: 40,
              threadTabActivatedAt: 40,
            }),
          ],
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

describe("leader thread tabs current quest state", () => {
  it("uses the current claimed leader and worker row over a historical local completion", () => {
    const oldLeader = makeSession({
      id: "leader-old",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1974"],
          closedThreadTombstones: [],
          updatedAt: 160,
        },
      } as unknown as Session["state"],
      completedBoard: new Map([
        [
          "q-1974",
          boardRow("q-1974", "WORKING", {
            title: "Historical completed run",
            worker: "worker-old",
            workerNum: 2569,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
              activePhaseIndex: 1,
            },
            createdAt: 100,
            updatedAt: 150,
            completedAt: 160,
          }),
        ],
      ]),
    });
    const currentLeader = makeSession({
      id: "leader-current",
      board: new Map([
        [
          "q-1974",
          boardRow("q-1974", "WORKING", {
            title: "Current active run",
            worker: "worker-current",
            workerNum: 2580,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "memory"],
              activePhaseIndex: 1,
            },
            createdAt: 300,
            updatedAt: 350,
          }),
        ],
      ]),
    });
    const fresherUnclaimedLeader = makeSession({
      id: "leader-unclaimed",
      board: new Map([
        [
          "q-1974",
          boardRow("q-1974", "PLANNING", {
            title: "Unclaimed conflicting run",
            worker: "worker-unclaimed",
            workerNum: 9999,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "memory"],
              activePhaseIndex: 0,
            },
            createdAt: 400,
            updatedAt: 500,
          }),
        ],
      ]),
    });
    const currentWorker = makeSession({
      id: "worker-current",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-1974",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-current",
      } as unknown as Session["state"],
    });
    const oldWorker = makeSession({
      id: "worker-old",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-1974",
        claimedQuestStatus: "done",
        claimedQuestLeaderSessionId: "leader-old",
      } as unknown as Session["state"],
    });

    const value = buildLeaderThreadTabsProjectionValue(oldLeader, {
      sessions: [oldLeader, currentLeader, fresherUnclaimedLeader, currentWorker, oldWorker],
    });

    expect(value.tabs).toEqual([
      expect.objectContaining({
        threadKey: "q-1974",
        title: "Current active run",
        boardStatus: "WORKING",
        sourceLeaderSessionId: "leader-current",
        sourceRowCreatedAt: 300,
        workerSessionId: "worker-current",
        workerSessionNum: 2580,
        active: true,
        completed: false,
        canClose: false,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 3,
          durationSummary: null,
        },
      }),
    ]);
    expect(oldLeader.completedBoard.get("q-1974")?.title).toBe("Historical completed run");
  });

  it("uses current cross-session state for scheduled priority instead of the observer's stale row", () => {
    // Ordering and presentation must resolve from the same current-run authority.
    const observer = makeSession({
      id: "leader-observer",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-scheduled", "q-current"],
          closedThreadTombstones: [],
          updatedAt: 100,
        },
      } as unknown as Session["state"],
      board: new Map([["q-scheduled", boardRow("q-scheduled", "QUEUED")]]),
      completedBoard: new Map([
        [
          "q-current",
          boardRow("q-current", "MEMORY", {
            completedAt: 90,
            createdAt: 50,
            updatedAt: 90,
          }),
        ],
      ]),
    });
    const currentLeader = makeSession({
      id: "leader-current",
      board: new Map([
        [
          "q-current",
          boardRow("q-current", "WORKING", {
            worker: "worker-current",
            createdAt: 200,
            updatedAt: 220,
            threadTabActivatedAt: 200,
          }),
        ],
      ]),
    });
    const worker = makeSession({
      id: "worker-current",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-current",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-current",
      } as unknown as Session["state"],
    });

    const value = buildLeaderThreadTabsProjectionValue(observer, {
      sessions: [observer, currentLeader, worker],
    });

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-scheduled", "q-current"]);
    expect(value.tabs[0]).toMatchObject({ queued: true, canClose: true });
    expect(value.tabs[1]).toMatchObject({
      active: true,
      canClose: false,
      sourceLeaderSessionId: "leader-current",
    });
  });

  it("projects cross-session requeue history without demoting the retained tab", () => {
    const observer = makeSession({
      id: "leader-observer",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-requeued", "q-scheduled", "q-active"],
          closedThreadTombstones: [],
          updatedAt: 100,
        },
      } as unknown as Session["state"],
      board: new Map([
        ["q-scheduled", boardRow("q-scheduled", "QUEUED")],
        ["q-active", boardRow("q-active", "WORKING")],
      ]),
      completedBoard: new Map([
        [
          "q-requeued",
          boardRow("q-requeued", "MEMORY", {
            completedAt: 90,
            createdAt: 50,
            updatedAt: 90,
          }),
        ],
      ]),
    });
    const currentLeader = makeSession({
      id: "leader-current",
      board: new Map([
        [
          "q-requeued",
          boardRow("q-requeued", "QUEUED", {
            createdAt: 200,
            updatedAt: 220,
            threadTabActivatedAt: 180,
          }),
        ],
      ]),
    });

    const value = buildLeaderThreadTabsProjectionValue(observer, {
      sessions: [observer, currentLeader],
    });

    expect(value.tabs.map((tab) => tab.threadKey)).toEqual(["q-requeued", "q-scheduled", "q-active"]);
    expect(value.tabs[0]).toMatchObject({
      queued: true,
      neverStartedScheduled: false,
      sourceLeaderSessionId: "leader-current",
    });
    expect(value.tabs[1]).toMatchObject({
      queued: true,
      neverStartedScheduled: true,
    });
  });

  it("prefers a demonstrably newer unclaimed active run over an older completed claim", () => {
    const projectedLeader = makeSession({
      id: "leader-projected",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1974"],
          closedThreadTombstones: [],
          updatedAt: 400,
        },
      } as unknown as Session["state"],
    });
    const completedLeader = makeSession({
      id: "leader-completed",
      completedBoard: new Map([
        [
          "q-1974",
          boardRow("q-1974", "MEMORY", {
            title: "Older completed run",
            worker: "worker-completed",
            createdAt: 100,
            completedAt: 200,
          }),
        ],
      ]),
    });
    const reopenedLeader = makeSession({
      id: "leader-reopened",
      board: new Map([
        [
          "q-1974",
          boardRow("q-1974", "PLANNING", {
            title: "Fresh reopened alignment",
            createdAt: 300,
            threadTabActivatedAt: 300,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "work", "memory"],
              activePhaseIndex: 0,
            },
          }),
        ],
      ]),
    });
    const completedWorker = makeSession({
      id: "worker-completed",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-1974",
        claimedQuestStatus: "done",
        claimedQuestLeaderSessionId: "leader-completed",
      } as unknown as Session["state"],
    });

    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: [projectedLeader, completedLeader, reopenedLeader, completedWorker],
      }).tabs[0],
    ).toMatchObject({
      title: "Fresh reopened alignment",
      boardStatus: "PLANNING",
      sourceLeaderSessionId: "leader-reopened",
      workerSessionId: null,
      active: true,
      completed: false,
      journey: { currentPhaseId: "alignment", activePhaseIndex: 0 },
    });
  });

  it("uses run identity and ignores hidden or search-only stale rows", () => {
    const projectedLeader = makeSession({
      id: "leader-projected",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-9"],
          closedThreadTombstones: [],
          updatedAt: 10,
        },
      } as unknown as Session["state"],
    });
    const completedLeader = makeSession({
      id: "leader-completed",
      completedBoard: new Map([
        [
          "q-9",
          boardRow("q-9", "MEMORY", {
            title: "Current completion",
            createdAt: 100,
            completedAt: 300,
            updatedAt: 9_000,
          }),
        ],
      ]),
    });
    const staleActiveLeader = makeSession({
      id: "leader-stale-active",
      board: new Map([
        [
          "q-9",
          boardRow("q-9", "WORKING", {
            title: "Stale visible active row",
            createdAt: 100,
            threadTabActivatedAt: 150,
            updatedAt: 10_000,
          }),
        ],
      ]),
    });
    const hiddenLeader = makeSession({
      id: "leader-hidden",
      state: {
        isOrchestrator: true,
        hidden: true,
      } as unknown as Session["state"],
      board: new Map([["q-9", boardRow("q-9", "WORKING", { title: "Hidden row", createdAt: 500 })]]),
    });
    const archivedSearchLeader = makeSession({
      id: "leader-search-only",
      searchDataOnly: true,
      board: new Map([["q-9", boardRow("q-9", "WORKING", { title: "Archived row", createdAt: 600 })]]),
    });
    const baseSessions = [projectedLeader, completedLeader, staleActiveLeader, hiddenLeader, archivedSearchLeader];

    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: baseSessions,
      }).tabs[0],
    ).toMatchObject({
      title: "Current completion",
      sourceLeaderSessionId: "leader-completed",
      active: false,
      completed: true,
    });

    const newerActiveLeader = makeSession({
      id: "leader-new-active",
      board: new Map([
        [
          "q-9",
          boardRow("q-9", "WORKING", {
            title: "New active run",
            createdAt: 400,
            updatedAt: 410,
          }),
        ],
      ]),
    });
    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: [...baseSessions, newerActiveLeader],
      }).tabs[0],
    ).toMatchObject({
      title: "New active run",
      sourceLeaderSessionId: "leader-new-active",
      active: true,
      completed: false,
    });
  });

  it("keeps the newest current completion authoritative after its source leader closes the tab", () => {
    const projectedLeader = makeSession({
      id: "leader-projected",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-41"],
          closedThreadTombstones: [],
          updatedAt: 10,
        },
      } as unknown as Session["state"],
      completedBoard: new Map([
        [
          "q-41",
          boardRow("q-41", "MEMORY", {
            title: "Older local completion",
            createdAt: 50,
            completedAt: 100,
          }),
        ],
      ]),
    });
    const currentLeader = makeSession({
      id: "leader-current",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-41", closedAt: 300 }],
          updatedAt: 300,
        },
      } as unknown as Session["state"],
      completedBoard: new Map([
        [
          "q-41",
          boardRow("q-41", "MEMORY", {
            title: "Current completion",
            createdAt: 150,
            completedAt: 200,
          }),
        ],
      ]),
    });

    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: [projectedLeader, currentLeader],
      }).tabs[0],
    ).toMatchObject({
      title: "Current completion",
      sourceLeaderSessionId: "leader-current",
      completed: true,
    });
  });

  it("ignores stray worker-owned board rows while retaining worker claim evidence", () => {
    const projectedLeader = makeSession({
      id: "leader-projected",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-42"],
          closedThreadTombstones: [],
          updatedAt: 10,
        },
      } as unknown as Session["state"],
    });
    const currentLeader = makeSession({
      id: "leader-current",
      board: new Map([
        [
          "q-42",
          boardRow("q-42", "WORKING", {
            title: "Leader authority",
            worker: "worker-current",
            createdAt: 100,
          }),
        ],
      ]),
    });
    const workerWithClaimAndStrayRow = makeSession({
      id: "worker-current",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-42",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-current",
      } as unknown as Session["state"],
      board: new Map([
        [
          "q-42",
          boardRow("q-42", "MEMORY", {
            title: "Stray worker row",
            createdAt: 1_000,
          }),
        ],
      ]),
    });

    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: [projectedLeader, currentLeader, workerWithClaimAndStrayRow],
      }).tabs[0],
    ).toMatchObject({
      title: "Leader authority",
      sourceLeaderSessionId: "leader-current",
      workerSessionId: "worker-current",
      active: true,
      completed: false,
    });
  });

  it("prefers an exact active leader claim over a newer legacy unscoped claim", () => {
    const projectedLeader = makeSession({
      id: "leader-projected",
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-43"],
          closedThreadTombstones: [],
          updatedAt: 10,
        },
      } as unknown as Session["state"],
    });
    const exactLeader = makeSession({
      id: "leader-exact",
      board: new Map([
        [
          "q-43",
          boardRow("q-43", "WORKING", {
            title: "Exact current row",
            worker: "worker-exact",
            createdAt: 100,
          }),
        ],
      ]),
    });
    const legacyLeader = makeSession({
      id: "leader-legacy",
      board: new Map([
        [
          "q-43",
          boardRow("q-43", "WORKING", {
            title: "Newer legacy row",
            worker: "worker-legacy",
            createdAt: 500,
          }),
        ],
      ]),
    });
    const exactWorker = makeSession({
      id: "worker-exact",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-43",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-exact",
      } as unknown as Session["state"],
    });
    const legacyWorker = makeSession({
      id: "worker-legacy",
      state: {
        isOrchestrator: false,
        claimedQuestId: "q-43",
        claimedQuestStatus: "in_progress",
      } as unknown as Session["state"],
    });

    expect(
      buildLeaderThreadTabsProjectionValue(projectedLeader, {
        sessions: [projectedLeader, exactLeader, legacyLeader, exactWorker, legacyWorker],
      }).tabs[0],
    ).toMatchObject({
      title: "Exact current row",
      sourceLeaderSessionId: "leader-exact",
      workerSessionId: "worker-exact",
    });
  });
});

describe("needs-input leader tab authority", () => {
  it("keeps a dismissed never-started scheduled tab closed when a prompt is created", () => {
    // A proposed/queued prompt may badge the hidden row but cannot revoke its tombstone.
    const session = makeSession({
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [{ threadKey: "q-2", closedAt: 1 }],
          updatedAt: 1,
        },
      } as unknown as Session["state"],
      board: new Map([["q-2", boardRow("q-2", "QUEUED")]]),
    });
    const deps = {
      persistSession: vi.fn(),
      getLauncherSessionInfo: () => ({ isOrchestrator: true }),
      isHerdedWorkerSession: () => false,
      broadcastToBrowsers: vi.fn(),
    };

    notifyUser(session, "needs-input", "Choose an option", deps, {
      threadRoute: { threadKey: "q-2", questId: "q-2" },
    });

    expect(session.state.leaderOpenThreadTabs).toMatchObject({
      orderedOpenThreadKeys: ["q-1"],
      closedThreadTombstones: [{ threadKey: "q-2", closedAt: 1 }],
    });
  });

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
