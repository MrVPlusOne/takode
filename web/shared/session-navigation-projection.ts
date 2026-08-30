import {
  isBoundedNullableString,
  isBoundedString,
  isNonNegativeInteger,
  isNonNegativeNullableNumber,
  isNonNegativeNumber,
  isPositiveNullableInteger,
} from "./synced-projection-codec.js";
import { reuseIfEqual } from "./stable-reconciliation.js";

/** Compact server-owned summary used by session navigation surfaces. */
export const SESSION_NAVIGATION_PROJECTION = "session-navigation" as const;
export const SESSION_NAVIGATION_PROJECTION_MAX_VALUE_BYTES = 16 * 1024;

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

function isIdentitySlice(value: unknown): value is SessionNavigationIdentitySlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationIdentitySlice>;
  return (
    isBoundedNullableString(candidate.name, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedString(candidate.model, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedString(candidate.cwd, SESSION_NAVIGATION_PATH_MAX_LENGTH) &&
    ["claude", "codex", "claude-sdk"].includes(candidate.backendType as SessionNavigationBackendType) &&
    isBoundedString(candidate.permissionMode, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    typeof candidate.askPermission === "boolean" &&
    isPositiveNullableInteger(candidate.sessionNum) &&
    isNonNegativeNumber(candidate.createdAt)
  );
}

function isTopologySlice(value: unknown): value is SessionNavigationTopologySlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationTopologySlice>;
  return (
    isBoundedNullableString(candidate.treeGroupId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    isBoundedNullableString(candidate.memorySessionSpaceSlug, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedString(candidate.repoRoot, SESSION_NAVIGATION_PATH_MAX_LENGTH) &&
    typeof candidate.isWorktree === "boolean" &&
    typeof candidate.isContainerized === "boolean" &&
    typeof candidate.isAssistant === "boolean" &&
    typeof candidate.isOrchestrator === "boolean" &&
    isBoundedNullableString(candidate.herdedBy, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    isPositiveNullableInteger(candidate.reviewerOf) &&
    isBoundedNullableString(candidate.cronJobId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    isBoundedNullableString(candidate.cronJobName, SESSION_NAVIGATION_TEXT_MAX_LENGTH)
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
    isNonNegativeInteger(candidate.pendingPermissionCount) &&
    isNonNegativeInteger(candidate.pendingTimerCount) &&
    typeof candidate.paused === "boolean" &&
    isNonNegativeInteger(candidate.pausedInputQueueCount) &&
    isNonNegativeNullableNumber(candidate.lastActivityAt) &&
    isNonNegativeNullableNumber(candidate.lastUserMessageAt) &&
    isNonNegativeNullableNumber(candidate.lastMessagePreviewAt)
  );
}

function isQuestSlice(value: unknown): value is SessionNavigationQuestSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationQuestSlice>;
  return (
    isBoundedNullableString(candidate.claimedQuestId, SESSION_NAVIGATION_ID_MAX_LENGTH) &&
    isBoundedNullableString(candidate.claimedQuestTitle, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedNullableString(candidate.claimedQuestStatus, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    (candidate.claimedQuestVerificationInboxUnread === null ||
      typeof candidate.claimedQuestVerificationInboxUnread === "boolean") &&
    isBoundedNullableString(candidate.claimedQuestLeaderSessionId, SESSION_NAVIGATION_ID_MAX_LENGTH)
  );
}

function isGitSlice(value: unknown): value is SessionNavigationGitSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationGitSlice>;
  return (
    isBoundedString(candidate.branch, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedString(candidate.defaultBranch, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedString(candidate.diffBaseBranch, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isNonNegativeInteger(candidate.ahead) &&
    isNonNegativeInteger(candidate.behind) &&
    isNonNegativeInteger(candidate.linesAdded) &&
    isNonNegativeInteger(candidate.linesRemoved) &&
    isBoundedNullableString(candidate.diffStatsSkippedReason, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isNonNegativeNullableNumber(candidate.statusRefreshedAt) &&
    isBoundedNullableString(candidate.statusRefreshError, SESSION_NAVIGATION_TEXT_MAX_LENGTH)
  );
}

function isDetailSlice(value: unknown): value is SessionNavigationDetailSlice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionNavigationDetailSlice>;
  return (
    isBoundedString(candidate.lastMessagePreview, SESSION_NAVIGATION_PREVIEW_MAX_LENGTH) &&
    isNonNegativeInteger(candidate.userTurnCount) &&
    isNonNegativeInteger(candidate.agentTurnCount) &&
    isNonNegativeNumber(candidate.contextUsedPercent) &&
    isNonNegativeNullableNumber(candidate.contextTokensUsed) &&
    isNonNegativeNullableNumber(candidate.modelContextWindow) &&
    isNonNegativeNullableNumber(candidate.configuredContextWindow) &&
    isNonNegativeNullableNumber(candidate.effectiveContextWindow) &&
    isNonNegativeInteger(candidate.messageHistoryBytes) &&
    isNonNegativeInteger(candidate.codexRetainedPayloadBytes) &&
    isBoundedNullableString(candidate.codexReasoningEffort, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
    isBoundedNullableString(candidate.codexEffectiveReasoningEffort, SESSION_NAVIGATION_TEXT_MAX_LENGTH) &&
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
  const identity = reuseIfEqual(previous.identity, next.identity, sessionNavigationIdentityEqual);
  const topology = reuseIfEqual(previous.topology, next.topology, sessionNavigationTopologyEqual);
  const lifecycle = reuseIfEqual(previous.lifecycle, next.lifecycle, sessionNavigationLifecycleEqual);
  const quest = reuseIfEqual(previous.quest, next.quest, sessionNavigationQuestEqual);
  const git = reuseIfEqual(previous.git, next.git, sessionNavigationGitEqual);
  const detail = reuseIfEqual(previous.detail, next.detail, sessionNavigationDetailEqual);
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
