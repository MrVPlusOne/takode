import { useSyncExternalStore } from "react";
import { isNeedsInputContextMessageId } from "../shared/notification-link.js";
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
import { readAloudMessageText, readAloudQuestionText } from "./read-aloud-text.js";
import { useStore } from "./store.js";
import type { AppState } from "./store-types.js";
import type { ChatMessage, SessionNotification } from "./types.js";
import { setLocalStorageItem } from "./utils/scoped-storage.js";
import { holdScreenWakeLock } from "./utils/screen-wake-lock.js";

/**
 * Voiceback: while on, each new final message of the session on screen is read aloud as it
 * arrives, for listening on a commute without watching the screen (Jiayi, Nov 4). Several arrivals
 * wait in order and are read one after another through Read aloud; a leader's answer or report read
 * to its end is marked read. The screen is kept awake meanwhile, because a sleeping phone may not
 * play audio even once it is made.
 *
 * Final messages are what each kind of session ends on: for a leader, the answers and reports its
 * read rules count (`readsWhenSeen`); for any other session, the message a turn ends on. A question
 * an agent asks (a needs-input prompt) is read in every session, its context message and then the
 * question with its suggested answers, since it is what the listener must hear most.
 *
 * It is a mode of this device rather than of one session (Jiayi, Nov 5): it stays on across
 * sessions and reloads until turned off, and follows whichever session is on screen. Only one tab
 * reads at a time. After a reload, the screen lock and (on iPhone) audio wait for the first tap or
 * key press, since browsers grant both only to one.
 */

export interface VoicebackState {
  /** Arrivals waiting to be read, after the one being read. */
  waiting: number;
  /** False after a reload until audio may play, which on iPhone needs a first tap. */
  ready: boolean;
}

interface VoicebackItem {
  sessionId: string;
  messageId: string;
  text: string;
  historyIndex?: number;
  /** A leader's unread result, marked read once read to its end. */
  notificationId?: string;
}

const STORAGE_KEY = "cc-voiceback";
const TAB_LOCK = "takode-voiceback";
/** Events that let a page play audio and keep the screen on (user activation). */
const GESTURES = ["click", "touchend", "keydown"] as const;
/**
 * Messages from before a session was first watched are not read even when they show up later (a
 * reconnect, a longer history window). A turn already running then ends on a newer message than
 * this allows for, so its final is read.
 */
const STARTED_SLACK_MS = 2 * 60_000;
/** How many of a session's latest messages are looked at for new turn ends. */
const RECENT_MESSAGES = 10;

interface Watch {
  startedAt: number;
  /** Notification and message ids already queued, or there when the session was first watched. */
  known: Set<string>;
}

interface Active {
  /** Whether audio may play: from the toggle's tap, a first tap after a reload, or a browser that allows it. */
  ready: boolean;
  /** Whether the screen lock is held (it needs a tap). */
  awake: boolean;
  /** Whether this tab reads (it holds the tab lock); other tabs with voiceback on wait for it. */
  reading: boolean;
  /** Each session watched since voiceback started in this page, so returning to one reads what came meanwhile. */
  watched: Map<string, Watch>;
  queue: VoicebackItem[];
  /** The item being read, if voiceback started the read on screen. */
  current: VoicebackItem | null;
  cleanups: Array<() => void>;
}

let active: Active | null = null;
let snapshot: VoicebackState | null = null;
const listeners = new Set<() => void>();
/** Starting a read stops the previous one first; its notices must not start another. */
let starting = false;
let lastSeen: { sessionId: string; notifications: unknown; messages: unknown; windows: unknown } | null = null;

/**
 * Turn voiceback on, or off when it is on, on this device. Must be called from the tap: the screen
 * lock and the audio unlock both need one.
 */
export function toggleVoiceback(): void {
  if (active) {
    removeSaved();
    turnOff();
    return;
  }
  setLocalStorageItem(STORAGE_KEY, "1");
  turnOn(true);
}

/** Voiceback's state, or null while it is off. */
export function useVoiceback(): VoicebackState | null {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Turn voiceback on if it was left on, and follow other tabs turning it on or off. Runs once when
 * the module loads in a browser.
 */
export function restoreVoiceback(): () => void {
  if (localStorage.getItem(STORAGE_KEY) === "1" && !active) turnOn(false);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const on = localStorage.getItem(STORAGE_KEY) === "1";
    if (on && !active) turnOn(false);
    else if (!on && active) turnOff();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function turnOn(tapped: boolean): void {
  const self: Active = {
    ready: false,
    awake: false,
    reading: false,
    watched: new Map(),
    queue: [],
    current: null,
    cleanups: [],
  };
  active = self;
  if (tapped) {
    wake(self);
  } else {
    // A desktop browser often lets a page play without a tap; iPhone Safari does not.
    void unlockReadAloudAudio().then((played) => {
      if (!played || active !== self || self.ready) return;
      self.ready = true;
      publish();
      next();
    });
    const onGesture = () => wake(self);
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true });
    self.cleanups.push(() => {
      for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
    });
  }
  readInOneTab(self, () => {
    self.reading = true;
    self.cleanups.push(useStore.subscribe(collect), subscribeReadAloud(readChanged), onReadAloudEnd(readEnded));
    lastSeen = null;
    collect(useStore.getState());
  });
  publish();
}

/** From a tap: keep the screen on and let later reads play. */
function wake(self: Active): void {
  if (active !== self || self.awake) return;
  self.awake = true;
  self.cleanups.push(holdScreenWakeLock());
  void unlockReadAloudAudio();
  self.ready = true;
  publish();
  next();
}

/** Run `read` once this tab holds the voiceback lock, so two tabs never read the same reply. */
function readInOneTab(self: Active, read: () => void): void {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return read();
  const controller = new AbortController();
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  self.cleanups.push(() => {
    controller.abort();
    release();
  });
  locks
    .request(TAB_LOCK, { signal: controller.signal }, () => {
      if (active !== self) return;
      read();
      return held;
    })
    .catch((error: unknown) => {
      if ((error as Error)?.name !== "AbortError") console.warn("[voiceback] Could not take the tab lock:", error);
    });
}

function turnOff(): void {
  if (!active) return;
  const { current, cleanups } = active;
  active = null;
  for (const cleanup of cleanups) cleanup();
  if (current && getReadAloudState()?.messageId === current.messageId) stopReadAloud();
  publish();
}

function removeSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[voiceback] Could not forget the saved setting:", error);
  }
}

/** Queue the final messages that arrived since the last look, and read the next if nothing is. */
function collect(state: AppState): void {
  if (!active?.reading) return;
  const sessionId = state.currentSessionId;
  if (!sessionId) return;
  const seen = {
    sessionId,
    notifications: state.sessionNotifications.get(sessionId),
    messages: state.messages.get(sessionId),
    windows: state.threadWindowMessages.get(sessionId),
  };
  // The store changes far more often than this session's messages and results.
  if (
    lastSeen &&
    lastSeen.sessionId === seen.sessionId &&
    lastSeen.notifications === seen.notifications &&
    lastSeen.messages === seen.messages &&
    lastSeen.windows === seen.windows
  ) {
    return;
  }
  lastSeen = seen;
  let watch = active.watched.get(sessionId);
  if (!watch) {
    // What is there now is not new, including a result whose message this browser hasn't loaded.
    const present = [
      ...(seen.notifications ?? []).map((notification) => notification.id),
      ...(seen.messages ?? []).slice(-RECENT_MESSAGES).map((message) => message.id),
    ];
    watch = { startedAt: Date.now(), known: new Set(present) };
    active.watched.set(sessionId, watch);
  }
  let added = false;
  for (const { key, item } of finalMessages(state, sessionId, watch)) {
    if (watch.known.has(key)) continue;
    watch.known.add(key);
    active.queue.push(item);
    added = true;
  }
  if (!added) return;
  publish();
  next();
}

/**
 * The session's final messages in arrival order, keyed for `known`. One whose message hasn't
 * reached this browser yet is left out until it has.
 */
function finalMessages(state: AppState, sessionId: string, watch: Watch): Array<{ key: string; item: VoicebackItem }> {
  const notBefore = watch.startedAt - STARTED_SLACK_MS;
  const leader = isLeader(state, sessionId);
  const finals: Array<{ key: string; timestamp: number; item: VoicebackItem }> = [];
  for (const notification of state.sessionNotifications.get(sessionId) ?? []) {
    if (notification.timestamp < notBefore) continue;
    if (notification.category === "needs-input" && !notification.done) {
      const item = questionItem(state, sessionId, notification);
      if (!item) continue;
      finals.push({ key: notification.id, timestamp: notification.timestamp, item });
    } else if (leader && readsWhenSeen(notification)) {
      const message = findMessage(state, sessionId, notification.messageId!);
      if (!message) continue;
      const item = { ...readable(sessionId, message), notificationId: notification.id };
      finals.push({ key: notification.id, timestamp: notification.timestamp, item });
    }
  }
  if (!leader) {
    for (const message of (state.messages.get(sessionId) ?? []).slice(-RECENT_MESSAGES)) {
      // The server stamps a turn's duration on the message the turn ended on.
      const turnEnd =
        message.role === "assistant" && !message.parentToolUseId && typeof message.turnDurationMs === "number";
      // A question's context is read with its question, not again on its own.
      if (!turnEnd || message.timestamp < notBefore || isNeedsInputContextMessageId(message.id)) continue;
      const item = readable(sessionId, message);
      if (item.text.trim()) finals.push({ key: message.id, timestamp: message.timestamp, item });
    }
  }
  return finals.sort((a, b) => a.timestamp - b.timestamp);
}

/** A question as it is read: its context message (once loaded), then the question and its answers. */
function questionItem(state: AppState, sessionId: string, notification: SessionNotification): VoicebackItem | null {
  const contextId = notification.contextMessageId;
  const context = contextId ? findMessage(state, sessionId, contextId) : undefined;
  if (contextId && !context) return null;
  const text = [context ? readAloudMessageText(context) : notification.body, readAloudQuestionText(notification)]
    .filter(Boolean)
    .join("\n\n");
  return { sessionId, messageId: notification.messageId ?? notification.id, text, historyIndex: context?.historyIndex };
}

function isLeader(state: AppState, sessionId: string): boolean {
  return (
    state.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator === true) ||
    state.sessions.get(sessionId)?.isOrchestrator === true
  );
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

function readable(sessionId: string, message: ChatMessage): VoicebackItem {
  return { sessionId, messageId: message.id, text: readAloudMessageText(message), historyIndex: message.historyIndex };
}

/** Read the next waiting message, unless something is being read (a voiceback read or the user's own). */
function next(): void {
  if (!active?.ready || starting || active.current || isReadAloudBusy()) return;
  const item = active.queue.shift();
  if (!item) return;
  starting = true;
  try {
    startReadAloud({
      sessionId: item.sessionId,
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
      void api.markNotificationDone(done.sessionId, done.notificationId, true).catch(console.error);
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
  snapshot = active ? { waiting: active.queue.length, ready: active.ready } : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined" && typeof localStorage !== "undefined") restoreVoiceback();
