import type { KeyedListDelta } from "../../shared/keyed-list-delta.js";
import { snapshotTextHash } from "../../shared/snapshot-part-hash.js";

/** How a list reaches a browser, given the hash of the list it holds. */
export interface KeyedListSync<T> {
  /** Hash of the current list. */
  hash: string;
  /** The whole list, when the browser holds no recent one. */
  list?: T[];
  /** What changed since the list the browser holds. With neither field, it holds the current list. */
  delta?: KeyedListDelta<T>;
}

interface ListVersion {
  hash: string;
  ids: string[];
  /** Hash of each entry's JSON, by position. */
  entryHashes: string[];
  /** Ids are unique, so deltas can address entries by id. */
  keyed: boolean;
}

/**
 * The recent versions of a list browsers hold, so a browser holding one of
 * them receives only what changed instead of the whole list. A version is
 * remembered by the hash of its JSON and the hash of each entry, never the
 * entries themselves, so later in-place edits of the entries cannot alter it.
 */
export class KeyedListVersions<T> {
  private readonly versions: ListVersion[] = [];
  /** Hash of the list the previous broadcast sent, which every socket of the audience holds. */
  private broadcastBase: string | undefined;

  constructor(
    private readonly idOf: (entry: T) => string,
    private readonly limit: number,
  ) {}

  /**
   * Remembers `list` and returns how it reaches a browser holding the list
   * hashed `held`. `hash` overrides the list's own hash, for a list that is
   * part of a larger value browsers identify as a whole.
   */
  sync(list: readonly T[], held: string | undefined, hash?: string): KeyedListSync<T> {
    const current = this.remember(list, hash);
    if (held === current.hash) return { hash: current.hash };
    const base = held === undefined ? undefined : this.versions.find((version) => version.hash === held);
    const delta = base && this.delta(base, current, list);
    return delta ? { hash: current.hash, delta } : { hash: current.hash, list: list as T[] };
  }

  /**
   * `sync` for a message every socket of the audience receives: they hold the
   * list the previous broadcast sent, or the same list from their subscribe.
   * A socket holding another list asks for it again.
   */
  broadcast(list: readonly T[], hash?: string): KeyedListSync<T> {
    const result = this.sync(list, this.broadcastBase, hash);
    this.broadcastBase = result.hash;
    return result;
  }

  private remember(list: readonly T[], hash: string | undefined): ListVersion {
    const texts = list.map((entry) => JSON.stringify(entry));
    const listHash = hash ?? snapshotTextHash(`[${texts.join(",")}]`);
    const latest = this.versions.at(-1);
    if (latest?.hash === listHash) return latest;
    const ids = list.map(this.idOf);
    // Unchanged entries share the previous version's hash strings, so a long list costs little per version.
    const previous = latest && new Map(latest.ids.map((id, index) => [id, latest.entryHashes[index]!]));
    const entryHashes = texts.map((text, index) => {
      const entryHash = snapshotTextHash(text);
      const previousHash = previous?.get(ids[index]!);
      return previousHash === entryHash ? previousHash : entryHash;
    });
    const version = { hash: listHash, ids, entryHashes, keyed: new Set(ids).size === ids.length };
    this.versions.push(version);
    if (this.versions.length > this.limit) this.versions.shift();
    return version;
  }

  /** The delta from `base` to `current`, when `applyKeyedListDelta` can express it and it is smaller than the list. */
  private delta(base: ListVersion, current: ListVersion, list: readonly T[]): KeyedListDelta<T> | undefined {
    if (!base.keyed || !current.keyed) return undefined;
    const baseIndexes = new Map(base.ids.map((id, index) => [id, index]));
    const upserts: T[] = [];
    let previousBaseIndex = -1;
    let appending = false;
    for (let index = 0; index < current.ids.length; index++) {
      const baseIndex = baseIndexes.get(current.ids[index]!);
      if (baseIndex === undefined) {
        appending = true;
        upserts.push(list[index]!);
        continue;
      }
      // Applying keeps held entries in their order and appends new ones; any other order needs the whole list.
      if (appending || baseIndex < previousBaseIndex) return undefined;
      previousBaseIndex = baseIndex;
      if (base.entryHashes[baseIndex] !== current.entryHashes[index]) upserts.push(list[index]!);
    }
    if (upserts.length === list.length && list.length > 0) return undefined;
    const currentIds = new Set(current.ids);
    const removed = base.ids.filter((id) => !currentIds.has(id));
    return { base: base.hash, hash: current.hash, upserts, removed };
  }
}
