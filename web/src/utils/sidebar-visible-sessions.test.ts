import { describe, expect, it } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../../shared/session-attention-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { buildSidebarVisibleSessions, deriveSessionSetAttention } from "./sidebar-visible-sessions.js";
import type { SessionAttentionRecord, SdkSessionInfo, TreeGroup } from "../types.js";

function makeSdkSession(id: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: id,
    state: "connected",
    cwd: `/repo/${id}`,
    createdAt: 1,
    archived: false,
    treeGroupId: "default",
    ...overrides,
  };
}

function attentionRecord(overrides: Partial<SessionAttentionRecord> = {}): SessionAttentionRecord {
  return {
    id: "attention:q-1",
    leaderSessionId: "leader",
    type: "review_ready",
    source: { kind: "notification", id: "n-review", questId: "q-1" },
    questId: "q-1",
    threadKey: "q-1",
    title: "Review q-1",
    summary: "Review q-1",
    actionLabel: "Review",
    priority: "review",
    state: "unresolved",
    createdAt: 100,
    updatedAt: 100,
    route: { threadKey: "q-1", questId: "q-1" },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: "attention:q-1",
    ...overrides,
  };
}

function projectedSessionKeys(...sessionIds: string[]): Set<string> {
  return new Set(sessionIds.map((sessionId) => syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, sessionId)));
}

describe("buildSidebarVisibleSessions", () => {
  it("derives ordered visible rows without reviewer sessions", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", { createdAt: 3, sessionNum: 10, isOrchestrator: true }),
      makeSdkSession("worker", { createdAt: 2, herdedBy: "leader", sessionNum: 11 }),
      makeSdkSession("reviewer", { createdAt: 1, reviewerOf: 11, sessionNum: 12 }),
    ];
    const treeGroups: TreeGroup[] = [{ id: "default", name: "Default" }];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups,
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(["leader"]),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.orderedVisibleSessionIds).toEqual(["leader", "worker"]);
  });

  it("uses projected leader review attention for the session blue dot", () => {
    const sdkSessions: SdkSessionInfo[] = [makeSdkSession("leader", { isOrchestrator: true, cliConnected: true })];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", "review"]]),
      syncedProjectionKeys: projectedSessionKeys("leader"),
      sessionAttentionRecords: new Map([["leader", [attentionRecord()]]]),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("leader")).toBe("review");
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("uses a fresh active session summary before attention or inbox hydration", () => {
    // Reconnect and multi-browser session lists can deliver the canonical
    // summary before this browser has raw attention or a per-session inbox.
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", {
        isOrchestrator: true,
        cliConnected: true,
        notificationUrgency: "review",
        activeNotificationCount: 3,
        activeReviewNotificationCount: 3,
        notificationStatusVersion: 12,
        notificationStatusUpdatedAt: 12_000,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1964", "q-1969", "q-1977"],
          closedThreadTombstones: [],
          updatedAt: 12_000,
        },
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionNotifications: new Map(),
      sessionAttentionRecords: new Map(),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("leader")).toBe("review");
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("uses the projected cleared attention after a leader thread tab is closed", () => {
    const sdkSessions: SdkSessionInfo[] = [makeSdkSession("leader", { isOrchestrator: true })];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", null]]),
      syncedProjectionKeys: projectedSessionKeys("leader"),
      sessionAttentionRecords: new Map([["leader", [attentionRecord()]]]),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("leader")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(0);
  });

  it("uses a fresh cleared notification summary ahead of stale unread attention", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", {
        notificationUrgency: null,
        activeNotificationCount: 0,
        mutedNeedsInputNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", "review"]]),
      sessionNotifications: new Map([
        [
          "leader",
          [
            {
              id: "n-review",
              category: "review",
              summary: "Stale review",
              timestamp: 100,
              done: false,
              messageId: null,
            },
          ],
        ],
      ]),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("leader")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(0);
  });

  it("preserves active needs-input and muted-only attention semantics", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("needs-input", {
        cliConnected: true,
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        activeNeedsInputNotificationCount: 1,
        notificationStatusVersion: 2,
      }),
      makeSdkSession("muted", {
        cliConnected: true,
        notificationUrgency: null,
        activeNotificationCount: 0,
        mutedNeedsInputNotificationCount: 1,
        notificationStatusVersion: 3,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([
        ["needs-input", "action"],
        ["muted", null],
      ]),
      sessionNotifications: new Map([
        [
          "needs-input",
          [
            {
              id: "n-input",
              category: "needs-input",
              summary: "Need answer",
              timestamp: 100,
              done: false,
              messageId: null,
            },
          ],
        ],
        [
          "muted",
          [
            {
              id: "n-muted",
              category: "needs-input",
              summary: "Muted answer",
              timestamp: 100,
              done: false,
              messageId: null,
              muted: true,
            },
          ],
        ],
      ]),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("needs-input")).toBe("action");
    expect(result.sessionSetAttention.get("muted")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("uses attention projection authority before selection while preserving navigation timer data", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", {
        isOrchestrator: true,
        cliConnected: true,
        pendingTimerCount: 1,
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 8,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-closed", closedAt: 8000 }],
          updatedAt: 8000,
        },
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", "review"]]),
      syncedProjectionKeys: projectedSessionKeys("leader"),
      sessionNotifications: new Map(),
      sessionAttentionRecords: new Map([["leader", [attentionRecord({ threadKey: "q-closed", questId: "q-closed" })]]]),
      sessionSortMode: "created",
    });

    expect(result.sessionSetAttention.get("leader")).toBe("review");
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
    expect(result.allSessionList[0]?.pendingTimerCount).toBe(1);
  });

  it("bypasses every legacy attention derivation for projected needs-input, muted-only, and clear keys", () => {
    const sdkSessions = [
      makeSdkSession("needs-input", {
        notificationUrgency: "review",
        activeNotificationCount: 4,
        notificationStatusVersion: 4,
      }),
      makeSdkSession("muted", {
        notificationUrgency: "review",
        activeNotificationCount: 2,
        notificationStatusVersion: 2,
      }),
      makeSdkSession("clear", {
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 1,
      }),
    ];

    const result = deriveSessionSetAttention({
      sessionAttention: new Map([
        ["needs-input", "action"],
        ["muted", null],
        ["clear", null],
      ]),
      syncedProjectionKeys: projectedSessionKeys("needs-input", "muted", "clear"),
      sdkSessions,
      sessionNotifications: new Map([
        [
          "needs-input",
          [{ id: "legacy-review", category: "review", summary: "Review", timestamp: 1, done: false, messageId: null }],
        ],
        [
          "muted",
          [
            {
              id: "legacy-review-2",
              category: "review",
              summary: "Review",
              timestamp: 1,
              done: false,
              messageId: null,
            },
          ],
        ],
        [
          "clear",
          [
            {
              id: "legacy-input",
              category: "needs-input",
              summary: "Input",
              timestamp: 1,
              done: false,
              messageId: null,
            },
          ],
        ],
      ]),
    });

    expect(result).toEqual(
      new Map([
        ["needs-input", "action"],
        ["muted", null],
        ["clear", null],
      ]),
    );
  });

  it("filters hidden Side Chat child sessions from the compatible-build snapshot", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("root", { createdAt: 2, sessionNum: 10 }),
      makeSdkSession("hidden-child", { createdAt: 1, sessionNum: 11, hidden: true }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.allSessionList.map((session) => session.id)).toEqual(["root"]);
    expect(result.orderedVisibleSessionIds).toEqual(["root"]);
  });

  it("does not invent Side Chat child rows omitted from the compatible-build snapshot", () => {
    const result = buildSidebarVisibleSessions({
      sdkSessions: [makeSdkSession("root", { createdAt: 2, sessionNum: 10 })],
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.allSessionList.map((session) => session.id)).toEqual(["root"]);
    expect(result.treeViewGroups.flatMap((group) => group.nodes.map((node) => node.leader.id))).toEqual(["root"]);
  });

  it("keeps archived reviewers attached to active parents without adding standalone archived rows", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("parent", { createdAt: 3, sessionNum: 11, archived: false }),
      makeSdkSession("reviewer", { createdAt: 2, reviewerOf: 11, sessionNum: 12, archived: true, archivedAt: 2500 }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    // Archived reviewer sessions should remain reachable from their parent
    // record, but should not become separate rows in the Archived section.
    expect(result.archivedSessions.map((s) => s.id)).toEqual([]);
    expect(result.activeReviewers).toEqual([]);
    expect(result.treeViewGroups[0].nodes[0].reviewers.map((s) => s.id)).toEqual(["reviewer"]);
  });

  it("carries archived worktree cleanup status into sidebar rows", () => {
    const result = buildSidebarVisibleSessions({
      sdkSessions: [
        makeSdkSession("archived-worktree", {
          archived: true,
          isWorktree: true,
          worktreeExists: true,
          worktreeCleanupStatus: "failed",
          worktreeCleanupError: "cleanup failed",
        }),
      ],
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.archivedSessions[0]).toMatchObject({
      id: "archived-worktree",
      isWorktree: true,
      worktreeExists: true,
      worktreeCleanupStatus: "failed",
      worktreeCleanupError: "cleanup failed",
    });
  });

  it("hides workers from ordered visible rows when their herd is collapsed", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", { createdAt: 3, sessionNum: 10, isOrchestrator: true }),
      makeSdkSession("worker", { createdAt: 2, herdedBy: "leader", sessionNum: 11 }),
      makeSdkSession("standalone", { createdAt: 1, sessionNum: 12 }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map([["default", ["leader", "standalone"]]]),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.orderedVisibleSessionIds).toEqual(["leader", "standalone"]);
  });

  it("hides an entire collapsed tree group from ordered visible rows", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("default-session", { createdAt: 2, sessionNum: 10 }),
      makeSdkSession("quest-session", { createdAt: 1, sessionNum: 11 }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [
        { id: "default", name: "Default" },
        { id: "quest", name: "Quest" },
      ],
      treeAssignments: new Map([["quest-session", "quest"]]),
      treeNodeOrder: new Map([
        ["default", ["default-session"]],
        ["quest", ["quest-session"]],
      ]),
      collapsedTreeGroups: new Set(["quest"]),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.orderedVisibleSessionIds).toEqual(["default-session"]);
  });

  it("uses snapshot treeGroupId while tree assignments are still hydrating", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("oai-leader", {
        createdAt: 1,
        sessionNum: 710,
        isOrchestrator: true,
        treeGroupId: "oai",
        memorySessionSpaceSlug: "OAI",
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [
        { id: "default", name: "Default" },
        { id: "oai", name: "OAI" },
      ],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.treeViewGroups.find((group) => group.id === "default")?.nodes).toHaveLength(0);
    expect(result.treeViewGroups.find((group) => group.id === "oai")?.nodes.map((node) => node.leader.id)).toEqual([
      "oai-leader",
    ]);
  });

  it("preserves completed quest review metadata from idle session snapshots", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("worker", {
        claimedQuestStatus: "done",
        claimedQuestVerificationInboxUnread: true,
        createdAt: 1,
        sessionNum: 12,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.allSessionList[0]).toMatchObject({
      id: "worker",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
  });

  it("uses quest status from the current compatible-build snapshot", () => {
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("worker", {
        claimedQuestStatus: "in_progress",
        claimedQuestVerificationInboxUnread: undefined,
        createdAt: 1,
        sessionNum: 12,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
    });

    expect(result.allSessionList[0]).toMatchObject({
      id: "worker",
      claimedQuestStatus: "in_progress",
      claimedQuestVerificationInboxUnread: undefined,
    });
  });
});
