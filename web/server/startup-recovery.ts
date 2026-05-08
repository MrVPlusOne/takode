import type { TimerSweepResult } from "./timer-manager.js";

export type StartupRecoveryReason =
  | "restart_continuation"
  | "pending_messages"
  | "pending_codex_inputs"
  | "pending_codex_turns"
  | "pending_codex_recovery"
  | "pending_herd_delivery"
  | "due_timer";

export interface StartupRecoveryLauncherSession {
  sessionId: string;
  archived?: boolean;
  killedByIdleManager?: boolean;
  state?: string;
}

export interface StartupRecoverySession {
  backendType?: string;
  pendingMessages?: string[];
  pendingCodexInputs?: Array<{
    id?: string;
    agentSource?: { sessionId?: string; sessionLabel?: string };
  }>;
  pendingCodexTurns?: Array<{
    status?: string;
    adapterMsg?: {
      type?: string;
      agentSource?: { sessionId?: string; sessionLabel?: string };
    };
    pendingInputIds?: string[];
    userMessageId?: string;
  }>;
  pendingCodexRollback?: unknown;
  pendingPermissions?: { size?: number };
}

export interface StartupRecoveryTimerManager {
  getDueTimerSessionIds: (now?: number) => string[];
  sweepDueTimersNow: (now?: number) => Promise<TimerSweepResult>;
}

export interface StartupRecoveryDeps {
  listLauncherSessions: () => StartupRecoveryLauncherSession[];
  getSession: (sessionId: string) => StartupRecoverySession | undefined;
  isBackendConnected: (sessionId: string) => boolean;
  isSessionPaused?: (sessionId: string) => boolean;
  requestCliRelaunch?: (sessionId: string) => void;
  timerManager?: StartupRecoveryTimerManager;
  restartContinuationSessionIds?: string[];
  alreadyRequestedRelaunchSessionIds?: Iterable<string>;
  now?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface StartupRecoverySessionResult {
  sessionId: string;
  reasons: StartupRecoveryReason[];
  requestedRelaunch: boolean;
  clearedIdleKilled: boolean;
  skippedReason?: "already_connected" | "no_relaunch_callback" | "relaunch_already_requested" | "session_paused";
}

export interface StartupRecoveryResult {
  recovered: StartupRecoverySessionResult[];
  timerSweep: TimerSweepResult | null;
}

export async function runStartupRecovery(deps: StartupRecoveryDeps): Promise<StartupRecoveryResult> {
  const now = deps.now ?? Date.now();
  const dueTimerSessionIds = new Set(deps.timerManager?.getDueTimerSessionIds(now) ?? []);
  const timerSweep = deps.timerManager ? await deps.timerManager.sweepDueTimersNow(now) : null;
  const restartContinuationSessionIds = new Set(deps.restartContinuationSessionIds ?? []);
  const alreadyRequestedRelaunchSessionIds = new Set(deps.alreadyRequestedRelaunchSessionIds ?? []);

  const recovered: StartupRecoverySessionResult[] = [];
  for (const launcherSession of deps.listLauncherSessions()) {
    if (launcherSession.archived) continue;

    const session = deps.getSession(launcherSession.sessionId);
    if (!session) continue;

    const reasons = collectStartupRecoveryReasons(session, {
      hasDueTimer: dueTimerSessionIds.has(launcherSession.sessionId),
      hasRestartContinuation: restartContinuationSessionIds.has(launcherSession.sessionId),
    });
    if (reasons.length === 0) continue;

    const result: StartupRecoverySessionResult = {
      sessionId: launcherSession.sessionId,
      reasons,
      requestedRelaunch: false,
      clearedIdleKilled: false,
    };

    if (deps.isBackendConnected(launcherSession.sessionId)) {
      result.skippedReason = "already_connected";
      recovered.push(result);
      continue;
    }

    if (deps.isSessionPaused?.(launcherSession.sessionId)) {
      result.skippedReason = "session_paused";
      recovered.push(result);
      continue;
    }

    if (alreadyRequestedRelaunchSessionIds.has(launcherSession.sessionId)) {
      result.skippedReason = "relaunch_already_requested";
      recovered.push(result);
      continue;
    }

    if (!deps.requestCliRelaunch) {
      result.skippedReason = "no_relaunch_callback";
      recovered.push(result);
      continue;
    }

    if (launcherSession.killedByIdleManager) {
      launcherSession.killedByIdleManager = false;
      result.clearedIdleKilled = true;
    }

    deps.requestCliRelaunch(launcherSession.sessionId);
    result.requestedRelaunch = true;
    recovered.push(result);
  }

  if (recovered.length > 0 || (timerSweep && (timerSweep.fired.length > 0 || timerSweep.skipped.length > 0))) {
    deps.log?.("Startup recovery scanned restored server-owned work", {
      recovered: recovered.length,
      timerFired: timerSweep?.fired.length ?? 0,
      timerSkipped: timerSweep?.skipped.length ?? 0,
    });
  }

  return { recovered, timerSweep };
}

export function collectStartupRecoveryReasons(
  session: StartupRecoverySession,
  options: { hasDueTimer?: boolean; hasRestartContinuation?: boolean } = {},
): StartupRecoveryReason[] {
  const reasons = new Set<StartupRecoveryReason>();

  if (options.hasRestartContinuation) reasons.add("restart_continuation");
  if (options.hasDueTimer) reasons.add("due_timer");

  const pendingMessages = session.pendingMessages ?? [];
  if (pendingMessages.length > 0) reasons.add("pending_messages");

  const pendingCodexInputs = session.pendingCodexInputs ?? [];
  if (pendingCodexInputs.length > 0) reasons.add("pending_codex_inputs");

  const pendingCodexTurns = (session.pendingCodexTurns ?? []).filter((turn) => turn.status !== "completed");
  if (pendingCodexTurns.length > 0) reasons.add("pending_codex_turns");

  if (session.pendingCodexRollback) reasons.add("pending_codex_recovery");

  if (hasDurablePendingHerdDelivery(session)) reasons.add("pending_herd_delivery");

  return [...reasons];
}

function hasDurablePendingHerdDelivery(session: StartupRecoverySession): boolean {
  const pendingInputIdsByHerdSource = new Set(
    (session.pendingCodexInputs ?? [])
      .filter((input) => input.agentSource?.sessionId === "herd-events" && input.id)
      .map((input) => input.id as string),
  );

  if (pendingInputIdsByHerdSource.size > 0) return true;

  for (const raw of session.pendingMessages ?? []) {
    const message = parseQueuedMessage(raw);
    if (message?.type === "user_message" && message.agentSource?.sessionId === "herd-events") return true;
  }

  for (const turn of session.pendingCodexTurns ?? []) {
    if (turn.status === "completed") continue;
    if (turn.adapterMsg?.agentSource?.sessionId === "herd-events") return true;

    const inputIds = turn.pendingInputIds ?? (turn.userMessageId ? [turn.userMessageId] : []);
    if (inputIds.some((id) => pendingInputIdsByHerdSource.has(id))) return true;
  }

  return false;
}

function parseQueuedMessage(raw: string): { type?: string; agentSource?: { sessionId?: string } } | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; agentSource?: { sessionId?: string } };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
