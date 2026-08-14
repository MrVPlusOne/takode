import { describe, expect, it } from "vitest";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";
import {
  getQuestPhaseAccentValue,
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

    expect(getQuestPhaseColorValue(phase.color)).toBe("var(--color-cc-phase-green, #166534)");
    expect(getQuestPhaseAccentValue(phase.color)).toBe(
      "var(--color-cc-phase-accent-green, var(--color-cc-phase-green, #4ade80))",
    );
    expect(getQuestPhaseTextStyle(phase)).toEqual({ color: "var(--color-cc-phase-green, #166534)" });
  });

  it("uses accent color-mix for dots and lines so light and dark themes share one helper", () => {
    const phase = getQuestJourneyPhaseForState("EXPLORING");
    expect(phase).toBeTruthy();
    if (!phase) return;

    expect(getQuestPhaseAccentValue(phase.color, 0.45)).toBe(
      "color-mix(in srgb, var(--color-cc-phase-accent-amber, var(--color-cc-phase-amber, #fbbf24)) 45%, transparent)",
    );
    expect(getQuestPhaseCurrentDotStyle(phase).boxShadow).toContain(
      "var(--color-cc-phase-accent-amber, var(--color-cc-phase-amber, #fbbf24))",
    );
  });

  it("separates active v2 readable text from the accepted brighter accents", () => {
    // Text tokens must remain AA-readable in light mode while dots, borders,
    // and progress lines use the brighter approved semantic accents.
    const alignment = getQuestJourneyPhaseForState("PLANNING");
    const work = getQuestJourneyPhaseForState("WORKING");
    const checkpoint = getQuestJourneyPhaseForState("USER_CHECKPOINTING");
    const memory = getQuestJourneyPhaseForState("MEMORY");
    expect(alignment?.color).toEqual({ name: "alignment", accent: "#0ea5e9" });
    expect(work?.color).toEqual({ name: "work", accent: "#4ade80" });
    expect(checkpoint?.color).toEqual({ name: "amber", accent: "#fbbf24" });
    expect(memory?.color).toEqual({ name: "memory", accent: "#8b5cf6" });
    if (!alignment || !work || !checkpoint || !memory) return;

    expect(getQuestPhaseColorValue(alignment.color)).toBe("var(--color-cc-phase-alignment, #0369a1)");
    expect(getQuestPhaseAccentValue(alignment.color)).toBe(
      "var(--color-cc-phase-accent-alignment, var(--color-cc-phase-alignment, #0ea5e9))",
    );
    expect(getQuestPhaseColorValue(work.color)).toBe("var(--color-cc-phase-work, #166534)");
    expect(getQuestPhaseAccentValue(work.color)).toBe(
      "var(--color-cc-phase-accent-work, var(--color-cc-phase-work, #4ade80))",
    );
    expect(getQuestPhaseColorValue(memory.color)).toBe("var(--color-cc-phase-memory, #6d28d9)");
    expect(getQuestPhaseAccentValue(memory.color)).toBe(
      "var(--color-cc-phase-accent-memory, var(--color-cc-phase-memory, #8b5cf6))",
    );
    expect(getQuestPhaseThreadTabTitleColorValue(checkpoint.color)).toBe(
      "var(--color-cc-phase-thread-tab-title-amber, #8a4b00)",
    );
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
