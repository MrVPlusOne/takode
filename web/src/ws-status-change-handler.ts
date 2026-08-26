import { useStore } from "./store.js";
import type { BrowserIncomingMessage, CodexAutoPauseRecoveryProgress, SessionState } from "./types.js";

type StatusChangeMessage = Extract<BrowserIncomingMessage, { type: "status_change" }>;
type StateSnapshotMessage = Extract<BrowserIncomingMessage, { type: "state_snapshot" }>;

function resolveAutoPauseRecoveryProgress(
  data: StatusChangeMessage,
  current: CodexAutoPauseRecoveryProgress | null,
  previousStatus: "idle" | "running" | "compacting" | "reverting" | null,
): CodexAutoPauseRecoveryProgress | null | undefined {
  if (data.codexAutoPauseRecoveryProgress !== undefined) return data.codexAutoPauseRecoveryProgress;
  if (data.codexAutoPauseRecoveryTesting === true) {
    return data.status === "running" ? (current ?? "testing") : "testing";
  }
  if (data.codexAutoPauseRecoveryTesting === false) return null;
  if (data.status === "idle") return null;
  if (data.status === null && previousStatus !== "compacting" && previousStatus !== "reverting") return null;
  return undefined;
}

export function handleStatusChangeMessage(sessionId: string, data: StatusChangeMessage): void {
  const store = useStore.getState();
  const previousStatus = store.sessionStatus.get(sessionId) ?? null;
  store.setSessionStatus(sessionId, data.status === "compacting" ? "compacting" : data.status);
  if ("activeTurnRoute" in data || data.status !== "running") {
    store.setActiveTurnRoute(sessionId, data.status === "running" ? data.activeTurnRoute : null);
  }
  if (data.codexReasoningPreviews !== undefined) {
    store.setCodexReasoningPreviews(sessionId, data.codexReasoningPreviews);
  } else if (data.activeCodexReasoningPreview) {
    // A legacy null active-turn field is a lifecycle boundary, not an
    // authoritative clear under the retained per-thread contract.
    store.setCodexReasoningPreviews(sessionId, [data.activeCodexReasoningPreview]);
  }

  const currentProgress = store.sessions.get(sessionId)?.codex_result_error_auto_pause_recovery_progress ?? null;
  const progress = resolveAutoPauseRecoveryProgress(data, currentProgress, previousStatus);
  if (progress !== undefined) {
    store.updateSession(sessionId, {
      codex_result_error_auto_pause_recovery_testing: progress !== null,
      codex_result_error_auto_pause_recovery_progress: progress,
    });
  }
  store.setSessionStuck(sessionId, false);
}

export function applyAutoPauseRecoverySnapshot(sessionId: string, data: StateSnapshotMessage): void {
  const progress =
    data.codexAutoPauseRecoveryProgress !== undefined
      ? data.codexAutoPauseRecoveryProgress
      : data.codexAutoPauseRecoveryTesting
        ? "testing"
        : null;
  useStore.getState().updateSession(sessionId, {
    codex_result_error_auto_pause_recovery_testing: progress !== null,
    codex_result_error_auto_pause_recovery_progress: progress,
  });
}

export function normalizeAutoPauseRecoverySessionUpdate(update: Partial<SessionState>): Partial<SessionState> {
  const hasProgress = Object.hasOwn(update, "codex_result_error_auto_pause_recovery_progress");
  const hasTesting = Object.hasOwn(update, "codex_result_error_auto_pause_recovery_testing");
  if (!hasProgress && !hasTesting) return update;
  const progress = hasProgress
    ? (update.codex_result_error_auto_pause_recovery_progress ?? null)
    : update.codex_result_error_auto_pause_recovery_testing
      ? "testing"
      : null;
  return {
    ...update,
    codex_result_error_auto_pause_recovery_testing: progress !== null,
    codex_result_error_auto_pause_recovery_progress: progress,
  };
}
