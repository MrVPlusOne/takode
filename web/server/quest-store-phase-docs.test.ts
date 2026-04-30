import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestFeedbackEntry, QuestJourneyRun } from "./quest-types.js";

let tempDir: string;
let questStore: typeof import("./quest-store.js");

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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-phase-doc-store-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function setupVerificationQuest(): Promise<void> {
  await questStore.createQuest({ title: "Feedback test" });
  await questStore.transitionQuest("q-1", { status: "refined", description: "Ready" });
  await questStore.claimQuest("q-1", "sess-1");
  await questStore.completeQuest("q-1", [
    { text: "Check A", checked: false },
    { text: "Check B", checked: false },
  ]);
}

describe("quest store phase documentation", () => {
  it("preserves scoped phase documentation metadata and Journey runs across transitions", async () => {
    await setupVerificationQuest();
    const entry: QuestFeedbackEntry = {
      author: "agent",
      kind: "phase_summary",
      text: "Summary: implemented phase docs",
      tldr: "Phase docs done",
      ts: Date.now(),
      journeyRunId: "run-1",
      phaseOccurrenceId: "run-1:p3",
      phaseId: "implement",
      phaseIndex: 2,
      phasePosition: 3,
      phaseOccurrence: 1,
    };
    const run: QuestJourneyRun = {
      runId: "run-1",
      source: "board",
      phaseIds: ["alignment", "explore", "implement"],
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      phaseOccurrences: [
        {
          occurrenceId: "run-1:p3",
          phaseId: "implement",
          phaseIndex: 2,
          phasePosition: 3,
          phaseOccurrence: 1,
          status: "active",
        },
      ],
    };

    await questStore.patchQuest("q-1", { feedback: [entry], journeyRuns: [run] });
    const result = await questStore.transitionQuest("q-1", { status: "in_progress", sessionId: "sess-1" });

    expect(result?.feedback?.[0]).toMatchObject({
      kind: "phase_summary",
      tldr: "Phase docs done",
      phaseId: "implement",
      phaseOccurrenceId: "run-1:p3",
    });
    expect(result?.journeyRuns?.[0]).toMatchObject({ runId: "run-1" });
  });
});
