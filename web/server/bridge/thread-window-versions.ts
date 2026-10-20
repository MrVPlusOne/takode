import type { ThreadWindowEntry } from "../session-types.js";
import { threadWindowEntryId } from "../../shared/thread-window.js";
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
