import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { questStoreDir, writeQuestStoreFixture } from "./test-fixtures/quest-store-fixture.js";

let tempDir: string;
let questStore: typeof import("./quest-store.js");
let questStoreDirModule: typeof import("./quest-store-dir.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (next: string) => {
      dir = next;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir.get() };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-store-cache-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
  questStoreDirModule = await import("./quest-store-dir.js");
  writeLiveStore([
    { questId: "q-1", title: "First", description: "Follow-up of q-2.", feedback: [] },
    { questId: "q-2", title: "Second", feedback: [{ author: "agent", text: "Summary: done", ts: 5 }] },
  ]);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function companionDir(): string {
  return join(tempDir, ".companion");
}

function writeLiveStore(quests: Record<string, unknown>[]): void {
  writeQuestStoreFixture(companionDir(), {
    quests: quests.map((quest, index) => ({
      id: quest.questId,
      version: 1,
      createdAt: 1_000 + index,
      status: "idea",
      ...quest,
    })),
  });
}

/** What a process with no cache would read: the store parsed fresh from disk. */
async function freshRead(): Promise<unknown[]> {
  questStoreDirModule._clearQuestDirCacheForTests();
  return questStore.listQuests();
}

describe("live quest store cache", () => {
  it("serves repeat reads from memory and returns frozen quests", async () => {
    const first = await questStore.getQuest("q-1");
    const second = await questStore.getQuest("q-1");
    // Same object: the store was not re-parsed for the second read.
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    // Derived relationship summaries are part of the cached view.
    expect(first?.relatedQuests).toEqual([{ questId: "q-2", kind: "references", explicit: false }]);
    // A caller that edits a shared quest in place fails loudly instead of corrupting later reads.
    expect(() => {
      (first as { title: string }).title = "Changed";
    }).toThrow(TypeError);
  });

  it("caches exactly what a fresh read of the written file returns", async () => {
    // The post-write cache reuses unchanged quests and round-trips only edited
    // ones through JSON; it must match a full re-read of the quest files,
    // including dropped undefined fields, order and derived relationships.
    await questStore.patchQuest("q-2", { title: "Second, renamed", description: "Now mentions q-1." });
    await questStore.createQuest({ title: "Third", description: "New quest." });
    const cached = await questStore.listQuests();
    expect(JSON.parse(JSON.stringify(cached))).toEqual(await freshRead());
    expect(cached.map((quest) => Object.keys(quest))).toEqual(
      (await freshRead()).map((quest) => Object.keys(quest as object)),
    );
  });

  it("reloads when another process rewrites the store", async () => {
    // The server's Codex quest worker writes quest files directly, so changed
    // files must win over the in-memory copy.
    expect((await questStore.getQuest("q-1"))?.title).toBe("First");
    writeLiveStore([{ questId: "q-1", title: "Replaced elsewhere", feedback: [] }]);
    expect((await questStore.getQuest("q-1"))?.title).toBe("Replaced elsewhere");
    expect(await questStore.getQuest("q-2")).toBeNull();
  });

  it("writes only the changed quest, as its own pretty-printed file", async () => {
    // A quest change must cost that quest's file, not the store: the other
    // quest's file is left exactly as it was (same inode and mtime).
    const dir = questStoreDir(companionDir());
    const untouched = statSync(join(dir, "q-2.json"), { bigint: true });
    await questStore.patchQuest("q-1", { title: "First, renamed" });
    const text = readFileSync(join(dir, "q-1.json"), "utf-8");
    const written = JSON.parse(text);
    expect(written.title).toBe("First, renamed");
    expect(text).toBe(`${JSON.stringify(written, null, 2)}\n`);
    const after = statSync(join(dir, "q-2.json"), { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([untouched.ino, untouched.mtimeNs]);
  });
});
