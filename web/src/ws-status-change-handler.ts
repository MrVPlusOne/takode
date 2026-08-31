import { useStore } from "./store.js";
import type { BrowserIncomingMessage, CodexAutoPauseRecoveryProgress } from "./types.js";

type StatusChangeMessage = Extract<BrowserIncomingMessage, { type: "status_change" }>;
type StateSnapshotMessage = Extract<BrowserIncomingMessage, { type: "state_snapshot" }>;

function resolveAutoPauseRecoveryProgress(
  data: StatusChangeMessage,
  previousStatus: "idle" | "running" | "compacting" | "reverting" | null,
): CodexAutoPauseRecoveryProgress | null | undefined {
  if (data.codexAutoPauseRecoveryProgress !== undefined) return data.codexAutoPauseRecoveryProgress;
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
  }

  const progress = resolveAutoPauseRecoveryProgress(data, previousStatus);
  if (progress !== undefined) {
    store.updateSession(sessionId, {
      codex_result_error_auto_pause_recovery_progress: progress,
    });
  }
  store.setSessionStuck(sessionId, false);
}

export function applyAutoPauseRecoverySnapshot(sessionId: string, data: StateSnapshotMessage): void {
  useStore.getState().updateSession(sessionId, {
    codex_result_error_auto_pause_recovery_progress: data.codexAutoPauseRecoveryProgress ?? null,
  });
}
