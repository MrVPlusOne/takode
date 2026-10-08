import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;
let questStore: typeof import("./quest-store.js");
let cachedJsonFile: typeof import("./cached-json-file.js");

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
  cachedJsonFile = await import("./cached-json-file.js");
  mkdirSync(join(tempDir, ".companion", "questmaster-live"), { recursive: true });
  writeLiveStore([
    { questId: "q-1", title: "First", description: "Follow-up of q-2.", feedback: [] },
    { questId: "q-2", title: "Second", feedback: [{ author: "agent", text: "Summary: done", ts: 5 }] },
  ]);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function liveStorePath(): string {
  return join(tempDir, ".companion", "questmaster-live", "store.json");
}

function writeLiveStore(quests: Record<string, unknown>[]): void {
  const store = {
    format: "mutable_current_record",
    version: 1,
    nextQuestNumber: quests.length + 1,
    updatedAt: 1,
    quests: quests.map((quest, index) => ({
      id: quest.questId,
      version: 1,
      createdAt: 1_000 + index,
      status: "idea",
      ...quest,
    })),
  };
  writeFileSync(liveStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

/** What a process with no cache would read: the store parsed fresh from disk. */
async function freshRead(): Promise<unknown[]> {
  cachedJsonFile._clearCachedJsonFilesForTests();
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
    // ones through JSON; it must match a full re-parse, including dropped
    // undefined fields and derived relationships.
    await questStore.patchQuest("q-2", { title: "Second, renamed", description: "Now mentions q-1." });
    await questStore.createQuest({ title: "Third", description: "New quest." });
    const cached = await questStore.listQuests();
    expect(JSON.parse(JSON.stringify(cached))).toEqual(await freshRead());
    expect(cached.map((quest) => Object.keys(quest))).toEqual(
      (await freshRead()).map((quest) => Object.keys(quest as object)),
    );
  });

  it("reloads when another process replaces the store file", async () => {
    // The server's Codex quest worker writes the store directly, so a changed
    // file must win over the in-memory copy.
    expect((await questStore.getQuest("q-1"))?.title).toBe("First");
    writeLiveStore([{ questId: "q-1", title: "Replaced elsewhere", feedback: [] }]);
    expect((await questStore.getQuest("q-1"))?.title).toBe("Replaced elsewhere");
    expect(await questStore.getQuest("q-2")).toBeNull();
  });

  it("keeps the written file unchanged in format", async () => {
    await questStore.patchQuest("q-1", { title: "First, renamed" });
    const written = JSON.parse(readFileSync(liveStorePath(), "utf-8"));
    expect(Object.keys(written)).toEqual(["format", "version", "quests", "nextQuestNumber", "updatedAt"]);
    expect(readFileSync(liveStorePath(), "utf-8")).toBe(JSON.stringify(written, null, 2));
  });
});
