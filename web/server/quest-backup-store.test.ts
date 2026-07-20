import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

function liveStoreDir(): string {
  return join(tempDir, ".companion", "questmaster-live");
}

function liveStorePath(): string {
  return join(liveStoreDir(), "store.json");
}

function backupRoot(): string {
  return join(tempDir, ".companion", "questmaster-backups");
}

function writeLiveStoreFixture(title = "Original"): void {
  mkdirSync(liveStoreDir(), { recursive: true });
  writeFileSync(
    liveStorePath(),
    JSON.stringify(
      {
        format: "mutable_current_record",
        version: 1,
        nextQuestNumber: 2,
        updatedAt: 1,
        quests: [
          {
            id: "q-1",
            questId: "q-1",
            version: 1,
            title,
            status: "idea",
            createdAt: 1,
            statusChangedAt: 1,
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
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
      quests: Array<{ questId: string; before: { title: string }; after: { title: string } }>;
    };
    expect(journalEntry.kind).toBe("quest_text_mutation");
    expect(journalEntry.quests).toEqual([
      expect.objectContaining({
        questId: "q-1",
        before: expect.objectContaining({ title: "Original" }),
        after: expect.objectContaining({ title: "Updated" }),
      }),
    ]);
  });

  it("retains only the configured number of full text snapshots", async () => {
    const baseStore = {
      format: "mutable_current_record" as const,
      version: 1,
      nextQuestNumber: 2,
      updatedAt: 1,
      quests: [
        {
          id: "q-1",
          questId: "q-1",
          version: 1,
          title: "A",
          status: "idea" as const,
          createdAt: 1,
        },
      ],
    };

    await questBackups.recordQuestStoreSnapshotBackup(baseStore, { reason: "test-1", maxSnapshots: 2 });
    await questBackups.recordQuestStoreSnapshotBackup(
      { ...baseStore, updatedAt: 2, quests: [{ ...baseStore.quests[0], title: "B" }] },
      { reason: "test-2", maxSnapshots: 2 },
    );
    await questBackups.recordQuestStoreSnapshotBackup(
      { ...baseStore, updatedAt: 3, quests: [{ ...baseStore.quests[0], title: "C" }] },
      { reason: "test-3", maxSnapshots: 2 },
    );

    const manifest = await questBackups.listQuestmasterBackups();
    expect(manifest.text.snapshots).toHaveLength(2);
    expect(manifest.text.snapshots.map((entry) => entry.reason)).toEqual(["test-3", "test-2"]);
    const files = await readdir(join(backupRoot(), "text", "snapshots"));
    expect(files).toHaveLength(2);
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
