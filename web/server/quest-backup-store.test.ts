import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readQuestFixture, writeQuestStoreFixture } from "./test-fixtures/quest-store-fixture.js";

let tempDir: string;
let questStore: typeof import("./quest-store.js");
let questBackups: typeof import("./quest-backup-store.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => {
      dir = d;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

function backupRoot(): string {
  return join(tempDir, ".companion", "questmaster-backups");
}

function writeLiveStoreFixture(title = "Original"): void {
  writeQuestStoreFixture(join(tempDir, ".companion"), {
    nextQuestNumber: 2,
    quests: [{ id: "q-1", questId: "q-1", version: 1, title, status: "idea", createdAt: 1, statusChangedAt: 1 }],
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-backup-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
  questBackups = await import("./quest-backup-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Questmaster local backups", () => {
  it("records a compact text journal and discoverable snapshot for live-store mutations", async () => {
    writeLiveStoreFixture();

    const updated = await questStore.patchQuest("q-1", { title: "Updated" });
    expect(updated?.title).toBe("Updated");

    const manifest = await questBackups.listQuestmasterBackups();
    expect(manifest.text.snapshots).toHaveLength(1);
    expect(manifest.text.journals).toHaveLength(1);
    expect(manifest.text.latestSnapshotId).toBe(manifest.text.snapshots[0]?.id);
    expect(existsSync(join(backupRoot(), manifest.restoreReadme))).toBe(true);

    const journalPath = join(backupRoot(), manifest.text.journals[0]!.relativePath);
    const journalRaw = await readFile(journalPath, "utf-8");
    const journalEntry = JSON.parse(journalRaw.trim()) as {
      kind: string;
      version: number;
      quests: Array<{ questId: string; set?: Record<string, unknown> }>;
    };
    expect(journalEntry).toMatchObject({ kind: "quest_text_mutation", version: 2 });
    expect(journalEntry.quests).toEqual([
      expect.objectContaining({ questId: "q-1", set: expect.objectContaining({ title: "Updated" }) }),
    ]);
  });

  it("journals only what changed, and replaying the records onto the snapshot rebuilds the quest", async () => {
    // Whole before/after copies made a note on a 10 MB quest write 20 MB of journal. A note is now recorded as
    // the appended entry, and the journal still restores the quest exactly.
    writeLiveStoreFixture();
    const bigNote = "evidence ".repeat(50_000);
    await questStore.appendQuestFeedback("q-1", { author: "agent", text: bigNote, ts: 1 });
    const manifest = await questBackups.listQuestmasterBackups();
    const snapshotPath = join(backupRoot(), manifest.text.snapshots[0]!.relativePath);
    await questBackups.restoreQuestSnapshotToFolder(snapshotPath, join(tempDir, "restored"));

    await questStore.appendQuestFeedback("q-1", { author: "agent", text: "second note", ts: 2 });
    await questStore.patchQuest("q-1", { title: "Retitled", tldr: "" });
    const journalPath = join(backupRoot(), manifest.text.journals[0]!.relativePath);
    const records = (await readFile(journalPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { quests: Record<string, unknown>[] });
    const lastTwo = records.slice(-2);
    expect(JSON.stringify(lastTwo).length).toBeLessThan(bigNote.length / 10);
    expect(lastTwo[0]!.quests[0]).toMatchObject({ appended: { feedback: [{ text: "second note" }] } });

    const quest = JSON.parse(await readFile(join(tempDir, "restored", "q-1.json"), "utf-8")) as Record<string, unknown>;
    for (const record of lastTwo) {
      const change = record.quests[0] as {
        set?: Record<string, unknown>;
        appended?: Record<string, unknown[]>;
        removed?: string[];
      };
      Object.assign(quest, change.set);
      for (const [key, items] of Object.entries(change.appended ?? {}))
        quest[key] = [...((quest[key] as unknown[]) ?? []), ...items];
      for (const key of change.removed ?? []) delete quest[key];
    }
    expect(quest).toEqual(readQuestFixture(join(tempDir, ".companion"), "q-1"));
  });

  it("keeps each quest version once and restores any retained snapshot exactly", async () => {
    // A snapshot of a large store must cost the quests that changed, not the store:
    // unchanged quests are shared between snapshots, and rotation deletes only
    // versions no retained snapshot names.
    const quest = (id: number, title: string) => ({
      id: `q-${id}`,
      questId: `q-${id}`,
      version: 1,
      title,
      status: "idea" as const,
      createdAt: id,
    });
    const store = (title: string) => ({
      format: "quest_per_file",
      version: 2,
      nextQuestNumber: 4,
      updatedAt: 1,
      quests: [quest(1, "Unchanged"), quest(2, title), quest(3, "Also unchanged")],
    });

    await questBackups.recordQuestStoreSnapshotBackup(store("A"), { reason: "test-1", maxSnapshots: 2 });
    const blobsAfterFirst = await readdir(join(backupRoot(), "text", "quest-blobs"));
    expect(blobsAfterFirst).toHaveLength(3);
    await questBackups.recordQuestStoreSnapshotBackup(store("B"), { reason: "test-2", maxSnapshots: 2 });
    // Only q-2 changed, so only its new version was written.
    expect(await readdir(join(backupRoot(), "text", "quest-blobs"))).toHaveLength(4);
    // An identical store is not snapshotted twice.
    const again = await questBackups.recordQuestStoreSnapshotBackup(store("B"), { reason: "dup", maxSnapshots: 2 });
    expect(again.reason).toBe("test-2");
    await questBackups.recordQuestStoreSnapshotBackup(store("C"), { reason: "test-3", maxSnapshots: 2 });

    const manifest = await questBackups.listQuestmasterBackups();
    expect(manifest.text.snapshots.map((entry) => entry.reason)).toEqual(["test-3", "test-2"]);
    expect(await readdir(join(backupRoot(), "text", "snapshots"))).toHaveLength(2);
    // q-2 "A" is no longer named by a retained snapshot and is gone; the rest stay.
    expect(await readdir(join(backupRoot(), "text", "quest-blobs"))).toHaveLength(4);

    for (const [entry, title] of [
      [manifest.text.snapshots[0]!, "C"],
      [manifest.text.snapshots[1]!, "B"],
    ] as const) {
      const out = join(tempDir, `restored-${title}`);
      expect(entry).toMatchObject({ format: "quest_index", questCount: 3, nextQuestNumber: 4 });
      expect(await questBackups.restoreQuestSnapshotToFolder(join(backupRoot(), entry.relativePath), out)).toBe(3);
      for (const expected of store(title).quests) {
        expect(await readFile(join(out, `${expected.questId}.json`), "utf-8")).toBe(
          `${JSON.stringify(expected, null, 2)}\n`,
        );
      }
      expect(JSON.parse(await readFile(join(out, "_meta.json"), "utf-8")).nextQuestNumber).toBe(4);
    }
  });

  it("restores an older whole-store snapshot into a quest folder", async () => {
    // Snapshots taken before quest-index snapshots stay usable until they rotate out.
    const path = join(backupRoot(), "text", "snapshots", "snapshot-old.json");
    const quests = [{ id: "q-5", questId: "q-5", version: 1, title: "Old", status: "idea", createdAt: 5 }];
    await mkdir(join(backupRoot(), "text", "snapshots"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        kind: "questmaster-text-snapshot",
        version: 1,
        createdAt: 1,
        store: { format: "mutable_current_record", version: 1, nextQuestNumber: 6, updatedAt: 1, quests },
      }),
    );
    const out = join(tempDir, "restored-old");
    expect(await questBackups.restoreQuestSnapshotToFolder(path, out)).toBe(1);
    expect(JSON.parse(await readFile(join(out, "q-5.json"), "utf-8"))).toEqual(quests[0]);
  });

  it("deduplicates quest image backups by content hash", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );

    await questStore.saveQuestImage("one.svg", svg, "image/svg+xml");
    await questStore.saveQuestImage("two.svg", svg, "image/svg+xml");

    const manifest = await questBackups.listQuestmasterBackups();
    expect(manifest.images.blobs).toHaveLength(1);
    expect(manifest.images.blobs[0]?.sourceFilenames).toEqual(["one.svg", "two.svg"]);
    const blobFiles = await readdir(join(backupRoot(), "images", "blobs"));
    expect(blobFiles).toHaveLength(1);
  });

  it("fails closed when a destructive Questmaster test reset is pointed outside a temp root", () => {
    expect(() => questBackups.assertSafeQuestmasterTestRoot("/Users/example/.companion")).toThrow(
      /Refusing to reset Questmaster data outside a verified temporary test root/,
    );
  });
});
