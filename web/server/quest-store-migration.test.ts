// Moving quest data between layouts: proof that what was written is what was
// read, refusal to switch over when it is not, and the way back to one file.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;
let migration: typeof import("./quest-store-migration.js");

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-store-migration-test-"));
  vi.resetModules();
  migration = await import("./quest-store-migration.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const QUESTS = [
  { id: "q-3", questId: "q-3", version: 2, title: "Newer — ✓", status: "idea", createdAt: 30, statusChangedAt: 40 },
  { id: "q-1", questId: "q-1", version: 1, title: "Older", status: "idea", createdAt: 10, statusChangedAt: 10 },
];

describe("activateQuestDir", () => {
  it("does not switch over when a quest reads back differently than it was given", async () => {
    // A record whose serialization changes between writing and checking stands in
    // for any corruption between the two; the folder must never appear.
    let reads = 0;
    const unstable = {
      questId: "q-1",
      get title() {
        reads++;
        return `title ${reads}`;
      },
    };
    const questsDir = join(tempDir, "quests");

    await expect(migration.activateQuestDir(questsDir, { nextQuestNumber: 2, quests: [unstable] })).rejects.toThrow(
      "q-1 differs",
    );
    expect(existsSync(questsDir)).toBe(false);
    expect(readdirSync(tempDir)).toEqual([]);
  });

  it("refuses a store that holds one quest twice", async () => {
    await expect(
      migration.activateQuestDir(join(tempDir, "quests"), { nextQuestNumber: 4, quests: [QUESTS[0]!, QUESTS[0]!] }),
    ).rejects.toThrow("holds q-3 twice");
    expect(readdirSync(tempDir)).toEqual([]);
  });
});

describe("writeVerifiedQuestStoreBackup", () => {
  it("saves the exact bytes and never overwrites an earlier backup", async () => {
    const bytes = Buffer.from('{"quests":[{"title":"café"}]}');
    const path = await migration.writeVerifiedQuestStoreBackup(tempDir, "store-before-test", bytes);
    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(path.startsWith(join(tempDir, "migrations", "store-before-test-"))).toBe(true);
  });
});

describe("exportQuestDirToSingleFile", () => {
  it("rebuilds a single-file store that migrates back to the same quests", async () => {
    // The rollback path: export, then an older build (or the next migration)
    // reads exactly the quests the folder held.
    const storeFile = join(tempDir, "store.json");
    writeFileSync(
      storeFile,
      JSON.stringify({
        format: "mutable_current_record",
        version: 1,
        quests: QUESTS,
        nextQuestNumber: 9,
        updatedAt: 1,
      }),
    );
    await migration.migrateSingleFileQuestStore({
      storeFile,
      questsDir: join(tempDir, "quests"),
      backupsDir: join(tempDir, "backups"),
    });

    const exported = join(tempDir, "exported.json");
    expect(await migration.exportQuestDirToSingleFile(join(tempDir, "quests"), exported)).toBe(2);
    const single = JSON.parse(readFileSync(exported, "utf-8"));
    expect(Object.keys(single)).toEqual(["format", "version", "quests", "nextQuestNumber", "updatedAt"]);
    expect(single).toMatchObject({ format: "mutable_current_record", version: 1, nextQuestNumber: 9 });
    expect(single.quests).toEqual(QUESTS);
    await expect(migration.exportQuestDirToSingleFile(join(tempDir, "quests"), exported)).rejects.toThrow(
      "already exists",
    );

    await migration.migrateSingleFileQuestStore({
      storeFile: exported,
      questsDir: join(tempDir, "quests-again"),
      backupsDir: join(tempDir, "backups"),
    });
    for (const quest of QUESTS) {
      expect(readFileSync(join(tempDir, "quests-again", `${quest.questId}.json`), "utf-8")).toBe(
        readFileSync(join(tempDir, "quests", `${quest.questId}.json`), "utf-8"),
      );
    }
  });
});

describe("rollBackQuestDirToSingleFile", () => {
  it("writes store.json from the quest files and moves the folder aside", async () => {
    const liveDir = join(tempDir, "questmaster-live");
    const storeFile = join(liveDir, "store.json");
    writeFileSync(
      join(tempDir, "seed.json"),
      JSON.stringify({
        format: "mutable_current_record",
        version: 1,
        quests: QUESTS,
        nextQuestNumber: 4,
        updatedAt: 1,
      }),
    );
    await migration.migrateSingleFileQuestStore({
      storeFile: join(tempDir, "seed.json"),
      questsDir: join(liveDir, "quests"),
      backupsDir: join(tempDir, "backups"),
    });

    const { movedFolder } = await migration.rollBackQuestDirToSingleFile(liveDir);

    expect(JSON.parse(readFileSync(storeFile, "utf-8")).quests).toEqual(QUESTS);
    expect(existsSync(join(liveDir, "quests"))).toBe(false);
    expect(readdirSync(movedFolder).sort()).toEqual(["_meta.json", "q-1.json", "q-3.json"]);
  });
});
