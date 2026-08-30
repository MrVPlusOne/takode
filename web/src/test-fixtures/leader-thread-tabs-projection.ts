import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionAttention,
  type LeaderThreadTabsProjectionTab,
  type LeaderThreadTabsProjectionTabState,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";

function attention(overrides: Partial<LeaderThreadTabsProjectionAttention> = {}): LeaderThreadTabsProjectionAttention {
  return {
    needsInput: false,
    mutedNeedsInput: false,
    reviewUnread: false,
    updatedAt: 0,
    ...overrides,
  };
}

function tab(threadKey: string, overrides: Partial<LeaderThreadTabsProjectionTab> = {}): LeaderThreadTabsProjectionTab {
  const { attention: attentionOverrides, ...rest } = overrides;
  return {
    threadKey,
    questId: threadKey,
    title: `Projected ${threadKey}`,
    boardStatus: null,
    journey: null,
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    active: false,
    queued: false,
    proposed: false,
    completed: false,
    canClose: true,
    updatedAt: 0,
    ...rest,
    attention: attention(attentionOverrides),
  };
}

export interface LeaderThreadTabsProjectionValueOverrides {
  /** Null omits the current-state marker for a legacy producer fixture. */
  currentQuestStateVersion?: 1 | null;
  tabState?: LeaderThreadTabsProjectionTabState | null;
  tabs?: LeaderThreadTabsProjectionTab[];
  mainAttention?: Partial<LeaderThreadTabsProjectionAttention>;
  threadStatuses?: LeaderThreadTabsProjectionValue["threadStatuses"];
  activePhaseSummary?: LeaderThreadTabsProjectionValue["activePhaseSummary"];
}

export function createLeaderThreadTabsProjectionValue(
  overrides: LeaderThreadTabsProjectionValueOverrides = {},
): LeaderThreadTabsProjectionValue {
  const tabState =
    overrides.tabState === undefined
      ? {
          version: 1 as const,
          orderedOpenThreadKeys: ["q-1", "q-2"],
          closedThreadTombstones: [{ threadKey: "q-9", closedAt: 50 }],
          updatedAt: 100,
        }
      : overrides.tabState;
  const tabs = overrides.tabs ?? [
    tab("q-1", {
      title: "Active projected thread",
      boardStatus: "WORKING",
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
        phaseCount: 3,
      },
      active: true,
      canClose: false,
      attention: attention({ needsInput: true, updatedAt: 90 }),
      updatedAt: 100,
    }),
    tab("q-2", {
      title: "Completed projected thread",
      boardStatus: "DONE",
      completed: true,
      attention: attention({ reviewUnread: true, updatedAt: 80 }),
      updatedAt: 80,
    }),
  ];
  return {
    ...(overrides.currentQuestStateVersion === null
      ? {}
      : { currentQuestStateVersion: overrides.currentQuestStateVersion ?? 1 }),
    tabState,
    tabs: tabs.map((entry) => ({
      ...entry,
      attention: { ...entry.attention },
      journey: entry.journey ? { ...entry.journey } : null,
    })),
    mainAttention: attention({ reviewUnread: true, updatedAt: 70, ...overrides.mainAttention }),
    threadStatuses: overrides.threadStatuses
      ? Object.fromEntries(Object.entries(overrides.threadStatuses).map(([key, status]) => [key, { ...status }]))
      : {
          main: {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "main",
            summary: "main result ready",
            messageId: "status-main",
            timestamp: 70,
            updatedAt: 70,
          },
          "q-2": {
            kind: "waiting",
            label: "Thread Waiting",
            threadKey: "q-2",
            questId: "q-2",
            summary: "waiting on validation",
            messageId: "status-q-2",
            timestamp: 80,
            updatedAt: 80,
          },
        },
    activePhaseSummary: (
      overrides.activePhaseSummary ?? [{ label: "Work", count: 1, tone: "phase", color: "blue", colorName: "Blue" }]
    ).map((segment) => ({ ...segment })),
  };
}

export interface LeaderThreadTabsProjectionEnvelopeOptions {
  type?: "synced_projection_snapshot" | "synced_projection_update";
  key?: string;
  generation?: string;
  revision?: number;
  value?: LeaderThreadTabsProjectionValue;
  overrides?: LeaderThreadTabsProjectionValueOverrides;
}

export function createLeaderThreadTabsProjectionEnvelope(options: LeaderThreadTabsProjectionEnvelopeOptions = {}) {
  return {
    type: options.type ?? "synced_projection_snapshot",
    projection: LEADER_THREAD_TABS_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "leader-tabs-generation-a",
    revision: options.revision ?? 1,
    value: options.value ?? createLeaderThreadTabsProjectionValue(options.overrides),
  } as const;
}
