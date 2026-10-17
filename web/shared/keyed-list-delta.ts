/**
 * A list of entries with unique ids (the notification list, the attention
 * records, the tree-group assignments) sent as only what changed since a list
 * the browser holds. Lists are identified by `snapshotPartHash` of their JSON,
 * so a browser applies a delta only to exactly the list it was computed from.
 */
export interface KeyedListDelta<T> {
  /** Hash of the list this delta applies to. */
  base: string;
  /** Hash of the list it produces. */
  hash: string;
  /** New and changed entries in list order. Entries new to the list come after all others. */
  upserts: T[];
  /** Ids of entries that left the list. */
  removed: string[];
}

/**
 * The list a delta produces from the list it was computed from: that list
 * without the removed entries, changed entries replaced in place, and new
 * entries appended in order.
 */
export function applyKeyedListDelta<T>(
  base: readonly T[],
  delta: Pick<KeyedListDelta<T>, "upserts" | "removed">,
  idOf: (entry: T) => string,
): T[] {
  const removed = new Set(delta.removed);
  const upserts = new Map(delta.upserts.map((entry) => [idOf(entry), entry]));
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
