import { applyKeyedListDelta, type KeyedListDelta } from "../../shared/keyed-list-delta.js";

/** The per-session lists the server sends as changes from the copy a browser holds. */
export type SyncedListKind = "notifications" | "attention_records";

/** A list as a server message carries it: whole, as changes, or not at all because the browser holds it. */
export interface SyncedList<T> {
  list?: T[];
  delta?: KeyedListDelta<T>;
  /** Hash of the list the message leaves the browser with. */
  hash?: string;
}

/**
 * The list the server last sent this browser, by kind and session, with the
 * server's hash of it. Changes build on this copy, not on the store's: the
 * store's copy may be cleared or replaced locally (a cleared session status,
 * a REST read), and each message then restores the server's list in the
 * store, as the whole lists sent before did.
 */
const receivedLists = new Map<string, { list: unknown[]; hash: string }>();

function receivedKey(kind: SyncedListKind, sessionId: string): string {
  return `${kind}\u0000${sessionId}`;
}

/** Hash of the list the server last sent this browser, named so the server can send only what changed. */
export function receivedListHash(kind: SyncedListKind, sessionId: string): string | undefined {
  return receivedLists.get(receivedKey(kind, sessionId))?.hash;
}

/**
 * The list a server message leaves the session with: the list it carries, or
 * the list the server last sent with the message's changes applied. Null when
 * the message builds on a list this browser did not receive; the browser then
 * asks for the list again.
 */
export function receiveSyncedList<T>(
  kind: SyncedListKind,
  sessionId: string,
  synced: SyncedList<T>,
  idOf: (entry: T) => string,
): T[] | null {
  const key = receivedKey(kind, sessionId);
  const previous = receivedLists.get(key) as { list: T[]; hash: string } | undefined;
  let list: T[] | null = null;
  if (synced.list) list = synced.list;
  else if (previous && previous.hash === synced.hash) list = previous.list;
  else if (previous && synced.delta && previous.hash === synced.delta.base) {
    list = applyKeyedListDelta(previous.list, synced.delta, idOf);
  }
  if (list && synced.hash !== undefined) receivedLists.set(key, { list, hash: synced.hash });
  return list;
}

/** Drops a removed session's received lists. */
export function forgetReceivedLists(sessionId: string): void {
  receivedLists.delete(receivedKey("notifications", sessionId));
  receivedLists.delete(receivedKey("attention_records", sessionId));
}
