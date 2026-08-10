import { CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS } from "../codex-process-reconnect.js";
import { beginCodexManualReconnectCycle } from "../bridge/session-registry-controller.js";
import type { RouteContext } from "./context.js";

export async function relaunchSessionProcess(
  launcher: RouteContext["launcher"],
  wsBridge: RouteContext["wsBridge"],
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = wsBridge.getSession(sessionId);
  const manualCodexCycleStarted = session
    ? beginCodexManualReconnectCycle(session as any, {
        persistSession: () => wsBridge.persistSessionById(sessionId),
        broadcastSessionUpdate: (_target, update) =>
          wsBridge.broadcastToSession(sessionId, { type: "session_update", session: update } as any),
        maxAdapterRelaunchFailures: CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS,
      })
    : false;
  if (!manualCodexCycleStarted) wsBridge.clearCodexAutomaticRecoverySuppression(sessionId);

  const result = await launcher.relaunch(sessionId);
  if (!result.ok && manualCodexCycleStarted) wsBridge.markCodexAutoRecoveryFailed(sessionId);
  return result;
}
