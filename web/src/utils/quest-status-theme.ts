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
    dot: "bg-zinc-400",
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    border: "border-zinc-500/20",
  },
  refined: {
    label: "Refined",
    dot: "bg-amber-400",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  in_progress: {
    label: "In Progress",
    dot: "bg-green-400",
    bg: "bg-green-500/10",
    text: "text-green-400",
    border: "border-green-500/20",
  },
  needs_verification: {
    label: "Verification",
    dot: "bg-blue-400",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
  },
  done: {
    label: "Done",
    dot: "bg-purple-400",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/20",
  },
};

export function getQuestStatusTheme(status: string): QuestStatusTheme {
  const known = QUEST_STATUS_THEME[status as QuestStatus];
  if (known) return known;
  return {
    label: status,
    dot: "bg-zinc-400",
    bg: "bg-zinc-500/10",
    text: "text-cc-muted",
    border: "border-zinc-500/20",
  };
}
