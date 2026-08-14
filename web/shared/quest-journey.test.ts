import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUEST_JOURNEY_PHASE_IDS,
  FREE_WORKER_WAIT_FOR_TOKEN,
  QUEST_JOURNEY_HINTS,
  QUEST_JOURNEY_PHASES,
  canonicalizeKnownQuestJourneyPhaseId,
  canonicalizeKnownQuestJourneyState,
  canonicalizeQuestJourneyLifecycleMode,
  canonicalizeQuestJourneyPhaseId,
  canonicalizeQuestJourneyState,
  formatQuestJourneyDuration,
  formatQuestJourneyText,
  formatWaitForRefLabel,
  getInvalidQuestJourneyPhaseIds,
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyCurrentPhaseIndex,
  getQuestJourneyPhase,
  getQuestJourneyPhaseDurationMs,
  getQuestJourneyPhaseForState,
  getQuestJourneyProposalSignature,
  getQuestJourneyTotalElapsedMs,
  getWaitForRefKind,
  isLegacyQuestJourneyPhaseId,
  isQuestJourneyOptionalUserCheckpoint,
  isQuestWaitForBlockingState,
  isValidQuestId,
  isValidWaitForRef,
  normalizeKnownQuestJourneyPhaseIds,
  normalizeQuestJourneyPhaseIds,
  normalizeQuestJourneyPlan,
  rebaseQuestJourneyPhaseNotes,
  reviseQuestJourneySuffix,
  validateQuestJourneyCompletedPrefixRevision,
  validateQuestJourneyPhaseSequence,
  validateQuestJourneyPersistedPhaseOccurrences,
  validateQuestJourneyUserCheckpointNotes,
  validateQuestJourneyUserCheckpointRemoval,
} from "./quest-journey.js";

describe("quest and wait-for refs", () => {
  it.each(["q-1", "q-42", "q-999", "Q-1"])("accepts valid quest ID: %j", (id) => {
    expect(isValidQuestId(id)).toBe(true);
  });

  it.each(["42", "#5", "q-", "foo", "q-abc", ""])("rejects invalid quest ID: %j", (id) => {
    expect(isValidQuestId(id)).toBe(false);
  });

  it.each(["q-1", "#42", FREE_WORKER_WAIT_FOR_TOKEN, "FREE-WORKER"])("accepts wait-for ref: %j", (ref) => {
    expect(isValidWaitForRef(ref)).toBe(true);
  });

  it.each(["42", "foo", "q-", "#", "#abc", "q-1,#5"])("rejects invalid wait-for ref: %j", (ref) => {
    expect(isValidWaitForRef(ref)).toBe(false);
  });

  it("classifies and formats wait-for refs", () => {
    expect(getWaitForRefKind("q-9")).toBe("quest");
    expect(getWaitForRefKind("#22")).toBe("session");
    expect(getWaitForRefKind(FREE_WORKER_WAIT_FOR_TOKEN)).toBe("free-worker");
    expect(getWaitForRefKind("oops")).toBe("invalid");
    expect(formatWaitForRefLabel(FREE_WORKER_WAIT_FOR_TOKEN)).toBe("free worker");
  });
});

describe("active v2 phase catalog", () => {
  it("exposes only the v2 active phase library", () => {
    expect(QUEST_JOURNEY_PHASES.map((phase) => phase.id)).toEqual(["alignment", "work", "user-checkpoint", "memory"]);
    // Active phases use semantic color names so their palette can change
    // without mutating the generic colors retained by historical v1 rows.
    expect(QUEST_JOURNEY_PHASES.map((phase) => ({ id: phase.id, color: phase.color }))).toEqual([
      { id: "alignment", color: { name: "alignment", accent: "#0ea5e9" } },
      { id: "work", color: { name: "work", accent: "#4ade80" } },
      { id: "user-checkpoint", color: { name: "amber", accent: "#fbbf24" } },
      { id: "memory", color: { name: "memory", accent: "#8b5cf6" } },
    ]);
    expect(DEFAULT_QUEST_JOURNEY_PHASE_IDS).toEqual(["alignment", "work", "memory"]);
    expect(QUEST_JOURNEY_PHASES.map((phase) => phase.boardState)).toEqual([
      "PLANNING",
      "WORKING",
      "USER_CHECKPOINTING",
      "MEMORY",
    ]);
  });

  it("rejects legacy phase ids for active plans while preserving known historical metadata", () => {
    expect(canonicalizeQuestJourneyPhaseId("work")).toBe("work");
    expect(canonicalizeQuestJourneyPhaseId("implement")).toBeNull();
    expect(canonicalizeQuestJourneyPhaseId("planning")).toBeNull();
    expect(getInvalidQuestJourneyPhaseIds(["alignment", "implement", "memory"])).toEqual(["implement"]);

    expect(canonicalizeKnownQuestJourneyPhaseId("planning")).toBe("alignment");
    expect(canonicalizeKnownQuestJourneyPhaseId("implement")).toBe("implement");
    expect(canonicalizeKnownQuestJourneyPhaseId("porting")).toBe("port");
    expect(normalizeKnownQuestJourneyPhaseIds(["planning", "implementation", "porting"])).toEqual([
      "alignment",
      "implement",
      "port",
    ]);
    expect(isLegacyQuestJourneyPhaseId("port")).toBe(true);
  });

  it("keeps legacy states readable but active state canonicalization v2-only", () => {
    expect(canonicalizeQuestJourneyState("WORKING")).toBe("WORKING");
    expect(canonicalizeQuestJourneyState("IMPLEMENTING")).toBe("WORKING");
    expect(canonicalizeQuestJourneyState("CODE_REVIEWING")).toBeNull();
    expect(canonicalizeKnownQuestJourneyState("CODE_REVIEWING")).toBe("CODE_REVIEWING");
    expect(canonicalizeKnownQuestJourneyState("SKEPTIC_REVIEWING")).toBe("CODE_REVIEWING");
    expect(formatQuestJourneyText("moved from IMPLEMENTING to WORKING")).toBe("moved from Implement to Work");
  });

  it("maps active and historical states to display metadata", () => {
    expect(getQuestJourneyPhaseForState("WORKING")?.id).toBe("work");
    expect(getQuestJourneyPhaseForState("IMPLEMENTING")?.id).toBe("implement");
    expect(getQuestJourneyPhaseForState("CODE_REVIEWING")?.label).toBe("Code Review");
    expect(getQuestJourneyPhaseForState("PROPOSED")).toBeNull();
    expect(getQuestJourneyPhase("work")?.nextLeaderAction).toContain("Work note");
    expect(getQuestJourneyPhase("port")?.nextLeaderAction).toBe("historical phase only");
    // Keep representative legacy colors explicit so the v2 refresh cannot
    // silently recolor persisted Code Review or Outcome Review rows.
    expect(getQuestJourneyPhase("code-review")?.color).toEqual({ name: "violet", accent: "#a78bfa" });
    expect(getQuestJourneyPhase("outcome-review")?.color).toEqual({ name: "cyan", accent: "#22d3ee" });
  });
});

describe("active Journey validation and normalization", () => {
  it("validates only active v2 phases for new plans", () => {
    expect(validateQuestJourneyPhaseSequence(["alignment", "work", "memory"])).toBeUndefined();
    expect(validateQuestJourneyPhaseSequence(["alignment", "implement", "memory"])).toContain(
      "Legacy v1 phase IDs are historical-read only",
    );
    expect(validateQuestJourneyPersistedPhaseOccurrences(["alignment", "implement", "port"])).toBeUndefined();
    expect(validateQuestJourneyPersistedPhaseOccurrences(["alignment", "unknown"])).toContain("repair required");
  });

  it("normalizes default v2 plans and checkpoint pause over Work", () => {
    expect(normalizeQuestJourneyPlan(undefined, "WORKING")).toMatchObject({
      presetId: "v2-work",
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "work",
      nextLeaderAction: expect.stringContaining("Work note"),
    });

    expect(
      normalizeQuestJourneyPlan(
        { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
        "USER_CHECKPOINTING",
      ),
    ).toMatchObject({
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "work",
    });
  });

  it("normalizes proposed rows without active phase semantics", () => {
    const normalized = normalizeQuestJourneyPlan(
      {
        presetId: "proposal",
        mode: "proposed",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
        presentation: {
          state: "presented",
          signature: "old",
          presentedAt: 123,
          summary: "Approve this Journey.",
        },
      },
      "PROPOSED",
    );
    expect(normalized).toMatchObject({
      mode: "proposed",
      phaseIds: ["alignment", "work", "memory"],
      nextLeaderAction: expect.stringContaining("promote"),
      presentation: { state: "presented", presentedAt: 123, summary: "Approve this Journey." },
    });
    expect(normalized.activePhaseIndex).toBeUndefined();
    expect(getQuestJourneyProposalSignature(normalized)).toBe(
      '{"presetId":"proposal","phaseIds":["alignment","work","memory"],"phaseNotes":{}}',
    );
  });

  it("keeps only in-range notes and timings", () => {
    const normalized = normalizeQuestJourneyPlan({
      phaseIds: ["alignment", "work", "memory"],
      phaseNotes: { "0": "Align", "1": "Work", "5": "drop" },
      phaseTimings: {
        "0": { startedAt: 1000, endedAt: 2000 },
        "1": { startedAt: 2000 },
        "5": { startedAt: 9999 },
      },
    });
    expect(normalized.phaseNotes).toEqual({ "0": "Align", "1": "Work" });
    expect(normalized.phaseTimings).toEqual({ "0": { startedAt: 1000, endedAt: 2000 }, "1": { startedAt: 2000 } });
    expect(getQuestJourneyPhaseDurationMs(normalized, 0, 5000)).toBe(1000);
    expect(getQuestJourneyPhaseDurationMs(normalized, 1, 5000)).toBe(3000);
    expect(getQuestJourneyTotalElapsedMs(normalized, 5000)).toBe(4000);
  });

  it("treats Memory as downstream-unblocking while active", () => {
    expect(isQuestWaitForBlockingState("WORKING")).toBe(true);
    expect(isQuestWaitForBlockingState("MEMORY")).toBe(false);
    expect(QUEST_JOURNEY_HINTS.WORKING).toContain("Work note");
  });
});

describe("Journey revision helpers", () => {
  it("rebases notes by matching phase occurrences", () => {
    expect(
      rebaseQuestJourneyPhaseNotes(
        { "0": "first alignment", "2": "final memory" },
        ["alignment", "work", "memory"],
        ["alignment", "work", "user-checkpoint", "work", "memory"],
      ),
    ).toEqual({
      phaseNotes: { "0": "first alignment", "4": "final memory" },
      warnings: [],
    });
  });

  it("revises future v2 suffixes without rewriting completed prefixes", () => {
    expect(
      reviseQuestJourneySuffix({
        existingPhaseIds: ["alignment", "work", "memory"],
        fromIndex: 1,
        expectedPhaseId: "work",
        replacementPhaseIds: ["work", "user-checkpoint", "work", "memory"],
      }),
    ).toMatchObject({
      phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
      warnings: [],
    });

    expect(
      validateQuestJourneyCompletedPrefixRevision({
        existingPlan: {
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
          currentPhaseId: "work",
        },
        existingStatus: "WORKING",
        nextPhaseIds: ["work", "memory"],
      }),
    ).toContain("Completed Journey phase occurrences cannot be revised in place");
  });

  it("requires concrete optional checkpoint notes before skip semantics", () => {
    expect(
      validateQuestJourneyUserCheckpointNotes(["work", "user-checkpoint", "work"], {
        "1": "Optional: skip if Work confirms there is no user-visible tradeoff.",
      }),
    ).toBeUndefined();
    expect(
      validateQuestJourneyUserCheckpointNotes(["work", "user-checkpoint", "work"], {
        "1": "Optional checkpoint.",
      }),
    ).toContain("Optional User Checkpoints require");
    expect(
      isQuestJourneyOptionalUserCheckpoint(
        ["work", "user-checkpoint", "work"],
        { "1": "This User Checkpoint may be skipped if Work finds no user-facing tradeoff." },
        1,
      ),
    ).toBe(true);
  });

  it("rejects removing mandatory checkpoints but allows explicitly optional ones", () => {
    expect(
      validateQuestJourneyUserCheckpointRemoval(
        ["alignment", "work", "user-checkpoint", "work", "memory"],
        ["alignment", "work", "work", "memory"],
        undefined,
      ),
    ).toContain("Optional User Checkpoints require");
    expect(
      validateQuestJourneyUserCheckpointRemoval(
        ["alignment", "work", "user-checkpoint", "work", "memory"],
        ["alignment", "work", "work", "memory"],
        { "2": "Optional: skip when Work confirms no user-visible tradeoff remains." },
      ),
    ).toBeUndefined();
  });
});

describe("durations and lifecycle mode", () => {
  it("normalizes lifecycle mode", () => {
    expect(canonicalizeQuestJourneyLifecycleMode("active")).toBe("active");
    expect(canonicalizeQuestJourneyLifecycleMode(" proposed ")).toBe("proposed");
    expect(canonicalizeQuestJourneyLifecycleMode("other")).toBeNull();
  });

  it("formats durations", () => {
    expect(formatQuestJourneyDuration(9_000)).toBe("9s");
    expect(formatQuestJourneyDuration(2 * 60_000)).toBe("2m");
    expect(formatQuestJourneyDuration(3 * 60 * 60_000 + 5 * 60_000)).toBe("3h 5m");
  });

  it("returns current phase helpers", () => {
    const plan = { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" } as const;
    expect(normalizeQuestJourneyPhaseIds(["alignment", "work", "memory"])).toEqual(["alignment", "work", "memory"]);
    expect(getQuestJourneyCurrentPhaseIndex(plan, "WORKING")).toBe(1);
    expect(getQuestJourneyCurrentPhaseId(plan, "WORKING")).toBe("work");
  });
});
