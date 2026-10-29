import { sendToSession } from "../ws.js";

/**
 * The threads each leader's side column shows beside the main view, as the server must know them:
 * live messages of a thread reach a browser only for the views it shows. The column registers its
 * conversations while it is mounted; the list goes to the server when it changes and again with
 * every subscribe (`getSideViews`), so a reconnect keeps it.
 */
const owners = new Map<string, Map<object, readonly string[]>>();

/** Sets one owner's side threads for a session, or clears them with an empty list. */
export function setSideViewsOf(sessionId: string, owner: object, threadKeys: readonly string[]): void {
  const before = getSideViews(sessionId).join(",");
  const byOwner = owners.get(sessionId) ?? new Map<object, readonly string[]>();
  if (threadKeys.length) byOwner.set(owner, threadKeys);
  else byOwner.delete(owner);
  if (byOwner.size) owners.set(sessionId, byOwner);
  else owners.delete(sessionId);
  const after = getSideViews(sessionId);
  // Not connected yet: the next subscribe carries the list.
  if (after.join(",") !== before) sendToSession(sessionId, { type: "side_views_update", thread_keys: after });
}

/** The side threads of a session, for its subscribe. */
export function getSideViews(sessionId: string): string[] {
  const keys = new Set<string>();
  for (const list of owners.get(sessionId)?.values() ?? []) for (const key of list) keys.add(key.toLowerCase());
  return [...keys].sort();
}
