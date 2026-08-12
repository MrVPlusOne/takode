import { describe, expect, it } from "vitest";
import {
  QUEST_PARTICIPANT_CHIP_CLASS,
  QUEST_PARTICIPANT_ROLE_CLASS,
  QUEST_PARTICIPANT_ROLE_INITIAL_CLASS,
} from "./quest-participant-chip-style.js";

function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

describe("quest participant chip styles", () => {
  it("uses the participant-readable muted class for visible chip labels", () => {
    // Quest participant labels are normal visible text inside dark-theme chips,
    // so they must not resolve through the low-contrast Tailwind muted utility.
    expect(QUEST_PARTICIPANT_CHIP_CLASS).toContain("cc-participant-muted-readable");
    expect(QUEST_PARTICIPANT_ROLE_CLASS).toContain("cc-participant-muted-readable");
    expect(QUEST_PARTICIPANT_CHIP_CLASS).not.toContain("cc-muted-readable");
    expect(QUEST_PARTICIPANT_ROLE_CLASS).not.toContain("cc-muted-readable");
    expect(classTokens(QUEST_PARTICIPANT_CHIP_CLASS)).not.toContain("text-cc-muted");
    expect(classTokens(QUEST_PARTICIPANT_ROLE_CLASS)).not.toContain("text-cc-muted");
  });

  it("keeps full labels through 320px and limits initials to smaller exceptional widths", () => {
    // Regression coverage for mobile role clarity: ordinary mobile must not
    // inherit the old base `hidden sm:inline` behavior.
    expect(classTokens(QUEST_PARTICIPANT_ROLE_CLASS)).not.toContain("hidden");
    expect(QUEST_PARTICIPANT_ROLE_CLASS).toContain("max-[319px]:hidden");
    expect(classTokens(QUEST_PARTICIPANT_ROLE_INITIAL_CLASS)).toContain("hidden");
    expect(QUEST_PARTICIPANT_ROLE_INITIAL_CLASS).toContain("max-[319px]:inline");
  });
});
