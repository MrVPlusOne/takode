import type { QuestmasterTask } from "../server/quest-types.js";
import { hasQuestReviewMetadata, isQuestReviewInboxUnread } from "../server/quest-types.js";
import {
  filterFeedbackEntries,
  formatFeedbackIndices,
  latestAgentSummaryFeedback,
  unaddressedHumanFeedbackEntries,
} from "./quest-feedback.js";
import { formatSessionLabel, type SessionMetadata } from "./quest-format.js";
import { preferredFeedbackPreview } from "../server/quest-tldr.js";

const STATUS_LABELS: Record<string, string> = {
  idea: "idea",
  refined: "refined",
  in_progress: "in_progress",
  done: "done",
};

/** Format the CLI's compact action-oriented Quest status view. */
export function formatQuestStatusSummary(
  quest: QuestmasterTask,
  sessionMetadata: Map<string, SessionMetadata> | undefined,
  options: {
    currentSessionId?: string;
    getSessionName: (sessionId: string) => string | undefined;
  },
): string {
  const owner = "sessionId" in quest ? formatSessionLabel(quest.sessionId, sessionMetadata, options) : "unclaimed";
  const leader = quest.leaderSessionId ? formatSessionLabel(quest.leaderSessionId, sessionMetadata, options) : "none";
  const verification =
    "verificationItems" in quest
      ? `${quest.verificationItems.filter((item) => item.checked).length}/${quest.verificationItems.length}`
      : "none";
  const humanEntries = filterFeedbackEntries(quest, { author: "human" });
  const unaddressed = unaddressedHumanFeedbackEntries(quest);
  const latestSummary = latestAgentSummaryFeedback(quest);
  return [
    `Quest ${quest.questId}: ${quest.title}`,
    `Status:      ${STATUS_LABELS[quest.status] ?? quest.status}`,
    `Owner:       ${owner}`,
    `Leader:      ${leader}`,
    `User review checks: ${verification}`,
    `Inbox:       ${hasQuestReviewMetadata(quest) ? (isQuestReviewInboxUnread(quest) ? "unread" : "acknowledged") : "n/a"}`,
    `Commits:     ${quest.commitShas?.length ?? 0}${quest.commitShas?.length ? ` (${quest.commitShas.join(", ")})` : ""}`,
    `Memory Commits: ${quest.memoryCommitShas?.length ?? 0}${quest.memoryCommitShas?.length ? ` (${quest.memoryCommitShas.join(", ")})` : ""}`,
    `Human Feedback: ${humanEntries.length}`,
    `Unaddressed: ${unaddressed.length ? formatFeedbackIndices(unaddressed) : "none"}`,
    `Latest Summary: ${latestSummary ? `#${latestSummary.index} ${compactSnippet(preferredFeedbackPreview(latestSummary), 120)}` : "none"}`,
    `Next Action:  ${suggestNextQuestAction(quest)}`,
  ].join("\n");
}

/** Build the stable JSON form of the compact Quest status view. */
export function questStatusSummaryForJson(quest: QuestmasterTask): Record<string, unknown> {
  const humanEntries = filterFeedbackEntries(quest, { author: "human" });
  const unaddressed = unaddressedHumanFeedbackEntries(quest);
  const latestSummary = latestAgentSummaryFeedback(quest);
  return {
    questId: quest.questId,
    title: quest.title,
    status: quest.status,
    ownerSessionId: "sessionId" in quest ? quest.sessionId : null,
    leaderSessionId: quest.leaderSessionId ?? null,
    verification:
      "verificationItems" in quest
        ? {
            checked: quest.verificationItems.filter((item) => item.checked).length,
            total: quest.verificationItems.length,
          }
        : { checked: 0, total: 0 },
    inbox: hasQuestReviewMetadata(quest) ? (isQuestReviewInboxUnread(quest) ? "unread" : "acknowledged") : null,
    commitCount: quest.commitShas?.length ?? 0,
    commitShas: quest.commitShas ?? [],
    memoryCommitCount: quest.memoryCommitShas?.length ?? 0,
    memoryCommitShas: quest.memoryCommitShas ?? [],
    humanFeedbackCount: humanEntries.length,
    unaddressedHumanFeedbackIndices: unaddressed.map((entry) => entry.index),
    latestSummary: latestSummary
      ? { index: latestSummary.index, text: latestSummary.text, tldr: latestSummary.tldr, ts: latestSummary.ts }
      : null,
    suggestedNextAction: suggestNextQuestAction(quest),
  };
}

function suggestNextQuestAction(quest: QuestmasterTask): string {
  const unaddressed = unaddressedHumanFeedbackEntries(quest);
  if (unaddressed.length > 0) return `address human feedback ${formatFeedbackIndices(unaddressed)}`;
  if (quest.status === "idea") return "refine the quest before dispatch";
  if (quest.status === "refined") return "claim the quest before implementation";
  if (quest.status === "in_progress")
    return "implement and add a consolidated Summary: feedback comment before handoff";
  if (hasQuestReviewMetadata(quest)) {
    return isQuestReviewInboxUnread(quest)
      ? "human review inbox triage"
      : "await final review or respond to new feedback";
  }
  return quest.status === "done" ? "no action" : "inspect quest details";
}

function compactSnippet(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
