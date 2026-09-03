import { describe, expect, it } from "vitest";
import type { QuestDone, QuestInProgress } from "./quest-types.js";
import { buildCancelledQuest, buildTransitionedQuest } from "./quest-store-mutations.js";
import { normalizeLiveQuest } from "./quest-store-normalize.js";

const legacyOutcome = {
  currentRevisionId: "legacy-r1",
  revisions: [
    {
      revisionId: "legacy-r1",
      markdown: "Human-authored legacy document.",
      actor: { kind: "human" },
      futureField: { preserve: [1, 2, 3] },
    },
  ],
  unknownTopLevel: { nested: true },
};

function active(outcome: unknown = legacyOutcome): QuestInProgress {
  return {
    id: "q-1",
    questId: "q-1",
    version: 2,
    title: "Legacy outcome",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    outcome,
  };
}

describe("legacy Quest Outcome status compatibility", () => {
  it("preserves opaque legacy data unchanged when a quest completes", () => {
    const done = buildTransitionedQuest(
      active(),
      {
        status: "done",
        verificationItems: [],
        debrief: "Corrected leader-thread result.",
        debriefTldr: "Corrected summary.",
      },
      { liveStore: true, now: 20 },
    );

    expect(done.outcome).toBe(legacyOutcome);
    expect(done).toMatchObject({
      debrief: "Corrected leader-thread result.",
      debriefTldr: "Corrected summary.",
    });
    expect(done.outcome).not.toHaveProperty("finalizedRevisionId");
  });

  it("lets debrief metadata remain independent from rejected legacy content", () => {
    const done = buildTransitionedQuest(
      active(),
      {
        status: "done",
        verificationItems: [],
        debrief: "Different authoritative debrief.",
        debriefTldr: "Different authoritative TLDR.",
      },
      { liveStore: true, now: 20 },
    );

    expect(done).toMatchObject({
      debrief: "Different authoritative debrief.",
      debriefTldr: "Different authoritative TLDR.",
      outcome: legacyOutcome,
    });
  });

  it("does not normalize unknown fields or overwrite debriefs from legacy state", () => {
    const normalized = normalizeLiveQuest({
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Legacy outcome",
      description: "Test",
      status: "done",
      completedAt: 20,
      createdAt: 1,
      verificationItems: [],
      debrief: "Trusted debrief.",
      debriefTldr: "Trusted TLDR.",
      outcome: legacyOutcome,
    });

    expect(normalized.outcome).toBe(legacyOutcome);
    expect(normalized).toMatchObject({ debrief: "Trusted debrief.", debriefTldr: "Trusted TLDR." });
  });

  it("preserves the same opaque payload when completed work reopens", () => {
    const done: QuestDone = {
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Legacy outcome",
      description: "Test",
      status: "done",
      completedAt: 20,
      claimedAt: 1,
      createdAt: 1,
      verificationItems: [],
      debrief: "Trusted debrief.",
      debriefTldr: "Trusted TLDR.",
      outcome: legacyOutcome,
    };
    const reopened = buildTransitionedQuest(
      done,
      { status: "in_progress", sessionId: "worker" },
      { liveStore: true, now: 30 },
    );

    expect(reopened.outcome).toBe(legacyOutcome);
    expect(reopened.outcome).not.toHaveProperty("reopenedAt");
    expect(reopened.outcome).not.toHaveProperty("previousFinalRevisionId");
  });

  it("preserves even falsey or unfamiliar legacy payloads through cancellation", () => {
    const cancelled = buildCancelledQuest(active(null), "Cancelled", true);

    expect(Object.prototype.hasOwnProperty.call(cancelled, "outcome")).toBe(true);
    expect(cancelled.outcome).toBeNull();
  });
});
