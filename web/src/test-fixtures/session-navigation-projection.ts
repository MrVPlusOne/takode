import {
  SESSION_NAVIGATION_PROJECTION,
  type SessionNavigationProjectionValue,
} from "../../shared/session-navigation-projection.js";

type Picked<K extends keyof SessionNavigationProjectionValue> = Partial<Pick<SessionNavigationProjectionValue, K>>;

export interface SessionNavigationProjectionOverrides {
  identity?: Picked<
    "name" | "model" | "cwd" | "backendType" | "permissionMode" | "askPermission" | "sessionNum" | "createdAt"
  >;
  topology?: Picked<
    | "treeGroupId"
    | "memorySessionSpaceSlug"
    | "repoRoot"
    | "isWorktree"
    | "isContainerized"
    | "isAssistant"
    | "isOrchestrator"
    | "herdedBy"
    | "reviewerOf"
    | "cronJobId"
    | "cronJobName"
  >;
  lifecycle?: Picked<
    | "state"
    | "status"
    | "cliConnected"
    | "killedByIdleManager"
    | "pendingPermissionCount"
    | "pendingTimerCount"
    | "paused"
    | "pausedInputQueueCount"
    | "lastActivityAt"
    | "lastUserMessageAt"
    | "lastMessagePreviewAt"
  > & {
    sdkState?: SessionNavigationProjectionValue["state"];
    idleKilled?: boolean;
  };
  quest?: Picked<
    | "claimedQuestId"
    | "claimedQuestTitle"
    | "claimedQuestStatus"
    | "claimedQuestVerificationInboxUnread"
    | "claimedQuestLeaderSessionId"
  >;
  git?: Picked<
    | "gitBranch"
    | "gitDefaultBranch"
    | "diffBaseBranch"
    | "gitAhead"
    | "gitBehind"
    | "totalLinesAdded"
    | "totalLinesRemoved"
    | "diffStatsSkippedReason"
    | "gitStatusRefreshedAt"
    | "gitStatusRefreshError"
  > & {
    branch?: string;
    defaultBranch?: string;
    ahead?: number;
    behind?: number;
    linesAdded?: number;
    linesRemoved?: number;
    statusRefreshedAt?: number | null;
    statusRefreshError?: string | null;
  };
  detail?: Picked<
    | "lastMessagePreview"
    | "userTurnCount"
    | "agentTurnCount"
    | "contextUsedPercent"
    | "contextTokensUsed"
    | "modelContextWindow"
    | "codexMaxContextLength"
    | "claudeMaxContextLength"
    | "codexLeaderRecycleThresholdTokens"
    | "messageHistoryBytes"
    | "codexRetainedPayloadBytes"
    | "codexReasoningEffort"
    | "codexEffectiveReasoningEffort"
    | "codexEffectiveReasoningEffortReported"
  > & {
    configuredContextWindow?: number | null;
    effectiveContextWindow?: number | null;
  };
}

export function createSessionNavigationProjectionValue(
  overrides: SessionNavigationProjectionOverrides = {},
): SessionNavigationProjectionValue {
  const { sdkState, idleKilled, ...lifecycle } = overrides.lifecycle ?? {};
  const {
    branch,
    defaultBranch,
    ahead,
    behind,
    linesAdded,
    linesRemoved,
    statusRefreshedAt,
    statusRefreshError,
    ...git
  } = overrides.git ?? {};
  const { configuredContextWindow, effectiveContextWindow, ...detail } = overrides.detail ?? {};
  return {
    name: "Worker",
    model: "gpt-5.6",
    cwd: "/repo",
    backendType: "codex",
    permissionMode: "default",
    askPermission: true,
    sessionNum: 42,
    createdAt: 1,
    treeGroupId: "default",
    memorySessionSpaceSlug: "Takode",
    repoRoot: "/repo",
    isWorktree: true,
    isContainerized: false,
    isAssistant: false,
    isOrchestrator: false,
    herdedBy: null,
    reviewerOf: null,
    cronJobId: null,
    cronJobName: null,
    state: sdkState ?? lifecycle.state ?? "connected",
    status: "idle",
    cliConnected: true,
    killedByIdleManager: idleKilled ?? lifecycle.killedByIdleManager ?? false,
    pendingPermissionCount: 0,
    pendingTimerCount: 0,
    paused: false,
    pausedInputQueueCount: 0,
    lastActivityAt: 2,
    lastUserMessageAt: 1,
    lastMessagePreviewAt: 1,
    claimedQuestId: null,
    claimedQuestTitle: null,
    claimedQuestStatus: null,
    claimedQuestVerificationInboxUnread: null,
    claimedQuestLeaderSessionId: null,
    gitBranch: branch ?? git.gitBranch ?? "jiayi",
    gitDefaultBranch: defaultBranch ?? git.gitDefaultBranch ?? "main",
    diffBaseBranch: "main",
    gitAhead: ahead ?? git.gitAhead ?? 0,
    gitBehind: behind ?? git.gitBehind ?? 0,
    totalLinesAdded: linesAdded ?? git.totalLinesAdded ?? 0,
    totalLinesRemoved: linesRemoved ?? git.totalLinesRemoved ?? 0,
    diffStatsSkippedReason: null,
    gitStatusRefreshedAt: statusRefreshedAt ?? git.gitStatusRefreshedAt ?? 3,
    gitStatusRefreshError: statusRefreshError ?? git.gitStatusRefreshError ?? null,
    lastMessagePreview: "Latest prompt",
    userTurnCount: 1,
    agentTurnCount: 1,
    contextUsedPercent: 10,
    contextTokensUsed: 1_000,
    modelContextWindow: 128_000,
    codexMaxContextLength: configuredContextWindow ?? detail.codexMaxContextLength ?? null,
    claudeMaxContextLength: null,
    codexLeaderRecycleThresholdTokens: effectiveContextWindow ?? detail.codexLeaderRecycleThresholdTokens ?? 120_000,
    messageHistoryBytes: 2_000,
    codexRetainedPayloadBytes: 1_500,
    codexReasoningEffort: "high",
    codexEffectiveReasoningEffort: "high",
    codexEffectiveReasoningEffortReported: true,
    ...overrides.identity,
    ...overrides.topology,
    ...lifecycle,
    ...overrides.quest,
    ...git,
    ...detail,
  };
}

export function createSessionNavigationProjectionEnvelope(
  options: {
    type?: "synced_projection_snapshot" | "synced_projection_update";
    key?: string;
    generation?: string;
    revision?: number;
    value?: SessionNavigationProjectionValue;
    overrides?: SessionNavigationProjectionOverrides;
  } = {},
) {
  return {
    type: options.type ?? "synced_projection_snapshot",
    projection: SESSION_NAVIGATION_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "navigation-generation-a",
    revision: options.revision ?? 1,
    value: options.value ?? createSessionNavigationProjectionValue(options.overrides),
  } as const;
}
