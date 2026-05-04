import type {
  BrowserIncomingMessage,
  BufferedBrowserEvent,
  ReplayableBrowserIncomingMessage,
} from "../session-types.js";

const NON_REPLAYABLE_BROWSER_EVENT_TYPES = new Set<string>([
  "session_init",
  "message_history",
  "event_replay",
  "leader_group_idle",
  "quest_list_updated",
  "session_quest_claimed",
  "session_name_update",
  "tree_groups_update",
  "leader_projection_snapshot",
]);

export function shouldBufferForReplay(msg: BrowserIncomingMessage): msg is ReplayableBrowserIncomingMessage {
  return shouldBufferForReplayWithContext(msg);
}

export function shouldBufferForReplayWithContext(
  msg: BrowserIncomingMessage,
  context?: { isLeaderSession?: boolean },
): msg is ReplayableBrowserIncomingMessage {
  if (NON_REPLAYABLE_BROWSER_EVENT_TYPES.has(msg.type)) return false;
  if (context?.isLeaderSession === true && isTopLevelTextStreamDelta(msg)) return false;
  return true;
}

export function isReplayableBufferedEvent(
  event: unknown,
  context?: { isLeaderSession?: boolean },
): event is BufferedBrowserEvent {
  if (!event || typeof event !== "object") return false;
  const maybeEvent = event as { seq?: unknown; message?: unknown };
  if (typeof maybeEvent.seq !== "number") return false;
  if (!maybeEvent.message || typeof maybeEvent.message !== "object") return false;
  const maybeMessage = maybeEvent.message as { type?: unknown };
  return (
    typeof maybeMessage.type === "string" &&
    shouldBufferForReplayWithContext(maybeMessage as BrowserIncomingMessage, context)
  );
}

function isTopLevelTextStreamDelta(msg: BrowserIncomingMessage): boolean {
  if (msg.type !== "stream_event") return false;
  if (msg.parent_tool_use_id !== null) return false;
  const event = msg.event;
  if (!event || typeof event !== "object") return false;
  const maybeEvent = event as { type?: unknown; delta?: unknown };
  if (maybeEvent.type !== "content_block_delta") return false;
  const delta = maybeEvent.delta;
  if (!delta || typeof delta !== "object") return false;
  const maybeDelta = delta as { type?: unknown; text?: unknown };
  return maybeDelta.type === "text_delta" && typeof maybeDelta.text === "string";
}
