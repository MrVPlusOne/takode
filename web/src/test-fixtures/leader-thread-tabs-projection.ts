import {
  LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
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

export function createLeaderThreadTabsProjectionTab(
  threadKey: string,
  overrides: Partial<Omit<LeaderThreadTabsProjectionTab, "attention">> & {
    attention?: Partial<LeaderThreadTabsProjectionAttention>;
  } = {},
): LeaderThreadTabsProjectionTab {
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
    neverStartedScheduled: false,
    completed: false,
    canClose: true,
    updatedAt: 0,
    ...rest,
    attention: attention(attentionOverrides),
  };
}

export interface LeaderThreadTabsProjectionValueOverrides {
  tabState?:
    | (LeaderThreadTabsProjectionTabState & {
        orderedOpenThreadKeys?: string[];
        closedThreadTombstones?: Array<{ threadKey: string; closedAt: number }>;
        updatedAt?: number;
        migratedFromLocalStorageAt?: number;
        explicitOrderUpdatedAt?: number;
      })
    | null;
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
      ? { version: 1 as const }
      : overrides.tabState
        ? { version: overrides.tabState.version }
        : null;
  const tabs = overrides.tabs ?? [
    createLeaderThreadTabsProjectionTab("q-1", {
      title: "Active projected thread",
      boardStatus: "WORKING",
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
        phaseCount: 3,
        durationSummary: null,
      },
      active: true,
      canClose: false,
      attention: attention({ needsInput: true, updatedAt: 90 }),
      updatedAt: 100,
    }),
    createLeaderThreadTabsProjectionTab("q-2", {
      title: "Completed projected thread",
      boardStatus: "DONE",
      completed: true,
      attention: attention({ reviewUnread: true, updatedAt: 80 }),
      updatedAt: 80,
    }),
  ];
  return {
    currentQuestStateVersion: 1,
    tabState,
    tabs: tabs.map((entry) => ({
      ...entry,
      attention: { ...entry.attention },
      journey: entry.journey
        ? {
            ...entry.journey,
            durationSummary:
              entry.journey.durationSummary !== null && typeof entry.journey.durationSummary === "object"
                ? {
                    ...entry.journey.durationSummary,
                    phaseDurationsMs: [...entry.journey.durationSummary.phaseDurationsMs],
                  }
                : entry.journey.durationSummary,
          }
        : null,
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
