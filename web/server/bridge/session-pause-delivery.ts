import type { BrowserIncomingMessage, SessionPauseState } from "../session-types.js";
import { pauseSessionState, unpauseSessionState } from "../session-pause.js";
import { handleBrowserIngressMessage, type BrowserTransportDeps } from "./browser-transport-controller.js";
import {
  beginRecoveryDeliveryTransferHandoff,
  deliverRecoveryDeliveryTransfer,
  type RecoveryDeliveryTransferDeps,
} from "./recovery-delivery-transfer.js";
import { backendAttached } from "./session-registry-controller.js";
import { notifyCodexWorkerV2RolloutActivity } from "../codex-worker-v2-rollout-hooks.js";
import type { Session } from "./ws-bridge-session.js";

interface SessionPauseDeliveryDeps extends RecoveryDeliveryTransferDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession: (session: Session) => void;
  getBrowserTransportDeps: () => BrowserTransportDeps;
  onCLIRelaunchNeeded?: (sessionId: string) => void;
}

export function pauseSessionForDelivery(
  session: Session,
  options: { pausedBy?: string; reason?: string } | undefined,
  deps: Pick<SessionPauseDeliveryDeps, "broadcastToBrowsers" | "persistSession">,
): SessionPauseState {
  const pause = pauseSessionState(session, options);
  deps.broadcastToBrowsers(session, { type: "session_update", session: { pause } });
  deps.persistSession(session);
  return pause;
}

export async function unpauseSessionForDelivery(
  session: Session,
  deps: SessionPauseDeliveryDeps,
): Promise<{ queued: number }> {
  const queued = [...(session.state.pause?.queuedMessages ?? [])];
  const recoveryItems = queued.filter((item) => item.message.autoPauseRecoveries?.length);
  const ordinaryItemIds = new Set(
    queued.filter((item) => !item.message.autoPauseRecoveries?.length).map((item) => item.id),
  );
  let transfers = new Map<string, string>();
  if (recoveryItems.length > 0) {
    try {
      transfers = await beginRecoveryDeliveryTransferHandoff(
        session,
        recoveryItems.map((item) => ({
          sourceOwnerKind: "manual_pause" as const,
          sourceOwnerId: item.id,
          message: item.message,
        })),
        {
          removeAdditionalSourceOwners: () => {
            const pause = session.state.pause;
            if (!pause || ordinaryItemIds.size === 0) return;
            pause.queuedMessages = pause.queuedMessages.filter((item) => !ordinaryItemIds.has(item.id));
            if (pause.queuedMessages.length === 0) session.state.pause = null;
          },
          onSourceOwnersRemoved: () => {
            deps.broadcastToBrowsers(session, {
              type: "session_update",
              session: { pause: session.state.pause ?? null },
            });
          },
        },
        deps,
      );
    } catch (err) {
      console.error("[session-pause] Failed to persist recovery delivery transfer:", err);
      deps.broadcastToBrowsers(session, {
        type: "error",
        message: "Paused inputs remain held because their recovery transfer could not be persisted.",
      });
      deps.persistSession(session);
      return { queued: queued.length };
    }
  } else {
    unpauseSessionState(session);
    deps.broadcastToBrowsers(session, { type: "session_update", session: { pause: null } });
    deps.persistSession(session);
  }
  for (const item of queued) {
    const transferId = transfers.get(item.id);
    if (transferId) await deliverRecoveryDeliveryTransfer(session, transferId, deps);
    else await handleBrowserIngressMessage(session, item.message, undefined, deps.getBrowserTransportDeps());
  }
  if (queued.length === 0 && !backendAttached(session)) {
    deps.onCLIRelaunchNeeded?.(session.id);
  }
  notifyCodexWorkerV2RolloutActivity(session.id, "session_unpaused");
  return { queued: queued.length };
}
