import { describe, expect, it } from "vitest";
import type { QuestFeedbackEntry, QuestJourneyRun, QuestmasterTask } from "../server/quest-types.js";
import type { QuestCodeDelivery } from "./quest-delivery.js";
import { buildQuestRounds, editQuestRound, reopenQuestRounds, roundTitle } from "./quest-rounds.js";

const MIN = 60_000;

function run(runId: string, createdAt: number, workEnd: number): QuestJourneyRun {
  return {
    runId,
    source: "board",
    phaseIds: ["work", "memory"],
    status: "active",
    createdAt,
    updatedAt: workEnd,
    phaseOccurrences: [
      {
        occurrenceId: `${runId}:p1`,
        phaseId: "work",
        phaseIndex: 0,
        phasePosition: 1,
        phaseOccurrence: 1,
        status: "completed",
        startedAt: createdAt,
        completedAt: workEnd,
      },
      {
        occurrenceId: `${runId}:p2`,
        phaseId: "memory",
        phaseIndex: 1,
        phasePosition: 2,
        phaseOccurrence: 1,
        status: "completed",
        startedAt: workEnd,
      },
    ],
  };
}

function note(runId: string, phaseId: "work" | "memory", ts: number, tldr: string): QuestFeedbackEntry {
  return {
    author: "agent",
    kind: "phase_summary",
    text: `${tldr} (full note)`,
    tldr,
    ts,
    journeyRunId: runId,
    phaseOccurrenceId: `${runId}:${phaseId === "work" ? "p1" : "p2"}`,
    phaseId,
  };
}

function human(text: string, ts: number): QuestFeedbackEntry {
  return { author: "human", text, ts };
}

function delivery(id: string, runId: string, recordedAt: number): QuestCodeDelivery {
  return {
    id,
    recordedAt,
    actorSessionId: "worker",
    phaseOccurrenceId: `${runId}:p1`,
    target: { repoRoot: "/repo", checkoutPath: "/repo", branch: "main", mode: "remote-backed" },
    targetHeadSha: "a".repeat(40),
    commits: [],
  } as unknown as QuestCodeDelivery;
}

/** A quest reopened twice before rounds existed: one board Journey run per reopening. */
function legacyQuest(): QuestmasterTask {
  return {
    id: "q-1",
    questId: "q-1",
    version: 9,
    title: "Library",
    status: "in_progress",
    description: "Build the Library in steps.",
    sessionId: "worker",
    claimedAt: 0,
    createdAt: 0,
    journeyRuns: [run("r1", 1 * MIN, 10 * MIN), run("r2", 30 * MIN, 40 * MIN), run("r3", 60 * MIN, 70 * MIN)],
    feedback: [
      note("r1", "work", 9 * MIN, "Artifact library with versions. Backfilled a month."),
      // Asked during round 1's Memory, after its Work ended: it asked for round 2.
      human("Now build topics.", 12 * MIN),
      note("r1", "memory", 14 * MIN, "Memory closed for the artifact library."),
      human("Pick option B.", 35 * MIN),
      note("r2", "work", 39 * MIN, "Topics and the page writer"),
      note("r3", "work", 69 * MIN, "Stars in the gallery"),
    ],
    codeDeliveries: [
      delivery("d1", "r1", 11 * MIN),
      // Landed through the landing queue after round 2 had already started.
      delivery("d2", "r2", 61 * MIN),
    ],
  } as QuestmasterTask;
}

describe("quest rounds", () => {
  it("derives one round per board Journey run for quests reopened before rounds existed", () => {
    const view = buildQuestRounds(legacyQuest());
    expect(view.rounds.map((round) => round.title)).toEqual([
      "Artifact library with versions",
      "Topics and the page writer",
      "Stars in the gallery",
    ]);
    const [first, second, third] = view.rounds;
    // A request made after a round's Work ended belongs to the next round, while
    // that round's own Memory note stays with it.
    expect(first!.feedbackIndices).toEqual([0, 2]);
    expect(second!.requestIndices).toEqual([1]);
    expect(second!.feedbackIndices).toEqual([1, 3, 4]);
    // A delivery follows the run of the Work that made it, even when it landed later.
    expect(first!.deliveryIds).toEqual(["d1"]);
    expect(second!.deliveryIds).toEqual(["d2"]);
    expect(third!.open).toBe(true);
    expect(first!.outcomeTldr).toBe("Artifact library with versions. Backfilled a month.");
  });

  it("treats a quest with one run as a single round named by the quest", () => {
    const quest = { ...legacyQuest(), journeyRuns: [run("r1", MIN, 10 * MIN)] } as QuestmasterTask;
    const view = buildQuestRounds(quest);
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]!.title).toBe("Library");
  });

  it("reopens a done quest: the debrief becomes the closing round's outcome and later feedback the next round's request", () => {
    const done = {
      ...legacyQuest(),
      status: "done",
      completedAt: 80 * MIN,
      debrief: "Stars and a Starred filter.",
      debriefTldr: "Stars in the gallery.",
      verificationItems: [],
      feedback: [...legacyQuest().feedback!, human("Next: per-leader Scribes.", 90 * MIN)],
    } as QuestmasterTask;
    // Before reopening, feedback after completion waits for the next round.
    expect(buildQuestRounds(done).pendingFeedbackIndices).toEqual([6]);

    const rounds = reopenQuestRounds(
      done,
      { title: "One Scribe per leader", brief: "Pair a Scribe.", requests: [6] },
      100 * MIN,
    );
    expect(rounds).toHaveLength(4);
    expect(rounds[2]).toMatchObject({
      closedAt: 80 * MIN,
      outcome: "Stars and a Starred filter.",
      outcomeTldr: "Stars in the gallery.",
      derived: true,
    });
    expect(rounds[3]).toEqual({
      openedAt: 100 * MIN,
      title: "One Scribe per leader",
      brief: "Pair a Scribe.",
      requests: [6],
    });

    const reopened = { ...done, status: "refined", rounds } as QuestmasterTask;
    const view = buildQuestRounds(reopened);
    expect(view.rounds[3]).toMatchObject({ number: 4, open: true, requestIndices: [6], brief: "Pair a Scribe." });
    expect(view.rounds[2]!.outcome).toBe("Stars and a Starred filter.");
    expect(view.pendingFeedbackIndices).toEqual([]);
  });

  it("rejects a reopening without a title or with a request that is not a feedback entry", () => {
    expect(() => reopenQuestRounds(legacyQuest(), { title: "  " }, 100 * MIN)).toThrow("needs a title");
    expect(() => reopenQuestRounds(legacyQuest(), { title: "Next", requests: [42] }, 100 * MIN)).toThrow("Request #42");
  });

  it("edits a round's title and brief, recording derived rounds first", () => {
    const rounds = editQuestRound(legacyQuest(), { number: 2, title: "Topics", brief: "Topics, opt-in per leader." });
    expect(rounds).toHaveLength(3);
    expect(rounds[1]).toMatchObject({ title: "Topics", brief: "Topics, opt-in per leader.", derived: true });
    expect(() => editQuestRound(legacyQuest(), { number: 4, title: "x" })).toThrow("Round 4 does not exist");
  });

  it("names derived rounds from the first meaningful line of a Work note", () => {
    expect(roundTitle("- **Outcome:** Takode now saves drafts. More detail follows.")).toBe("Takode now saves drafts");
    expect(roundTitle("#2957's new pages are good")).toBe("#2957's new pages are good");
    expect(roundTitle("## Outcome\nScribes run as continuous workers")).toBe("Scribes run as continuous workers");
    expect(roundTitle("x".repeat(30) + " " + "y".repeat(80))!.endsWith("…")).toBe(true);
  });
});
