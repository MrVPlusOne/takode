import {
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
  isCodexLeaderRecoveryDiagnosticSourceId,
  isCodexTurnRecoverySourceId,
} from "../../shared/injected-event-message.js";
import { getKnownSessionNum } from "../cli-launcher.js";
import { compactPendingCodexInputsForBrowser } from "../codex-pending-input-safety.js";
import type {
  BrowserIncomingMessage,
  CLIResultMessage,
  CodexOutboundTurn,
  CodexTurnRecoveryReason,
  PendingCodexInput,
  SessionState,
} from "../session-types.js";
import type { CodexResumeTurnSnapshot } from "../codex-adapter.js";
import { sessionTag } from "../session-tag.js";
import {
  browserMessageRoute,
  routeFromHistoryEntry,
  sameThreadRoute,
  threadRouteForTarget,
  type ThreadRouteMetadata,
} from "../thread-routing-metadata.js";
import {
  getMessageAtAbsoluteHistoryIndex,
  summarizeLocalCodexDeliveryActivity,
  type CodexLocalDeliveryActivitySummary,
} from "./codex-delivery-ownership.js";
import { reconcileRecoveredQueuedTurnLifecycle } from "./codex-queued-turn-lifecycle.js";

export type CodexTurnRecoveryDeliveryStatus = "sent" | "queued" | "paused_queued" | "dropped" | "no_session";

export interface CodexInterruptedTurnRecoverySessionLike {
  id: string;
  attentionReason?: "action" | "error" | "review" | null;
  codexLeaderRecycleContinuation?: {
    content: string;
    requestedAt: number;
    trigger: string;
    recoveryId?: string;
  } | null;
  isGenerating?: boolean;
  queuedTurnStarts?: number;
  queuedTurnReasons?: string[];
  queuedTurnUserMessageIds?: number[][];
  queuedTurnInterruptSources?: Array<"user" | "leader" | "system" | null>;
  queuedTurnActiveRoutes?: Array<{ threadKey: string; questId?: string } | null>;
  sessionNum?: number | null;
  state: Pick<
    SessionState,
    "backend_state" | "codex_result_error_auto_pause" | "codex_turn_recovery" | "isOrchestrator" | "pause"
  >;
  messageHistory: BrowserIncomingMessage[];
  frozenCount?: number;
  _frozenCount?: number;
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
  pendingStartupMemoryCatalogInjection?: unknown;
}

export interface CodexInterruptedTurnRecoveryDeps {
  broadcastToBrowsers: (session: any, message: BrowserIncomingMessage) => void;
  persistSession: (session: any) => void;
  persistHistoryMetadataRepair?: (session: any, expectedFrozenCount: number) => Promise<void>;
  refreshBrowserConversationViews?: (session: any) => void;
  injectUserMessage: (
    sessionId: string,
    content: string,
    agentSource: { sessionId: string; sessionLabel?: string },
    threadRoute: ThreadRouteMetadata,
    options: { deliveryContent: string },
  ) => CodexTurnRecoveryDeliveryStatus;
  setAttentionError?: (session: any) => void;
}

const OUTCOME_BEARING_ACTIVITY = new Set(["assistant_text", "tool_use", "tool_result", "permission", "stream"]);

const RECOVERY_STATUSES = new Set(["recovering", "continuation_pending", "continuation_active", "action_required"]);
const RECOVERY_REASONS = new Set([
  "adapter_disconnect",
  "interrupted_after_activity",
  "continuation_dispatch_failed",
  "continuation_interrupted",
  "continuation_failed",
  "recovery_timeout",
  "recovery_failed",
]);

export function normalizeCodexTurnRecoveryState(value: unknown): SessionState["codex_turn_recovery"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const status = String(raw.status);
  const reason = String(raw.reason);
  if (
    typeof raw.recoveryId !== "string" ||
    !raw.recoveryId.trim() ||
    typeof raw.originalOwnerId !== "string" ||
    !raw.originalOwnerId.trim() ||
    !Number.isInteger(raw.originalHistoryIndex) ||
    typeof raw.threadKey !== "string" ||
    !raw.threadKey.trim() ||
    !RECOVERY_STATUSES.has(status) ||
    !RECOVERY_REASONS.has(reason) ||
    raw.maxAttempts !== 1 ||
    !Number.isFinite(raw.createdAt) ||
    !Number.isFinite(raw.updatedAt)
  ) {
    return null;
  }
  const attemptValid = raw.attempt === 0 || raw.attempt === 1;
  const continuationStatus = status === "continuation_pending" || status === "continuation_active";
  const failClosed = !attemptValid || (continuationStatus && raw.attempt !== 1);
  return {
    recoveryId: raw.recoveryId,
    originalOwnerId: raw.originalOwnerId,
    originalProviderTurnId:
      typeof raw.originalProviderTurnId === "string" && raw.originalProviderTurnId.trim()
        ? raw.originalProviderTurnId
        : null,
    originalHistoryIndex: raw.originalHistoryIndex as number,
    continuationOwnerId:
      typeof raw.continuationOwnerId === "string" && raw.continuationOwnerId.trim() ? raw.continuationOwnerId : null,
    threadKey: raw.threadKey,
    ...(typeof raw.questId === "string" && raw.questId.trim() ? { questId: raw.questId } : {}),
    status: failClosed ? "action_required" : (status as NonNullable<SessionState["codex_turn_recovery"]>["status"]),
    reason: failClosed ? "recovery_failed" : (reason as CodexTurnRecoveryReason),
    ...(typeof raw.raisedAttention === "boolean" ? { raisedAttention: raw.raisedAttention } : {}),
    attempt: failClosed ? 1 : (raw.attempt as number),
    maxAttempts: 1,
    createdAt: raw.createdAt as number,
    updatedAt: raw.updatedAt as number,
  };
}

export interface RestoredCodexTurnRecoveryRepair {
  state: SessionState["codex_turn_recovery"];
  resolvedByHistoricalSuccess: boolean;
  historyMetadataChanged: boolean;
  requiresFrozenHistoryMetadataRepair: boolean;
}

export function repairRestoredCodexTurnRecovery(
  session: CodexInterruptedTurnRecoverySessionLike,
): RestoredCodexTurnRecoveryRepair {
  const current = normalizeCodexTurnRecoveryState(session.state.codex_turn_recovery);
  if (!current) {
    return {
      state: null,
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }
  if (current.status === "action_required") {
    if (hasHistoricalSuccessfulSameThreadHumanFollowUp(session, current)) {
      const retired = retireCodexTurnRecoveryDiagnostics(session, current, Date.now());
      return {
        state: null,
        resolvedByHistoricalSuccess: true,
        historyMetadataChanged: retired.changed,
        requiresFrozenHistoryMetadataRepair: retired.requiresFrozenHistoryMetadataRepair,
      };
    }
    if (!session.attentionReason) {
      session.attentionReason = "error";
      return {
        state: { ...current, raisedAttention: true },
        resolvedByHistoricalSuccess: false,
        historyMetadataChanged: false,
        requiresFrozenHistoryMetadataRepair: false,
      };
    }
    return {
      state: current,
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }

  const sourceId = codexTurnRecoverySourceId(current.recoveryId);
  const continuationInput = [...session.pendingCodexInputs]
    .reverse()
    .find((input) => input.deliveryState !== "failed" && input.agentSource?.sessionId === sourceId);
  const continuationTurn = [...session.pendingCodexTurns]
    .reverse()
    .find((turn) => sourceIdForPendingTurn(session, turn) === sourceId && turn.status !== "completed");
  const continuationOwnerId = continuationInput?.id ?? continuationTurn?.userMessageId ?? null;
  if (continuationOwnerId) {
    return {
      state: {
        ...current,
        continuationOwnerId,
        status: continuationTurn?.status === "backend_acknowledged" ? "continuation_active" : "continuation_pending",
      },
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }

  if (current.attempt === 1 && session.codexLeaderRecycleContinuation?.recoveryId === current.recoveryId) {
    return {
      state: { ...current, continuationOwnerId: null, status: "continuation_pending" },
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }
  if (current.attempt === 1) {
    const raisedAttention = !session.attentionReason;
    if (raisedAttention) session.attentionReason = "error";
    return {
      state: {
        ...current,
        ...(raisedAttention ? { raisedAttention: true } : {}),
        status: "action_required",
        reason: "continuation_dispatch_failed",
        updatedAt: Date.now(),
      },
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }

  const originalPending = session.pendingCodexTurns.some(
    (turn) =>
      turn.status !== "completed" &&
      (turn.userMessageId === current.originalOwnerId ||
        (!!current.originalProviderTurnId && turn.turnId === current.originalProviderTurnId)),
  );
  if (originalPending) {
    return {
      state: current,
      resolvedByHistoricalSuccess: false,
      historyMetadataChanged: false,
      requiresFrozenHistoryMetadataRepair: false,
    };
  }
  const raisedAttention = !session.attentionReason;
  if (raisedAttention) session.attentionReason = "error";
  return {
    state: {
      ...current,
      ...(raisedAttention ? { raisedAttention: true } : {}),
      status: "action_required",
      reason: "recovery_failed",
      updatedAt: Date.now(),
    },
    resolvedByHistoricalSuccess: false,
    historyMetadataChanged: false,
    requiresFrozenHistoryMetadataRepair: false,
  };
}

export function repairRestoredCodexTurnRecoveryState(
  session: CodexInterruptedTurnRecoverySessionLike,
): SessionState["codex_turn_recovery"] {
  return repairRestoredCodexTurnRecovery(session).state;
}

export function hasIncompleteCodexActivityWithoutTerminalEvidence(
  turn: CodexResumeTurnSnapshot,
  threadStatus: string | null | undefined,
  activity: CodexLocalDeliveryActivitySummary,
  omittedFromResumeSnapshotCount: number,
  includeReasoning = false,
): boolean {
  const status = normalizeStatus(turn.status);
  const eligibleStatus =
    status === "completed" ||
    status === "failed" ||
    status === "error" ||
    (status === "interrupted" && normalizeStatus(threadStatus) === "idle");
  if (!eligibleStatus || turn.items.some(isTerminalResumeItem) || activity.kinds.includes("result")) return false;

  const lastToolIndex = findLastResumeItemIndex(turn.items, isResumeToolActivityItem);
  const lastAgentIndex = findLastResumeItemIndex(
    turn.items,
    (item) => item.type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0,
  );
  const toolEvidence =
    omittedFromResumeSnapshotCount > 0 ||
    lastToolIndex >= 0 ||
    activity.kinds.includes("tool_use") ||
    activity.kinds.includes("tool_result");
  if (toolEvidence) {
    return omittedFromResumeSnapshotCount > 0 || lastAgentIndex < lastToolIndex || lastAgentIndex < 0;
  }
  if (status !== "interrupted") return false;
  return activity.kinds.some(
    (kind) => OUTCOME_BEARING_ACTIVITY.has(kind) || (includeReasoning && kind === "reasoning"),
  );
}

export function hasFinalCodexOutcomeEvidence(turn: CodexResumeTurnSnapshot): boolean {
  if (turn.items.some(isTerminalResumeItem)) return true;
  const lastToolIndex = findLastResumeItemIndex(turn.items, isResumeToolActivityItem);
  const lastAgentIndex = findLastResumeItemIndex(
    turn.items,
    (item) => item.type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0,
  );
  return lastAgentIndex >= 0 && lastAgentIndex > lastToolIndex;
}

export function selectCodexTurnRecoveryOwner(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
): CodexOutboundTurn {
  const coOwners = pending.turnId
    ? session.pendingCodexTurns.filter((turn) => turn.turnId === pending.turnId)
    : [pending];
  return coOwners.find((turn) => isDirectHumanTurn(session, turn)) ?? pending;
}

export function markCodexTurnRecoveryOnDisconnect(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession">,
): void {
  const recoveryOwner = selectCodexTurnRecoveryOwner(session, pending);
  pending = recoveryOwner;
  const current = session.state.codex_turn_recovery ?? null;
  if (current && isRecoveryContinuationTurn(session, pending, current.recoveryId)) {
    setRecoveryState(
      session,
      { ...current, status: "recovering", reason: "adapter_disconnect", updatedAt: Date.now() },
      deps,
    );
    return;
  }
  if (current || session.state.isOrchestrator !== true || !isDirectHumanTurn(session, pending)) return;
  const activity = summarizeLocalCodexDeliveryActivity(session, pending);
  if (activity.count === 0) return;
  const now = Date.now();
  const route = resolveCodexTurnRecoveryRoute(session, pending);
  setRecoveryState(
    session,
    {
      recoveryId: pending.userMessageId,
      originalOwnerId: pending.userMessageId,
      originalProviderTurnId: pending.turnId,
      originalHistoryIndex: pending.historyIndex,
      continuationOwnerId: null,
      threadKey: route.threadKey,
      ...(route.questId ? { questId: route.questId } : {}),
      status: "recovering",
      reason: "adapter_disconnect",
      attempt: 0,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    },
    deps,
  );
}

export function isCodexLeaderRecycleRecoveryInjectionPending(
  session: CodexInterruptedTurnRecoverySessionLike,
): boolean {
  const recovery = session.state.codex_turn_recovery ?? null;
  const recycle = session.codexLeaderRecycleContinuation ?? null;
  return (
    recovery?.status === "continuation_pending" &&
    recovery.continuationOwnerId == null &&
    recycle?.recoveryId === recovery.recoveryId
  );
}

export function prepareCodexLeaderRecycleRecoveryInjection(
  session: CodexInterruptedTurnRecoverySessionLike,
  recoveryId: string,
  requestedAt: number,
): boolean {
  const current = session.state.codex_turn_recovery ?? null;
  const recycle = session.codexLeaderRecycleContinuation ?? null;
  if (
    !current ||
    current.status !== "continuation_pending" ||
    current.continuationOwnerId != null ||
    current.recoveryId !== recoveryId ||
    recycle?.recoveryId !== recoveryId ||
    recycle.requestedAt !== requestedAt ||
    session.pendingStartupMemoryCatalogInjection ||
    session.state.pause?.pausedAt ||
    session.state.codex_result_error_auto_pause?.pausedAt
  ) {
    return false;
  }

  if (hasRecoveryEpochUserMessage(session, requestedAt)) return false;
  if (session.pendingCodexInputs.some((input) => input.deliveryState !== "failed")) return false;
  return !session.pendingCodexTurns.some((turn) => turn.status !== "completed");
}

export function finalizeCodexLeaderRecycleRecoveryInjection(
  session: CodexInterruptedTurnRecoverySessionLike,
  recoveryId: string,
  requestedAt: number,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession" | "setAttentionError"> & {
    rebuildQueuedCodexPendingStartBatch: (session: any) => void;
    dispatchQueuedCodexTurns: (session: any, reason: string) => void;
  },
): boolean {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current || current.recoveryId !== recoveryId) return false;
  if (current.status === "action_required") {
    retireCodexTurnRecoveryOwners(session, current, deps);
    deps.rebuildQueuedCodexPendingStartBatch(session);
    deps.dispatchQueuedCodexTurns(session, "codex_recycle_recovery_stale_action_required");
    return false;
  }
  if (
    session.codexLeaderRecycleContinuation?.recoveryId !== recoveryId ||
    session.codexLeaderRecycleContinuation.requestedAt !== requestedAt
  ) {
    return false;
  }
  const sourceId = codexTurnRecoverySourceId(recoveryId);
  const recoveryInput = [...session.pendingCodexInputs]
    .reverse()
    .find((input) => input.deliveryState !== "failed" && input.agentSource?.sessionId === sourceId);
  const laterInputExists = session.pendingCodexInputs.some(
    (input) => input.deliveryState !== "failed" && input.agentSource?.sessionId !== sourceId,
  );
  const laterTurnExists = session.pendingCodexTurns.some((turn) => {
    if (turn.status === "completed") return false;
    const ids = turn.pendingInputIds ?? [turn.userMessageId];
    return ids.some((id) => id !== recoveryInput?.id);
  });
  if (!recoveryInput || laterInputExists || laterTurnExists) {
    markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
    deps.rebuildQueuedCodexPendingStartBatch(session);
    deps.dispatchQueuedCodexTurns(session, "codex_recycle_recovery_order_changed");
    return false;
  }
  session.codexLeaderRecycleContinuation = null;
  setRecoveryState(
    session,
    {
      ...current,
      continuationOwnerId: recoveryInput.id,
      status: "continuation_pending",
      attempt: 1,
      updatedAt: Date.now(),
    },
    deps,
  );
  deps.rebuildQueuedCodexPendingStartBatch(session);
  deps.dispatchQueuedCodexTurns(session, "codex_recycle_recovery_ready");
  return true;
}

export function beginCodexTurnRecoveryContinuation(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
  route: ThreadRouteMetadata,
  deps: CodexInterruptedTurnRecoveryDeps,
): boolean {
  const existing = session.state.codex_turn_recovery ?? null;
  if (isRecoveryContinuationTurn(session, pending, existing?.recoveryId)) {
    markCodexTurnRecoveryActionRequired(session, "continuation_interrupted", deps);
    return false;
  }
  if (session.state.isOrchestrator !== true || !isDirectHumanTurn(session, pending)) return false;
  if (existing && existing.originalOwnerId !== pending.userMessageId) return false;
  if (existing?.attempt === 1) {
    if (existing.status === "action_required") return false;
    const sourceId = codexTurnRecoverySourceId(existing.recoveryId);
    const continuationOwnerId = findContinuationOwnerId(session, sourceId);
    if (!continuationOwnerId) {
      markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
      return false;
    }
    setRecoveryState(session, { ...existing, continuationOwnerId, updatedAt: Date.now() }, deps);
    return true;
  }

  const now = Date.now();
  const recoveryId = pending.userMessageId;
  const next = {
    recoveryId,
    originalOwnerId: pending.userMessageId,
    originalProviderTurnId: pending.turnId,
    originalHistoryIndex: pending.historyIndex,
    continuationOwnerId: null,
    threadKey: route.threadKey,
    ...(route.questId ? { questId: route.questId } : {}),
    status: "continuation_pending" as const,
    reason: "interrupted_after_activity" as const,
    attempt: 1,
    maxAttempts: 1 as const,
    createdAt: existing?.originalOwnerId === pending.userMessageId ? existing.createdAt : now,
    updatedAt: now,
  };
  setRecoveryState(session, next, deps);
  const laterTurnExists = session.pendingCodexTurns.some(
    (turn) => turn !== pending && turn.status !== "completed" && (!pending.turnId || turn.turnId !== pending.turnId),
  );
  if (laterTurnExists || session.state.pause?.pausedAt || session.state.codex_result_error_auto_pause?.pausedAt) {
    markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
    return false;
  }

  const sourceId = codexTurnRecoverySourceId(recoveryId);
  const delivery = deps.injectUserMessage(
    session.id,
    "Takode is resuming this interrupted work without repeating actions that already completed.",
    { sessionId: sourceId, sessionLabel: CODEX_TURN_RECOVERY_SOURCE_LABEL },
    route,
    { deliveryContent: buildContinuationPrompt(session, pending) },
  );
  if (delivery === "dropped" || delivery === "no_session" || delivery === "paused_queued") {
    markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
    return false;
  }

  const continuationOwnerId = findContinuationOwnerId(session, sourceId);
  setRecoveryState(
    session,
    {
      ...next,
      continuationOwnerId,
      updatedAt: Date.now(),
    },
    deps,
  );
  console.log(
    `[ws-bridge] Queued exact-owner Codex leader continuation for session ${sessionTag(session.id)} ` +
      `(recovery=${recoveryId}, owner=${continuationOwnerId ?? "pending"}, route=${route.threadKey})`,
  );
  return true;
}

export function markCodexTurnRecoveryContinuationActive(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession">,
): void {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current || !isRecoveryContinuationTurn(session, pending, current.recoveryId)) return;
  setRecoveryState(
    session,
    {
      ...current,
      continuationOwnerId: pending.userMessageId,
      status: "continuation_active",
      updatedAt: Date.now(),
    },
    deps,
  );
}

function retireCodexTurnRecoveryOwners(
  session: CodexInterruptedTurnRecoverySessionLike,
  current: NonNullable<SessionState["codex_turn_recovery"]>,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession">,
): void {
  const sourceId = codexTurnRecoverySourceId(current.recoveryId);
  if (session.codexLeaderRecycleContinuation?.recoveryId === current.recoveryId) {
    session.codexLeaderRecycleContinuation = null;
  }
  const ownerIds = new Set([current.originalOwnerId, current.continuationOwnerId].filter(Boolean) as string[]);
  for (const input of session.pendingCodexInputs) {
    if (input.agentSource?.sessionId === sourceId) ownerIds.add(input.id);
  }

  const providerTurnIds = new Set<string>();
  if (current.originalProviderTurnId) providerTurnIds.add(current.originalProviderTurnId);
  for (const turn of session.pendingCodexTurns) {
    const ids = turn.pendingInputIds ?? [turn.userMessageId];
    const ownsTurn =
      ownerIds.has(turn.userMessageId) ||
      ids.some((id) => ownerIds.has(id)) ||
      sourceIdForPendingTurn(session, turn) === sourceId;
    if (ownsTurn && turn.turnId) providerTurnIds.add(turn.turnId);
  }
  for (const turn of session.pendingCodexTurns) {
    if (!turn.turnId || !providerTurnIds.has(turn.turnId)) continue;
    for (const id of turn.pendingInputIds ?? [turn.userMessageId]) ownerIds.add(id);
  }

  const previousTurnCount = session.pendingCodexTurns.length;
  let splitMixedTurn = false;
  session.pendingCodexTurns = session.pendingCodexTurns.flatMap((turn) => {
    if (turn.turnId != null && providerTurnIds.has(turn.turnId)) return [];
    const ids = turn.pendingInputIds ?? [turn.userMessageId];
    const remainingIds = ids.filter((id) => !ownerIds.has(id));
    const sourceOwned = sourceIdForPendingTurn(session, turn) === sourceId;
    if (remainingIds.length === ids.length && !sourceOwned) return [turn];
    if (remainingIds.length === 0 || turn.adapterMsg.type === "user_message") return [];
    if (turn.adapterMsg.type !== "codex_start_pending" && turn.adapterMsg.type !== "codex_steer_pending") {
      return [];
    }

    const batchMessage = turn.adapterMsg;
    const inputById = new Map(
      batchMessage.pendingInputIds.map((id, index) => [id, batchMessage.inputs[index]] as const),
    );
    const pendingById = new Map(session.pendingCodexInputs.map((input) => [input.id, input] as const));
    const remainingInputs = remainingIds.map((id) => {
      const existing = inputById.get(id);
      if (existing) return existing;
      const pending = pendingById.get(id);
      return {
        content: pending?.deliveryContent || pending?.content || turn.userContent,
        ...(pending?.vscodeSelection ? { vscodeSelection: pending.vscodeSelection } : {}),
      };
    });
    turn.adapterMsg = { ...batchMessage, pendingInputIds: remainingIds, inputs: remainingInputs };
    turn.pendingInputIds = remainingIds;
    turn.userMessageId = remainingIds[0]!;
    turn.userContent = remainingInputs
      .map((input) => input.content)
      .filter(Boolean)
      .join("\n\n");
    if (turn.historyIndex === current.originalHistoryIndex || sourceOwned) turn.historyIndex = -1;
    splitMixedTurn = true;
    return [turn];
  });

  const previousInputCount = session.pendingCodexInputs.length;
  session.pendingCodexInputs = session.pendingCodexInputs.filter(
    (input) => !ownerIds.has(input.id) && input.agentSource?.sessionId !== sourceId,
  );
  if (session.pendingCodexInputs.length !== previousInputCount) {
    deps.broadcastToBrowsers(session, {
      type: "codex_pending_inputs",
      inputs: compactPendingCodexInputsForBrowser(session.pendingCodexInputs),
    });
  }
  if (
    session.pendingCodexTurns.length !== previousTurnCount ||
    session.pendingCodexInputs.length !== previousInputCount ||
    splitMixedTurn
  ) {
    if (
      typeof session.isGenerating === "boolean" &&
      typeof session.queuedTurnStarts === "number" &&
      Array.isArray(session.queuedTurnReasons) &&
      Array.isArray(session.queuedTurnUserMessageIds) &&
      Array.isArray(session.queuedTurnInterruptSources)
    ) {
      reconcileRecoveredQueuedTurnLifecycle(session as any, "codex_turn_recovery_action_required", {
        getCodexHeadTurn: (target: CodexInterruptedTurnRecoverySessionLike) => target.pendingCodexTurns[0] ?? null,
      });
    }
    deps.persistSession(session);
  }
}

export function markCodexTurnRecoveryActionRequired(
  session: CodexInterruptedTurnRecoverySessionLike,
  reason: CodexTurnRecoveryReason,
  deps: Pick<
    CodexInterruptedTurnRecoveryDeps,
    | "broadcastToBrowsers"
    | "persistSession"
    | "persistHistoryMetadataRepair"
    | "refreshBrowserConversationViews"
    | "setAttentionError"
  >,
): void {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current) return;
  retireCodexTurnRecoveryOwners(session, current, deps);
  const shouldRaiseAttention = !session.attentionReason;
  const raisedAttention = current.raisedAttention === true || shouldRaiseAttention;
  setRecoveryState(
    session,
    { ...current, status: "action_required", reason, raisedAttention, updatedAt: Date.now() },
    deps,
  );
  if (shouldRaiseAttention) deps.setAttentionError?.(session);
  console.warn(
    `[ws-bridge] Codex interrupted-turn recovery requires action for session ${sessionTag(session.id)} ` +
      `(recovery=${current.recoveryId}, reason=${reason}, route=${current.threadKey})`,
  );
}

export function resolveCodexTurnRecoveryAction(
  session: CodexInterruptedTurnRecoverySessionLike,
  recoveryId: string,
  deps: Pick<
    CodexInterruptedTurnRecoveryDeps,
    "broadcastToBrowsers" | "persistSession" | "persistHistoryMetadataRepair" | "refreshBrowserConversationViews"
  >,
): boolean {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current || current.status !== "action_required" || current.recoveryId !== recoveryId) return false;
  retireCodexTurnRecoveryOwners(session, current, deps);
  clearCodexTurnRecoveryState(session, current, deps);
  console.log(
    `[ws-bridge] User resolved Codex interrupted-turn recovery for session ${sessionTag(session.id)} ` +
      `(recovery=${current.recoveryId}, route=${current.threadKey})`,
  );
  return true;
}

export function clearCodexTurnRecoveryForOwner(
  session: CodexInterruptedTurnRecoverySessionLike,
  ownerId: string,
  deps: Pick<
    CodexInterruptedTurnRecoveryDeps,
    "broadcastToBrowsers" | "persistSession" | "persistHistoryMetadataRepair" | "refreshBrowserConversationViews"
  >,
): void {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current) return;
  if (ownerId !== current.originalOwnerId && ownerId !== current.continuationOwnerId) return;
  if (ownerId === current.originalOwnerId && current.attempt > 0) return;
  clearCodexTurnRecoveryState(session, current, deps);
  console.log(
    `[ws-bridge] Cleared Codex interrupted-turn recovery for session ${sessionTag(session.id)} ` +
      `(recovery=${current.recoveryId}, owner=${ownerId})`,
  );
}

export function settleCodexTurnRecoveryFromResult(
  session: CodexInterruptedTurnRecoverySessionLike,
  completedTurns: CodexOutboundTurn[],
  result: CLIResultMessage,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession" | "setAttentionError">,
  interrupted = false,
): void {
  const current = session.state.codex_turn_recovery ?? null;
  if (!current) return;
  const successful = isSuccessfulResult(result, interrupted);
  if (successful && current.status === "action_required") {
    const followUp = completedTurns.find((turn) => isFreshSameThreadHumanRecoveryFollowUp(session, turn, current));
    if (followUp) {
      clearCodexTurnRecoveryState(session, current, deps);
      console.log(
        `[ws-bridge] Cleared action-required Codex recovery after a successful same-thread follow-up for ` +
          `${sessionTag(session.id)} (recovery=${current.recoveryId}, owner=${followUp.userMessageId}, ` +
          `route=${current.threadKey})`,
      );
      return;
    }
  }
  const continuation = completedTurns.find((turn) => isRecoveryContinuationTurn(session, turn, current.recoveryId));
  if (!continuation) {
    const completedOriginal = completedTurns.some((turn) => turn.userMessageId === current.originalOwnerId);
    if (!completedOriginal || current.attempt > 0) return;
    if (successful) clearCodexTurnRecoveryForOwner(session, current.originalOwnerId, deps);
    else markCodexTurnRecoveryActionRequired(session, "recovery_failed", deps);
    return;
  }
  if (successful) {
    clearCodexTurnRecoveryForOwner(session, continuation.userMessageId, deps);
    return;
  }
  const stopReason = typeof result.stop_reason === "string" ? result.stop_reason.toLowerCase() : "";
  markCodexTurnRecoveryActionRequired(
    session,
    interrupted || stopReason.includes("interrupt") || stopReason.includes("cancel")
      ? "continuation_interrupted"
      : "continuation_failed",
    deps,
  );
}

function isFreshSameThreadHumanRecoveryFollowUp(
  session: CodexInterruptedTurnRecoverySessionLike,
  turn: CodexOutboundTurn,
  recovery: NonNullable<SessionState["codex_turn_recovery"]>,
): boolean {
  if (turn.userMessageId === recovery.originalOwnerId || turn.userMessageId === recovery.continuationOwnerId) {
    return false;
  }
  if (turn.historyIndex <= recovery.originalHistoryIndex || !isDirectHumanTurn(session, turn)) return false;
  const message = getMessageAtAbsoluteHistoryIndex(session, turn.historyIndex);
  if (message?.type !== "user_message" || message.timestamp <= recovery.updatedAt) return false;
  const route = routeFromHistoryEntry(message) ?? threadRouteForTarget("main");
  return sameThreadRoute(route, { threadKey: recovery.threadKey });
}

function clearCodexTurnRecoveryState(
  session: CodexInterruptedTurnRecoverySessionLike,
  recovery: NonNullable<SessionState["codex_turn_recovery"]>,
  deps: Pick<
    CodexInterruptedTurnRecoveryDeps,
    "broadcastToBrowsers" | "persistSession" | "persistHistoryMetadataRepair" | "refreshBrowserConversationViews"
  >,
): void {
  const retired = retireCodexTurnRecoveryDiagnostics(session, recovery, Date.now());
  session.state.codex_turn_recovery = null;
  deps.broadcastToBrowsers(session, { type: "session_update", session: { codex_turn_recovery: null } });
  if (retired.requiresFrozenHistoryMetadataRepair && deps.persistHistoryMetadataRepair) {
    const expectedFrozenCount = normalizedFrozenHistoryCount(session);
    void deps.persistHistoryMetadataRepair(session, expectedFrozenCount).catch((error) => {
      console.error(
        `[ws-bridge] Failed to persist resolved Codex recovery diagnostic for ${sessionTag(session.id)} ` +
          `(recovery=${recovery.recoveryId}):`,
        error,
      );
    });
  } else {
    deps.persistSession(session);
  }
  if (retired.changed) deps.refreshBrowserConversationViews?.(session);
}

interface RetiredCodexTurnRecoveryDiagnostics {
  changed: boolean;
  requiresFrozenHistoryMetadataRepair: boolean;
}

function retireCodexTurnRecoveryDiagnostics(
  session: CodexInterruptedTurnRecoverySessionLike,
  recovery: NonNullable<SessionState["codex_turn_recovery"]>,
  resolvedAt: number,
): RetiredCodexTurnRecoveryDiagnostics {
  const exactIndexes: number[] = [];
  for (let index = recovery.originalHistoryIndex + 1; index < session.messageHistory.length; index += 1) {
    const message = session.messageHistory[index];
    if (
      message?.type === "user_message" &&
      message.codexTurnRecoveryId === recovery.recoveryId &&
      message.codexTurnRecoveryResolvedAt == null &&
      isCodexLeaderRecoveryDiagnosticSourceId(message.agentSource?.sessionId)
    ) {
      exactIndexes.push(index);
    }
  }

  const indexes = exactIndexes.length > 0 ? exactIndexes : uniqueLegacyRecoveryDiagnosticIndex(session, recovery);
  const frozenCount = normalizedFrozenHistoryCount(session);
  let requiresFrozenHistoryMetadataRepair = false;
  for (const index of indexes) {
    const message = session.messageHistory[index];
    if (message?.type !== "user_message") continue;
    message.codexTurnRecoveryId = recovery.recoveryId;
    message.codexTurnRecoveryResolvedAt = resolvedAt;
    requiresFrozenHistoryMetadataRepair ||= index < frozenCount;
  }
  return { changed: indexes.length > 0, requiresFrozenHistoryMetadataRepair };
}

function uniqueLegacyRecoveryDiagnosticIndex(
  session: CodexInterruptedTurnRecoverySessionLike,
  recovery: NonNullable<SessionState["codex_turn_recovery"]>,
): number[] {
  const candidates: number[] = [];
  for (let index = recovery.originalHistoryIndex + 1; index < session.messageHistory.length; index += 1) {
    const message = session.messageHistory[index];
    if (!message) continue;
    if (message.type === "user_message" && message.agentSource == null) break;
    if (
      message.type !== "user_message" ||
      message.codexTurnRecoveryId != null ||
      message.codexTurnRecoveryResolvedAt != null ||
      !isCodexLeaderRecoveryDiagnosticSourceId(message.agentSource?.sessionId) ||
      message.timestamp < recovery.createdAt
    ) {
      continue;
    }
    const route = routeFromHistoryEntry(message) ?? threadRouteForTarget("main");
    if (sameThreadRoute(route, { threadKey: recovery.threadKey })) candidates.push(index);
  }
  return candidates.length === 1 ? candidates : [];
}

function normalizedFrozenHistoryCount(session: CodexInterruptedTurnRecoverySessionLike): number {
  const raw = session.frozenCount ?? session._frozenCount ?? 0;
  return Number.isFinite(raw) ? Math.max(0, Math.min(Math.floor(raw), session.messageHistory.length)) : 0;
}

function hasHistoricalSuccessfulSameThreadHumanFollowUp(
  session: CodexInterruptedTurnRecoverySessionLike,
  recovery: NonNullable<SessionState["codex_turn_recovery"]>,
): boolean {
  const pendingOwnerIds = new Set(session.pendingCodexInputs.map((input) => input.id));
  for (const turn of session.pendingCodexTurns) {
    if (turn.status === "completed") continue;
    pendingOwnerIds.add(turn.userMessageId);
    for (const id of turn.pendingInputIds ?? []) pendingOwnerIds.add(id);
  }

  let segmentHasEligibleFollowUp = false;
  for (let index = recovery.originalHistoryIndex + 1; index < session.messageHistory.length; index += 1) {
    const message = session.messageHistory[index];
    if (!message || message.codexSubagent != null) continue;
    if (message.type === "user_message") {
      const messageId = message.id?.trim() ?? "";
      const route = routeFromHistoryEntry(message) ?? threadRouteForTarget("main");
      segmentHasEligibleFollowUp =
        message.agentSource == null &&
        messageId.length > 0 &&
        message.timestamp > recovery.updatedAt &&
        !pendingOwnerIds.has(messageId) &&
        sameThreadRoute(route, { threadKey: recovery.threadKey });
      continue;
    }
    if (message.type !== "result") continue;
    const route = routeFromHistoryEntry(message) ?? threadRouteForTarget("main");
    if (
      segmentHasEligibleFollowUp &&
      sameThreadRoute(route, { threadKey: recovery.threadKey }) &&
      isSuccessfulResult(message.data, message.interrupted === true)
    ) {
      return true;
    }
    segmentHasEligibleFollowUp = false;
  }
  return false;
}

export function resolveCodexTurnRecoveryRoute(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
  recoveredRoute?: ThreadRouteMetadata | null,
): ThreadRouteMetadata {
  if (pending.adapterMsg.type === "user_message") {
    const route = browserMessageRoute(pending.adapterMsg);
    if (route) return route;
  }
  const original = getMessageAtAbsoluteHistoryIndex(session, pending.historyIndex);
  return routeFromHistoryEntry(original ?? undefined) ?? recoveredRoute ?? threadRouteForTarget("main");
}

export function isRecoveryContinuationTurn(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
  recoveryId = session.state.codex_turn_recovery?.recoveryId,
): boolean {
  if (!recoveryId) return false;
  if (pending.userMessageId === session.state.codex_turn_recovery?.continuationOwnerId) return true;
  const sourceId = sourceIdForPendingTurn(session, pending);
  return sourceId === codexTurnRecoverySourceId(recoveryId);
}

function setRecoveryState(
  session: CodexInterruptedTurnRecoverySessionLike,
  state: SessionState["codex_turn_recovery"],
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession">,
): void {
  session.state.codex_turn_recovery = state;
  deps.broadcastToBrowsers(session, { type: "session_update", session: { codex_turn_recovery: state } });
  deps.persistSession(session);
}

function isDirectHumanTurn(session: CodexInterruptedTurnRecoverySessionLike, pending: CodexOutboundTurn): boolean {
  const original = getMessageAtAbsoluteHistoryIndex(session, pending.historyIndex);
  if (original?.type === "user_message") return original.agentSource == null;
  return pending.adapterMsg.type === "user_message" && pending.adapterMsg.agentSource == null;
}

function sourceIdForPendingTurn(
  session: CodexInterruptedTurnRecoverySessionLike,
  pending: CodexOutboundTurn,
): string | undefined {
  const original = getMessageAtAbsoluteHistoryIndex(session, pending.historyIndex);
  if (original?.type === "user_message") return original.agentSource?.sessionId;
  if (pending.adapterMsg.type === "user_message") return pending.adapterMsg.agentSource?.sessionId;
  return undefined;
}

function findContinuationOwnerId(session: CodexInterruptedTurnRecoverySessionLike, sourceId: string): string | null {
  const pendingInput = [...session.pendingCodexInputs]
    .reverse()
    .find((input) => input.deliveryState !== "failed" && input.agentSource?.sessionId === sourceId);
  if (pendingInput) return pendingInput.id;
  const pendingTurn = [...session.pendingCodexTurns]
    .reverse()
    .find((turn) => sourceIdForPendingTurn(session, turn) === sourceId);
  return pendingTurn?.userMessageId ?? null;
}

function buildContinuationPrompt(session: CodexInterruptedTurnRecoverySessionLike, pending: CodexOutboundTurn): string {
  const sessionRef = String(getKnownSessionNum(session.id) ?? session.sessionNum ?? session.id);
  const historyIndex = pending.historyIndex;
  const inspectCommands =
    historyIndex >= 0
      ? `Start with \`takode peek ${sessionRef} --turn-containing ${historyIndex}\`, then use \`takode read ${sessionRef} ${historyIndex}\` and other targeted inspection only as needed.`
      : `Start with \`takode scan ${sessionRef}\`, then inspect the most recent interrupted turn with \`takode peek\` or \`takode read\` as needed.`;
  return [
    "Takode detected that the previous leader turn ended after model/tool activity but before a final response.",
    "This message is a separate recovery continuation. The original user payload was already delivered and must not be replayed.",
    inspectCommands,
    "Treat completed tool calls and durable side effects as already performed. Verify existing quest, board, notification, file, and external state before repeating any action.",
    "Continue only the missing work within the original authorization and thread route. If safe continuation remains unclear, report the unfinished/action-required state instead of guessing or claiming completion.",
  ].join("\n\n");
}

function isSuccessfulResult(result: CLIResultMessage, interrupted = false): boolean {
  if (interrupted || result.is_error) return false;
  const stopReason = typeof result.stop_reason === "string" ? result.stop_reason.toLowerCase() : "";
  if (stopReason.includes("interrupt") || stopReason.includes("cancel") || stopReason.includes("fail")) return false;
  return result.subtype === "success";
}

function hasRecoveryEpochUserMessage(session: CodexInterruptedTurnRecoverySessionLike, requestedAt: number): boolean {
  let markerIndex = -1;
  for (let index = session.messageHistory.length - 1; index >= 0; index -= 1) {
    const message = session.messageHistory[index];
    if (
      message?.type === "compact_marker" &&
      message.markerKind === "session_recycled" &&
      message.timestamp === requestedAt
    ) {
      markerIndex = index;
      break;
    }
  }
  if (markerIndex >= 0) {
    return session.messageHistory.slice(markerIndex + 1).some((message) => message.type === "user_message");
  }
  return session.messageHistory.some(
    (message) => message.type === "user_message" && (message.timestamp ?? 0) >= requestedAt,
  );
}

function normalizeStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function findLastResumeItemIndex(
  items: Array<Record<string, unknown>>,
  predicate: (item: Record<string, unknown>) => boolean,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}

function isResumeToolActivityItem(item: Record<string, unknown>): boolean {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  return (
    type.includes("command") ||
    type.includes("tool") ||
    type.includes("function") ||
    type.includes("filechange") ||
    type.includes("patch")
  );
}

function isTerminalResumeItem(item: Record<string, unknown>): boolean {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  return (
    type === "result" ||
    type === "turnresult" ||
    type === "turn_result" ||
    type === "taskcomplete" ||
    type === "task_complete" ||
    type.includes("taskcomplete") ||
    type.includes("task_complete")
  );
}

export function isCodexTurnRecoverySource(sourceId: string | undefined): boolean {
  return isCodexTurnRecoverySourceId(sourceId);
}
