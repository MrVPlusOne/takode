import type {
  BrowserIncomingMessage,
  BufferedBrowserEvent,
  ReplayableBrowserIncomingMessage,
} from "../session-types.js";

type SessionRecoveryProjection = {
  codex_turn_recovery?: { status?: unknown } | null;
};

/**
 * Keep terminal interrupted-work recovery as server/audit authority without
 * projecting its retired attention surface back into current-build browsers.
 */
export function projectBrowserMessage(message: BrowserIncomingMessage): BrowserIncomingMessage {
  if (message.type === "session_init") {
    const session = projectSessionRecoveryState(message.session);
    return session === message.session ? message : { ...message, session };
  }
  if (message.type === "session_update") {
    const session = projectSessionRecoveryState(message.session);
    return session === message.session ? message : { ...message, session };
  }
  if (message.type === "state_snapshot" && message.codexTurnRecovery?.status === "action_required") {
    return { ...message, codexTurnRecovery: null };
  }
  if (message.type === "event_replay") {
    let changed = false;
    const events = message.events.map((event) => {
      const projected = projectBrowserMessage(event.message);
      if (projected === event.message) return event;
      changed = true;
      return { ...event, message: projected as ReplayableBrowserIncomingMessage } satisfies BufferedBrowserEvent;
    });
    return changed ? { ...message, events } : message;
  }
  return message;
}

function projectSessionRecoveryState<T extends SessionRecoveryProjection>(session: T): T {
  if (session.codex_turn_recovery?.status !== "action_required") return session;
  return { ...session, codex_turn_recovery: null };
}
