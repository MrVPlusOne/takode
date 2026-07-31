import { compactPendingCodexInputsForBrowser } from "../codex-pending-input-safety.js";
import type { CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import { pruneStalePendingCodexHerdInputs as pruneStalePendingCodexHerdInputsController } from "./board-watchdog-controller.js";
import { rebuildQueuedCodexPendingStartBatch as rebuildQueuedCodexPendingStartBatchController } from "./codex-recovery-orchestrator.js";
import { handleCodexResultErrorAutoPause as handleCodexResultErrorAutoPauseDelivery } from "./codex-result-error-auto-pause-delivery.js";
import type { Session } from "./ws-bridge-session.js";
import { getRecoveryDeliveryTransferDepsForBridge } from "./ws-bridge-recovery-delivery-transfer-deps.js";

export function handleCodexResultErrorAutoPauseForBridge(
  host: any,
  session: Session,
  msg: CLIResultMessage,
  completedTurn: CodexOutboundTurn | null,
  interrupted = false,
): Promise<void> | void {
  return handleCodexResultErrorAutoPauseDelivery(
    session,
    msg,
    completedTurn,
    {
      ...getRecoveryDeliveryTransferDepsForBridge(host),
      broadcastPendingCodexInputs: (targetSession) =>
        host.broadcastToBrowsers(targetSession, {
          type: "codex_pending_inputs",
          inputs: compactPendingCodexInputsForBrowser(targetSession.pendingCodexInputs),
        }),
    },
    interrupted,
  );
}

export function pruneStalePendingCodexHerdInputsForBridge(host: any, session: Session, reason: string): boolean {
  return pruneStalePendingCodexHerdInputsController(session, reason, host.getBoardWatchdogDeps(), {
    broadcastToBrowsers: (targetSession, message) => host.broadcastToBrowsers(targetSession as Session, message),
    broadcastPendingCodexInputs: (targetSession) =>
      host.broadcastToBrowsers(targetSession as Session, {
        type: "codex_pending_inputs",
        inputs: compactPendingCodexInputsForBrowser((targetSession as Session).pendingCodexInputs),
      }),
    rebuildQueuedCodexPendingStartBatch: (targetSession) =>
      rebuildQueuedCodexPendingStartBatchController(targetSession as Session, host.getCodexRecoveryOrchestratorDeps()),
    persistSession: (targetSession) => host.persistSession(targetSession as Session),
  });
}
