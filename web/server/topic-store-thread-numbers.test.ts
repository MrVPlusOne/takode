import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TopicStore } from "./topic-store.js";
import { resetThreadNumbersForTest, threadAddress } from "../shared/topic-thread-key.js";

/**
 * Threads get short addresses (`t-1`, `t-2`, …) like quests: one global sequence in the order they
 * started, so two leaders' threads never share an address. Threads saved before addresses existed
 * are numbered when the store loads, by when they started, after any numbers already given.
 */

const NOW = Date.UTC(2026, 10, 1, 9, 0);
let root: string;
let now = NOW;
const stores: TopicStore[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "thread-numbers-"));
  now = NOW;
  resetThreadNumbersForTest();
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()));
  await rm(root, { recursive: true, force: true });
  resetThreadNumbersForTest();
});

async function newStore() {
  const store = new TopicStore(root, () => now);
  stores.push(store);
  await store.load();
  return store;
}

describe("thread numbers", () => {
  it("numbers threads globally in the order they start, and finds them by address", async () => {
    const store = await newStore();
    const first = store.startThread({ space: "MSI", name: "Composer height", leaderId: "leader-a" });
    now += 1000;
    const second = store.startThread({ space: "Takode", name: "Relay", leaderId: "leader-b" });
    expect([first.address, second.address]).toEqual(["t-1", "t-2"]);
    expect(store.thread("t-2")?.id).toBe(second.id);
    expect(store.thread("T-1")?.id).toBe(first.id);
    expect(store.resolve("t-1")?.id).toBe(first.id);
    expect(store.thread("t-3")).toBeUndefined();
    expect(threadAddress(second.key)).toBe("t-2");

    // The sequence survives a reload; a thread started then continues it.
    await store.flush();
    resetThreadNumbersForTest();
    const reloaded = await newStore();
    expect(threadAddress(first.key)).toBe("t-1");
    expect(reloaded.startThread({ space: "MSI", name: "Later", leaderId: "leader-a" }).address).toBe("t-3");
  });

  it("numbers threads saved before addresses existed by when they started, after numbers already given", async () => {
    const store = await newStore();
    const older = store.startThread({ space: "MSI", name: "Older", leaderId: "leader-a" });
    now += 1000;
    const numbered = store.startThread({ space: "MSI", name: "Numbered", leaderId: "leader-a" });
    now += 1000;
    const newer = store.startThread({ space: "MSI", name: "Newer", leaderId: "leader-b" });
    await store.flush();

    // Rewrite the file as an older server left it: one thread numbered (as if the user already
    // read it as t-5), the others without numbers and no saved sequence.
    const file = join(root, "topics.json");
    const saved = JSON.parse(await readFile(file, "utf-8"));
    delete saved.nextThreadNumber;
    delete saved.topics[older.id].thread.number;
    delete saved.topics[newer.id].thread.number;
    saved.topics[numbered.id].thread.number = 5;
    await writeFile(file, JSON.stringify(saved));
    resetThreadNumbersForTest();

    const upgraded = await newStore();
    expect(upgraded.allThreads().map((thread) => [thread.name, thread.address])).toEqual(
      expect.arrayContaining([
        ["Numbered", "t-5"],
        ["Older", "t-6"],
        ["Newer", "t-7"],
      ]),
    );
    expect(upgraded.startThread({ space: "MSI", name: "Next", leaderId: "leader-a" }).address).toBe("t-8");
    await upgraded.flush();
    const resaved = JSON.parse(await readFile(file, "utf-8"));
    expect(resaved.topics[older.id].thread.number).toBe(6);
    expect(resaved.nextThreadNumber).toBe(9);
  });
});
