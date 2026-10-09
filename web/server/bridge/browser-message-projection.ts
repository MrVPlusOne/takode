import type {
  BrowserIncomingMessage,
  BufferedBrowserEvent,
  ReplayableBrowserIncomingMessage,
} from "../session-types.js";

type SessionRecoveryProjection = {
  codex_turn_recovery?: { status?: unknown } | null;
};

/**
 * Shape a server message for browsers without changing server state:
 * - terminal interrupted-work recovery stays server/audit authority, so its
 *   retired attention surface is not projected back into current-build browsers;
 * - thinking-block signatures are omitted. They are opaque, incompressible
 *   blobs the model API needs and the browser never uses, and on long Claude
 *   sessions they are most of a history window's bytes on the wire.
 */
export function projectBrowserMessage(message: BrowserIncomingMessage): BrowserIncomingMessage {
  if (message.type === "assistant") return projectBrowserHistoryMessage(message);
  if (message.type === "history_window_sync") {
    const messages = projectBrowserHistoryMessages(message.messages);
    return messages === message.messages ? message : { ...message, messages };
  }
  if (message.type === "thread_window_sync") {
    let changed = false;
    const entries = message.entries.map((entry) => {
      const projected = projectBrowserHistoryMessage(entry.message);
      if (projected === entry.message) return entry;
      changed = true;
      return { ...entry, message: projected };
    });
    return changed ? { ...message, entries } : message;
  }
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

/** Project history messages for a browser; returns the input array when nothing changes. */
export function projectBrowserHistoryMessages(messages: BrowserIncomingMessage[]): BrowserIncomingMessage[] {
  let projected: BrowserIncomingMessage[] | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = projectBrowserHistoryMessage(messages[index]);
    if (message === messages[index] && !projected) continue;
    projected ??= messages.slice(0, index);
    projected.push(message);
  }
  return projected ?? messages;
}

function projectBrowserHistoryMessage(message: BrowserIncomingMessage): BrowserIncomingMessage {
  if (message.type !== "assistant") return message;
  const content: unknown = message.message?.content;
  if (!Array.isArray(content) || !content.some(isSignedThinkingBlock)) return message;
  return {
    ...message,
    message: {
      ...message.message,
      content: content.map((block) => {
        if (!isSignedThinkingBlock(block)) return block;
        const { signature: _signature, ...rest } = block;
        return rest;
      }),
    },
  };
}

function isSignedThinkingBlock(block: unknown): block is { type: "thinking"; signature: unknown } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "thinking" &&
    "signature" in block
  );
}

function projectSessionRecoveryState<T extends SessionRecoveryProjection>(session: T): T {
  if (session.codex_turn_recovery?.status !== "action_required") return session;
  return { ...session, codex_turn_recovery: null };
}
