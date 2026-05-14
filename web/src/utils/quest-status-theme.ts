import type { QuestStatus } from "../types.js";

export interface QuestStatusTheme {
  label: string;
  dot: string;
  bg: string;
  text: string;
  border: string;
}

export const QUEST_STATUS_THEME: Record<QuestStatus, QuestStatusTheme> = {
  idea: {
    label: "Idea",
    dot: "bg-cc-status-idea",
    bg: "bg-cc-status-idea/10",
    text: "text-cc-status-idea",
    border: "border-cc-status-idea/25",
  },
  refined: {
    label: "Refined",
    dot: "bg-cc-status-refined",
    bg: "bg-cc-status-refined/10",
    text: "text-cc-status-refined",
    border: "border-cc-status-refined/25",
  },
  in_progress: {
    label: "In Progress",
    dot: "bg-cc-status-progress",
    bg: "bg-cc-status-progress/10",
    text: "text-cc-status-progress",
    border: "border-cc-status-progress/25",
  },
  done: {
    label: "Done",
    dot: "bg-cc-status-done",
    bg: "bg-cc-status-done/10",
    text: "text-cc-status-done",
    border: "border-cc-status-done/25",
  },
};

export function getQuestStatusTheme(status: string): QuestStatusTheme {
  const known = QUEST_STATUS_THEME[status as QuestStatus];
  if (known) return known;
  return {
    label: status,
    dot: "bg-cc-status-idea",
    bg: "bg-cc-status-idea/10",
    text: "text-cc-muted",
    border: "border-cc-status-idea/25",
  };
}
