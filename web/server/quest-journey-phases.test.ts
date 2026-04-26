import { describe, expect, it } from "vitest";
import { QUEST_JOURNEY_PHASES } from "../shared/quest-journey.js";
import { getQuestJourneyPhaseSkillPath, loadBuiltInQuestJourneyPhases } from "./quest-journey-phases.js";

describe("Quest Journey phase skill loading", () => {
  it("loads concise built-in phase skill files for the built-in Quest Journey library", async () => {
    const phases = await loadBuiltInQuestJourneyPhases();

    expect(phases.map((phase) => phase.id)).toEqual(QUEST_JOURNEY_PHASES.map((phase) => phase.id));
    for (const phase of phases) {
      expect(phase.path).toBe(getQuestJourneyPhaseSkillPath(phase.id));
      expect(phase.content).toContain("Quest Journey Phase:");
      expect(phase.content).not.toContain("Human Verification");
      expect(phase.content.length).toBeLessThan(2000);
    }
  });
});
