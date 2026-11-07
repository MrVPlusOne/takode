// The quest folder store: one file per quest, written alone, numbered safely,
// and reloaded when another process changes it.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestmasterTask } from "./quest-types.js";
import type { QuestDirState } from "./quest-store-dir.js";

let tempDir: string;
let dir: string;
let questDir: typeof import("./quest-store-dir.js");

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-store-dir-test-"));
  dir = join(tempDir, "quests");
  vi.resetModules();
  questDir = await import("./quest-store-dir.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

function quest(number: number, extra: Record<string, unknown> = {}): QuestmasterTask {
  return {
    id: `q-${number}`,
    questId: `q-${number}`,
    version: 1,
    title: `Quest ${number}`,
    status: "idea",
    createdAt: 1_000 + number,
    statusChangedAt: 1_000 + number,
    ...extra,
  } as QuestmasterTask;
}

async function seed(quests: QuestmasterTask[], nextQuestNumber = quests.length + 1): Promise<QuestDirState> {
  await questDir.writeNewQuestDir(dir, { nextQuestNumber, quests });
  return (await questDir.readQuestDir(dir))!;
}

/** Another process: a fresh module instance with its own cache. */
async function otherProcess(): Promise<typeof import("./quest-store-dir.js")> {
  vi.resetModules();
  return import("./quest-store-dir.js");
}

describe("quest folder store", () => {
  it("returns null when the folder does not exist", async () => {
    expect(await questDir.readQuestDir(dir)).toBeNull();
  });

  it("writes only changed quests and keeps unchanged ones as the same objects", async () => {
    const before = await seed([quest(1), quest(2)]);
    const untouched = statSync(join(dir, "q-1.json"), { bigint: true });
    const q2 = before.quests.find((entry) => entry.questId === "q-2")!;
    const after = await questDir.writeQuestDirChanges(dir, before, {
      ...before,
      quests: [before.quests.find((entry) => entry.questId === "q-1")!, { ...q2, title: "Renamed", updatedAt: 5_000 }],
    });

    expect(JSON.parse(readFileSync(join(dir, "q-2.json"), "utf-8")).title).toBe("Renamed");
    const q1Stat = statSync(join(dir, "q-1.json"), { bigint: true });
    expect([q1Stat.ino, q1Stat.mtimeNs]).toEqual([untouched.ino, untouched.mtimeNs]);
    // Newest first; the read after the write is the cached state itself.
    expect(after.quests.map((entry) => entry.questId)).toEqual(["q-2", "q-1"]);
    expect(await questDir.readQuestDir(dir)).toBe(after);
    expect(after.quests[1]).toBe(before.quests.find((entry) => entry.questId === "q-1"));
    // No temp files are left behind.
    expect(readdirSync(dir).sort()).toEqual(["_meta.json", "q-1.json", "q-2.json"]);
  });

  it("never hands out a deleted quest's number again, also after a reload", async () => {
    const before = await seed([quest(1), quest(2), quest(3)]);
    const after = await questDir.writeQuestDirChanges(dir, before, {
      ...before,
      quests: before.quests.filter((entry) => entry.questId !== "q-3"),
    });
    expect(readdirSync(dir)).not.toContain("q-3.json");
    expect(after.nextQuestNumber).toBe(4);
    const fresh = await (await otherProcess()).readQuestDir(dir);
    expect(fresh?.nextQuestNumber).toBe(4);
  });

  it("counts quest files the meta file has not caught up with, as after a crash mid-create", async () => {
    // A create writes the quest file before the meta file; a crash in between
    // must not let the next create reuse that number.
    await seed([quest(1)]);
    writeFileSync(join(dir, "q-5.json"), JSON.stringify(quest(5), null, 2));
    const state = await (await otherProcess()).readQuestDir(dir);
    expect(state?.nextQuestNumber).toBe(6);
    expect(state?.quests.map((entry) => entry.questId)).toEqual(["q-5", "q-1"]);
  });

  it("sees another process's writes and re-reads only the files that changed", async () => {
    const mine = await seed([quest(1), quest(2)]);
    const other = await otherProcess();
    const theirs = (await other.readQuestDir(dir))!;
    const q1 = theirs.quests.find((entry) => entry.questId === "q-1")!;
    await other.writeQuestDirChanges(dir, theirs, {
      ...theirs,
      quests: [...theirs.quests.filter((entry) => entry !== q1), { ...q1, title: "Changed elsewhere" }],
    });

    const reread = (await questDir.readQuestDir(dir))!;
    expect(reread).not.toBe(mine);
    expect(reread.quests.find((entry) => entry.questId === "q-1")?.title).toBe("Changed elsewhere");
    // q-2's file did not change, so its object is reused rather than parsed again.
    expect(reread.quests.find((entry) => entry.questId === "q-2")).toBe(
      mine.quests.find((entry) => entry.questId === "q-2"),
    );
  });

  it("leaves an unreadable quest file untouched, reads the rest and keeps its number taken", async () => {
    // One damaged file must not take the whole store down or let its number be reused.
    await seed([quest(1), quest(2)]);
    writeFileSync(join(dir, "q-3.json"), "{damaged");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await (await otherProcess()).readQuestDir(dir);

    expect(state?.quests.map((entry) => entry.questId).sort()).toEqual(["q-1", "q-2"]);
    expect(state?.nextQuestNumber).toBe(4);
    expect(readFileSync(join(dir, "q-3.json"), "utf-8")).toBe("{damaged");
    expect(errors.mock.calls.flat().join(" ")).toContain("q-3.json");
  });

  it("removes old temp files left by an interrupted write but keeps fresh ones", async () => {
    // A young temp file may belong to a writer about to rename it into place.
    await seed([quest(1)]);
    const old = join(dir, ".q-1.json.123.abc.tmp");
    const fresh = join(dir, ".q-1.json.456.def.tmp");
    writeFileSync(old, "partial");
    writeFileSync(fresh, "partial");
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(old, hourAgo, hourAgo);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await (await otherProcess()).readQuestDir(dir);

    expect(readdirSync(dir)).not.toContain(".q-1.json.123.abc.tmp");
    expect(readdirSync(dir)).toContain(".q-1.json.456.def.tmp");
  });

  it("writes a new store exactly as given, without normalizing", async () => {
    // A migration proves its files hold the very records it read.
    const raw = { questId: "q-1", title: "Partial legacy record", extra: { kept: [1, null] } };
    await questDir.writeNewQuestDir(dir, { nextQuestNumber: 9, quests: [raw], legacyBackupDir: "/old/legacy" });
    expect(readFileSync(join(dir, "q-1.json"), "utf-8")).toBe(`${JSON.stringify(raw, null, 2)}\n`);
    const { meta, quests } = await questDir.readQuestDirRaw(dir);
    expect(meta).toEqual({ format: "quest_per_file", version: 2, nextQuestNumber: 9, legacyBackupDir: "/old/legacy" });
    expect(quests.get("q-1")).toEqual(raw);
    await expect(questDir.writeNewQuestDir(dir, { nextQuestNumber: 1, quests: [] })).rejects.toThrow();
  });

  it("orders equal recency by quest number, newest first", () => {
    const sorted = questDir.sortQuestsByRecency([
      quest(1, { createdAt: 5, statusChangedAt: 5 }),
      quest(3, { createdAt: 5, statusChangedAt: 5 }),
      quest(2),
    ]);
    expect(sorted.map((entry) => entry.questId)).toEqual(["q-2", "q-3", "q-1"]);
  });
});
