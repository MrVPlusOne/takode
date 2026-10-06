import { sessionTag } from "../session-tag.js";
import { hasQueuedCompactRequest } from "./adapter-browser-routing-commands.js";
import type {
  AdapterBrowserRoutingDeps,
  AdapterBrowserRoutingSessionLike,
  InterruptSource,
} from "./adapter-browser-routing-types.js";

/** Turn-end reason when an interrupt ends a turn whose input never reached Claude. */
export const INTERRUPT_WITHOUT_BACKEND_TURN = "interrupt_without_backend_turn";

/**
 * Interrupt a Claude SDK session's current turn.
 *
 * Claude only answers an interrupt with a result when it is running a turn.
 * If Takode marked the session running but Claude never received the input
 * (it is still queued, for example while the process starts), no result would
 * ever arrive, so the turn is ended here instead. Undelivered user input is
 * cancelled with the turn; its history entry stays, so the message remains
 * visible as sent. A restart-prep interrupt keeps that input queued, because
 * the session is resumed after the restart.
 */
export function interruptClaudeSdkTurn(
  session: AdapterBrowserRoutingSessionLike,
  source: InterruptSource,
  deps: AdapterBrowserRoutingDeps,
): void {
  deps.markTurnInterrupted(session, source);
  const adapter = session.claudeSdkAdapter;
  if (session.restartPrepInterruptOrigin !== "restart_prep") {
    const discarded = discardQueuedUserMessages(session) + (adapter?.discardPendingUserMessages?.() ?? 0);
    if (discarded > 0) {
      console.log(
        `[ws-bridge] Interrupt cancelled ${discarded} undelivered message(s) for session ${sessionTag(session.id)}`,
      );
    }
  }
  // Forward even without a Takode prompt in flight: Claude may be running a
  // turn it started itself. Never queue an interrupt for a process that is
  // not running yet; it would cancel whatever that process does next.
  if (adapter?.isConnected?.()) {
    adapter.sendBrowserMessage({ type: "interrupt", interruptSource: source });
  }
  if (session.isGenerating && !adapter?.hasTurnInFlight?.()) {
    if (session.forceCompactPending && !hasQueuedCompactRequest(session)) {
      session.forceCompactPending = false;
      session.state.is_compacting = false;
    }
    deps.setGenerating(session, false, INTERRUPT_WITHOUT_BACKEND_TURN);
    deps.broadcastStatusChange(session, "idle");
  }
  deps.persistSession(session);
}

function discardQueuedUserMessages(session: AdapterBrowserRoutingSessionLike): number {
  const kept = session.pendingMessages.filter((raw) => !isQueuedUserMessage(raw));
  const discarded = session.pendingMessages.length - kept.length;
  session.pendingMessages = kept;
  return discarded;
}

function isQueuedUserMessage(raw: string): boolean {
  try {
    const type = (JSON.parse(raw) as { type?: unknown } | null)?.type;
    // "user" is the raw CLI form queued by the retired WebSocket backend.
    return type === "user_message" || type === "user";
  } catch {
    return false;
  }
}
