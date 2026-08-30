import {
  SESSION_NAVIGATION_PROJECTION,
  type SessionNavigationDetailSlice,
  type SessionNavigationGitSlice,
  type SessionNavigationIdentitySlice,
  type SessionNavigationLifecycleSlice,
  type SessionNavigationProjectionValue,
  type SessionNavigationQuestSlice,
  type SessionNavigationTopologySlice,
} from "../../shared/session-navigation-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../../shared/synced-projection.js";

export interface SessionNavigationProjectionOverrides {
  identity?: Partial<SessionNavigationIdentitySlice>;
  topology?: Partial<SessionNavigationTopologySlice>;
  lifecycle?: Partial<SessionNavigationLifecycleSlice>;
  quest?: Partial<SessionNavigationQuestSlice>;
  git?: Partial<SessionNavigationGitSlice>;
  detail?: Partial<SessionNavigationDetailSlice>;
}

export function createSessionNavigationProjectionValue(
  overrides: SessionNavigationProjectionOverrides = {},
): SessionNavigationProjectionValue {
  return {
    identity: {
      name: "Worker",
      model: "gpt-5.6",
      cwd: "/repo",
      backendType: "codex",
      permissionMode: "default",
      askPermission: true,
      sessionNum: 42,
      createdAt: 1,
      ...overrides.identity,
    },
    topology: {
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
      ...overrides.topology,
    },
    lifecycle: {
      sdkState: "connected",
      status: "idle",
      cliConnected: true,
      idleKilled: false,
      pendingPermissionCount: 0,
      pendingTimerCount: 0,
      paused: false,
      pausedInputQueueCount: 0,
      lastActivityAt: 2,
      lastUserMessageAt: 1,
      lastMessagePreviewAt: 1,
      ...overrides.lifecycle,
    },
    quest: {
      claimedQuestId: null,
      claimedQuestTitle: null,
      claimedQuestStatus: null,
      claimedQuestVerificationInboxUnread: null,
      claimedQuestLeaderSessionId: null,
      ...overrides.quest,
    },
    git: {
      branch: "jiayi",
      defaultBranch: "main",
      diffBaseBranch: "main",
      ahead: 0,
      behind: 0,
      linesAdded: 0,
      linesRemoved: 0,
      diffStatsSkippedReason: null,
      statusRefreshedAt: 3,
      statusRefreshError: null,
      ...overrides.git,
    },
    detail: {
      lastMessagePreview: "Latest prompt",
      userTurnCount: 1,
      agentTurnCount: 1,
      contextUsedPercent: 10,
      contextTokensUsed: 1_000,
      modelContextWindow: 128_000,
      configuredContextWindow: null,
      effectiveContextWindow: 120_000,
      messageHistoryBytes: 2_000,
      codexRetainedPayloadBytes: 1_500,
      codexReasoningEffort: "high",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
      ...overrides.detail,
    },
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
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_NAVIGATION_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "navigation-generation-a",
    revision: options.revision ?? 1,
    value: options.value ?? createSessionNavigationProjectionValue(options.overrides),
  } as const;
}
