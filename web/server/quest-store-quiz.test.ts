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
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-quiz-store-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quest quiz store metadata", () => {
  it("persists normalized quiz items and allows clearing them", async () => {
    // Exercises the same same-stage patch path used by `quest quiz set|clear`.
    await questStore.createQuest({ title: "Quiz carrier" });
    const patched = await questStore.patchQuest("q-1", {
      quizItems: [
        { id: "decision", question: "  Recall what?  ", answer: "  The key decision.  ", source: "  Implement  " },
      ],
    });

    expect(patched?.quizItems).toEqual([
      { id: "decision", question: "Recall what?", answer: "The key decision.", source: "Implement" },
    ]);

    vi.resetModules();
    questStore = await import("./quest-store.js");
    expect((await questStore.getQuest("q-1"))?.quizItems?.[0]?.answer).toBe("The key decision.");

    const cleared = await questStore.patchQuest("q-1", { quizItems: [] });
    expect(cleared?.quizItems).toBeUndefined();
  });

  it("carries quiz items across quest lifecycle transitions", async () => {
    // Guards final Memory-created quiz metadata from being dropped when the quest advances.
    await questStore.createQuest({
      title: "Lifecycle quiz",
      quizItems: [{ id: "decision", question: "What changed?", answer: "Quiz metadata is preserved." }],
    });

    const refined = await questStore.transitionQuest("q-1", { status: "refined", description: "Ready" });
    expect(refined?.quizItems?.[0]?.id).toBe("decision");

    const claimed = await questStore.claimQuest("q-1", "worker-quiz");
    expect(claimed?.quizItems?.[0]?.answer).toBe("Quiz metadata is preserved.");
  });
});
