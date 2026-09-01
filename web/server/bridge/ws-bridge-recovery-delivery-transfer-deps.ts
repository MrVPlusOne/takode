import { clampFrozenCount } from "./browser-transport-controller.js";
import { queueCodexPendingStartBatch } from "./codex-recovery-orchestrator.js";
import type { RecoveryDeliveryTransferDeps } from "./recovery-delivery-transfer.js";
import { buildPersistedSessionPayload } from "./session-registry-controller.js";
import type { Session } from "./ws-bridge-session.js";

export function getRecoveryDeliveryTransferDepsForBridge(host: any): RecoveryDeliveryTransferDeps {
  const isCurrentSession = (session: unknown) => {
    const target = session as Session;
    return host.sessions.get(target.id) === target;
  };
  return {
    isCurrentSession,
    broadcastToBrowsers: (session, message) => {
      if (isCurrentSession(session)) host.broadcastToBrowsers(session as Session, message);
    },
    persistSession: (session) => {
      if (isCurrentSession(session)) host.persistSession(session as Session);
    },
    persistSessionImmediately: async (session) => {
      if (!isCurrentSession(session)) throw new Error("Session is no longer active.");
      if (!host.store) return;
      const target = session as Session;
      clampFrozenCount(target);
      await host.store.saveImmediate(buildPersistedSessionPayload(target));
      if (!isCurrentSession(target)) {
        host.store.remove(target.id);
        throw new Error("Session was removed while recovery delivery state was being saved.");
      }
    },
    getBrowserTransportDeps: () => host.getBrowserTransportDeps(),
    releasePendingTransfer: (session, transferId) => {
      const target = session as Session;
      if (!isCurrentSession(target)) return;
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
