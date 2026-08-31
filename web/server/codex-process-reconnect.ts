import type { PendingCodexInput } from "./codex-pending-input-types.js";
import type { BackendReconnectProgress, CodexOutageRecoveryFamily } from "./codex-outbound-turn-types.js";
import type { BrowserIncomingMessage, CodexOutboundTurn, SessionState } from "./session-types.js";
import { sessionTag } from "./session-tag.js";

/** Maximum Codex process launches in one inner automatic or manual reconnect cycle. */
export const CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS = 5;

/** Overall timeout retained for finite provider-result recovery families. */
export const CODEX_PROVIDER_RESULT_RECONNECT_TIMEOUT_MS = 6 * 60_000;

/** Persistent network-outage recovery never launches more frequently than this. */
export const CODEX_OUTAGE_RECOVERY_RETRY_INTERVAL_MS = 30_000;

/**
 * Finite provider recovery retains the earlier spread. Persistent stream
 * outages use CODEX_OUTAGE_RECOVERY_RETRY_INTERVAL_MS instead.
 */
const CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS = [30_000, 60_000, 90_000, 120_000] as const;

export function codexProviderResultReconnectRetryDelayMs(failedAttempt: number): number {
  const index = Math.max(0, Math.floor(failedAttempt) - 1);
  return (
    CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS[index] ?? CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS.at(-1)!
  );
}

export interface CodexOutageRecoverySessionLike {
  state: Pick<
    SessionState,
    "backend_error" | "backend_state" | "backend_reconnect" | "codex_provider_retry" | "codex_turn_recovery" | "pause"
  >;
  pendingCodexTurns?: CodexOutboundTurn[];
  pendingCodexInputs?: PendingCodexInput[];
}

export interface CodexOutageRecoveryLauncherLike {
  archived?: boolean;
  killedByIdleManager?: boolean;
}

export interface CodexOutageRecoveryDescriptor {
  ownerId: string;
  family: CodexOutageRecoveryFamily;
}

interface CodexRecoveryRuntimeState {
  codexInitRetryTimer?: ReturnType<typeof setTimeout> | null;
  codexInitRecoveryFailures?: number;
  codexAutoRecoveryReason?: string | null;
  codexRecoveryAttemptToken?: number;
}

export function isCodexPersistentOutageRecoveryReason(reason: string): boolean {
  if (reason.includes("provider_result:")) return reason.includes("model_backend_stream_error");
  return [
    "adapter_disconnect",
    "queued_user_message_adapter_missing",
    "manual_reconnect",
    "restored_pending_transport",
  ].some((fragment) => reason.includes(fragment));
}

export function getCodexOutageRecoveryDescriptor(
  session: CodexOutageRecoverySessionLike,
  reason: string,
): CodexOutageRecoveryDescriptor | null {
  if (!isCodexPersistentOutageRecoveryReason(reason)) return null;
  if (session.state.codex_turn_recovery) return null;

  const providerRetry = session.state.codex_provider_retry;
  if (providerRetry) {
    if (
      providerRetry.family === "model_backend_stream_error" &&
      isLiveCodexOutageOwner(session, providerRetry.ownerId)
    ) {
      return {
        ownerId: providerRetry.ownerId,
        family: "model_backend_stream_error",
      };
    }
    return null;
  }
  if (hasLiveFiniteProviderRecoveryTurn(session)) return null;

  const recorded = session.state.backend_reconnect;
  if (recorded?.outageOwnerId || recorded?.outageFamily) {
    if (recorded.outageOwnerId && recorded.outageFamily && isLiveCodexOutageOwner(session, recorded.outageOwnerId)) {
      return { ownerId: recorded.outageOwnerId, family: recorded.outageFamily };
    }
    // A recorded exact owner never transfers silently to later queued work.
    return null;
  }

  const ownerId = firstLiveCodexOutageOwnerId(session);
  if (!ownerId) return null;
  return {
    ownerId,
    family: reason.includes("model_backend_stream_error") ? "model_backend_stream_error" : "process_transport",
  };
}

export function canContinueCodexOutageRecovery(
  session: CodexOutageRecoverySessionLike,
  reason: string,
  launcher: CodexOutageRecoveryLauncherLike | null | undefined,
): boolean {
  if (!launcher || launcher.archived || launcher.killedByIdleManager) return false;
  if (session.state.pause?.pausedAt) return false;
  if (session.state.backend_state === "broken" || session.state.backend_state === "recovery_suppressed") return false;
  return getCodexOutageRecoveryDescriptor(session, reason) !== null;
}

export function resolveCodexAutoRecoveryReason(
  session: CodexOutageRecoverySessionLike,
  runtimeReason: string | null | undefined,
  options: { allowPendingFallback?: boolean } = {},
): string | null {
  const providerRetry = session.state.codex_provider_retry;
  if (providerRetry) {
    return isLiveCodexOutageOwner(session, providerRetry.ownerId)
      ? `provider_result:${providerRetry.family}:attempt_${providerRetry.attempt}`
      : null;
  }

  const finiteTurn = session.pendingCodexTurns?.find(
    (turn) => isLiveCodexOutageTurn(turn) && turn.providerRecoveryFamily === "copilot_auth_refresh_invalidated",
  );
  if (finiteTurn) {
    return `provider_result:copilot_auth_refresh_invalidated:attempt_${finiteTurn.providerRecoveryAttempts ?? 1}`;
  }

  if (runtimeReason) return runtimeReason;
  if (session.state.codex_turn_recovery) return null;

  const reconnect = session.state.backend_reconnect;
  if (reconnect?.outageOwnerId && reconnect.outageFamily && isLiveCodexOutageOwner(session, reconnect.outageOwnerId)) {
    return reconnect.outageFamily === "model_backend_stream_error"
      ? "provider_result:model_backend_stream_error:restored"
      : "restored_pending_transport";
  }

  return options.allowPendingFallback && firstLiveCodexOutageOwnerId(session) ? "restored_pending_transport" : null;
}

export function withCodexOutageRecoveryDescriptor(
  progress: BackendReconnectProgress,
  session: CodexOutageRecoverySessionLike,
  reason: string,
): BackendReconnectProgress {
  const descriptor = getCodexOutageRecoveryDescriptor(session, reason);
  if (!descriptor) return progress;
  return {
    ...progress,
    outageOwnerId: descriptor.ownerId,
    outageFamily: descriptor.family,
  };
}

export function beginCodexRecoveryAttempt(session: object): number {
  const runtime = session as CodexRecoveryRuntimeState;
  if (runtime.codexInitRetryTimer) clearTimeout(runtime.codexInitRetryTimer);
  runtime.codexInitRetryTimer = null;
  runtime.codexRecoveryAttemptToken = (runtime.codexRecoveryAttemptToken ?? 0) + 1;
  return runtime.codexRecoveryAttemptToken;
}

export function isCurrentCodexRecoveryAttempt(session: object, token: number): boolean {
  return (session as CodexRecoveryRuntimeState).codexRecoveryAttemptToken === token;
}

export function invalidateCodexRecoveryAttempt(session: object): void {
  beginCodexRecoveryAttempt(session);
}

export function clearCodexRecoveryRuntimeState(session: object): void {
  const runtime = session as CodexRecoveryRuntimeState;
  if (runtime.codexInitRetryTimer) clearTimeout(runtime.codexInitRetryTimer);
  runtime.codexInitRetryTimer = null;
  runtime.codexInitRecoveryFailures = 0;
  runtime.codexAutoRecoveryReason = null;
  invalidateCodexRecoveryAttempt(session);
}

export function clearCodexOutageRecoveryState(
  session: CodexOutageRecoverySessionLike,
  options: { onlyIfTrackedOwnerMissing?: boolean } = {},
): Record<string, unknown> | null {
  const trackedOwnerIds = [
    session.state.backend_reconnect?.outageOwnerId,
    session.state.codex_provider_retry?.ownerId,
  ].filter((ownerId): ownerId is string => !!ownerId);
  if (
    options.onlyIfTrackedOwnerMissing &&
    (trackedOwnerIds.length === 0 || trackedOwnerIds.some((ownerId) => isLiveCodexOutageOwner(session, ownerId)))
  ) {
    return null;
  }

  clearCodexRecoveryRuntimeState(session);
  const update: Record<string, unknown> = {};
  if (session.state.backend_reconnect) {
    session.state.backend_reconnect = null;
    update.backend_reconnect = null;
  }
  if (session.state.codex_provider_retry) {
    session.state.codex_provider_retry = null;
    update.codex_provider_retry = null;
  }
  return update;
}

export interface CodexOutageRecoveryStopDeps<Session extends CodexOutageRecoverySessionLike> {
  getLauncherSessionInfo?: (sessionId: string) => CodexOutageRecoveryLauncherLike | null | undefined;
  setBackendState?: (session: Session, state: string, error: string | null) => void;
  broadcastToBrowsers?: (session: Session, message: BrowserIncomingMessage) => void;
  broadcastSessionUpdate?: (session: Session, update: Record<string, unknown>) => void;
  persistSession: (session: Session) => void;
}

export function stopIneligibleCodexOutageRecovery<Session extends CodexOutageRecoverySessionLike & { id: string }>(
  session: Session,
  reason: string,
  deps: CodexOutageRecoveryStopDeps<Session>,
): boolean {
  if (!isCodexPersistentOutageRecoveryReason(reason)) return false;
  if (session.state.backend_state === "broken" || session.state.backend_state === "recovery_suppressed") return false;
  const hasPersistentState =
    session.state.codex_provider_retry?.family === "model_backend_stream_error" ||
    (!!session.state.backend_reconnect?.outageOwnerId && !!session.state.backend_reconnect.outageFamily);
  const launcher = deps.getLauncherSessionInfo?.(session.id);
  if (!hasPersistentState || !launcher || canContinueCodexOutageRecovery(session, reason, launcher)) return false;
  const recoveryUpdate = clearCodexOutageRecoveryState(session) ?? {};
  deps.broadcastToBrowsers?.(session, {
    type: "session_update",
    session: recoveryUpdate,
  });
  if (deps.setBackendState) {
    deps.setBackendState(session, "disconnected", null);
  } else {
    session.state.backend_state = "disconnected";
    (session.state as SessionState).backend_error = null;
    deps.broadcastSessionUpdate?.(session, {
      backend_state: "disconnected",
      backend_error: null,
      backend_reconnect: null,
    });
  }
  deps.persistSession(session);
  return true;
}

export interface CodexOutageRecoveryLifecycleDeps<Session extends CodexOutageRecoverySessionLike> {
  getLauncherSessionInfo: (sessionId: string) => CodexOutageRecoveryLauncherLike | null | undefined;
  requestCodexAutoRecovery: (session: Session, reason: string) => boolean;
  setBackendState: (session: Session, state: string, error: string | null) => void;
  broadcastToBrowsers: (session: Session, message: BrowserIncomingMessage) => void;
  persistSession: (session: Session) => void;
}

export function continueCodexOutageRecoveryAfterFailure<
  Session extends CodexOutageRecoverySessionLike & {
    id: string;
    codexAdapter?: unknown | null;
    consecutiveAdapterFailures?: number;
    lastAdapterFailureAt?: number | null;
  },
>(
  session: Session,
  reason: string,
  deps: CodexOutageRecoveryLifecycleDeps<Session>,
  options: { resetCycle?: boolean; delayMs?: number } = {},
): boolean {
  return scheduleCodexOutageRecoveryRetry(
    session,
    reason,
    {
      getLauncherSessionInfo: () => deps.getLauncherSessionInfo(session.id),
      requestRecovery: (retryReason) => deps.requestCodexAutoRecovery(session, retryReason),
      onWaiting: () => {
        deps.setBackendState(session, "recovering", null);
        deps.broadcastToBrowsers(session, { type: "backend_disconnected" });
      },
      onIneligible: () => {
        const recoveryUpdate = clearCodexOutageRecoveryState(session) ?? {};
        deps.broadcastToBrowsers(session, {
          type: "session_update",
          session: recoveryUpdate,
        });
        deps.setBackendState(session, "disconnected", null);
      },
      persist: () => deps.persistSession(session),
    },
    options,
  );
}

export function handleExhaustedCodexAdapterDisconnect<
  Session extends CodexOutageRecoverySessionLike & {
    id: string;
    codexAdapter?: unknown | null;
    consecutiveAdapterFailures?: number;
    lastAdapterFailureAt?: number | null;
  },
>(
  session: Session,
  wasGenerating: boolean,
  maxAttempts: number,
  deps: CodexOutageRecoveryLifecycleDeps<Session> & {
    emitTakodeEvent: (sessionId: string, type: string, data: Record<string, unknown>) => void;
  },
): boolean {
  if (
    continueCodexOutageRecoveryAfterFailure(session, "adapter_disconnect", deps, {
      resetCycle: true,
    })
  ) {
    console.log(
      `[ws-bridge] Codex adapter for session ${sessionTag(session.id)} exhausted an inner reconnect cycle; exact pending work will retry after the outage delay`,
    );
    return true;
  }
  console.error(
    `[ws-bridge] Codex adapter for session ${sessionTag(session.id)} exceeded ${maxAttempts} consecutive adapter-disconnect recovery attempts -- pausing adapter-disconnect auto-relaunch`,
  );
  deps.emitTakodeEvent(session.id, "session_disconnected", {
    wasGenerating,
    reason: "adapter_disconnect",
  });
  deps.broadcastToBrowsers(session, {
    type: "error",
    message: `Codex disconnected repeatedly after ${maxAttempts} automatic recovery attempts. Adapter-disconnect auto-relaunch is paused; use the relaunch button to retry. Orchestrator sessions may also be woken by queued herd events when safe.`,
  });
  return false;
}

export interface ScheduleCodexOutageRecoveryDeps {
  getLauncherSessionInfo: () => CodexOutageRecoveryLauncherLike | null | undefined;
  requestRecovery: (reason: string) => boolean;
  onWaiting: () => void;
  onIneligible: () => void;
  persist: () => void;
}

export function scheduleCodexOutageRecoveryRetry(
  session: CodexOutageRecoverySessionLike & {
    codexAdapter?: unknown | null;
    consecutiveAdapterFailures?: number;
    lastAdapterFailureAt?: number | null;
  },
  reason: string,
  deps: ScheduleCodexOutageRecoveryDeps,
  options: {
    resetCycle?: boolean;
    delayMs?: number;
    allowAttached?: boolean;
  } = {},
): boolean {
  if (!canContinueCodexOutageRecovery(session, reason, deps.getLauncherSessionInfo())) return false;
  invalidateCodexRecoveryAttempt(session);
  if (options.resetCycle) {
    session.consecutiveAdapterFailures = 0;
    setCodexInitRecoveryFailures(session, 0);
  }
  session.lastAdapterFailureAt = Date.now();
  setCodexRecoveryRuntimeReason(session, reason);
  deps.onWaiting();
  const timer = setTimeout(() => {
    setCodexRecoveryRetryTimer(session, null);
    if (session.codexAdapter && !options.allowAttached) return;
    if (!canContinueCodexOutageRecovery(session, reason, deps.getLauncherSessionInfo())) {
      clearCodexRecoveryRuntimeState(session);
      deps.onIneligible();
      deps.persist();
      return;
    }
    if (!deps.requestRecovery(reason)) {
      clearCodexRecoveryRuntimeState(session);
      deps.onIneligible();
      deps.persist();
    }
  }, options.delayMs ?? CODEX_OUTAGE_RECOVERY_RETRY_INTERVAL_MS);
  setCodexRecoveryRetryTimer(session, timer);
  deps.persist();
  return true;
}

export function setCodexRecoveryRuntimeReason(session: object, reason: string | null): void {
  (session as CodexRecoveryRuntimeState).codexAutoRecoveryReason = reason;
}

export function getCodexRecoveryRuntimeReason(session: object): string | null {
  return (session as CodexRecoveryRuntimeState).codexAutoRecoveryReason ?? null;
}

export function getCodexRecoveryRetryTimer(session: object): ReturnType<typeof setTimeout> | null {
  return (session as CodexRecoveryRuntimeState).codexInitRetryTimer ?? null;
}

export function setCodexRecoveryRetryTimer(session: object, timer: ReturnType<typeof setTimeout> | null): void {
  (session as CodexRecoveryRuntimeState).codexInitRetryTimer = timer;
}

export function getCodexInitRecoveryFailures(session: object): number {
  return (session as CodexRecoveryRuntimeState).codexInitRecoveryFailures ?? 0;
}

export function setCodexInitRecoveryFailures(session: object, failures: number): void {
  (session as CodexRecoveryRuntimeState).codexInitRecoveryFailures = failures;
}

function firstLiveCodexOutageOwnerId(session: CodexOutageRecoverySessionLike): string | null {
  const turn = session.pendingCodexTurns?.find(
    (candidate) =>
      isLiveCodexOutageTurn(candidate) &&
      (!candidate.providerRecoveryFamily || candidate.providerRecoveryFamily === "model_backend_stream_error"),
  );
  if (turn) return turn.userMessageId;
  const input = session.pendingCodexInputs?.find((candidate) => candidate.deliveryState !== "failed");
  return input?.id ?? null;
}

function hasLiveFiniteProviderRecoveryTurn(session: CodexOutageRecoverySessionLike): boolean {
  return (
    session.pendingCodexTurns?.some(
      (turn) => isLiveCodexOutageTurn(turn) && turn.providerRecoveryFamily === "copilot_auth_refresh_invalidated",
    ) === true
  );
}

function isLiveCodexOutageOwner(session: CodexOutageRecoverySessionLike, ownerId: string): boolean {
  return (
    session.pendingCodexTurns?.some(
      (turn) =>
        isLiveCodexOutageTurn(turn) &&
        (turn.userMessageId === ownerId || (turn.pendingInputIds ?? []).includes(ownerId)),
    ) === true ||
    session.pendingCodexInputs?.some((input) => input.id === ownerId && input.deliveryState !== "failed") === true
  );
}

function isLiveCodexOutageTurn(turn: CodexOutboundTurn): boolean {
  return turn.status === "queued" || turn.status === "dispatched" || turn.status === "backend_acknowledged";
}
