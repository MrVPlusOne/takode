import { describe, expect, it } from "vitest";
import { getQuestSessionSpaceCandidates, getQuestSessionSpaceSlug } from "./quest-session-space.js";
import type { QuestmasterTask } from "./quest-types.js";

describe("quest session-space helpers", () => {
  it("prefers explicit quest metadata before provenance and default fallback", () => {
    const quest = {
      id: "q-1",
      questId: "q-1",
      version: 1,
      title: "Quest",
      status: "done",
      description: "Done",
      createdAt: 1,
      completedAt: 2,
      sessionSpaceSlug: "MSI",
      previousOwnerSessionIds: ["worker-other"],
    } as QuestmasterTask;

    const candidates = getQuestSessionSpaceCandidates(quest, {
      resolveSessionSpaceSlug: (sessionId) => (sessionId === "worker-other" ? "Other" : undefined),
      defaultSessionSpaceSlug: "Takode",
    });

    expect(candidates).toEqual(["MSI", "Other", "Takode"]);
    expect(getQuestSessionSpaceSlug(quest)).toBe("MSI");
  });

  it("falls back through Journey provenance when explicit metadata is missing", () => {
    const quest = {
      id: "q-2",
      questId: "q-2",
      version: 1,
      title: "Legacy quest",
      status: "done",
      description: "Done",
      createdAt: 1,
      completedAt: 2,
      verificationItems: [],
      journeyRuns: [
        {
          runId: "run-1",
          workerSessionId: "worker-msi",
          leaderSessionId: "leader-takode",
          source: "board",
          phaseIds: ["alignment"],
          status: "completed",
          createdAt: 1,
          updatedAt: 2,
          phaseOccurrences: [],
        },
      ],
    } as QuestmasterTask;

    const candidates = getQuestSessionSpaceCandidates(quest, {
      resolveSessionSpaceSlug: (sessionId) =>
        sessionId === "worker-msi" ? "MSI" : sessionId === "leader-takode" ? "Takode" : undefined,
      defaultSessionSpaceSlug: "Takode",
    });

    expect(candidates).toEqual(["MSI", "Takode"]);
    expect(getQuestSessionSpaceSlug(quest, { resolveSessionSpaceSlug: () => "MSI" })).toBe("MSI");
  });
});
