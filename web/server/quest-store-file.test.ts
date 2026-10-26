import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deepFreeze } from "./cached-json-file.js";
import { questStoreFileChunks, replaceFileWithChunks } from "./quest-store-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "quest-store-file-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function quest(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: `q-${index}`,
    questId: `q-${index}`,
    title: `Quest ${index} — café ✓`,
    description: 'Line one\nline two with "quotes" and a tab\t',
    feedback: [{ text: "nested", images: [] }],
    empty: {},
    ...extra,
  };
}

function store(quests: object[]) {
  return { format: "mutable_current_record", version: 1, quests, nextQuestNumber: quests.length + 1, updatedAt: 5 };
}

describe("questStoreFileChunks", () => {
  it("produces exactly the bytes of a pretty whole-store stringify", () => {
    // The live store file keeps its existing format: readers and backups must see
    // the same bytes a whole-store JSON.stringify(store, null, 2) wrote, including
    // escaped newlines inside strings, non-ASCII text and empty containers.
    for (const quests of [[], [quest(1)], [quest(1), quest(2, { nested: { list: [1, [2, {}]] } }), quest(3)]]) {
      const value = store(quests);
      expect(Buffer.concat(questStoreFileChunks(value)).toString("utf-8")).toBe(JSON.stringify(value, null, 2));
    }
  });

  it("reuses cached bytes for frozen quests and reserializes mutable ones", () => {
    // Unchanged quests are frozen objects shared with the previous read, so their
    // bytes can be reused; a mutable quest may still change and must be read afresh.
    const frozen = deepFreeze(quest(1));
    const mutable = quest(2);
    const first = questStoreFileChunks(store([frozen, mutable]));
    mutable.title = "Renamed";
    const second = questStoreFileChunks(store([frozen, mutable]));

    expect(second[1]).toBe(first[1]);
    expect(Buffer.concat(second).toString("utf-8")).toBe(JSON.stringify(store([frozen, mutable]), null, 2));
  });
});

describe("replaceFileWithChunks", () => {
  it("writes every chunk in order, across several write batches, and leaves no temp file", async () => {
    // Batches stay under the kernel's iovec limit, so a store of thousands of
    // quests is written in several writev calls.
    const value = store(Array.from({ length: 1500 }, (_, index) => quest(index)));
    const path = join(dir, "store.json");

    await replaceFileWithChunks(path, questStoreFileChunks(value));

    expect(await readFile(path, "utf-8")).toBe(JSON.stringify(value, null, 2));
    expect(await readdir(dir)).toEqual(["store.json"]);
  });
});
