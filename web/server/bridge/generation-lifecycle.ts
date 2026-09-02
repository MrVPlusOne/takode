import { sessionTag } from "../session-tag.js";
import type { ActiveCodexReasoningPreview, ActiveTurnRoute, TakodeTurnEndEventData } from "../session-types.js";
import {
  clearCodexReasoningPreviewForRoute,
  type CodexReasoningPreviewsByThread,
} from "./codex-reasoning-preview-state.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { clearRecentAskVisibleResponseBoundaries } from "../recent-ask-bundles.js";
import { isSystemSourceTag, isTimerSourceTag } from "./adapter-browser-routing-source-tags.js";

/** Reasons that indicate the turn ended due to recovery/error, not a normal result.
 *  Queued turns should be drained (not promoted) for these reasons because the CLI
 *  that would process them is either dead, stuck, or was replaced by a new process. */
export const RECOVERY_REASONS = new Set([
  "stuck_auto_recovery",
  "restart_prep_codex_fallback",
  "system_init_reset",
  "cli_disconnect",
  "user_message_timeout",
]);

/** Reasons that are internal lifecycle bookkeeping boundaries, not
 * leader-actionable turn completions. State cleanup and local callbacks still
 * run, but no external turn_end herd event should be emitted. */
export const SUPPRESSED_TAKODE_TURN_END_REASONS = new Set([
  "codex_retry_pending_turn_restart",
  "codex_provider_result_retry",
  "codex_steer_no_active_turn",
  "codex_init_error",
  "codex_recovery_suppressed",
  "codex_interrupted_turn_continuation",
]);

export type InterruptSource = "user" | "leader" | "system";

export interface ProvisionalStuckRecovery {
  turnId: string;
  notifiedAt: number;
  terminalAfter: number;
}

export interface GenerationLifecycleSession {
  id: string;
  isGenerating: boolean;
  generationStartedAt: number | null;
  stuckNotifiedAt: number | null;
  questStatusAtTurnStart: string | null;
  messageCountAtTurnStart: number;
  interruptedDuringTurn: boolean;
  interruptSourceDuringTurn: InterruptSource | null;
  restartPrepInterruptOperationId?: string | null;
  restartPrepInterruptOrigin?: "restart_prep" | null;
  compactedDuringTurn: boolean;
  provisionalStuckRecovery: ProvisionalStuckRecovery | null;
  userMessageIdsThisTurn: number[];
  questThreadRemindersThisTurn?: unknown[];
  activeTurnRoute?: ActiveTurnRoute | null;
  activeReasoningAttributionRoute?: ActiveTurnRoute | null;
  activeCodexReasoningPreview?: ActiveCodexReasoningPreview | null;
  codexReasoningPreviews?: CodexReasoningPreviewsByThread;
  queuedTurnStarts: number;
  queuedTurnReasons: string[];
  queuedTurnUserMessageIds: number[][];
  recentAskVisibleResponseThreads?: Set<string>;
  queuedTurnInterruptSources: (InterruptSource | null)[];
  queuedTurnActiveRoutes?: (ActiveTurnRoute | null)[];
  optimisticRunningTimer: ReturnType<typeof setTimeout> | null;
  lastUserMessage?: string;
  state: {
    claimedQuestStatus?: string;
    leaderThreadStatuses?: Record<string, LeaderThreadStatus>;
  };
  messageHistory: unknown[];
  notifications?: Array<{
    id: string;
    category: string;
    timestamp: number;
    messageId?: string | null;
    threadKey?: string;
    questId?: string;
    herdDecisionWaitReportedAt?: number;
    herdDecisionResumeReportedAt?: number;
  }>;
}

export interface GenerationLifecycleDeps<S extends GenerationLifecycleSession> {
  sessions: Map<string, S>;
  userMessageRunningTimeoutMs: number;
  broadcastStatus: (session: S, status: "running" | "idle") => void;
  broadcastSessionUpdate?: (session: S, update: Record<string, unknown>) => void;
  persistSession: (session: S) => void;
  onSessionActivityStateChanged: (sessionId: string, reason: string) => void;
  emitTakodeEvent: (sessionId: string, type: "turn_start" | "turn_end", data: Record<string, unknown>) => void;
  buildTurnToolSummary: (session: S) => Record<string, unknown>;
  recordGenerationStarted?: (session: S, reason: string) => void;
  recordGenerationEnded?: (session: S, reason: string, elapsedMs: number) => void;
  recoverPendingCodexTurnBeforeQueueDrain?: (session: S, reason: string) => boolean;
  onNonResultTurnTerminal?: (session: S, reason: string) => void;
  onGenerationStopped?: (session: S, reason: string) => void;
  onOrchestratorTurnEnd?: (sessionId: string, reason?: string) => void;
  /** Returns who triggered the current turn on a given session. */
  getCurrentTurnTriggerSource?: (session: S) => "user" | "leader" | "system" | "unknown";
  /** Returns true if the session is a herded worker (owned by an orchestrator). */
  isHerdedWorker?: (session: S) => boolean;
}

export interface StuckWatchdogSession extends GenerationLifecycleSession {
  backendType: string;
  pendingCodexInputs: Array<{ timestamp: number; deliveryState?: "failed" }>;
  codexAdapter: unknown | null;
  toolStartTimes: Map<string, number>;
  lastCliMessageAt: number;
  lastToolProgressAt: number;
  state: GenerationLifecycleSession["state"] & {
    backend_state?: string;
    cwd: string;
  };
}

export interface StuckWatchdogDeps<S extends StuckWatchdogSession> {
  stuckPendingDeliveryMs: number;
  stuckThresholdMs: number;
  autoRecoverMs: number;
  autoRecoverOrchestratorMs: number;
  requestCodexAutoRecovery: (session: S, reason: string) => void;
  broadcastMessage: (session: S, msg: Record<string, unknown>) => void;
  recordServerEvent?: (session: S, reason: string, payload: Record<string, unknown>) => void;
  getLauncherSessionInfo?: (
    sessionId: string,
  ) => { isOrchestrator?: boolean; archived?: boolean; killedByIdleManager?: boolean } | null | undefined;
  forceFlushPendingEvents?: (sessionId: string) => number;
  backendConnected: (session: S) => boolean;
  markTurnInterrupted: (session: S, source: InterruptSource) => void;
  setGenerating: (session: S, generating: boolean, reason: string) => void;
  emitTakodeEvent: (sessionId: string, type: "turn_end", data: TakodeTurnEndEventData) => void;
  buildTurnToolSummary: (session: S) => Record<string, unknown>;
  getCurrentTurnTriggerSource?: (session: S) => "user" | "leader" | "system" | "unknown";
  getRecoverableActiveCodexTurnId?: (session: S) => string | null;
  pokeStaleCodexPendingDelivery?: (session: S, reason: string) => boolean;
  recoverStuckOrchestratorCodexTurn?: (session: S) => boolean;
}

export type UserDispatchTurnTarget = "current" | "queued";
export interface QueuedTurnLifecycleEntry {
  reason: string;
  userMessageIds: number[];
  interruptSource: InterruptSource | null;
  activeTurnRoute: ActiveTurnRoute | null;
}

function getCurrentTurnDecisionLifecycle(
  session: GenerationLifecycleSession,
  generationStartedAt: number | null,
  activeTurnRoute: ActiveTurnRoute | null | undefined,
  turnEndedAt: number,
): Pick<TakodeTurnEndEventData, "awaiting_decision" | "resumed_after_decision"> {
  if (generationStartedAt === null) return {};
  const notifications = session.notifications ?? [];
  const activeRouteKey = decisionRouteKey(activeTurnRoute?.threadKey, activeTurnRoute?.questId);
  const currentResponseIds = getDecisionResponseNotificationIds(session, session.userMessageIdsThisTurn);
  const queuedResponseIds = getDecisionResponseNotificationIds(session, session.queuedTurnUserMessageIds.flat());
  const queuedExternalContinuation = hasExternalContinuationForRoute(
    session,
    session.queuedTurnUserMessageIds.flat(),
    activeRouteKey,
  );
  // `done` is not answer evidence here: herd delivery confirmation marks a
  // notification done before the leader may have answered it. Correlate actual
  // current/queued inputs instead so the predecessor's normal wait stays visible.
  const currentWaitCandidates = notifications.filter(
    (notification) =>
      notification.category === "needs-input" &&
      notification.timestamp >= generationStartedAt &&
      decisionRouteKey(notification.threadKey, notification.questId) === activeRouteKey &&
      !currentResponseIds.has(notification.id),
  );
  const inferredQueuedContinuationId =
    currentResponseIds.size === 0 &&
    queuedResponseIds.size === 0 &&
    currentWaitCandidates.length === 1 &&
    queuedExternalContinuation(currentWaitCandidates[0].timestamp)
      ? currentWaitCandidates[0].id
      : null;
  const currentWaits = currentWaitCandidates.filter(
    (notification) => !queuedResponseIds.has(notification.id) && notification.id !== inferredQueuedContinuationId,
  );
  for (const notification of currentWaits) {
    notification.herdDecisionWaitReportedAt ??= turnEndedAt;
  }

  const pendingWaits = notifications.filter(
    (notification) =>
      notification.category === "needs-input" &&
      notification.timestamp < generationStartedAt &&
      decisionRouteKey(notification.threadKey, notification.questId) === activeRouteKey &&
      typeof notification.herdDecisionWaitReportedAt === "number" &&
      notification.herdDecisionResumeReportedAt === undefined,
  );
  const currentExternalContinuation = hasExternalContinuationForRoute(
    session,
    session.userMessageIdsThisTurn,
    activeRouteKey,
  );
  const exactResumedWaits = pendingWaits.filter((notification) => currentResponseIds.has(notification.id));
  const inferredResumedWaits =
    exactResumedWaits.length === 0 &&
    currentResponseIds.size === 0 &&
    pendingWaits.length === 1 &&
    currentExternalContinuation(pendingWaits[0].timestamp)
      ? pendingWaits
      : [];
  const resumedWaits = exactResumedWaits.length > 0 ? exactResumedWaits : inferredResumedWaits;
  for (const notification of resumedWaits) notification.herdDecisionResumeReportedAt = turnEndedAt;
  return {
    ...(currentWaits.length > 0 ? { awaiting_decision: true } : {}),
    ...(resumedWaits.length > 0 ? { resumed_after_decision: true } : {}),
  };
}

function decisionRouteKey(threadKey: string | undefined, questId: string | undefined): string {
  return (questId ?? threadKey ?? "main").trim().toLowerCase() || "main";
}

function getDecisionResponseNotificationIds(
  session: GenerationLifecycleSession,
  historyIndices: readonly number[],
): Set<string> {
  const notifications = new Map(
    (session.notifications ?? [])
      .filter((notification) => notification.category === "needs-input")
      .map((notification) => [notification.id, notification] as const),
  );
  const responseIds = new Set<string>();
  for (const historyIndex of historyIndices) {
    const entry = session.messageHistory[historyIndex] as
      | {
          type?: string;
          replyContext?: { notificationId?: string };
          threadKey?: string;
          questId?: string;
        }
      | undefined;
    if (entry?.type !== "user_message") continue;
    const notificationId = entry.replyContext?.notificationId;
    if (!notificationId) continue;
    const notification = notifications.get(notificationId);
    if (!notification) continue;
    if (
      decisionRouteKey(entry.threadKey, entry.questId) !==
      decisionRouteKey(notification.threadKey, notification.questId)
    ) {
      continue;
    }
    responseIds.add(notificationId);
  }
  return responseIds;
}

function hasExternalContinuationForRoute(
  session: GenerationLifecycleSession,
  historyIndices: readonly number[],
  routeKey: string,
): (afterTimestamp: number) => boolean {
  const candidates = historyIndices.flatMap((historyIndex) => {
    const entry = session.messageHistory[historyIndex] as
      | {
          type?: string;
          timestamp?: number;
          agentSource?: { sessionId: string; sessionLabel?: string };
          threadKey?: string;
          questId?: string;
        }
      | undefined;
    if (entry?.type !== "user_message") return [];
    if (decisionRouteKey(entry.threadKey, entry.questId) !== routeKey) return [];
    if (
      isSystemSourceTag(entry.agentSource) ||
      isTimerSourceTag(entry.agentSource) ||
      entry.agentSource?.sessionId === "herd-events" ||
      entry.agentSource?.sessionId.startsWith("cron:")
    ) {
      return [];
    }
    return [{ timestamp: entry.timestamp ?? 0 }];
  });
  return (afterTimestamp) => candidates.some((candidate) => candidate.timestamp >= afterTimestamp);
}

function interruptSourcePriority(source: InterruptSource | null): number {
  switch (source) {
    case "user":
    case "leader":
      return 2;
    case "system":
      return 1;
    default:
      return 0;
  }
}

export function markTurnInterrupted<S extends GenerationLifecycleSession>(session: S, source: InterruptSource): void {
  if (!session.isGenerating) return;
  session.interruptedDuringTurn = true;
  if (interruptSourcePriority(source) > interruptSourcePriority(session.interruptSourceDuringTurn)) {
    session.interruptSourceDuringTurn = source;
  }
}

export function clearOptimisticRunningTimer<S extends GenerationLifecycleSession>(session: S): void {
  if (!session.optimisticRunningTimer) return;
  clearTimeout(session.optimisticRunningTimer);
  session.optimisticRunningTimer = null;
}

function restartOptimisticRunningTimer<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  reason: string,
): void {
  clearOptimisticRunningTimer(session);
  const timer = setTimeout(() => {
    const current = deps.sessions.get(session.id);
    if (!current) return;
    if (current.optimisticRunningTimer !== timer) return;
    current.optimisticRunningTimer = null;
    if (!current.isGenerating) return;

    console.warn(
      `[ws-bridge] Reverting optimistic running state after ${deps.userMessageRunningTimeoutMs}ms for session ${sessionTag(current.id)} (${reason})`,
    );
    deps.onNonResultTurnTerminal?.(current, "user_message_timeout");
    markTurnInterrupted(current, "system");
    setGenerating(deps, current, false, "user_message_timeout");
    // Drain any remaining queued turns — if the CLI didn't respond to this
    // promoted turn, it won't respond to subsequent phantom turns either.
    const remainingEntries = getQueuedTurnLifecycleEntries(current);
    if (remainingEntries.length > 0) {
      console.warn(
        `[ws-bridge] Draining ${remainingEntries.length} remaining queued turn(s) for session ${sessionTag(current.id)} after timeout`,
      );
      replaceQueuedTurnLifecycleEntries(current, []);
    }
    deps.broadcastStatus(current, "idle");
    deps.persistSession(current);
  }, deps.userMessageRunningTimeoutMs);
  session.optimisticRunningTimer = timer;
}

export function markRunningFromUserDispatch<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  reason: string,
  queuedInterruptSource: InterruptSource | null = null,
  userMessageHistoryIndex?: number,
  activeTurnRoute?: ActiveTurnRoute | null,
): UserDispatchTurnTarget {
  const wasGenerating = session.isGenerating;
  // Skip the optimistic 30s timeout for herded workers — their turns are
  // leader-paced and the timeout would spuriously interrupt them.
  if (!deps.isHerdedWorker?.(session)) {
    restartOptimisticRunningTimer(deps, session, reason);
  }
  if (wasGenerating) {
    const hadActiveReasoningStream = session.activeCodexReasoningPreview != null;
    const clearedRetainedPreview = clearCodexReasoningPreviewForRoute(session, activeTurnRoute);
    const queuedTurnActiveRoutes = session.queuedTurnActiveRoutes ?? [];
    while (queuedTurnActiveRoutes.length < session.queuedTurnStarts) {
      queuedTurnActiveRoutes.push(null);
    }
    session.queuedTurnStarts += 1;
    session.queuedTurnReasons.push(reason);
    session.queuedTurnUserMessageIds.push(userMessageHistoryIndex === undefined ? [] : [userMessageHistoryIndex]);
    session.queuedTurnInterruptSources.push(queuedInterruptSource);
    queuedTurnActiveRoutes.push(activeTurnRoute ?? null);
    session.queuedTurnActiveRoutes = queuedTurnActiveRoutes;
    session.activeReasoningAttributionRoute = activeTurnRoute ?? null;
    session.activeCodexReasoningPreview = null;
    if (hadActiveReasoningStream || clearedRetainedPreview) deps.broadcastStatus(session, "running");
    deps.persistSession(session);
    return "queued";
  }
  setGenerating(deps, session, true, reason);
  if (userMessageHistoryIndex !== undefined) {
    session.userMessageIdsThisTurn = [userMessageHistoryIndex];
  }
  session.activeTurnRoute = activeTurnRoute ?? null;
  session.activeReasoningAttributionRoute = activeTurnRoute ?? null;
  clearCodexReasoningPreviewForRoute(session, activeTurnRoute);
  session.activeCodexReasoningPreview = null;
  if (!wasGenerating) {
    deps.broadcastStatus(session, "running");
  }
  deps.persistSession(session);
  return "current";
}

export function trackUserMessageForTurn<S extends GenerationLifecycleSession>(
  session: S,
  historyIndex: number,
  target: UserDispatchTurnTarget,
): void {
  if (target === "queued") {
    const nextIdx = session.queuedTurnUserMessageIds.length - 1;
    if (nextIdx >= 0) {
      session.queuedTurnUserMessageIds[nextIdx].push(historyIndex);
      return;
    }
  }
  session.userMessageIdsThisTurn.push(historyIndex);
}

export function getQueuedTurnLifecycleEntries<S extends GenerationLifecycleSession>(
  session: S,
): QueuedTurnLifecycleEntry[] {
  const count = Math.max(
    session.queuedTurnStarts,
    session.queuedTurnReasons.length,
    session.queuedTurnUserMessageIds.length,
    session.queuedTurnInterruptSources.length,
    session.queuedTurnActiveRoutes?.length ?? 0,
  );
  return Array.from({ length: count }, (_, idx) => ({
    reason: session.queuedTurnReasons[idx] ?? "queued_user_message",
    userMessageIds: [...(session.queuedTurnUserMessageIds[idx] ?? [])],
    interruptSource: session.queuedTurnInterruptSources[idx] ?? null,
    activeTurnRoute: session.queuedTurnActiveRoutes?.[idx] ?? null,
  }));
}

export function replaceQueuedTurnLifecycleEntries<S extends GenerationLifecycleSession>(
  session: S,
  entries: QueuedTurnLifecycleEntry[],
): void {
  session.queuedTurnStarts = entries.length;
  session.queuedTurnReasons = entries.map((entry) => entry.reason);
  session.queuedTurnUserMessageIds = entries.map((entry) => [...entry.userMessageIds]);
  session.queuedTurnInterruptSources = entries.map((entry) => entry.interruptSource);
  session.queuedTurnActiveRoutes = entries.map((entry) => entry.activeTurnRoute);
}

function startQueuedTurn<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  entry: QueuedTurnLifecycleEntry,
  suffix = "queued",
): void {
  const turnReason = `${entry.reason}:${suffix}`;
  session.isGenerating = true;
  session.generationStartedAt = Date.now();
  session.stuckNotifiedAt = null;
  session.questStatusAtTurnStart = session.state.claimedQuestStatus ?? null;
  session.messageCountAtTurnStart = session.messageHistory.length;
  session.interruptedDuringTurn = false;
  session.interruptSourceDuringTurn = null;
  session.restartPrepInterruptOperationId = null;
  session.restartPrepInterruptOrigin = null;
  session.compactedDuringTurn = false;
  session.provisionalStuckRecovery = null;
  session.userMessageIdsThisTurn = [...entry.userMessageIds];
  session.activeTurnRoute = entry.activeTurnRoute;
  session.activeReasoningAttributionRoute = entry.activeTurnRoute;
  session.activeCodexReasoningPreview = null;
  console.log(`[ws-bridge] Generation started for session ${sessionTag(session.id)} (${turnReason})`);
  deps.recordGenerationStarted?.(session, turnReason);
  deps.emitTakodeEvent(session.id, "turn_start", {
    reason: turnReason,
    userMessage: session.lastUserMessage?.slice(0, 120),
  });
  deps.broadcastStatus(session, "running");
  deps.onSessionActivityStateChanged(session.id, `generating:${turnReason}`);
  // Safety net: if the CLI doesn't respond to this promoted queued turn within
  // the timeout, it was likely a phantom turn (user message lost during a
  // WebSocket token refresh). Without this, phantom queued turns leave
  // isGenerating=true forever. Skip for herded workers (leader-paced).
  if (!deps.isHerdedWorker?.(session)) {
    restartOptimisticRunningTimer(deps, session, turnReason);
  }
}

export function promoteNextQueuedTurn<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  suffix = "queued",
): boolean {
  const entries = getQueuedTurnLifecycleEntries(session);
  const nextEntry = entries.shift();
  if (!nextEntry) return false;
  replaceQueuedTurnLifecycleEntries(session, entries);
  startQueuedTurn(deps, session, nextEntry, suffix);
  return true;
}

export function reconcileTerminalResultState<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  reason: string,
): { endedTurn: boolean; clearedResidualState: boolean } {
  clearOptimisticRunningTimer(session);
  if (session.isGenerating) {
    setGenerating(deps, session, false, reason);
    return { endedTurn: true, clearedResidualState: true };
  }

  const hadResidualState =
    session.generationStartedAt !== null ||
    session.stuckNotifiedAt !== null ||
    session.interruptedDuringTurn ||
    session.interruptSourceDuringTurn !== null ||
    session.compactedDuringTurn ||
    session.provisionalStuckRecovery !== null ||
    session.userMessageIdsThisTurn.length > 0;
  if (!hadResidualState) {
    return { endedTurn: false, clearedResidualState: false };
  }

  session.generationStartedAt = null;
  session.stuckNotifiedAt = null;
  session.interruptedDuringTurn = false;
  session.interruptSourceDuringTurn = null;
  session.compactedDuringTurn = false;
  session.provisionalStuckRecovery = null;
  session.userMessageIdsThisTurn = [];
  session.questThreadRemindersThisTurn = [];
  clearRecentAskVisibleResponseBoundaries(session);
  deps.onSessionActivityStateChanged(session.id, `generating:${reason}:reconciled`);
  return { endedTurn: false, clearedResidualState: true };
}

export function setGenerating<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  generating: boolean,
  reason: string,
): void {
  if (session.isGenerating === generating) return;
  session.isGenerating = generating;
  if (generating) {
    clearRecentAskVisibleResponseBoundaries(session);
    session.generationStartedAt = Date.now();
    session.stuckNotifiedAt = null;
    session.questStatusAtTurnStart = session.state.claimedQuestStatus ?? null;
    session.messageCountAtTurnStart = session.messageHistory.length;
    session.interruptedDuringTurn = false;
    session.interruptSourceDuringTurn = null;
    session.restartPrepInterruptOperationId = null;
    session.restartPrepInterruptOrigin = null;
    session.compactedDuringTurn = false;
    session.provisionalStuckRecovery = null;
    session.userMessageIdsThisTurn = [];
    session.questThreadRemindersThisTurn = [];
    session.activeTurnRoute = null;
    session.activeReasoningAttributionRoute = null;
    session.activeCodexReasoningPreview = null;
    console.log(`[ws-bridge] Generation started for session ${sessionTag(session.id)} (${reason})`);
    deps.recordGenerationStarted?.(session, reason);

    deps.emitTakodeEvent(session.id, "turn_start", {
      reason,
      userMessage: session.lastUserMessage?.slice(0, 120),
    });
  } else {
    clearRecentAskVisibleResponseBoundaries(session);
    clearOptimisticRunningTimer(session);
    const generationStartedAt = session.generationStartedAt;
    const turnEndedAt = Date.now();
    const elapsed = generationStartedAt ? turnEndedAt - generationStartedAt : 0;
    session.generationStartedAt = null;
    session.stuckNotifiedAt = null;
    console.log(
      `[ws-bridge] Generation ended for session ${sessionTag(session.id)} (${reason}, duration: ${elapsed}ms)`,
    );
    deps.recordGenerationEnded?.(session, reason, elapsed);

    const toolSummary = deps.buildTurnToolSummary(session);
    const interrupted = session.interruptedDuringTurn;
    const interruptSource = interrupted ? session.interruptSourceDuringTurn || "system" : null;
    const interruptOrigin = interrupted ? session.restartPrepInterruptOrigin || null : null;
    const restartPrepOperationId = interrupted ? session.restartPrepInterruptOperationId || null : null;
    const compacted = session.compactedDuringTurn;
    const turnSource = deps.getCurrentTurnTriggerSource?.(session) ?? "unknown";
    const activeTurnRoute = session.activeTurnRoute;
    const decisionLifecycle =
      reason === "result" && !interrupted
        ? getCurrentTurnDecisionLifecycle(session, generationStartedAt, activeTurnRoute, turnEndedAt)
        : {};
    session.interruptedDuringTurn = false;
    session.interruptSourceDuringTurn = null;
    session.restartPrepInterruptOperationId = null;
    session.restartPrepInterruptOrigin = null;
    session.compactedDuringTurn = false;
    session.provisionalStuckRecovery = null;
    session.activeTurnRoute = null;
    session.activeReasoningAttributionRoute = null;
    session.activeCodexReasoningPreview = null;
    if (!SUPPRESSED_TAKODE_TURN_END_REASONS.has(reason)) {
      deps.emitTakodeEvent(session.id, "turn_end", {
        reason,
        duration_ms: elapsed,
        ...(interrupted ? { interrupted: true, interrupt_source: interruptSource } : {}),
        ...(interruptOrigin ? { interrupt_origin: interruptOrigin } : {}),
        ...(restartPrepOperationId ? { restart_prep_operation_id: restartPrepOperationId } : {}),
        ...(compacted ? { compacted: true } : {}),
        ...decisionLifecycle,
        ...toolSummary,
        turn_source: turnSource,
        ...(activeTurnRoute?.threadKey ? { threadKey: activeTurnRoute.threadKey } : {}),
        ...(activeTurnRoute?.questId ? { questId: activeTurnRoute.questId } : {}),
      });

      deps.onOrchestratorTurnEnd?.(session.id, reason);
    }

    // On normal result: promote the next queued turn (the CLI is ready for more).
    // On recovery/error: drain ALL queued turns -- the CLI that would process them
    // is either dead, stuck, or was replaced. Promoting them would start phantom
    // turns that never complete, leaving isGenerating=true indefinitely (q-307).
    if (reason === "result") {
      promoteNextQueuedTurn(deps, session);
    } else if (RECOVERY_REASONS.has(reason)) {
      const staleEntries = getQueuedTurnLifecycleEntries(session);
      if (staleEntries.length > 0) {
        const recoveredBeforeDrain = deps.recoverPendingCodexTurnBeforeQueueDrain?.(session, reason) ?? false;
        if (recoveredBeforeDrain) {
          console.warn(
            `[ws-bridge] Retried live Codex pending turn before draining ${staleEntries.length} queued lifecycle entr${
              staleEntries.length === 1 ? "y" : "ies"
            } for session ${sessionTag(session.id)} (reason: ${reason})`,
          );
        } else {
          console.warn(
            `[ws-bridge] Draining ${staleEntries.length} orphaned queued turn(s) for session ${sessionTag(session.id)} (reason: ${reason})`,
          );
          replaceQueuedTurnLifecycleEntries(session, []);
        }
      }
    }
  }
  deps.onSessionActivityStateChanged(session.id, `generating:${reason}`);
  if (!generating) {
    deps.onGenerationStopped?.(session, reason);
  }
}

export function runStuckSessionWatchdogSweep<S extends StuckWatchdogSession>(
  sessions: Iterable<S>,
  now: number,
  deps: StuckWatchdogDeps<S>,
): void {
  for (const session of sessions) {
    const launcherInfo = deps.getLauncherSessionInfo?.(session.id);
    const deliverablePendingCodexInputs = session.pendingCodexInputs.filter(
      (input) => input.deliveryState !== "failed",
    );
    if (
      session.backendType === "codex" &&
      deliverablePendingCodexInputs.length > 0 &&
      !session.codexAdapter &&
      session.state.backend_state !== "broken" &&
      session.state.backend_state !== "recovery_suppressed" &&
      session.state.backend_state !== "recovering" &&
      launcherInfo?.archived !== true &&
      launcherInfo?.killedByIdleManager !== true
    ) {
      const oldestPending = deliverablePendingCodexInputs[0];
      const pendingAge = now - oldestPending.timestamp;
      if (pendingAge > deps.stuckPendingDeliveryMs) {
        console.warn(
          `[ws-bridge] Codex session ${sessionTag(session.id)} has stuck pending delivery ` +
            `(${Math.round(pendingAge / 1000)}s, ${deliverablePendingCodexInputs.length} input(s), ` +
            `backend_state=${session.state.backend_state})`,
        );
        deps.requestCodexAutoRecovery(session, "stuck_pending_delivery_watchdog");
      }
    }
    if (
      session.backendType === "codex" &&
      deliverablePendingCodexInputs.length > 0 &&
      session.codexAdapter &&
      !session.isGenerating &&
      session.state.backend_state !== "broken" &&
      session.state.backend_state !== "recovery_suppressed" &&
      session.state.backend_state !== "recovering" &&
      launcherInfo?.archived !== true &&
      launcherInfo?.killedByIdleManager !== true
    ) {
      const oldestPending = deliverablePendingCodexInputs[0];
      const pendingAge = now - oldestPending.timestamp;
      if (pendingAge > deps.stuckPendingDeliveryMs) {
        deps.pokeStaleCodexPendingDelivery?.(session, "stuck_pending_delivery_connected_watchdog");
      }
    }

    if (!session.isGenerating || !session.generationStartedAt) continue;
    if (now - session.generationStartedAt < deps.stuckThresholdMs) continue;

    if (session.toolStartTimes.size > 0) {
      let allToolsStale = true;
      for (const startedAt of session.toolStartTimes.values()) {
        if (now - startedAt < deps.autoRecoverMs) {
          allToolsStale = false;
          break;
        }
      }
      if (!allToolsStale) {
        if (session.stuckNotifiedAt) {
          session.stuckNotifiedAt = null;
          session.provisionalStuckRecovery = null;
          deps.broadcastMessage(session, { type: "session_unstuck" });
        }
        continue;
      }
    }

    const lastActivity = Math.max(session.lastCliMessageAt, session.lastToolProgressAt);
    const sinceLastActivity = lastActivity > 0 ? now - lastActivity : now - session.generationStartedAt;
    if (sinceLastActivity < deps.stuckThresholdMs) {
      if (session.stuckNotifiedAt) {
        session.stuckNotifiedAt = null;
        session.provisionalStuckRecovery = null;
        deps.broadcastMessage(session, { type: "session_unstuck" });
      }
      continue;
    }

    const elapsed = now - session.generationStartedAt;
    if (!session.stuckNotifiedAt) {
      session.stuckNotifiedAt = now;
      console.warn(
        `[ws-bridge] Session ${session.id} appears stuck (${Math.round(elapsed / 1000)}s generation, ${Math.round(sinceLastActivity / 1000)}s since last CLI activity)`,
      );
      deps.recordServerEvent?.(session, "stuck_detected", { elapsed, sinceLastActivity });
      deps.broadcastMessage(session, { type: "session_stuck" });

      if (launcherInfo?.isOrchestrator && deps.forceFlushPendingEvents) {
        const flushed = deps.forceFlushPendingEvents(session.id);
        if (flushed > 0) {
          console.warn(
            `[ws-bridge] Force-delivered ${flushed} pending herd event(s) to stuck orchestrator session ${session.id}`,
          );
        }
      }
    }

    const isOrchestrator = !!launcherInfo?.isOrchestrator;
    const cliConnected = deps.backendConnected(session);
    const recoverThreshold = isOrchestrator ? deps.autoRecoverOrchestratorMs : deps.autoRecoverMs;
    if (elapsed < recoverThreshold || (!cliConnected && elapsed < deps.autoRecoverMs)) continue;

    const recoverableCodexTurnId = deps.getRecoverableActiveCodexTurnId?.(session) ?? null;
    if (
      isOrchestrator &&
      session.backendType === "codex" &&
      cliConnected &&
      recoverableCodexTurnId &&
      deps.recoverStuckOrchestratorCodexTurn?.(session)
    ) {
      deps.recordServerEvent?.(session, "stuck_orchestrator_recovery_requested", {
        elapsed,
        sinceLastActivity,
        activeTurnId: recoverableCodexTurnId,
      });
      continue;
    }
    const canDeferTerminalInterrupt =
      !isOrchestrator && session.backendType === "codex" && cliConnected && recoverableCodexTurnId;
    if (canDeferTerminalInterrupt) {
      const provisional = session.provisionalStuckRecovery;
      if (provisional?.turnId === recoverableCodexTurnId && now < provisional.terminalAfter) {
        continue;
      }
      if (!provisional || provisional.turnId !== recoverableCodexTurnId) {
        session.provisionalStuckRecovery = {
          turnId: recoverableCodexTurnId,
          notifiedAt: now,
          terminalAfter: now + deps.autoRecoverMs,
        };
        deps.recordServerEvent?.(session, "stuck_recovery_pending", {
          elapsed,
          sinceLastActivity,
          cliConnected,
          activeTurnId: recoverableCodexTurnId,
        });
        deps.emitTakodeEvent(session.id, "turn_end", {
          reason: "stuck_auto_recovery",
          duration_ms: elapsed,
          interrupted: true,
          interrupt_source: "system",
          recovery_pending: true,
          provisional: true,
          ...(session.compactedDuringTurn ? { compacted: true } : {}),
          ...deps.buildTurnToolSummary(session),
          turn_source: deps.getCurrentTurnTriggerSource?.(session) ?? "unknown",
          ...(session.activeTurnRoute?.threadKey ? { threadKey: session.activeTurnRoute.threadKey } : {}),
          ...(session.activeTurnRoute?.questId ? { questId: session.activeTurnRoute.questId } : {}),
        });
        console.warn(
          `[ws-bridge] Reported provisional stuck recovery for session ${sessionTag(session.id)} ` +
            `(${Math.round(elapsed / 1000)}s stuck, active Codex turn ${recoverableCodexTurnId})`,
        );
        continue;
      }
    }

    console.warn(
      `[ws-bridge] Auto-recovering stuck session ${sessionTag(session.id)} ` +
        `(${Math.round(elapsed / 1000)}s stuck, CLI ${cliConnected ? "connected" : "disconnected"}` +
        `${isOrchestrator ? ", orchestrator" : ""}, force-clearing isGenerating)`,
    );
    deps.recordServerEvent?.(session, "stuck_auto_recovered", {
      elapsed,
      sinceLastActivity,
      cliConnected,
      isOrchestrator,
    });
    deps.markTurnInterrupted(session, "system");
    deps.setGenerating(session, false, "stuck_auto_recovery");
    session.toolStartTimes.clear();
    deps.broadcastMessage(session, { type: "status_change", status: "idle" });
    deps.broadcastMessage(session, { type: "session_unstuck" });
  }
}
