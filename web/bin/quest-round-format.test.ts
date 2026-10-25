import { describe, expect, it } from "vitest";
import type { QuestFeedbackEntry, QuestmasterTask } from "../server/quest-types.js";
import { formatQuestDetail } from "./quest-format.js";

const HOUR = 3_600_000;

function workNote(runId: string, ts: number, tldr: string): QuestFeedbackEntry {
  return {
    author: "agent",
    kind: "phase_summary",
    text: `${tldr}, in full.`,
    tldr,
    ts,
    journeyRunId: runId,
    phaseId: "work",
  };
}

/** A quest reopened for a third round, with stored rounds. */
function reopenedQuest(): QuestmasterTask {
  const run = (runId: string, createdAt: number) => ({
    runId,
    source: "board" as const,
    phaseIds: ["work" as const],
    status: "completed" as const,
    createdAt,
    updatedAt: createdAt,
    phaseOccurrences: [],
  });
  return {
    id: "q-9",
    questId: "q-9",
    version: 5,
    title: "Library",
    status: "in_progress",
    description: "The Library and the decisions that still stand.",
    sessionId: "worker",
    claimedAt: 3 * HOUR,
    createdAt: 0,
    journeyRuns: [run("r1", 0.1 * HOUR), run("r2", 1.1 * HOUR), run("r3", 2.1 * HOUR)],
    rounds: [
      {
        openedAt: 0,
        title: "Artifact library",
        closedAt: HOUR,
        outcome: "Artifacts saved with versions.",
        outcomeTldr: "Artifacts.",
      },
      { openedAt: 1.05 * HOUR, title: "Topics", closedAt: 2 * HOUR, outcome: "Topic pages.", outcomeTldr: "Topics." },
      { openedAt: 2.05 * HOUR, title: "Stars in the gallery", brief: "Add stars to gallery cards.", requests: [2] },
    ],
    feedback: [
      workNote("r1", 0.5 * HOUR, "Artifact library built"),
      workNote("r2", 1.5 * HOUR, "Topics built"),
      { author: "human", text: "Can we star artifacts?", ts: 2.02 * HOUR },
      workNote("r3", 2.5 * HOUR, "Stars added to gallery cards"),
    ],
  } as QuestmasterTask;
}

describe("quest show for a reopened quest", () => {
  it("shows the open round in full and one line per earlier round instead of every phase note", () => {
    const output = formatQuestDetail(reopenedQuest(), new Map());
    expect(output).toContain("Round 3 (open since");
    expect(output).toContain("): Stars in the gallery");
    expect(output).toContain("    Add stars to gallery cards.");
    expect(output).toContain("  Requests:\n    #2 [human");
    expect(output).toContain("#3 [agent");
    expect(output).toContain("Earlier rounds (2; reveal one with --round <n>):");
    expect(output).toMatch(/ {3}2 {2}\w{3} \d+ +Topics/);
    // Earlier rounds' notes are left out of the default view.
    expect(output).not.toContain("Topics built");
    expect(output).not.toContain("Phase Documentation:");
    expect(output).toContain("One round:   quest show q-9 --round <n>");
  });

  it("shows one earlier round in full with --round", () => {
    const output = formatQuestDetail(reopenedQuest(), new Map(), { round: 2 });
    expect(output).toContain("Round 2 (");
    expect(output).toContain("): Topics");
    expect(output).toContain("Topics built");
    expect(output).toContain("  Outcome TLDR:\n    Topics.\n  Outcome:\n    Topic pages.");
    expect(output).not.toContain("Stars added");
    expect(formatQuestDetail(reopenedQuest(), new Map(), { round: 7 })).toContain(
      "Round 7: not found; q-9 has 3 round(s).",
    );
  });

  it("keeps the usual view for a quest that was never reopened", () => {
    const quest = { ...reopenedQuest(), rounds: [{ openedAt: 0 }], journeyRuns: [] } as QuestmasterTask;
    const output = formatQuestDetail(quest, new Map());
    expect(output).not.toContain("Earlier rounds");
    expect(output).toContain("Phase Documentation:");
  });
});
