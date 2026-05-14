import { describe, expect, it } from "vitest";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";
import {
  getQuestPhaseColorValue,
  getQuestPhaseCurrentDotStyle,
  getQuestPhaseTextStyle,
  getQuestPhaseThreadTabTitleColorValue,
} from "./quest-phase-theme.js";

describe("quest-phase-theme", () => {
  it("presents Journey phases through theme-safe CSS variables instead of raw metadata accents", () => {
    const phase = getQuestJourneyPhaseForState("IMPLEMENTING");
    expect(phase?.color.accent).toBe("#4ade80");
    expect(phase).toBeTruthy();
    if (!phase) return;

    expect(getQuestPhaseColorValue(phase.color)).toBe("var(--color-cc-phase-green, #4ade80)");
    expect(getQuestPhaseTextStyle(phase)).toEqual({ color: "var(--color-cc-phase-green, #4ade80)" });
  });

  it("uses color-mix for alpha presentation so light and dark themes share one helper", () => {
    const phase = getQuestJourneyPhaseForState("EXPLORING");
    expect(phase).toBeTruthy();
    if (!phase) return;

    expect(getQuestPhaseColorValue(phase.color, 0.45)).toBe(
      "color-mix(in srgb, var(--color-cc-phase-amber, #fbbf24) 45%, transparent)",
    );
    expect(getQuestPhaseCurrentDotStyle(phase).boxShadow).toContain("var(--color-cc-phase-amber, #fbbf24)");
  });

  it("uses readable phase text tokens for Work Board thread-tab titles", () => {
    const phase = getQuestJourneyPhaseForState("CODE_REVIEWING");
    expect(phase?.color.accent).toBe("#a78bfa");
    expect(phase).toBeTruthy();
    if (!phase) return;

    expect(getQuestPhaseThreadTabTitleColorValue(phase.color)).toBe(
      "var(--color-cc-phase-thread-tab-title-violet, #6d28d9)",
    );
  });
});
