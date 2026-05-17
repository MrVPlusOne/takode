import type { ChatMessage } from "../types.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import { isInjectedEventMessage } from "../utils/injected-event-message.js";
import { getMessageFeedBlockId, getTurnFeedBlockId } from "./message-feed-utils.js";

export type UserNavigationDirection = "previous" | "next";

export interface UserNavigationTarget {
  key: string;
  turnId: string;
  blockId: string;
}

export function collectUserNavigationTargets(turns: readonly Turn[], leaderSessionId: string): UserNavigationTarget[] {
  const targets: UserNavigationTarget[] = [];

  for (const turn of turns) {
    const boundaryMessage = getEntryMessage(turn.userEntry);
    if (boundaryMessage && isUserNavigationTargetMessage(boundaryMessage, leaderSessionId)) {
      const blockId = getTurnFeedBlockId(turn.id);
      targets.push({ key: blockId, turnId: turn.id, blockId });
    }

    for (const entry of turn.allEntries) {
      const message = getEntryMessage(entry);
      if (!message || !isUserNavigationTargetMessage(message, leaderSessionId)) continue;
      const blockId = getMessageFeedBlockId(message.id);
      targets.push({ key: blockId, turnId: turn.id, blockId });
    }
  }

  return targets;
}

export function findAdjacentUserNavigationTarget(
  targets: readonly UserNavigationTarget[],
  anchorKey: string | null,
  direction: UserNavigationDirection,
): UserNavigationTarget | null {
  if (targets.length === 0) return null;
  if (!anchorKey) return direction === "previous" ? targets[targets.length - 1]! : targets[0]!;

  const anchorIndex = targets.findIndex((target) => target.key === anchorKey);
  if (anchorIndex < 0) return direction === "previous" ? targets[targets.length - 1]! : targets[0]!;
  if (direction === "previous") return anchorIndex > 0 ? targets[anchorIndex - 1]! : null;
  return anchorIndex < targets.length - 1 ? targets[anchorIndex + 1]! : null;
}

function isUserNavigationTargetMessage(message: ChatMessage, leaderSessionId: string): boolean {
  if (message.role === "assistant") return message.metadata?.leaderUserMessage === true;
  if (message.role !== "user") return false;
  if (isInjectedEventMessage(message)) return false;

  const sourceId = message.agentSource?.sessionId;
  return sourceId == null || sourceId === leaderSessionId;
}

function getEntryMessage(entry: FeedEntry | null): ChatMessage | null {
  return entry?.kind === "message" ? entry.msg : null;
}
