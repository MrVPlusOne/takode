import { useSyncExternalStore } from "react";
import { api } from "./api.js";
import { readsWhenSeen } from "./hooks/use-unread-messages-seen.js";
import {
  getReadAloudState,
  isReadAloudBusy,
  onReadAloudEnd,
  startReadAloud,
  stopReadAloud,
  subscribeReadAloud,
  unlockReadAloudAudio,
} from "./read-aloud-player.js";
import { readAloudMessageText } from "./read-aloud-text.js";
import { useStore } from "./store.js";
import type { AppState } from "./store-types.js";
import type { ChatMessage } from "./types.js";
import { holdScreenWakeLock } from "./utils/screen-wake-lock.js";

/**
 * Voiceback: while on, each new final message of one session is read aloud as it arrives, for
 * listening on a commute without watching the screen (Jiayi, Nov 4). Several arrivals wait in
 * order and are read one after another through Read aloud; a leader's answer or report read to its
 * end is marked read. The screen is kept awake meanwhile, because a sleeping phone may not play
 * audio even once it is made.
 *
 * Final messages are what each kind of session ends on: for a leader, the answers and reports its
 * read rules count (`readsWhenSeen`); for any other session, the message a turn ends on.
 *
 * It is this browser's state, not the session's: it runs in the window the toggle was tapped in,
 * for the session it was tapped for, until turned off or the page reloads (the screen lock and the
 * unlocked audio are the page's).
 */

export interface VoicebackState {
  sessionId: string;
  /** Arrivals waiting to be read, after the one being read. */
  waiting: number;
}

interface VoicebackItem {
  messageId: string;
  text: string;
  historyIndex?: number;
  /** A leader's unread result, marked read once read to its end. */
  notificationId?: string;
}

/**
 * Messages from before voiceback started are not read even when they show up later (a reconnect,
 * a longer history window). A turn already running when it started ends on a newer message than
 * this allows for, so its final is read.
 */
const STARTED_SLACK_MS = 2 * 60_000;
/** How many of a session's latest messages are looked at for new turn ends. */
const RECENT_MESSAGES = 10;

interface Active {
  sessionId: string;
  leader: boolean;
  startedAt: number;
  /** Notification ids (leaders) or message ids (others) already queued or there at the start. */
  known: Set<string>;
  queue: VoicebackItem[];
  /** The item being read, if voiceback started the read on screen. */
  current: VoicebackItem | null;
  release: () => void;
}

let active: Active | null = null;
let snapshot: VoicebackState | null = null;
const listeners = new Set<() => void>();
/** Starting a read stops the previous one first; its notices must not start another. */
let starting = false;
let lastSeen: { notifications: unknown; messages: unknown; windows: unknown } | null = null;

/**
 * Turn voiceback on for `sessionId`, or off when it is already on for it. Must be called from the
 * tap: the screen lock and the audio unlock both need one.
 */
export function toggleVoiceback(sessionId: string, leader: boolean): void {
  if (active?.sessionId === sessionId) return stopVoiceback();
  stopVoiceback();
  const releaseWakeLock = holdScreenWakeLock();
  unlockReadAloudAudio();
  const unsubscribeStore = useStore.subscribe(collect);
  const unsubscribeRead = subscribeReadAloud(readChanged);
  const unsubscribeEnd = onReadAloudEnd(readEnded);
  active = {
    sessionId,
    leader,
    startedAt: Date.now(),
    known: new Set(),
    queue: [],
    current: null,
    release: () => {
      releaseWakeLock();
      unsubscribeStore();
      unsubscribeRead();
      unsubscribeEnd();
    },
  };
  // What is there now is not new, including a result whose message this browser hasn't loaded.
  const now = useStore.getState();
  const present = leader
    ? (now.sessionNotifications.get(sessionId) ?? []).map((notification) => notification.id)
    : finalMessages(now, active).map(({ key }) => key);
  for (const key of present) active.known.add(key);
  lastSeen = null;
  publish();
}

/** Turn voiceback off, stopping a read it started. */
export function stopVoiceback(): void {
  if (!active) return;
  const { current, release } = active;
  active = null;
  release();
  if (current && getReadAloudState()?.messageId === current.messageId) stopReadAloud();
  publish();
}

/** Voiceback's state, or null while it is off. */
export function useVoiceback(): VoicebackState | null {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Queue the final messages that arrived since the last look, and read the next if nothing is. */
function collect(state: AppState): void {
  if (!active) return;
  const seen = {
    notifications: state.sessionNotifications.get(active.sessionId),
    messages: state.messages.get(active.sessionId),
    windows: state.threadWindowMessages.get(active.sessionId),
  };
  // The store changes far more often than this session's messages and results.
  if (
    lastSeen &&
    lastSeen.notifications === seen.notifications &&
    lastSeen.messages === seen.messages &&
    lastSeen.windows === seen.windows
  ) {
    return;
  }
  lastSeen = seen;
  let added = false;
  for (const { key, item } of finalMessages(state, active)) {
    if (active.known.has(key)) continue;
    active.known.add(key);
    active.queue.push(item);
    added = true;
  }
  if (!added) return;
  publish();
  next();
}

/**
 * The session's final messages in arrival order, keyed for `known`. A leader's result whose
 * message hasn't reached this browser yet is left out until it has.
 */
function finalMessages(state: AppState, session: Active): Array<{ key: string; item: VoicebackItem }> {
  const notBefore = session.startedAt - STARTED_SLACK_MS;
  if (session.leader) {
    return (state.sessionNotifications.get(session.sessionId) ?? []).flatMap((notification) => {
      if (!readsWhenSeen(notification) || notification.timestamp < notBefore) return [];
      const message = findMessage(state, session.sessionId, notification.messageId!);
      return message ? [{ key: notification.id, item: { ...readable(message), notificationId: notification.id } }] : [];
    });
  }
  const messages = state.messages.get(session.sessionId) ?? [];
  return messages.slice(-RECENT_MESSAGES).flatMap((message) => {
    // The server stamps a turn's duration on the message the turn ended on.
    const turnEnd =
      message.role === "assistant" && !message.parentToolUseId && typeof message.turnDurationMs === "number";
    if (!turnEnd || message.timestamp < notBefore) return [];
    const item = readable(message);
    return item.text.trim() ? [{ key: message.id, item }] : [];
  });
}

function findMessage(state: AppState, sessionId: string, messageId: string): ChatMessage | undefined {
  const inHistory = state.messages.get(sessionId)?.find((message) => message.id === messageId);
  if (inHistory) return inHistory;
  for (const messages of state.threadWindowMessages.get(sessionId)?.values() ?? []) {
    const found = messages.find((message) => message.id === messageId);
    if (found) return found;
  }
  return undefined;
}

function readable(message: ChatMessage): VoicebackItem {
  return { messageId: message.id, text: readAloudMessageText(message), historyIndex: message.historyIndex };
}

/** Read the next waiting message, unless something is being read (a voiceback read or the user's own). */
function next(): void {
  if (!active || starting || active.current || isReadAloudBusy()) return;
  const item = active.queue.shift();
  if (!item) return;
  starting = true;
  try {
    startReadAloud({
      sessionId: active.sessionId,
      messageId: item.messageId,
      text: item.text,
      historyIndex: item.historyIndex,
    });
  } finally {
    starting = false;
  }
  active.current = item;
  publish();
}

/** A message was read to its end: a voiceback one is now read; then the next one plays. */
function readEnded(messageId: string): void {
  if (!active) return;
  const done = active.current?.messageId === messageId ? active.current : null;
  if (done) {
    active.current = null;
    if (done.notificationId) {
      void api.markNotificationDone(active.sessionId, done.notificationId, true).catch(console.error);
    }
  }
  next();
}

/** The read changed: one voiceback started that was stopped, replaced or failed is let go unread. */
function readChanged(): void {
  if (!active || starting) return;
  const read = getReadAloudState();
  if (active.current && (read?.messageId !== active.current.messageId || read.status === "error")) {
    active.current = null;
    publish();
  }
  next();
}

function publish(): void {
  snapshot = active ? { sessionId: active.sessionId, waiting: active.queue.length } : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
