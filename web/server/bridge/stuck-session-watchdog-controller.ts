import type { BrowserIncomingMessage, TakodeTurnEndEventData } from "../session-types.js";
import { isSystemSourceTag } from "./adapter-browser-routing-source-tags.js";
import { runStuckSessionWatchdogSweep, type InterruptSource } from "./generation-lifecycle.js";
import {
  backendConnected as backendConnectedController,
  getCurrentTurnTriggerSource as getCurrentTurnTriggerSourceController,
} from "./session-registry-controller.js";
import type { Session } from "./ws-bridge-session.js";

const STUCK_GENERATION_THRESHOLD_MS = 120_000; // 2 minutes
const STUCK_PENDING_DELIVERY_MS = 60_000;

interface LauncherSessionInfo {
  archived?: boolean;
  killedByIdleManager?: boolean;
  isOrchestrator?: boolean;
}

export interface StuckSessionWatchdogBridgeDeps {
  sessions: Iterable<Session>;
  now: number;
  launcher?: { getSession: (sessionId: string) => LauncherSessionInfo | undefined } | null;
  recorder?: {
    recordServerEvent: (
      sessionId: string,
      reason: string,
      payload: Record<string, unknown>,
      backendType: Session["backendType"],
      cwd?: string,
    ) => void;
  } | null;
  herdEventDispatcher?: { forceFlushPendingEvents?: (sessionId: string) => number } | null;
  requestCodexAutoRecovery: (session: Session, reason: string) => boolean;
  broadcastToBrowsers: (session: Session, message: BrowserIncomingMessage) => void;
  markTurnInterrupted: (session: Session, source: InterruptSource) => void;
  setGenerating: (session: Session, generating: boolean, reason: string) => void;
  emitTakodeTurnEnd: (sessionId: string, data: TakodeTurnEndEventData) => void;
  buildTurnToolSummary: (
    session: Session,
  ) => Pick<TakodeTurnEndEventData, "tools" | "resultPreview" | "msgRange" | "questChange" | "userMsgs">;
  pokeStaleCodexPendingDelivery?: (session: Session, reason: string) => boolean;
}

export function runWsBridgeStuckSessionWatchdogSweep(deps: StuckSessionWatchdogBridgeDeps): void {
  runStuckSessionWatchdogSweep(deps.sessions, deps.now, {
    stuckPendingDeliveryMs: STUCK_PENDING_DELIVERY_MS,
    stuckThresholdMs: STUCK_GENERATION_THRESHOLD_MS,
    autoRecoverMs: 300_000,
    autoRecoverOrchestratorMs: STUCK_GENERATION_THRESHOLD_MS,
    requestCodexAutoRecovery: deps.requestCodexAutoRecovery,
    broadcastMessage: (session, message) => deps.broadcastToBrowsers(session, message as BrowserIncomingMessage),
    recordServerEvent: (session, reason, payload) =>
      deps.recorder?.recordServerEvent(session.id, reason, payload, session.backendType, session.state.cwd),
    getLauncherSessionInfo: (sessionId) => deps.launcher?.getSession(sessionId),
    forceFlushPendingEvents: (sessionId) => deps.herdEventDispatcher?.forceFlushPendingEvents?.(sessionId) ?? 0,
    backendConnected: (session) => backendConnectedController(session),
    markTurnInterrupted: deps.markTurnInterrupted,
    setGenerating: deps.setGenerating,
    emitTakodeEvent: (sessionId, _type, data) => deps.emitTakodeTurnEnd(sessionId, data),
    buildTurnToolSummary: deps.buildTurnToolSummary,
    getCurrentTurnTriggerSource: (session) =>
      getCurrentTurnTriggerSourceController(session, {
        isSystemSourceTag,
      }),
    getRecoverableActiveCodexTurnId: getRecoverableActiveCodexTurnId,
    pokeStaleCodexPendingDelivery: deps.pokeStaleCodexPendingDelivery,
  });
}

function getRecoverableActiveCodexTurnId(session: Session): string | null {
  if (session.backendType !== "codex") return null;
  if (session.codexAdapter?.isConnected?.() !== true) return null;
  return session.codexAdapter.getCurrentTurnId();
}
