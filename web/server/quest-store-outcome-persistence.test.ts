import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readQuestFixture, writeQuestStoreFixture } from "./test-fixtures/quest-store-fixture.js";

let tempDir: string;
let questStore: typeof import("./quest-store.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (value: string) => {
      dir = value;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir.get() };
});

function seedLiveStore(): void {
  writeQuestStoreFixture(join(tempDir, ".companion"), {
    nextQuestNumber: 3,
    quests: [
      {
        id: "q-1",
        questId: "q-1",
        version: 3,
        title: "Preserve legacy payload",
        description: "Keep opaque shipped data unchanged.",
        status: "in_progress",
        sessionId: "worker-1",
        claimedAt: 1,
        createdAt: 1,
        outcome: {
          futureSchema: 9,
          nested: ["human-authored", { retained: true }],
          finalizedRevisionId: "not-authority",
        },
      },
      {
        id: "q-2",
        questId: "q-2",
        version: 2,
        title: "Preserve null payload",
        description: "Keep explicit null presence unchanged.",
        status: "in_progress",
        sessionId: "worker-2",
        claimedAt: 1,
        createdAt: 1,
        outcome: null,
      },
    ],
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-outcome-persistence-"));
  mockHomedir.set(tempDir);
  seedLiveStore();
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("opaque legacy Quest Outcome persistence", () => {
  it("round-trips arbitrary and falsey payloads through durable status mutations", async () => {
    const originalObject = (await questStore.getQuest("q-1"))?.outcome;

    await questStore.completeQuest("q-1", [], {
      sessionId: "worker-1",
      debrief: "Trusted replacement debrief.",
      debriefTldr: "Trusted replacement summary.",
    });
    await questStore.transitionQuest("q-1", { status: "in_progress", sessionId: "worker-3" });
    await questStore.cancelQuest("q-2", "No longer needed.");

    vi.resetModules();
    questStore = await import("./quest-store.js");
    const reloadedObject = await questStore.getQuest("q-1");
    const reloadedNull = await questStore.getQuest("q-2");

    expect(reloadedObject?.outcome).toEqual(originalObject);
    expect(reloadedObject?.outcome).toEqual({
      futureSchema: 9,
      nested: ["human-authored", { retained: true }],
      finalizedRevisionId: "not-authority",
    });
    expect(Object.prototype.hasOwnProperty.call(reloadedNull, "outcome")).toBe(true);
    expect(reloadedNull?.outcome).toBeNull();
    expect(readQuestFixture(join(tempDir, ".companion"), "q-1")?.outcome).toEqual(originalObject);
    expect(readQuestFixture(join(tempDir, ".companion"), "q-2")).toHaveProperty("outcome", null);
  });
});
