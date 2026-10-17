import { describe, expect, it } from "vitest";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";
import { receiveSyncedList } from "../../src/utils/synced-lists.js";
import { KeyedListVersions, type KeyedListSync } from "./keyed-list-versions.js";

// Notification lists, attention records and tree-group assignments reach
// browsers as changes from a list they hold. These tests drive the server's
// producer and the browser's real receiving code together: whatever path a
// list takes (whole, delta, or left out), the browser must end with exactly
// the server's list, entry for entry and in order.

interface Entry {
  id: string;
  done: boolean;
  text: string;
}

const idOf = (entry: Entry) => entry.id;
let browsers = 0;

/** A new browser that received `held` from the server, or nothing. */
function browser(held?: Entry[]): string {
  const id = `browser-${browsers++}`;
  if (held) receiveSyncedList("notifications", id, { list: clone(held), hash: snapshotPartHash(held) }, idOf);
  return id;
}

/** The list a browser ends with after receiving `sync` over the wire; null when it must ask again. */
function receive(id: string, sync: KeyedListSync<Entry>): Entry[] | null {
  return receiveSyncedList("notifications", id, clone(sync), idOf);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function entry(id: number, text = `entry ${id}`): Entry {
  return { id: `n-${id}`, done: false, text };
}

describe("KeyedListVersions", () => {
  it("sends the whole list to a browser holding nothing it knows, and nothing to one holding the current list", () => {
    const versions = new KeyedListVersions<Entry>(idOf, 8);
    const list = [entry(1), entry(2)];

    expect(versions.sync(list, undefined)).toEqual({ hash: snapshotPartHash(list), list });
    expect(versions.sync(list, "unknown")).toMatchObject({ list });
    // The hash is the browser's own hash of the list as received.
    expect(versions.sync(list, snapshotPartHash(JSON.parse(JSON.stringify(list))))).toEqual({
      hash: snapshotPartHash(list),
    });
  });

  // The common case on a busy leader: hundreds of resolved notifications and
  // one change. Only the changed and new entries and the removed ids travel.
  it("sends only changed, new and removed entries from a recent list", () => {
    const versions = new KeyedListVersions<Entry>(idOf, 8);
    const before = [entry(1), entry(2), entry(3), entry(4)];
    const held = JSON.parse(JSON.stringify(before)) as Entry[];
    versions.sync(before, undefined);

    // Entries are edited in place on the server; earlier versions must not see the edit.
    before[1]!.done = true;
    const after = [before[0]!, before[1]!, before[3]!, entry(5)];
    const sync = versions.sync(after, snapshotPartHash(held));

    expect(sync.list).toBeUndefined();
    expect(sync.delta).toEqual({
      base: snapshotPartHash(held),
      hash: snapshotPartHash(after),
      upserts: [after[1], after[3]],
      removed: ["n-3"],
    });
    expect(receive(browser(held), sync)).toEqual(after);
  });

  it("sends the whole list when the order changed beyond appending, or ids repeat", () => {
    const versions = new KeyedListVersions<Entry>(idOf, 8);
    const list = [entry(1), entry(2), entry(3)];
    versions.sync(list, undefined);
    const held = snapshotPartHash(list);

    const reordered = [list[1]!, list[0]!, list[2]!];
    expect(versions.sync(reordered, held)).toMatchObject({ list: reordered });
    // A new entry placed before held ones cannot be appended either.
    const inserted = [entry(9), ...list];
    expect(versions.sync(inserted, held)).toMatchObject({ list: inserted });
    const repeated = [...list, entry(1, "duplicate id")];
    expect(versions.sync(repeated, held)).toMatchObject({ list: repeated });
  });

  it("forgets versions beyond its limit and then sends the whole list", () => {
    const versions = new KeyedListVersions<Entry>(idOf, 2);
    const first = [entry(1)];
    versions.sync(first, undefined);
    versions.sync([entry(1), entry(2)], undefined);
    versions.sync([entry(1), entry(2), entry(3)], undefined);

    const current = [entry(1), entry(2), entry(3), entry(4)];
    expect(versions.sync(current, snapshotPartHash(first))).toMatchObject({ list: current });
  });

  // A broadcast is computed once for every socket: its base is the list the
  // previous broadcast sent. A browser that holds something else (it missed an
  // update) cannot apply it and asks again with the hash of what it holds.
  it("bases each broadcast on the previous one, and a browser holding another list asks again", () => {
    const versions = new KeyedListVersions<Entry>(idOf, 8);
    const live = browser();
    const missed = browser();
    const first = versions.broadcast([entry(1), entry(3)]);
    expect(first.list).toEqual([entry(1), entry(3)]);
    receive(live, first);
    receive(missed, first);

    const second = versions.broadcast([entry(1), entry(3), entry(2)]);
    expect(second.delta?.upserts).toEqual([entry(2)]);
    expect(receive(live, second)).toEqual([entry(1), entry(3), entry(2)]);

    const current = [entry(1, "edited"), entry(3), entry(2)];
    const third = versions.broadcast(current);
    // A browser that missed the second broadcast cannot apply the third ...
    expect(receive(missed, third)).toBeNull();
    // ... and its resync request gets the changes from what it holds.
    const resync = versions.sync(current, snapshotPartHash([entry(1), entry(3)]));
    expect(resync.delta?.upserts).toEqual([entry(1, "edited"), entry(2)]);
    expect(receive(missed, resync)).toEqual(current);
    // A second copy of an update it already applied (another socket of the same tab) changes nothing.
    expect(receive(live, third)).toEqual(current);
    expect(receive(live, third)).toEqual(current);
  });

  // Randomized edits like a session's notification list sees: resolutions,
  // new prompts, removals, and occasional reorders. Every browser path must
  // end on the server's exact list.
  it("leaves every browser with the server's exact list across random edits", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const versions = new KeyedListVersions<Entry>(idOf, 6);
    let list: Entry[] = [];
    let nextId = 1;
    const live = browser();
    const snapshots: Entry[][] = [];
    for (let step = 0; step < 400; step++) {
      list = list.map((item) => (random() < 0.05 ? { ...item, done: !item.done } : item));
      if (random() < 0.4) list.push(entry(nextId++));
      if (list.length > 0 && random() < 0.15) list.splice(Math.floor(random() * list.length), 1);
      if (list.length > 1 && random() < 0.03) list.reverse();

      // A socket that receives every broadcast.
      expect(receive(live, versions.broadcast(list))).toEqual(list);

      // A browser returning with an older copy, as on a phone reconnect.
      snapshots.push(clone(list));
      const older = snapshots[Math.floor(random() * snapshots.length)]!;
      expect(receive(browser(older), versions.sync(list, snapshotPartHash(older)))).toEqual(list);
    }
  });
});
