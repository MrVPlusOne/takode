import { describe, expect, it } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../../shared/session-attention-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { buildSidebarVisibleSessions, deriveSessionSetAttention } from "./sidebar-visible-sessions.js";
import type { SessionAttentionRecord, SessionState, SdkSessionInfo, TreeGroup } from "../types.js";

function makeSessionState(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: id,
    model: "model",
    cwd: `/repo/${id}`,
    tools: [],
    permissionMode: "default",
    claude_code_version: "1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/repo",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    treeGroupId: "default",
    ...overrides,
  };
}

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
    const sessions = new Map<string, SessionState>([
      ["leader", makeSessionState("leader")],
      ["worker", makeSessionState("worker")],
      ["reviewer", makeSessionState("reviewer")],
    ]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", { createdAt: 3, sessionNum: 10, isOrchestrator: true }),
      makeSdkSession("worker", { createdAt: 2, herdedBy: "leader", sessionNum: 11 }),
      makeSdkSession("reviewer", { createdAt: 1, reviewerOf: 11, sessionNum: 12 }),
    ];
    const treeGroups: TreeGroup[] = [{ id: "default", name: "Default" }];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups,
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(["leader"]),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.orderedVisibleSessionIds).toEqual(["leader", "worker"]);
  });

  it("keeps leader review blue only when an open thread tab has a blue notification", () => {
    const sessions = new Map<string, SessionState>([["leader", makeSessionState("leader")]]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", {
        isOrchestrator: true,
        cliConnected: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [],
          updatedAt: 100,
        },
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", "review"]]),
      sessionAttentionRecords: new Map([["leader", [attentionRecord()]]]),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.sessionSetAttention.get("leader")).toBe("review");
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("uses a fresh active session summary before attention or inbox hydration", () => {
    // Reconnect and multi-browser session lists can deliver the canonical
    // summary before this browser has raw attention or a per-session inbox.
    const sessions = new Map<string, SessionState>([["leader", makeSessionState("leader")]]);
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
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionNotifications: new Map(),
      sessionAttentionRecords: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.sessionSetAttention.get("leader")).toBe("review");
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("treats directly closed unread thread tabs as read for the session blue dot", () => {
    const sessions = new Map<string, SessionState>([["leader", makeSessionState("leader")]]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-1", closedAt: 200 }],
          updatedAt: 200,
        },
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map([["leader", "review"]]),
      sessionAttentionRecords: new Map([["leader", [attentionRecord()]]]),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.sessionSetAttention.get("leader")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(0);
  });

  it("uses a fresh cleared notification summary ahead of stale unread attention", () => {
    const sessions = new Map<string, SessionState>([["leader", makeSessionState("leader")]]);
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
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
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
      countUserPermissions: () => 0,
    });

    expect(result.sessionSetAttention.get("leader")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(0);
  });

  it("preserves active needs-input and muted-only attention semantics", () => {
    const sessions = new Map<string, SessionState>([
      ["needs-input", makeSessionState("needs-input")],
      ["muted", makeSessionState("muted")],
    ]);
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
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
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
      countUserPermissions: () => 0,
    });

    expect(result.sessionSetAttention.get("needs-input")).toBe("action");
    expect(result.sessionSetAttention.get("muted")).toBeNull();
    expect(result.treeViewGroups[0]?.unreadCount).toBe(1);
  });

  it("uses projection authority before selection even when legacy inputs and a timer disagree", () => {
    const sessions = new Map<string, SessionState>([["leader", makeSessionState("leader")]]);
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
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
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
      countUserPermissions: () => 0,
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

  it("filters hidden Side Chat child sessions that only exist in frontend store state", () => {
    const sessions = new Map<string, SessionState>([
      ["root", makeSessionState("root")],
      [
        "hidden-child",
        makeSessionState("hidden-child", {
          hidden: true,
          slackThreadChild: {
            rootSessionId: "root",
            threadId: "st-1",
            anchorMessageId: "a1",
            anchorHistoryIndex: 1,
            readOnly: true,
          },
        }),
      ],
    ]);
    const sdkSessions: SdkSessionInfo[] = [makeSdkSession("root", { createdAt: 2, sessionNum: 10 })];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.allSessionList.map((session) => session.id)).toEqual(["root"]);
    expect(result.orderedVisibleSessionIds).toEqual(["root"]);
  });

  it("filters direct Side Chat child socket snapshots using the root thread record", () => {
    const sessions = new Map<string, SessionState>([
      [
        "root",
        makeSessionState("root", {
          slackThreads: {
            "st-1": {
              id: "st-1",
              rootSessionId: "root",
              childSessionId: "hidden-child",
              anchorMessageId: "a1",
              anchorHistoryIndex: 1,
              anchorPreview: "Root reply",
              createdAt: 100,
              updatedAt: 100,
              messageCount: 0,
              seeded: false,
            },
          },
        }),
      ],
      [
        "hidden-child",
        makeSessionState("hidden-child", {
          hidden: undefined,
          slackThreadChild: undefined,
          treeGroupId: undefined,
        }),
      ],
    ]);

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions: [makeSdkSession("root", { createdAt: 2, sessionNum: 10 })],
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.allSessionList.map((session) => session.id)).toEqual(["root"]);
    expect(result.treeViewGroups.flatMap((group) => group.nodes.map((node) => node.leader.id))).toEqual(["root"]);
  });

  it("keeps archived reviewers attached to active parents without adding standalone archived rows", () => {
    const sessions = new Map<string, SessionState>([
      ["parent", makeSessionState("parent")],
      ["reviewer", makeSessionState("reviewer")],
    ]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("parent", { createdAt: 3, sessionNum: 11, archived: false }),
      makeSdkSession("reviewer", { createdAt: 2, reviewerOf: 11, sessionNum: 12, archived: true, archivedAt: 2500 }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    // Archived reviewer sessions should remain reachable from their parent
    // record, but should not become separate rows in the Archived section.
    expect(result.archivedSessions.map((s) => s.id)).toEqual([]);
    expect(result.activeReviewers).toEqual([]);
    expect(result.treeViewGroups[0].nodes[0].reviewers.map((s) => s.id)).toEqual(["reviewer"]);
  });

  it("carries archived worktree cleanup status into sidebar rows", () => {
    const result = buildSidebarVisibleSessions({
      sessions: new Map(),
      sdkSessions: [
        makeSdkSession("archived-worktree", {
          archived: true,
          isWorktree: true,
          worktreeExists: true,
          worktreeCleanupStatus: "failed",
          worktreeCleanupError: "cleanup failed",
        }),
      ],
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
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
    const sessions = new Map<string, SessionState>([
      ["leader", makeSessionState("leader")],
      ["worker", makeSessionState("worker")],
      ["standalone", makeSessionState("standalone")],
    ]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("leader", { createdAt: 3, sessionNum: 10, isOrchestrator: true }),
      makeSdkSession("worker", { createdAt: 2, herdedBy: "leader", sessionNum: 11 }),
      makeSdkSession("standalone", { createdAt: 1, sessionNum: 12 }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map([["default", ["leader", "standalone"]]]),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.orderedVisibleSessionIds).toEqual(["leader", "standalone"]);
  });

  it("hides an entire collapsed tree group from ordered visible rows", () => {
    const sessions = new Map<string, SessionState>([
      ["default-session", makeSessionState("default-session")],
      ["quest-session", makeSessionState("quest-session")],
    ]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("default-session", { createdAt: 2, sessionNum: 10 }),
      makeSdkSession("quest-session", { createdAt: 1, sessionNum: 11 }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
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
      countUserPermissions: () => 0,
    });

    expect(result.orderedVisibleSessionIds).toEqual(["default-session"]);
  });

  it("uses snapshot treeGroupId while tree assignments are still hydrating", () => {
    const sessions = new Map<string, SessionState>();
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
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
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
      countUserPermissions: () => 0,
    });

    expect(result.treeViewGroups.find((group) => group.id === "default")?.nodes).toHaveLength(0);
    expect(result.treeViewGroups.find((group) => group.id === "oai")?.nodes.map((node) => node.leader.id)).toEqual([
      "oai-leader",
    ]);
  });

  it("preserves completed quest review metadata from idle session snapshots", () => {
    const sessions = new Map<string, SessionState>();
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("worker", {
        claimedQuestStatus: "done",
        claimedQuestVerificationInboxUnread: true,
        createdAt: 1,
        sessionNum: 12,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.allSessionList[0]).toMatchObject({
      id: "worker",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
  });

  it("keeps live completed quest state when a polled snapshot is stale", () => {
    const sessions = new Map<string, SessionState>([
      [
        "worker",
        makeSessionState("worker", {
          claimedQuestStatus: "done",
          claimedQuestVerificationInboxUnread: true,
        }),
      ],
    ]);
    const sdkSessions: SdkSessionInfo[] = [
      makeSdkSession("worker", {
        claimedQuestStatus: "in_progress",
        claimedQuestVerificationInboxUnread: undefined,
        createdAt: 1,
        sessionNum: 12,
      }),
    ];

    const result = buildSidebarVisibleSessions({
      sessions,
      sdkSessions,
      cliConnected: new Map(),
      cliDisconnectReason: new Map(),
      sessionStatus: new Map(),
      pendingPermissions: new Map(),
      askPermission: new Map(),
      diffFileStats: new Map(),
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: new Map(),
      sessionSortMode: "created",
      countUserPermissions: () => 0,
    });

    expect(result.allSessionList[0]).toMatchObject({
      id: "worker",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
  });
});
