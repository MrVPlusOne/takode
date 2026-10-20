/**
 * A list of entries with unique ids (the notification list, the attention
 * records, the tree-group assignments, the completed work board, a thread
 * window) sent as only what changed since a list the browser holds. Lists are
 * identified by a hash of their JSON, so a browser applies a delta only to
 * exactly the list it was computed from.
 */
export interface KeyedListDelta<T> {
  /** Hash of the list this delta applies to. */
  base: string;
  /** Hash of the list it produces. */
  hash: string;
  /** New and changed entries in list order. Without `order`, entries new to the list come after all others. */
  upserts: T[];
  /** Ids of entries that left the list. */
  removed: string[];
  /**
   * Every id of the resulting list, in order. Sent only when keeping the held
   * entries in place and appending new ones does not produce the list (an
   * entry inserted before held ones, or a reorder).
   */
  order?: string[];
}

/**
 * The list a delta produces from the list it was computed from: that list
 * without the removed entries, changed entries replaced in place, and new
 * entries appended in order, or arranged by `order` when the delta has one.
 * Null when `order` names an entry neither list has, which a delta computed
 * from this base never does.
 */
export function applyKeyedListDelta<T>(
  base: readonly T[],
  delta: Pick<KeyedListDelta<T>, "upserts" | "removed" | "order">,
  idOf: (entry: T) => string,
): T[] | null {
  const removed = new Set(delta.removed);
  const upserts = new Map(delta.upserts.map((entry) => [idOf(entry), entry]));
  if (delta.order) {
    const held = new Map(base.map((entry) => [idOf(entry), entry]));
    const result: T[] = [];
    for (const id of delta.order) {
      const entry = upserts.get(id) ?? (removed.has(id) ? undefined : held.get(id));
      if (entry === undefined) return null;
      result.push(entry);
    }
    return result;
  }
  const result: T[] = [];
  for (const entry of base) {
    const id = idOf(entry);
    if (removed.has(id)) continue;
    const changed = upserts.get(id);
    if (changed === undefined) {
      result.push(entry);
      continue;
    }
    result.push(changed);
    upserts.delete(id);
  }
  result.push(...upserts.values());
  return result;
}
