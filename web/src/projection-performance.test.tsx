// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, render, type RenderResult } from "@testing-library/react";
import { memo, Profiler, useMemo, type ComponentProps, type ProfilerOnRenderCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderThreadTabsProjectionTab,
  LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import type { SessionNavigationProjectionValue } from "../shared/session-navigation-projection.js";
import type { BrowserIncomingMessage, SessionState } from "./types.js";
import { SessionItem } from "./components/SessionItem.js";
import { WorkBoardBar } from "./components/WorkBoardBar.js";
import type { BoardRowData } from "./components/BoardTable.js";
import { useStore } from "./store.js";
import { createWsMessageHandler } from "./ws-handlers.js";
import { buildSidebarVisibleSessions } from "./utils/sidebar-visible-sessions.js";
import {
  createSessionNavigationProjectionEnvelope,
  createSessionNavigationProjectionValue,
} from "./test-fixtures/session-navigation-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "./test-fixtures/leader-thread-tabs-projection.js";

const apiMocks = vi.hoisted(() => ({
  getQuestValidated: vi.fn().mockResolvedValue({ status: "missing", data: null, etag: null }),
  getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));
vi.mock("./utils/names.js", () => ({ generateUniqueSessionName: vi.fn(() => "Benchmark Session") }));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));
vi.mock("./ws.js", () => ({ sendToSession: vi.fn(() => true) }));

/**
 * Historical comparison anchors:
 *
 * - session navigation: 12b08e56dd321d5cd7138cf5e57ee42eb8796f7d
 * - leader thread tabs: 6b50d3bd51b3782540016f02dc76576e5b70281d
 *
 * This test does not load or execute those historical revisions. Instead, its legacy
 * controls replay the full retained producer shapes through today's legacy derivation
 * branches. Current scenarios always install a valid accepted v1 projection, and the
 * matched cases retain the parallel detail/activity fields a compatible server sends.
 * Missing, malformed, and mixed-version modes remain excluded.
 */
const SESSION_IDS = ["s-1", "s-2", "s-3", "s-4"] as const;
const LEADER_ID = "leader";
const LEADER_THREAD_KEYS = ["q-1", "q-2", "q-3", "q-4"] as const;
const NOOP = () => {};

const handleMessage = createWsMessageHandler({
  disconnectSession: NOOP,
  sendToSession: () => true,
  requestSyncedProjectionResync: () => true,
  hasPendingSyncedProjectionResync: () => false,
  resolveSyncedProjectionResync: NOOP,
  noteAcceptedSyncedProjectionSnapshot: NOOP,
  consumeSyncedProjectionSubscriptionsAck: (_carrierSessionId, subscriptions) => [...subscriptions],
});

type BenchmarkMode = "legacy" | "projection";

type StepMetrics = {
  rootCommits: number;
  childCommits: Record<string, number>;
  storeNotifications: number;
  profilerDurationMs: number;
};

type BenchmarkRecorder = {
  onRender: ProfilerOnRenderCallback;
  reset: () => void;
  snapshot: () => StepMetrics;
  stop: () => void;
};

function createBenchmarkRecorder(rootId: string): BenchmarkRecorder {
  let rootCommits = 0;
  let profilerDurationMs = 0;
  const childCommits = new Map<string, number>();
  let storeNotifications = 0;
  const unsubscribe = useStore.subscribe(() => {
    storeNotifications += 1;
  });
  const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
    profilerDurationMs += actualDuration;
    if (id === rootId) rootCommits += 1;
    else childCommits.set(id, (childCommits.get(id) ?? 0) + 1);
  };
  return {
    onRender,
    reset: () => {
      rootCommits = 0;
      profilerDurationMs = 0;
      childCommits.clear();
      storeNotifications = 0;
    },
    snapshot: () => ({
      rootCommits,
      childCommits: Object.fromEntries([...childCommits].sort(([left], [right]) => left.localeCompare(right))),
      storeNotifications,
      profilerDurationMs,
    }),
    stop: unsubscribe,
  };
}

function applyStep(recorder: BenchmarkRecorder, apply: () => void): StepMetrics {
  recorder.reset();
  act(apply);
  return recorder.snapshot();
}

function sumMetrics(metrics: readonly StepMetrics[]): StepMetrics {
  const childCommits = new Map<string, number>();
  let rootCommits = 0;
  let storeNotifications = 0;
  let profilerDurationMs = 0;
  for (const metric of metrics) {
    rootCommits += metric.rootCommits;
    storeNotifications += metric.storeNotifications;
    profilerDurationMs += metric.profilerDurationMs;
    for (const [id, count] of Object.entries(metric.childCommits)) {
      childCommits.set(id, (childCommits.get(id) ?? 0) + count);
    }
  }
  return {
    rootCommits,
    childCommits: Object.fromEntries([...childCommits].sort(([left], [right]) => left.localeCompare(right))),
    storeNotifications,
    profilerDurationMs,
  };
}

function aggregateClients(metrics: readonly StepMetrics[]): StepMetrics {
  return sumMetrics(metrics);
}

function structuralResult(result: { metrics: StepMetrics; output: string }) {
  const { profilerDurationMs: _reportOnlyDuration, ...metrics } = result.metrics;
  return { metrics, output: result.output };
}

function reportBenchmark(label: string, results: Record<string, unknown>): void {
  if (process.env.TAKODE_PROJECTION_PERF_REPORT !== "1") return;
  console.info(`[projection-performance] ${label} ${JSON.stringify(results)}`);
}

function makeSessionState(sessionId: string, isOrchestrator = false): SessionState {
  return {
    session_id: sessionId,
    model: "gpt-5.6",
    cwd: "/repo",
    tools: [],
    permissionMode: "default",
    claude_code_version: "2.1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 2,
    context_used_percent: 10,
    is_compacting: false,
    git_branch: "jiayi",
    is_worktree: true,
    is_containerized: false,
    repo_root: "/repo",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    isOrchestrator,
  };
}

function makeSdkSession(sessionId: string, index: number, isOrchestrator = false) {
  return {
    sessionId,
    state: "connected",
    model: "gpt-5.6",
    cwd: "/repo",
    createdAt: index + 1,
    archived: false,
    backendType: "codex",
    cliConnected: true,
    isWorktree: true,
    repoRoot: "/repo",
    gitBranch: "jiayi",
    gitAhead: 0,
    gitBehind: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    sessionNum: index + 1,
    isOrchestrator,
    lastActivityAt: 100 + index,
    lastUserMessageAt: 90 + index,
    lastMessagePreview: `Latest prompt ${index + 1}`,
    pendingPermissionCount: 0,
    pendingTimerCount: 0,
    notificationUrgency: null,
    activeNotificationCount: 0,
    activeNeedsInputNotificationCount: 0,
    activeReviewNotificationCount: 0,
    mutedNeedsInputNotificationCount: 0,
    notificationStatusVersion: 0,
    notificationStatusUpdatedAt: 0,
  } as const;
}

function navigationValue(
  index: number,
  status: SessionNavigationProjectionValue["status"] = "idle",
): SessionNavigationProjectionValue {
  return createSessionNavigationProjectionValue({
    identity: {
      name: `Session ${index + 1}`,
      sessionNum: index + 1,
      createdAt: index + 1,
    },
    topology: {
      treeGroupId: null,
      isWorktree: true,
      repoRoot: "/repo",
    },
    lifecycle: {
      status,
      lastActivityAt: 100 + index,
      lastUserMessageAt: 90 + index,
      lastMessagePreviewAt: 90 + index,
    },
    detail: { lastMessagePreview: `Latest prompt ${index + 1}` },
    quest: {
      claimedQuestId: null,
      claimedQuestTitle: null,
      claimedQuestStatus: null,
      claimedQuestVerificationInboxUnread: null,
      claimedQuestLeaderSessionId: null,
    },
  });
}

function installNavigationState(mode: BenchmarkMode): void {
  const sessions = new Map<string, SessionState>();
  const sdkSessions = SESSION_IDS.map((sessionId, index) => {
    sessions.set(sessionId, makeSessionState(sessionId));
    return makeSdkSession(sessionId, index);
  });
  useStore.setState({
    sessions,
    sdkSessions: sdkSessions as never,
    sessionNames: new Map(SESSION_IDS.map((sessionId, index) => [sessionId, `Session ${index + 1}`])),
    sessionPreviews: new Map(SESSION_IDS.map((sessionId, index) => [sessionId, `Latest prompt ${index + 1}`])),
    cliConnected: new Map(SESSION_IDS.map((sessionId) => [sessionId, true])),
    cliDisconnectReason: new Map(SESSION_IDS.map((sessionId) => [sessionId, null])),
    sessionStatus: new Map(SESSION_IDS.map((sessionId) => [sessionId, "idle"])),
    pendingPermissions: new Map(SESSION_IDS.map((sessionId) => [sessionId, new Map()])),
    askPermission: new Map(SESSION_IDS.map((sessionId) => [sessionId, true])),
    diffFileStats: new Map(),
    sessionAttention: new Map(SESSION_IDS.map((sessionId) => [sessionId, null])),
    treeGroups: [],
    treeAssignments: new Map(),
    treeNodeOrder: new Map(),
    collapsedTreeGroups: new Set(),
    expandedHerdNodes: new Set(),
  } as never);

  if (mode === "projection") {
    SESSION_IDS.forEach((sessionId, index) => {
      useStore.getState().applySyncedProjectionSnapshot(
        createSessionNavigationProjectionEnvelope({
          key: sessionId,
          generation: `navigation-generation-${sessionId}`,
          value: navigationValue(index),
        }),
      );
      useStore.getState().applySyncedProjectionSnapshot({
        type: "synced_projection_snapshot",
        projection: SESSION_ATTENTION_PROJECTION,
        key: sessionId,
        generation: `attention-generation-${sessionId}`,
        revision: 1,
        value: { attentionReason: null, status: null },
      });
    });
  }
}

const sessionItemProps: Omit<ComponentProps<typeof SessionItem>, "session" | "sessionName" | "attention"> = {
  isActive: false,
  isArchived: false,
  sessionPreview: undefined,
  permCount: 0,
  isRecentlyRenamed: false,
  onSelect: NOOP,
  onStartRename: NOOP,
  onArchive: NOOP,
  onUnarchive: NOOP,
  onDelete: NOOP,
  onClearRecentlyRenamed: NOOP,
  editingSessionId: null,
  editingName: "",
  setEditingName: NOOP,
  onConfirmRename: NOOP,
  onCancelRename: NOOP,
  editInputRef: { current: null },
};

const NavigationBenchmarkRow = memo(function NavigationBenchmarkRow({
  session,
  sessionName,
  sessionPreview,
  attention,
  onRender,
}: {
  session: ReturnType<typeof buildSidebarVisibleSessions>["allSessionList"][number];
  sessionName: string | undefined;
  sessionPreview: string | undefined;
  attention: "action" | "error" | "review" | null;
  onRender: ProfilerOnRenderCallback;
}) {
  return (
    <Profiler id={`navigation-row:${session.id}`} onRender={onRender}>
      <SessionItem
        session={session}
        sessionName={sessionName}
        sessionPreview={sessionPreview}
        attention={attention}
        {...sessionItemProps}
      />
    </Profiler>
  );
});

function SessionNavigationSurface({ mode, onRender }: { mode: BenchmarkMode; onRender: ProfilerOnRenderCallback }) {
  const source = useStore(
    useShallow((state) => ({
      sdkSessions: state.sdkSessions,
      syncedProjectionValues: state.syncedProjectionValues,
      syncedProjectionKeys: state.syncedProjectionKeys,
      treeGroups: state.treeGroups,
      treeAssignments: state.treeAssignments,
      treeNodeOrder: state.treeNodeOrder,
      collapsedTreeGroups: state.collapsedTreeGroups,
      expandedHerdNodes: state.expandedHerdNodes,
      sessionAttention: state.sessionAttention,
      sessionNotifications: mode === "legacy" ? state.sessionNotifications : undefined,
      sessionAttentionRecords: mode === "legacy" ? state.sessionAttentionRecords : undefined,
      sessionStatus: mode === "legacy" ? state.sessionStatus : undefined,
      sessionSortMode: state.sessionSortMode,
    })),
  );
  const visible = useMemo(() => {
    const current = buildSidebarVisibleSessions(source);
    if (mode !== "legacy") return current;
    return {
      ...current,
      allSessionList: current.allSessionList.map((session) => ({
        ...session,
        status: source.sessionStatus?.get(session.id) ?? session.status,
      })),
    };
  }, [mode, source]);

  return (
    <div
      data-testid="navigation-benchmark-surface"
      data-statuses={visible.allSessionList.map((session) => `${session.id}:${session.status}`).join("|")}
    >
      {visible.allSessionList.map((session) => (
        <NavigationBenchmarkRow
          key={session.id}
          session={session}
          sessionName={session.name ?? undefined}
          sessionPreview={session.lastMessagePreview || undefined}
          attention={visible.sessionSetAttention.get(session.id) ?? null}
          onRender={onRender}
        />
      ))}
    </div>
  );
}

function mountNavigationSurface(mode: BenchmarkMode, recorder: BenchmarkRecorder): RenderResult {
  return render(
    <Profiler id="navigation-root" onRender={recorder.onRender}>
      <SessionNavigationSurface mode={mode} onRender={recorder.onRender} />
    </Profiler>,
  );
}

function receiveNavigationActivity(status: "idle" | "running" | "compacting"): void {
  // Full historical 412-byte producer shape at the baseline (using worker-1):
  // status plus attention, permission, and notification summary fields.
  handleMessage("s-1", {
    type: "session_activity_update",
    session_id: "s-1",
    session: {
      attentionReason: null,
      lastReadAt: 0,
      pendingPermissionCount: 0,
      pendingPermissionSummary: null,
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 0,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: 0,
      notificationStatusUpdatedAt: 0,
      status,
    },
  } as BrowserIncomingMessage);
  // Reconstruct the retired current-build fallback for the historical control.
  // The production handler intentionally ignores these projection-owned fields.
  useStore.getState().updateSdkSession("s-1", { status, pendingPermissionCount: 0 });
  useStore.getState().setSessionStatus("s-1", status);
}

function receiveNavigationProjection(
  revision: number,
  status: SessionNavigationProjectionValue["status"],
  generation = "navigation-generation-s-1",
  type: "synced_projection_snapshot" | "synced_projection_update" = "synced_projection_update",
): void {
  handleMessage(
    "carrier",
    (type === "synced_projection_snapshot"
      ? createSessionNavigationProjectionEnvelope({
          type,
          key: "s-1",
          generation,
          revision,
          value: navigationValue(0, status),
        })
      : {
          type,
          projection: "session-navigation",
          key: "s-1",
          generation,
          revision,
          patch: { status },
        }) as BrowserIncomingMessage,
  );
}

function navigationStateSnapshot(status: "idle" | "running" | "compacting"): BrowserIncomingMessage {
  return {
    type: "state_snapshot",
    sessionStatus: status,
    permissionMode: "default",
    backendConnected: true,
    uiMode: null,
    askPermission: true,
    board: [],
    completedBoard: [],
    notifications: [],
    attentionRecords: [],
    rowSessionStatuses: {},
  } as BrowserIncomingMessage;
}

function readNavigationStatuses(view: RenderResult): string {
  return view.getByTestId("navigation-benchmark-surface").getAttribute("data-statuses") ?? "";
}

type Scenario = "noop" | "single" | "burst" | "reconnect";
type ScenarioResult = { metrics: StepMetrics; output: string };

function measureNavigation(mode: BenchmarkMode, scenario: Scenario): ScenarioResult {
  useStore.getState().reset();
  installNavigationState(mode);
  const recorder = createBenchmarkRecorder("navigation-root");
  const view = mountNavigationSurface(mode, recorder);
  const steps: StepMetrics[] = [];

  if (scenario === "noop") {
    steps.push(
      applyStep(recorder, () =>
        mode === "legacy" ? receiveNavigationActivity("idle") : receiveNavigationProjection(2, "idle"),
      ),
    );
  } else if (scenario === "single") {
    steps.push(
      applyStep(recorder, () =>
        mode === "legacy" ? receiveNavigationActivity("running") : receiveNavigationProjection(2, "running"),
      ),
    );
  } else if (scenario === "burst") {
    if (mode === "legacy") {
      for (const status of ["running", "compacting", "running"] as const) {
        steps.push(applyStep(recorder, () => receiveNavigationActivity(status)));
      }
    } else {
      steps.push(applyStep(recorder, () => receiveNavigationProjection(2, "running")));
    }
  } else {
    if (mode === "projection") {
      // Compatible reconnect order is projection snapshot, ack, then state_snapshot.
      steps.push(
        applyStep(recorder, () =>
          receiveNavigationProjection(1, "running", "navigation-reconnect-s-1", "synced_projection_snapshot"),
        ),
      );
    }
    steps.push(applyStep(recorder, () => handleMessage("s-1", navigationStateSnapshot("running"))));
  }

  const result = { metrics: sumMetrics(steps), output: readNavigationStatuses(view) };
  view.unmount();
  recorder.stop();
  return result;
}

function leaderBoard(status: "WORKING" | "MEMORY" | "DONE" = "WORKING"): BoardRowData[] {
  return LEADER_THREAD_KEYS.map((threadKey, index) => ({
    questId: threadKey,
    title: `Quest ${index + 1}`,
    status: index === 0 ? status : "WORKING",
    journey: {
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: index === 0 && status === "MEMORY" ? 2 : 1,
      currentPhaseId: index === 0 && status === "MEMORY" ? "memory" : "work",
    },
    createdAt: index + 1,
    updatedAt: 100 + index,
  })) as BoardRowData[];
}

function projectedLeaderTab(
  threadKey: string,
  index: number,
  status: "WORKING" | "MEMORY" | "DONE" = "WORKING",
): LeaderThreadTabsProjectionTab {
  const completed = index === 0 && status === "DONE";
  const tabStatus = index === 0 ? status : "WORKING";
  return {
    threadKey,
    questId: threadKey,
    title: `Quest ${index + 1}`,
    boardStatus: tabStatus,
    journey: completed
      ? null
      : {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: tabStatus === "MEMORY" ? "memory" : "work",
          activePhaseIndex: tabStatus === "MEMORY" ? 2 : 1,
          phaseCount: 3,
        },
    sourceLeaderSessionId: LEADER_ID,
    sourceRowCreatedAt: index + 1,
    workerSessionId: null,
    workerSessionNum: null,
    active: !completed,
    queued: false,
    proposed: false,
    completed,
    canClose: completed,
    attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    updatedAt: 100 + index,
  };
}

function leaderProjectionValue(status: "WORKING" | "MEMORY" | "DONE" = "WORKING"): LeaderThreadTabsProjectionValue {
  const tabs = LEADER_THREAD_KEYS.map((threadKey, index) => projectedLeaderTab(threadKey, index, status));
  return createLeaderThreadTabsProjectionValue({
    currentQuestStateVersion: 1,
    tabState: {
      version: 1,
      orderedOpenThreadKeys: [...LEADER_THREAD_KEYS],
      closedThreadTombstones: [],
      updatedAt: status === "WORKING" ? 100 : status === "MEMORY" ? 110 : 120,
    },
    tabs,
    mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    threadStatuses: {},
    activePhaseSummary:
      status === "DONE"
        ? [{ label: "Work", count: 3, tone: "phase" }]
        : [{ label: status === "MEMORY" ? "Memory" : "Work", count: 4, tone: "phase" }],
  });
}

function installLeaderState(mode: BenchmarkMode): void {
  const openTabs = {
    version: 1 as const,
    orderedOpenThreadKeys: [...LEADER_THREAD_KEYS],
    closedThreadTombstones: [],
    updatedAt: 100,
  };
  useStore.setState({
    sessions: new Map([
      [
        LEADER_ID,
        {
          ...makeSessionState(LEADER_ID, true),
          leaderOpenThreadTabs: openTabs,
          leaderThreadStatuses: {},
        },
      ],
    ]),
    sdkSessions: [{ ...makeSdkSession(LEADER_ID, 0, true), leaderOpenThreadTabs: openTabs }] as never,
    sessionBoards: new Map([[LEADER_ID, leaderBoard()]]),
    sessionCompletedBoards: new Map([[LEADER_ID, []]]),
    sessionBoardRowStatuses: new Map([[LEADER_ID, {}]]),
    quests: [],
    questDetails: new Map(),
    questTitlePreviews: new Map(),
    sessionStatus: new Map([[LEADER_ID, "idle"]]),
    activeTurnRoutes: new Map(),
  } as never);
  // Session-navigation and session-attention projections already existed at the
  // 6b50 leader-tabs control boundary, so both leader modes own those authorities.
  const leaderNavigation = navigationValue(0);
  leaderNavigation.name = "Leader";
  leaderNavigation.isOrchestrator = true;
  useStore.getState().applySyncedProjectionSnapshot(
    createSessionNavigationProjectionEnvelope({
      key: LEADER_ID,
      generation: "leader-navigation-generation",
      value: leaderNavigation,
    }),
  );
  useStore.getState().applySyncedProjectionSnapshot({
    type: "synced_projection_snapshot",
    projection: SESSION_ATTENTION_PROJECTION,
    key: LEADER_ID,
    generation: "leader-attention-generation",
    revision: 1,
    value: { attentionReason: null, status: null },
  });
  if (mode === "projection") {
    useStore
      .getState()
      .applySyncedProjectionSnapshot(
        createLeaderThreadTabsProjectionEnvelope({ key: LEADER_ID, value: leaderProjectionValue() }),
      );
  }
}

function mountLeaderSurface(mode: BenchmarkMode, recorder: BenchmarkRecorder): RenderResult {
  return render(
    <Profiler id="leader-root" onRender={recorder.onRender}>
      <WorkBoardBar
        sessionId={LEADER_ID}
        currentThreadKey="main"
        openThreadKeys={mode === "legacy" ? [...LEADER_THREAD_KEYS] : []}
        threadRows={[]}
        attentionRecords={[]}
      />
    </Profiler>,
  );
}

function leaderActivityFields(status: "WORKING" | "MEMORY" | "DONE") {
  const completed = status === "DONE" ? [leaderBoard("DONE")[0]!] : [];
  const board = status === "DONE" ? leaderBoard("WORKING").slice(1) : leaderBoard(status);
  return {
    board,
    completed,
    summary:
      status === "DONE"
        ? [{ label: "Work", count: 3, tone: "phase" as const }]
        : [{ label: status === "MEMORY" ? "Memory" : "Work", count: 4, tone: "phase" as const }],
  };
}

function receiveLeaderActivity(status: "WORKING" | "MEMORY" | "DONE"): void {
  const { board, summary } = leaderActivityFields(status);
  handleMessage("observer", {
    type: "session_activity_update",
    session_id: LEADER_ID,
    session: {
      attentionReason: null,
      lastReadAt: 0,
      pendingPermissionSummary: null,
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 0,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: 0,
      notificationStatusUpdatedAt: 0,
      leaderActiveBoardRows: board,
      leaderActivePhaseSummary: summary,
    },
  } as BrowserIncomingMessage);
}

function receiveBoard(status: "WORKING" | "MEMORY" | "DONE"): void {
  const { board, completed, summary } = leaderActivityFields(status);
  handleMessage(LEADER_ID, {
    type: "board_updated",
    board,
    completedBoard: completed,
    leaderOpenThreadTabs: {
      version: 1,
      orderedOpenThreadKeys: [...LEADER_THREAD_KEYS],
      closedThreadTombstones: [],
      updatedAt: status === "WORKING" ? 100 : status === "MEMORY" ? 110 : 120,
    },
    leaderActivePhaseSummary: summary,
    rowSessionStatuses: {},
  } as BrowserIncomingMessage);
}

function receiveLeaderProjection(
  revision: number,
  status: "WORKING" | "MEMORY" | "DONE",
  generation = "leader-tabs-generation-a",
  type: "synced_projection_snapshot" | "synced_projection_update" = "synced_projection_update",
): void {
  handleMessage(
    "carrier",
    createLeaderThreadTabsProjectionEnvelope({
      type,
      key: LEADER_ID,
      generation,
      revision,
      value: leaderProjectionValue(status),
    }) as BrowserIncomingMessage,
  );
}

function leaderStateSnapshot(status: "WORKING" | "MEMORY" | "DONE"): BrowserIncomingMessage {
  const { board, completed, summary } = leaderActivityFields(status);
  return {
    type: "state_snapshot",
    sessionStatus: "idle",
    permissionMode: "default",
    backendConnected: true,
    uiMode: null,
    askPermission: true,
    board,
    completedBoard: completed,
    notifications: [],
    attentionRecords: [],
    rowSessionStatuses: {},
    leaderActivePhaseSummary: summary,
    leaderThreadStatuses: {},
  } as BrowserIncomingMessage;
}

function readLeaderOutput(view: RenderResult): string {
  const tabs = [...view.container.querySelectorAll<HTMLElement>("[data-testid='thread-tab']")];
  return tabs
    .map((tab) => {
      const title = tab.querySelector<HTMLElement>("[data-testid='thread-tab-title']");
      return `${tab.dataset.threadKey}:${title?.getAttribute("data-title-color") ?? ""}:${tab.dataset.closable}`;
    })
    .join("|");
}

function measureLeader(
  mode: BenchmarkMode,
  scenario: Scenario,
  options: { includeDetailFrames?: boolean } = {},
): ScenarioResult {
  useStore.getState().reset();
  installLeaderState(mode);
  const recorder = createBenchmarkRecorder("leader-root");
  const view = mountLeaderSurface(mode, recorder);
  const steps: StepMetrics[] = [];

  const includeDetailFrames = mode === "legacy" || options.includeDetailFrames === true;
  const replayBoardProducer = (status: "WORKING" | "MEMORY" | "DONE") => {
    // Both sides already subscribe to navigation/attention at this comparison boundary.
    steps.push(applyStep(recorder, () => receiveLeaderActivity(status)));
    steps.push(applyStep(recorder, () => receiveBoard(status)));
  };
  if (scenario === "noop") {
    if (includeDetailFrames) replayBoardProducer("WORKING");
    if (mode === "projection") steps.push(applyStep(recorder, () => receiveLeaderProjection(2, "WORKING")));
  } else if (scenario === "single") {
    if (includeDetailFrames) replayBoardProducer("MEMORY");
    if (mode === "projection") {
      // The compatible pair sends activity summary, board detail, then its visual projection.
      steps.push(applyStep(recorder, () => receiveLeaderProjection(2, "MEMORY")));
    }
  } else if (scenario === "burst") {
    if (includeDetailFrames) {
      for (const status of ["MEMORY", "WORKING", "DONE"] as const) {
        replayBoardProducer(status);
      }
    }
    if (mode === "projection") {
      steps.push(applyStep(recorder, () => receiveLeaderProjection(2, "DONE")));
    }
  } else {
    if (mode === "projection") {
      steps.push(
        applyStep(recorder, () =>
          receiveLeaderProjection(1, "MEMORY", "leader-tabs-reconnect", "synced_projection_snapshot"),
        ),
      );
    }
    steps.push(applyStep(recorder, () => handleMessage(LEADER_ID, leaderStateSnapshot("MEMORY"))));
  }

  const result = { metrics: sumMetrics(steps), output: readLeaderOutput(view) };
  view.unmount();
  recorder.stop();
  return result;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

afterEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
});

describe("matched-build synchronized projection performance", () => {
  it("compares session-navigation no-op, one-field, coalesced burst, and reconnect work", () => {
    const legacyNoop = measureNavigation("legacy", "noop");
    const isolatedProjectionNoop = measureNavigation("projection", "noop");
    const matchedCompatibleNoop = measureNavigation("projection", "noop");
    const legacySingle = measureNavigation("legacy", "single");
    const isolatedProjectionSingle = measureNavigation("projection", "single");
    const matchedCompatibleSingle = measureNavigation("projection", "single");
    const legacyBurst = measureNavigation("legacy", "burst");
    const isolatedProjectionBurst = measureNavigation("projection", "burst");
    const matchedCompatibleBurst = measureNavigation("projection", "burst");
    const legacyReconnect = measureNavigation("legacy", "reconnect");
    const matchedCompatibleReconnect = measureNavigation("projection", "reconnect");

    reportBenchmark("session-navigation", {
      legacyNoop,
      isolatedProjectionNoop,
      matchedCompatibleNoop,
      legacySingle,
      isolatedProjectionSingle,
      matchedCompatibleSingle,
      legacyBurst,
      isolatedProjectionBurst,
      matchedCompatibleBurst,
      legacyReconnect,
      matchedCompatibleReconnect,
    });

    expect(isolatedProjectionNoop.output).toBe(legacyNoop.output);
    expect(matchedCompatibleNoop.output).toBe(isolatedProjectionNoop.output);
    expect(isolatedProjectionSingle.output).toBe(legacySingle.output);
    expect(matchedCompatibleSingle.output).toBe(isolatedProjectionSingle.output);
    expect(isolatedProjectionBurst.output).toBe(legacyBurst.output);
    expect(matchedCompatibleBurst.output).toBe(isolatedProjectionBurst.output);
    expect(matchedCompatibleReconnect.output).toBe(legacyReconnect.output);

    // Current-build navigation has no parallel activity residual. Equal
    // revisions therefore produce no React commit and only the handler notification.
    expect(isolatedProjectionNoop.metrics.rootCommits).toBe(0);
    expect(isolatedProjectionNoop.metrics.childCommits).toEqual({});
    expect(matchedCompatibleNoop.metrics.rootCommits).toBe(0);
    expect(legacyNoop.metrics.storeNotifications).toBe(4);
    expect(matchedCompatibleNoop.metrics.storeNotifications).toBe(1);

    // One field patch commits once and preserves every unrelated row identity.
    expect(isolatedProjectionSingle.metrics.rootCommits).toBe(1);
    expect(legacySingle.metrics.rootCommits).toBe(1);
    expect(matchedCompatibleSingle.metrics.rootCommits).toBe(1);
    expect(legacySingle.metrics.storeNotifications).toBe(4);
    expect(isolatedProjectionSingle.metrics.childCommits).toEqual({ "navigation-row:s-1": 1 });
    expect(matchedCompatibleSingle.metrics.childCommits).toEqual(isolatedProjectionSingle.metrics.childCommits);
    expect(matchedCompatibleSingle.metrics.storeNotifications).toBe(1);

    // A burst is coalesced to the same one-row, one-commit result.
    expect(isolatedProjectionBurst.metrics.rootCommits).toBe(1);
    expect(matchedCompatibleBurst.metrics.rootCommits).toBe(1);
    expect(matchedCompatibleBurst.metrics.childCommits).toEqual({ "navigation-row:s-1": 1 });
    expect(matchedCompatibleBurst.metrics.storeNotifications).toBe(1);
    expect(legacyBurst.metrics.rootCommits).toBe(3);
    expect(legacyBurst.metrics.storeNotifications).toBe(12);

    // Reconnect replaces authority without adding a React commit and rerenders
    // only the changed row; transport bookkeeping adds one store notification.
    expect(matchedCompatibleReconnect.metrics.rootCommits).toBe(legacyReconnect.metrics.rootCommits);
    expect(matchedCompatibleReconnect.metrics.childCommits).toEqual({ "navigation-row:s-1": 1 });
    expect(matchedCompatibleReconnect.metrics.storeNotifications).toBe(legacyReconnect.metrics.storeNotifications + 1);

    // Profiler durations are intentionally report-only: CI timing is noisy, while the
    // structural commit and store-notification assertions above are deterministic.
    expect(isolatedProjectionSingle.metrics.profilerDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("compares leader-tab no-op, detail-plus-projection updates, coalesced burst, and reconnect work", () => {
    const legacyNoop = measureLeader("legacy", "noop");
    const isolatedProjectionNoop = measureLeader("projection", "noop");
    const matchedCompatibleNoop = measureLeader("projection", "noop", { includeDetailFrames: true });
    const legacySingle = measureLeader("legacy", "single");
    const matchedCompatibleSingle = measureLeader("projection", "single", { includeDetailFrames: true });
    const legacyBurst = measureLeader("legacy", "burst");
    const isolatedProjectionBurst = measureLeader("projection", "burst");
    const matchedCompatibleBurst = measureLeader("projection", "burst", { includeDetailFrames: true });
    const legacyReconnect = measureLeader("legacy", "reconnect");
    const matchedCompatibleReconnect = measureLeader("projection", "reconnect");

    reportBenchmark("leader-thread-tabs", {
      legacyNoop,
      isolatedProjectionNoop,
      matchedCompatibleNoop,
      legacySingle,
      matchedCompatibleSingle,
      legacyBurst,
      isolatedProjectionBurst,
      matchedCompatibleBurst,
      legacyReconnect,
      matchedCompatibleReconnect,
    });

    expect(isolatedProjectionNoop.output).toBe(legacyNoop.output);
    expect(matchedCompatibleNoop.output).toBe(isolatedProjectionNoop.output);
    expect(matchedCompatibleSingle.output).toBe(legacySingle.output);
    expect(isolatedProjectionBurst.output).toBe(legacyBurst.output);
    expect(matchedCompatibleBurst.output).toBe(isolatedProjectionBurst.output);
    expect(matchedCompatibleReconnect.output).toBe(legacyReconnect.output);

    expect(isolatedProjectionNoop.metrics.rootCommits).toBe(0);
    expect(matchedCompatibleNoop.metrics.rootCommits).toBe(2);
    expect(legacyNoop.metrics.rootCommits).toBe(2);
    expect(legacyNoop.metrics.storeNotifications).toBe(7);
    expect(matchedCompatibleNoop.metrics.storeNotifications).toBe(6);

    // Each board producer first publishes activity summary and then board detail.
    // The matched pair adds its visual projection as a third delivery.
    expect(legacySingle.metrics.rootCommits).toBe(2);
    expect(legacySingle.metrics.storeNotifications).toBe(7);
    expect(matchedCompatibleSingle.metrics.rootCommits).toBe(3);
    expect(matchedCompatibleSingle.metrics.storeNotifications).toBeLessThan(legacySingle.metrics.storeNotifications);

    // The projection alone is one final commit. The matched burst retains activity
    // and board deliveries for all three producers; its seven commits equal the full
    // legacy control rather than collapsing to the isolated projection result.
    expect(isolatedProjectionBurst.metrics.rootCommits).toBe(1);
    expect(legacyBurst.metrics.rootCommits).toBe(7);
    expect(legacyBurst.metrics.storeNotifications).toBe(21);
    expect(matchedCompatibleBurst.metrics.rootCommits).toBe(7);
    expect(matchedCompatibleBurst.metrics.storeNotifications).toBe(16);

    expect(matchedCompatibleReconnect.metrics.rootCommits).toBe(legacyReconnect.metrics.rootCommits + 1);
    expect(matchedCompatibleReconnect.metrics.storeNotifications).toBeLessThan(
      legacyReconnect.metrics.storeNotifications,
    );
    expect(matchedCompatibleSingle.metrics.profilerDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps two independent compatible clients identical and exactly linear", () => {
    const navigationClients = [measureNavigation("projection", "single"), measureNavigation("projection", "single")];
    expect(structuralResult(navigationClients[1]!)).toEqual(structuralResult(navigationClients[0]!));
    const navigationAggregate = aggregateClients(navigationClients.map((client) => client.metrics));
    expect(navigationAggregate.rootCommits).toBe(navigationClients[0]!.metrics.rootCommits * 2);
    expect(navigationAggregate.storeNotifications).toBe(navigationClients[0]!.metrics.storeNotifications * 2);
    for (const [id, count] of Object.entries(navigationClients[0]!.metrics.childCommits)) {
      expect(navigationAggregate.childCommits[id]).toBe(count * 2);
    }

    const leaderClients = [
      measureLeader("projection", "single", { includeDetailFrames: true }),
      measureLeader("projection", "single", { includeDetailFrames: true }),
    ];
    expect(structuralResult(leaderClients[1]!)).toEqual(structuralResult(leaderClients[0]!));
    const leaderAggregate = aggregateClients(leaderClients.map((client) => client.metrics));
    expect(leaderAggregate.rootCommits).toBe(leaderClients[0]!.metrics.rootCommits * 2);
    expect(leaderAggregate.storeNotifications).toBe(leaderClients[0]!.metrics.storeNotifications * 2);
  });
});
