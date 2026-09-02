import { describe, expect, it } from "vitest";
import type { QuestDone, QuestInProgress } from "./quest-types.js";
import { buildTransitionedQuest } from "./quest-store-mutations.js";
import { normalizeLiveQuest } from "./quest-store-normalize.js";

const outcome = {
  currentRevisionId: "r1",
  revisions: [
    {
      revisionId: "r1",
      markdown: "Final outcome.",
      summaryMarkdown: "Final outcome.",
      summarySource: "derived" as const,
      contentHash: "hash",
      createdAt: 10,
      actor: { kind: "human" as const },
      sources: [],
    },
  ],
};

describe("Quest Outcome status transitions", () => {
  it("seals the exact current Outcome revision when a quest completes", () => {
    const active: QuestInProgress = {
      id: "q-1",
      questId: "q-1",
      version: 2,
      title: "Outcome",
      description: "Test",
      status: "in_progress",
      sessionId: "worker",
      claimedAt: 1,
      createdAt: 1,
      outcome,
    };
    const done = buildTransitionedQuest(
      active,
      {
        status: "done",
        verificationItems: [],
        debrief: "Final outcome.",
        debriefTldr: "Final outcome.",
      },
      { liveStore: true, now: 20 },
    );
    expect(done.outcome).toEqual({ ...outcome, finalizedRevisionId: "r1", finalizedAt: 20 });
    expect(done).toMatchObject({ debrief: "Final outcome.", debriefTldr: "Final outcome." });
  });

  it("rejects completion metadata that conflicts with the sealed Outcome", () => {
    const active: QuestInProgress = {
      id: "q-1",
      questId: "q-1",
      version: 2,
      title: "Outcome",
      description: "Test",
      status: "in_progress",
      sessionId: "worker",
      claimedAt: 1,
      createdAt: 1,
      outcome,
    };
    expect(() =>
      buildTransitionedQuest(
        active,
        {
          status: "done",
          verificationItems: [],
          debrief: "Different lifecycle debrief.",
          debriefTldr: "Different lifecycle TLDR.",
        },
        { liveStore: true, now: 20 },
      ),
    ).toThrow(/conflicts with the sealed Quest Outcome/);
  });

  it("repairs legacy debrief compatibility from the sealed Outcome", () => {
    const normalized = normalizeLiveQuest({
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Outcome",
      description: "Test",
      status: "done",
      completedAt: 20,
      createdAt: 1,
      verificationItems: [],
      debrief: "Stale debrief.",
      debriefTldr: "Stale TLDR.",
      outcome: { ...outcome, finalizedRevisionId: "r1", finalizedAt: 20 },
    });
    expect(normalized).toMatchObject({ debrief: "Final outcome.", debriefTldr: "Final outcome." });
  });

  it("does not promote a cancelled draft into a previous finalized Outcome", () => {
    const cancelled: QuestDone = {
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Outcome",
      description: "Test",
      status: "done",
      completedAt: 20,
      claimedAt: 1,
      createdAt: 1,
      verificationItems: [],
      cancelled: true,
      outcome,
    };
    const reopened = buildTransitionedQuest(
      cancelled,
      { status: "in_progress", sessionId: "worker" },
      { liveStore: true, now: 30 },
    );
    expect(reopened.outcome).toEqual(outcome);
  });

  it("marks the former final revision as Previous outcome on real reopen", () => {
    const done: QuestDone = {
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Outcome",
      description: "Test",
      status: "done",
      completedAt: 20,
      claimedAt: 1,
      createdAt: 1,
      verificationItems: [],
      debrief: "Final outcome.",
      debriefTldr: "Final outcome.",
      outcome: { ...outcome, finalizedRevisionId: "r1", finalizedAt: 20 },
    };
    const reopened = buildTransitionedQuest(
      done,
      { status: "in_progress", sessionId: "worker" },
      { liveStore: true, now: 30 },
    );
    expect(reopened.outcome).toMatchObject({
      currentRevisionId: "r1",
      previousFinalRevisionId: "r1",
      reopenedAt: 30,
    });
  });
});
