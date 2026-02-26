import { buildQuestReworkDraft } from "./quest-rework.js";

describe("buildQuestReworkDraft", () => {
  it("includes quest id and feedback-directed instruction", () => {
    expect(buildQuestReworkDraft("q-73")).toBe(
      "Please address the unaddressed human feedback on q-73. Run /quest show q-73, then implement the requested fixes and report back.",
    );
  });
});
