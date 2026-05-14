import type { CSSProperties } from "react";
import type { QuestJourneyPhase } from "../../shared/quest-journey.js";

type QuestPhaseColor = QuestJourneyPhase["color"];

const READABLE_LIGHT_PHASE_TEXT_FALLBACKS: Record<string, string> = {
  amber: "#8a4b00",
  blue: "#1d4ed8",
  cyan: "#0e7490",
  emerald: "#047857",
  fuchsia: "#a21caf",
  green: "#166534",
  orange: "#9a3412",
  sky: "#0369a1",
  violet: "#6d28d9",
  yellow: "#854d0e",
};

export function getQuestPhaseColorValue(color: QuestPhaseColor, alpha = 1): string {
  const phaseColor = `var(--color-cc-phase-${color.name}, ${color.accent})`;
  if (alpha >= 1) return phaseColor;
  return colorMixWithTransparent(phaseColor, alpha);
}

export function getQuestPhaseThreadTabTitleColorValue(color: QuestPhaseColor): string {
  return `var(--color-cc-phase-thread-tab-title-${color.name}, ${readablePhaseTextFallback(color)})`;
}

export function getQuestPhaseTextStyle(phase: QuestJourneyPhase, alpha = 1): CSSProperties {
  return { color: getQuestPhaseColorValue(phase.color, alpha) };
}

export function getQuestPhaseBorderStyle(phase: QuestJourneyPhase, alpha = 1): CSSProperties {
  return { borderColor: getQuestPhaseColorValue(phase.color, alpha) };
}

export function getQuestPhaseLineStyle(phase: QuestJourneyPhase, alpha = 0.45): CSSProperties {
  return { backgroundColor: getQuestPhaseColorValue(phase.color, alpha) };
}

export function getQuestPhaseDotStyle(phase: QuestJourneyPhase, alpha = 1): CSSProperties {
  const color = getQuestPhaseColorValue(phase.color, alpha);
  return {
    backgroundColor: color,
    borderColor: color,
  };
}

export function getQuestPhaseCurrentDotStyle(phase: QuestJourneyPhase): CSSProperties {
  const color = getQuestPhaseColorValue(phase.color);
  return {
    backgroundColor: color,
    borderColor: color,
    boxShadow: `0 0 0 3px ${colorMixWithTransparent(color, 0.18)}`,
  };
}

function colorMixWithTransparent(color: string, alpha: number): string {
  const percent = Math.max(0, Math.min(100, Math.round(alpha * 100)));
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function readablePhaseTextFallback(color: QuestPhaseColor): string {
  return READABLE_LIGHT_PHASE_TEXT_FALLBACKS[color.name] ?? color.accent;
}
