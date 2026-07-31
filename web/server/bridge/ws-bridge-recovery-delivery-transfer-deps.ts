import { clampFrozenCount } from "./browser-transport-controller.js";
import { queueCodexPendingStartBatch } from "./codex-recovery-orchestrator.js";
import type { RecoveryDeliveryTransferDeps } from "./recovery-delivery-transfer.js";
import { buildPersistedSessionPayload } from "./session-registry-controller.js";
import type { Session } from "./ws-bridge-session.js";

export function getRecoveryDeliveryTransferDepsForBridge(host: any): RecoveryDeliveryTransferDeps {
  return {
    broadcastToBrowsers: (session, message) => host.broadcastToBrowsers(session as Session, message),
    persistSession: (session) => host.persistSession(session as Session),
    persistSessionImmediately: async (session) => {
      if (!host.store) return;
      clampFrozenCount(session as Session);
      await host.store.saveImmediate(buildPersistedSessionPayload(session as Session));
    },
    getBrowserTransportDeps: () => host.getBrowserTransportDeps(),
    releasePendingTransfer: (session, transferId) => {
      const target = session as Session;
      queueCodexPendingStartBatch(
        target,
        `recovery_delivery_transfer_${transferId}`,
        host.getCodexRecoveryOrchestratorDeps(),
      );
      if (
        !target.codexAdapter &&
        target.state.backend_state !== "broken" &&
        target.state.backend_state !== "recovery_suppressed"
      ) {
        host.onCLIRelaunchNeeded?.(target.id);
      }
    },
  };
}
