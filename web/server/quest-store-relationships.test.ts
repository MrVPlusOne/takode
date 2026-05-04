import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let questStore: typeof import("./quest-store.js");

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
  tempDir = mkdtempSync(join(tmpdir(), "quest-relationships-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quest store relationships", () => {
  it("persists explicit follow-up relationships and derives backlinks on read", async () => {
    // Covers the persisted store path plus the read-time backlink enrichment used by CLI/API consumers.
    const earlier = await questStore.createQuest({ title: "Original" });
    const followUp = await questStore.createQuest({
      title: "Follow-up",
      relationships: { followUpOf: [earlier.questId] },
    });

    expect(followUp.relationships).toEqual({ followUpOf: [earlier.questId] });

    const storedEarlier = await questStore.getQuest(earlier.questId);
    const storedFollowUp = await questStore.getQuest(followUp.questId);

    expect(storedEarlier?.relatedQuests).toEqual([
      { questId: followUp.questId, kind: "has_follow_up", explicit: true },
    ]);
    expect(storedFollowUp?.relatedQuests).toEqual([{ questId: earlier.questId, kind: "follow_up_of", explicit: true }]);
  });

  it("updates follow-up relationships through patchQuest", async () => {
    // Ensures same-stage edits can add or replace explicit relationships without a status transition.
    const earlier = await questStore.createQuest({ title: "Original" });
    const followUp = await questStore.createQuest({ title: "Follow-up" });

    await questStore.patchQuest(followUp.questId, { relationships: { followUpOf: [earlier.questId] } });

    expect((await questStore.getQuest(earlier.questId))?.relatedQuests).toEqual([
      { questId: followUp.questId, kind: "has_follow_up", explicit: true },
    ]);
  });
});
