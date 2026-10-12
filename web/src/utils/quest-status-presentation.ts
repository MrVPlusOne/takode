import type { CSSProperties } from "react";
import type { QuestListPreview, QuestmasterTask } from "../types.js";
import { getQuestJourneyPhaseForState, getQuestJourneyPresentation } from "../../shared/quest-journey.js";
import { isCompletedJourneyPresentationStatus } from "../components/QuestJourneyTimeline.js";
import type { QuestJourneyContext } from "./quest-journey-context.js";
import { getQuestPhaseDotStyle } from "./quest-phase-theme.js";
import { getQuestRecordStatusTheme, type QuestStatusTheme } from "./quest-status-theme.js";

export interface QuestStatusPresentation {
  label: string;
  /** Chip colors, always from the quest's own status. */
  theme: QuestStatusTheme;
  /** The current phase's dot color, when the label names a Journey phase. */
  dotStyle?: CSSProperties;
}

/**
 * The status label every quest view shows (the feed's title preview, the quest preview and the
 * full quest view), so one quest never reads "In Progress" in one place and "Work" in another.
 * An unfinished quest with an active Journey shows its phase (Work, Memory, ...); otherwise the
 * quest's own status, with finished quests as Done or Cancelled.
 */
export function getQuestStatusPresentation(
  quest: QuestmasterTask | QuestListPreview,
  context: QuestJourneyContext | null,
): QuestStatusPresentation {
  const theme = getQuestRecordStatusTheme(quest);
  if (isCompletedJourneyPresentationStatus(quest.status) || context?.completed) return { label: theme.label, theme };
  const boardState = context?.row.status;
  const phase = getQuestJourneyPhaseForState(boardState);
  const label = getQuestJourneyPresentation(boardState)?.label ?? phase?.label ?? theme.label;
  return { label, theme, ...(phase ? { dotStyle: getQuestPhaseDotStyle(phase) } : {}) };
}
