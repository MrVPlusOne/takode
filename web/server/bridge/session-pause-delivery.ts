import type { BrowserIncomingMessage, SessionPauseState } from "../session-types.js";
import { pauseSessionState, unpauseSessionState } from "../session-pause.js";
import { handleBrowserIngressMessage, type BrowserTransportDeps } from "./browser-transport-controller.js";
import { backendAttached } from "./session-registry-controller.js";
import type { Session } from "./ws-bridge-session.js";

interface SessionPauseDeliveryDeps {
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
  const queued = unpauseSessionState(session);
  deps.broadcastToBrowsers(session, { type: "session_update", session: { pause: null } });
  deps.persistSession(session);
  for (const item of queued) {
    await handleBrowserIngressMessage(session, item.message, undefined, deps.getBrowserTransportDeps());
  }
  if (queued.length === 0 && !backendAttached(session)) {
    deps.onCLIRelaunchNeeded?.(session.id);
  }
  return { queued: queued.length };
}
