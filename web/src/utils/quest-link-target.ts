import type { CommitRange } from "../../shared/quest-delivery.js";

export interface QuestFeedbackTargetRequest {
  index: number;
  requestId: number;
}

export interface QuestLinkTarget {
  questId: string;
  feedbackIndex?: number;
  delivery?: { id: string; sha: string; range?: CommitRange };
}

const QUEST_ID_PATTERN = "(q-\\d+)";
const WHOLE_QUEST_PATTERNS = [
  new RegExp(`^${QUEST_ID_PATTERN}$`, "i"),
  new RegExp(`^quest:${QUEST_ID_PATTERN}$`, "i"),
  new RegExp(`^quest:\\/\\/${QUEST_ID_PATTERN}$`, "i"),
];
const CANONICAL_FEEDBACK_PATTERN = new RegExp(`^quest:${QUEST_ID_PATTERN}:feedback:(\\d+)$`, "i");
const LEGACY_FEEDBACK_PATTERN = new RegExp(`^quest:${QUEST_ID_PATTERN}#feedback-(\\d+)$`, "i");

export function parseQuestLinkTarget(href?: string): QuestLinkTarget | null {
  if (!href) return null;
  const trimmed = href.trim();

  for (const pattern of WHOLE_QUEST_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return { questId: match[1]!.toLowerCase() };
  }

  const deliveryMatch = trimmed.match(
    /^quest:(q-\d+):delivery:([a-f0-9]{32})(?::range:([a-f0-9]{40}):([a-f0-9]{40}))?:commit:([a-f0-9]{40})$/i,
  );
  if (deliveryMatch)
    return {
      questId: deliveryMatch[1]!.toLowerCase(),
      delivery: {
        id: deliveryMatch[2]!.toLowerCase(),
        sha: deliveryMatch[5]!.toLowerCase(),
        ...(deliveryMatch[3]
          ? { range: { baseSha: deliveryMatch[3].toLowerCase(), tipSha: deliveryMatch[4]!.toLowerCase() } }
          : {}),
      },
    };

  const feedbackMatch = trimmed.match(CANONICAL_FEEDBACK_PATTERN) ?? trimmed.match(LEGACY_FEEDBACK_PATTERN);
  if (!feedbackMatch) return null;
  const feedbackIndex = Number.parseInt(feedbackMatch[2]!, 10);
  if (!Number.isSafeInteger(feedbackIndex) || feedbackIndex < 0) return null;
  return { questId: feedbackMatch[1]!.toLowerCase(), feedbackIndex };
}

export function isReservedQuestLinkHref(href?: string): boolean {
  return Boolean(href?.trim().match(/^quest:/i));
}
