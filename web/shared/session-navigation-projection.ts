/** Compact server-owned summary used by session navigation surfaces. */
export const SESSION_NAVIGATION_PROJECTION = "session-navigation" as const;

export const SESSION_NAVIGATION_ID_MAX_LENGTH = 160;
export const SESSION_NAVIGATION_TEXT_MAX_LENGTH = 1_024;
export const SESSION_NAVIGATION_PATH_MAX_LENGTH = 4_096;
export const SESSION_NAVIGATION_PREVIEW_MAX_LENGTH = 80;

export type SessionNavigationBackendType = "claude" | "codex" | "claude-sdk";
export type SessionNavigationSdkState = "starting" | "connected" | "running" | "exited";
export type SessionNavigationStatus = "running" | "compacting" | "reverting" | "idle" | null;

export interface SessionNavigationIdentitySlice {
  name: string | null;
  model: string;
  cwd: string;
  backendType: SessionNavigationBackendType;
  permissionMode: string;
  askPermission: boolean;
  sessionNum: number | null;
  createdAt: number;
}

export interface SessionNavigationTopologySlice {
  treeGroupId: string | null;
  memorySessionSpaceSlug: string | null;
  repoRoot: string;
  isWorktree: boolean;
  isContainerized: boolean;
  isAssistant: boolean;
  isOrchestrator: boolean;
  herdedBy: string | null;
  reviewerOf: number | null;
  cronJobId: string | null;
  cronJobName: string | null;
}

export interface SessionNavigationLifecycleSlice {
  sdkState: SessionNavigationSdkState;
  status: SessionNavigationStatus;
  cliConnected: boolean;
  idleKilled: boolean;
  pendingPermissionCount: number;
  pendingTimerCount: number;
  paused: boolean;
  pausedInputQueueCount: number;
  lastActivityAt: number | null;
  lastUserMessageAt: number | null;
  /** Timestamp of the user_message that supplied lastMessagePreview, including injected inputs. */
  lastMessagePreviewAt: number | null;
}

export interface SessionNavigationQuestSlice {
  claimedQuestId: string | null;
  claimedQuestTitle: string | null;
  claimedQuestStatus: string | null;
  claimedQuestVerificationInboxUnread: boolean | null;
  claimedQuestLeaderSessionId: string | null;
}

export interface SessionNavigationGitSlice {
  branch: string;
  defaultBranch: string;
  diffBaseBranch: string;
  ahead: number;
  behind: number;
  linesAdded: number;
  linesRemoved: number;
  diffStatsSkippedReason: string | null;
  statusRefreshedAt: number | null;
  statusRefreshError: string | null;
}

export interface SessionNavigationDetailSlice {
  lastMessagePreview: string;
  userTurnCount: number;
  agentTurnCount: number;
  contextUsedPercent: number;
  contextTokensUsed: number | null;
  modelContextWindow: number | null;
  configuredContextWindow: number | null;
  effectiveContextWindow: number | null;
  messageHistoryBytes: number;
  codexRetainedPayloadBytes: number;
  codexReasoningEffort: string | null;
  codexEffectiveReasoningEffort: string | null;
  codexEffectiveReasoningEffortReported: boolean;
}

export interface SessionNavigationProjectionValue {
  identity: SessionNavigationIdentitySlice;
  topology: SessionNavigationTopologySlice;
  lifecycle: SessionNavigationLifecycleSlice;
  quest: SessionNavigationQuestSlice;
  git: SessionNavigationGitSlice;
  detail: SessionNavigationDetailSlice;
}

function boundedString(value: unknown, maxLength = SESSION_NAVIGATION_TEXT_MAX_LENGTH): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function boundedNullableString(value: unknown, maxLength = SESSION_NAVIGATION_TEXT_MAX_LENGTH): value is string | null {
  return value === null || boundedString(value, maxLength);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveNullableInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 1);
}

function nonNegativeNullableNumber(value: unknown): value is number | null {
  return value === null || nonNegativeNumber(value);
}

function isIdentitySlice(value: unknown): value is SessionNavigationIdentitySlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationIdentitySlice>;
  return (
    boundedNullableString(candidate.name) &&
    boundedString(candidate.model) &&
    boundedString(candidate.cwd, SESSION_NAVIGATION_PATH_MAX_LENGTH) &&
    ["claude", "codex", "claude-sdk"].includes(candidate.backendType as SessionNavigationBackendType) &&
    boundedString(candidate.permissionMode) &&
    typeof candidate.askPermission === "boolean" &&
    positiveNullableInteger(candidate.sessionNum) &&
    nonNegativeNumber(candidate.createdAt)
  );
}

function isTopologySlice(value: unknown): value is SessionNavigationTopologySlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationTopologySlice>;
  return (
    boundedNullableString(candidate.treeGroupId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    boundedNullableString(candidate.memorySessionSpaceSlug) &&
    boundedString(candidate.repoRoot, SESSION_NAVIGATION_PATH_MAX_LENGTH) &&
    typeof candidate.isWorktree === "boolean" &&
    typeof candidate.isContainerized === "boolean" &&
    typeof candidate.isAssistant === "boolean" &&
    typeof candidate.isOrchestrator === "boolean" &&
    boundedNullableString(candidate.herdedBy, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    positiveNullableInteger(candidate.reviewerOf) &&
    boundedNullableString(candidate.cronJobId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    boundedNullableString(candidate.cronJobName)
  );
}

function isLifecycleSlice(value: unknown): value is SessionNavigationLifecycleSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationLifecycleSlice>;
  return (
    ["starting", "connected", "running", "exited"].includes(candidate.sdkState as SessionNavigationSdkState) &&
    [null, "running", "compacting", "reverting", "idle"].includes(candidate.status as SessionNavigationStatus) &&
    typeof candidate.cliConnected === "boolean" &&
    typeof candidate.idleKilled === "boolean" &&
    nonNegativeInteger(candidate.pendingPermissionCount) &&
    nonNegativeInteger(candidate.pendingTimerCount) &&
    typeof candidate.paused === "boolean" &&
    nonNegativeInteger(candidate.pausedInputQueueCount) &&
    nonNegativeNullableNumber(candidate.lastActivityAt) &&
    nonNegativeNullableNumber(candidate.lastUserMessageAt) &&
    nonNegativeNullableNumber(candidate.lastMessagePreviewAt)
  );
}

function isQuestSlice(value: unknown): value is SessionNavigationQuestSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationQuestSlice>;
  return (
    boundedNullableString(candidate.claimedQuestId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    boundedNullableString(candidate.claimedQuestTitle) &&
    boundedNullableString(candidate.claimedQuestStatus) &&
    (candidate.claimedQuestVerificationInboxUnread === null ||
      typeof candidate.claimedQuestVerificationInboxUnread === "boolean") &&
    boundedNullableString(candidate.claimedQuestLeaderSessionId, SESSION_NAVIGATION_ID_MAX_LENGTH)
  );
}

function isGitSlice(value: unknown): value is SessionNavigationGitSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationGitSlice>;
  return (
    boundedString(candidate.branch) &&
    boundedString(candidate.defaultBranch) &&
    boundedString(candidate.diffBaseBranch) &&
    nonNegativeInteger(candidate.ahead) &&
    nonNegativeInteger(candidate.behind) &&
    nonNegativeInteger(candidate.linesAdded) &&
    nonNegativeInteger(candidate.linesRemoved) &&
    boundedNullableString(candidate.diffStatsSkippedReason) &&
    nonNegativeNullableNumber(candidate.statusRefreshedAt) &&
    boundedNullableString(candidate.statusRefreshError)
  );
}

function isDetailSlice(value: unknown): value is SessionNavigationDetailSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationDetailSlice>;
  return (
    boundedString(candidate.lastMessagePreview, SESSION_NAVIGATION_PREVIEW_MAX_LENGTH) &&
    nonNegativeInteger(candidate.userTurnCount) &&
    nonNegativeInteger(candidate.agentTurnCount) &&
    nonNegativeNumber(candidate.contextUsedPercent) &&
    nonNegativeNullableNumber(candidate.contextTokensUsed) &&
    nonNegativeNullableNumber(candidate.modelContextWindow) &&
    nonNegativeNullableNumber(candidate.configuredContextWindow) &&
    nonNegativeNullableNumber(candidate.effectiveContextWindow) &&
    nonNegativeInteger(candidate.messageHistoryBytes) &&
    nonNegativeInteger(candidate.codexRetainedPayloadBytes) &&
    boundedNullableString(candidate.codexReasoningEffort) &&
    boundedNullableString(candidate.codexEffectiveReasoningEffort) &&
    typeof candidate.codexEffectiveReasoningEffortReported === "boolean"
  );
}

export function isSessionNavigationProjectionValue(value: unknown): value is SessionNavigationProjectionValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationProjectionValue>;
  return (
    isIdentitySlice(candidate.identity) &&
    isTopologySlice(candidate.topology) &&
    isLifecycleSlice(candidate.lifecycle) &&
    isQuestSlice(candidate.quest) &&
    isGitSlice(candidate.git) &&
    isDetailSlice(candidate.detail)
  );
}

export function sessionNavigationIdentityEqual(
  left: SessionNavigationIdentitySlice,
  right: SessionNavigationIdentitySlice,
): boolean {
  return (
    left.name === right.name &&
    left.model === right.model &&
    left.cwd === right.cwd &&
    left.backendType === right.backendType &&
    left.permissionMode === right.permissionMode &&
    left.askPermission === right.askPermission &&
    left.sessionNum === right.sessionNum &&
    left.createdAt === right.createdAt
  );
}

export function sessionNavigationTopologyEqual(
  left: SessionNavigationTopologySlice,
  right: SessionNavigationTopologySlice,
): boolean {
  return (
    left.treeGroupId === right.treeGroupId &&
    left.memorySessionSpaceSlug === right.memorySessionSpaceSlug &&
    left.repoRoot === right.repoRoot &&
    left.isWorktree === right.isWorktree &&
    left.isContainerized === right.isContainerized &&
    left.isAssistant === right.isAssistant &&
    left.isOrchestrator === right.isOrchestrator &&
    left.herdedBy === right.herdedBy &&
    left.reviewerOf === right.reviewerOf &&
    left.cronJobId === right.cronJobId &&
    left.cronJobName === right.cronJobName
  );
}

export function sessionNavigationLifecycleEqual(
  left: SessionNavigationLifecycleSlice,
  right: SessionNavigationLifecycleSlice,
): boolean {
  return (
    left.sdkState === right.sdkState &&
    left.status === right.status &&
    left.cliConnected === right.cliConnected &&
    left.idleKilled === right.idleKilled &&
    left.pendingPermissionCount === right.pendingPermissionCount &&
    left.pendingTimerCount === right.pendingTimerCount &&
    left.paused === right.paused &&
    left.pausedInputQueueCount === right.pausedInputQueueCount &&
    left.lastActivityAt === right.lastActivityAt &&
    left.lastUserMessageAt === right.lastUserMessageAt &&
    left.lastMessagePreviewAt === right.lastMessagePreviewAt
  );
}

export function sessionNavigationQuestEqual(
  left: SessionNavigationQuestSlice,
  right: SessionNavigationQuestSlice,
): boolean {
  return (
    left.claimedQuestId === right.claimedQuestId &&
    left.claimedQuestTitle === right.claimedQuestTitle &&
    left.claimedQuestStatus === right.claimedQuestStatus &&
    left.claimedQuestVerificationInboxUnread === right.claimedQuestVerificationInboxUnread &&
    left.claimedQuestLeaderSessionId === right.claimedQuestLeaderSessionId
  );
}

export function sessionNavigationGitEqual(left: SessionNavigationGitSlice, right: SessionNavigationGitSlice): boolean {
  return (
    left.branch === right.branch &&
    left.defaultBranch === right.defaultBranch &&
    left.diffBaseBranch === right.diffBaseBranch &&
    left.ahead === right.ahead &&
    left.behind === right.behind &&
    left.linesAdded === right.linesAdded &&
    left.linesRemoved === right.linesRemoved &&
    left.diffStatsSkippedReason === right.diffStatsSkippedReason &&
    left.statusRefreshedAt === right.statusRefreshedAt &&
    left.statusRefreshError === right.statusRefreshError
  );
}

export function sessionNavigationDetailEqual(
  left: SessionNavigationDetailSlice,
  right: SessionNavigationDetailSlice,
): boolean {
  return (
    left.lastMessagePreview === right.lastMessagePreview &&
    left.userTurnCount === right.userTurnCount &&
    left.agentTurnCount === right.agentTurnCount &&
    left.contextUsedPercent === right.contextUsedPercent &&
    left.contextTokensUsed === right.contextTokensUsed &&
    left.modelContextWindow === right.modelContextWindow &&
    left.configuredContextWindow === right.configuredContextWindow &&
    left.effectiveContextWindow === right.effectiveContextWindow &&
    left.messageHistoryBytes === right.messageHistoryBytes &&
    left.codexRetainedPayloadBytes === right.codexRetainedPayloadBytes &&
    left.codexReasoningEffort === right.codexReasoningEffort &&
    left.codexEffectiveReasoningEffort === right.codexEffectiveReasoningEffort &&
    left.codexEffectiveReasoningEffortReported === right.codexEffectiveReasoningEffortReported
  );
}

export function sessionNavigationProjectionEqual(
  left: SessionNavigationProjectionValue,
  right: SessionNavigationProjectionValue,
): boolean {
  return (
    sessionNavigationIdentityEqual(left.identity, right.identity) &&
    sessionNavigationTopologyEqual(left.topology, right.topology) &&
    sessionNavigationLifecycleEqual(left.lifecycle, right.lifecycle) &&
    sessionNavigationQuestEqual(left.quest, right.quest) &&
    sessionNavigationGitEqual(left.git, right.git) &&
    sessionNavigationDetailEqual(left.detail, right.detail)
  );
}

/** Preserve stable nested identities when only part of the navigation summary changed. */
export function reconcileSessionNavigationProjectionValue(
  previous: SessionNavigationProjectionValue | undefined,
  next: SessionNavigationProjectionValue,
): SessionNavigationProjectionValue {
  if (!previous) return next;
  const identity = sessionNavigationIdentityEqual(previous.identity, next.identity) ? previous.identity : next.identity;
  const topology = sessionNavigationTopologyEqual(previous.topology, next.topology) ? previous.topology : next.topology;
  const lifecycle = sessionNavigationLifecycleEqual(previous.lifecycle, next.lifecycle)
    ? previous.lifecycle
    : next.lifecycle;
  const quest = sessionNavigationQuestEqual(previous.quest, next.quest) ? previous.quest : next.quest;
  const git = sessionNavigationGitEqual(previous.git, next.git) ? previous.git : next.git;
  const detail = sessionNavigationDetailEqual(previous.detail, next.detail) ? previous.detail : next.detail;
  if (
    identity === previous.identity &&
    topology === previous.topology &&
    lifecycle === previous.lifecycle &&
    quest === previous.quest &&
    git === previous.git &&
    detail === previous.detail
  ) {
    return previous;
  }
  return { identity, topology, lifecycle, quest, git, detail };
}
