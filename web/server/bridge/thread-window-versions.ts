import type { BrowserIncomingMessage, ThreadWindowEntry } from "../session-types.js";
import { computeHistoryPayloadSyncHash } from "../../shared/history-sync-hash.js";
import {
  normalizeSelectedFeedThreadKey,
  threadWindowEntryId,
  type buildThreadWindowSync,
} from "../../shared/thread-window.js";
import type { BrowserConversationWindowSocketData } from "./browser-conversation-window-policy.js";
import { KeyedListVersions } from "./keyed-list-versions.js";

/**
 * Thread windows sent as only what changed since a window the browser holds.
 * A leader's selected window runs to 100-400 KB, while between two deliveries
 * (a phone returning after a minute, a live refresh after one new message)
 * usually only a few entries arrive, leave or change. The browser names the
 * hash of a window it holds; when the server sent that window recently, the
 * new window goes as changed entries plus removed ids, and the browser builds
 * it from its copy. Anything else sends the window whole.
 */

/** Windows a browser may hold per thread stay usable for about this many deliveries of that thread. */
const RECENT_WINDOWS_PER_THREAD = 16;
/** Threads remembered per session; the least recently sent thread is forgotten first. */
const RECENT_THREADS_PER_SESSION = 8;

const sessionWindows = new WeakMap<object, Map<string, KeyedListVersions<ThreadWindowEntry>>>();

/** How a thread window's entries reach a browser. */
export interface ThreadWindowEntriesSync {
  /** The whole window, or its new and changed entries when `delta` is set. */
  entries: ThreadWindowEntry[];
  delta?: { base: string; removed: string[]; order?: string[] };
}

/**
 * Remembers the window hashed `windowHash` and returns how it reaches a
 * browser holding the window hashed `held` (of the same thread).
 */
export function syncThreadWindowEntries(
  session: object,
  threadKey: string,
  entries: ThreadWindowEntry[],
  windowHash: string,
  held: string | undefined,
): ThreadWindowEntriesSync {
  const sync = threadVersions(session, threadKey).sync(entries, held, windowHash);
  if (!sync.delta) return { entries };
  const { upserts, removed, base, order } = sync.delta;
  return {
    entries: upserts,
    delta: { base, removed, ...(order ? { order } : {}) },
  };
}

/**
 * Sends a built thread window, as changes to the window the browser holds when it can. A partial
 * window (`held` null) goes whole and is remembered nowhere: the full window replaces it next.
 */
export function deliverThreadWindow<Socket extends { data?: unknown }>(
  session: object,
  ws: Socket,
  sync: ReturnType<typeof buildThreadWindowSync>,
  held: string | undefined | null,
  send: (ws: Socket, message: BrowserIncomingMessage) => boolean,
): void {
  const partial = held === null;
  // The answer state is covered too, so a cache hit can leave it out.
  const windowHash = computeHistoryPayloadSyncHash({
    threadKey: sync.threadKey,
    entries: sync.entries,
    responseState: sync.threadResponseProjection ?? null,
  });
  const cacheHit = held === windowHash;
  const delivered = partial
    ? { entries: sync.entries }
    : syncThreadWindowEntries(session, sync.threadKey, sync.entries, windowHash, held ?? undefined);
  const sent = send(ws, {
    type: "thread_window_sync",
    thread_key: sync.threadKey,
    entries: cacheHit ? [] : delivered.entries,
    ...(!cacheHit && delivered.delta ? { entries_delta: delivered.delta } : {}),
    window: { ...sync.window, window_hash: windowHash, ...(partial ? { partial: true } : {}) },
    ...(sync.threadResponseProjection && !cacheHit ? { response_state: sync.threadResponseProjection } : {}),
    ...(cacheHit ? { cache_hit: true } : {}),
  } as BrowserIncomingMessage);
  if (sent && !partial) noteThreadWindowHeld(ws, sync.threadKey, windowHash);
}

/**
 * Whether a browser holding the window hashed `held` of this thread may already have the message
 * `messageId`: true when that window has it, and when the server no longer remembers the window
 * (entry ids end with the message id).
 */
export function heldWindowMayHave(
  session: object,
  threadKey: string,
  held: string | undefined,
  messageId: string,
): boolean {
  if (held === undefined) return false;
  const ids = sessionWindows.get(session)?.get(threadKey)?.idsOf(held);
  return !ids || ids.some((id) => id.endsWith(`:${messageId}`));
}

/**
 * The socket's browser now holds the window just sent, so a later refresh of
 * the same thread view validates against it (a small cache hit, or only what
 * changed) instead of against the window named when the view was opened.
 */
function noteThreadWindowHeld(ws: { data?: unknown }, threadKey: string, windowHash: string): void {
  const view = ((ws.data ??= {}) as BrowserConversationWindowSocketData).conversationView;
  if (view?.kind !== "thread" || normalizeSelectedFeedThreadKey(view.request.threadKey) !== threadKey) return;
  view.request = { ...view.request, cachedWindowHash: windowHash };
}

function threadVersions(session: object, threadKey: string): KeyedListVersions<ThreadWindowEntry> {
  let threads = sessionWindows.get(session);
  if (!threads) {
    threads = new Map();
    sessionWindows.set(session, threads);
  }
  let versions = threads.get(threadKey);
  // Re-inserted on each use, so the map's first key is the least recently sent thread.
  if (versions) threads.delete(threadKey);
  else versions = new KeyedListVersions<ThreadWindowEntry>(threadWindowEntryId, RECENT_WINDOWS_PER_THREAD);
  threads.set(threadKey, versions);
  if (threads.size > RECENT_THREADS_PER_SESSION) threads.delete(threads.keys().next().value!);
  return versions;
}
