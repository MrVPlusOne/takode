import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { QuestDone } from "./quest-types.js";

let tempDir: string;
let questStore: typeof import("./quest-store.js");
let migration: typeof import("./quest-machine-stamps.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => {
      dir = d;
    },
  };
});

// The migration bulk-edits the quest store, so every path resolves into a temp HOME.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir.get() };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-machine-stamps-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
  migration = await import("./quest-machine-stamps.js");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("stampQuestMachines", () => {
  // Existing notes get the machine their author session ran on (or this
  // coordinator's), browser-written notes stay unstamped like new ones, and
  // debriefs get the coordinator's machine. The store before the migration is
  // kept in a backup the marker names, and the migration runs only once.
  it("stamps existing notes and debriefs once, after a verified backup", async () => {
    await questStore.createQuest({ title: "Done quest", description: "Ready", status: "refined" });
    await questStore.claimQuest("q-1", "worker-1");
    await questStore.completeQuest("q-1", [], { debrief: "Outcome.", debriefTldr: "TLDR." });
    await questStore.createQuest({ title: "Notes", description: "Ready", status: "refined" });
    await questStore.patchQuest("q-2", {
      feedback: [
        { author: "agent", text: "Local worker note", ts: 1, authorSessionId: "local-session" },
        { author: "agent", text: "Remote worker note", ts: 2, authorSessionId: "remote-session" },
        { author: "agent", text: "Old agent note without a session", ts: 3 },
        { author: "human", text: "Typed in the browser", ts: 4 },
        { author: "human", text: "Relayed by an agent", ts: 5, authorSessionId: "local-session" },
        { author: "agent", text: "", ts: 6, deletedAt: 7 },
        { author: "agent", text: "Already stamped", ts: 8, authorSessionId: "remote-session", machine: "gpu-box" },
      ],
    });
    // Production servers run on the live store; move the per-file quests into it.
    await questStore.bootstrapQuestStore();
    const storePath = join(tempDir, ".companion", "questmaster-live", "store.json");
    const before = JSON.parse(await readFile(storePath, "utf-8"));

    const result = await migration.stampQuestMachines({
      coordinatorMachine: "laptop",
      machineForSession: (sessionId) => ({ "local-session": "laptop", "remote-session": "devbox" })[sessionId],
    });

    expect(result).toMatchObject({ stampedEntries: 4, stampedDebriefs: 1 });
    expect((await questStore.getQuest("q-1")) as QuestDone).toMatchObject({ debriefMachine: "laptop" });
    const machines = (await questStore.getQuest("q-2"))?.feedback?.map((entry) => entry.machine);
    expect(machines).toEqual(["laptop", "devbox", "laptop", undefined, "laptop", undefined, "gpu-box"]);

    // The backup is the store as it was, and the marker says where it is.
    expect(JSON.parse(await readFile(result!.backupFile, "utf-8")).quests).toEqual(before.quests);
    const marker = JSON.parse(
      await readFile(join(tempDir, ".companion", "questmaster-live", "machine-stamps.json"), "utf-8"),
    );
    expect(marker).toMatchObject({ coordinatorMachine: "laptop", backupFile: result!.backupFile });

    // Once only: notes added later without a stamp are not stamped by a rerun.
    await questStore.patchQuest("q-2", {
      feedback: [...((await questStore.getQuest("q-2"))?.feedback ?? []), { author: "agent", text: "Later", ts: 9 }],
    });
    expect(await migration.stampQuestMachines({ coordinatorMachine: "other" })).toBeNull();
    expect((await questStore.getQuest("q-2"))?.feedback?.at(-1)?.machine).toBeUndefined();
  });

  it("marks an empty store as migrated without a backup", async () => {
    expect(await migration.stampQuestMachines({ coordinatorMachine: "laptop" })).toBeNull();
    const marker = JSON.parse(
      await readFile(join(tempDir, ".companion", "questmaster-live", "machine-stamps.json"), "utf-8"),
    );
    expect(marker.backupFile).toBeUndefined();
  });
});

describe("debrief machine", () => {
  // The stamp belongs to the debrief text: it stays while the text does and
  // goes when another write replaces the text without a machine.
  it("keeps a debrief's machine with its text", async () => {
    await questStore.createQuest({ title: "Quest", description: "Ready", status: "refined" });
    await questStore.claimQuest("q-1", "worker-1");
    await questStore.completeQuest("q-1", [], { debrief: "Outcome.", debriefTldr: "TLDR.", debriefMachine: "devbox" });
    expect((await questStore.getQuest("q-1")) as QuestDone).toMatchObject({ debriefMachine: "devbox" });

    await questStore.transitionQuest("q-1", { status: "done", notes: "More notes" });
    expect((await questStore.getQuest("q-1")) as QuestDone).toMatchObject({ debriefMachine: "devbox" });

    await questStore.transitionQuest("q-1", { status: "done", debrief: "Rewritten in the browser." });
    expect(((await questStore.getQuest("q-1")) as QuestDone).debriefMachine).toBeUndefined();
  });
});
