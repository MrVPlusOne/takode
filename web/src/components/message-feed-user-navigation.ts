import type { ChatMessage } from "../types.js";
import type { StarredMessageRecord } from "../types.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import { isInjectedEventMessage } from "../utils/injected-event-message.js";
import { getMessageFeedBlockId, getTurnFeedBlockId } from "./message-feed-utils.js";

export type UserNavigationDirection = "previous" | "next";

export interface UserNavigationTarget {
  key: string;
  turnId: string;
  blockId: string;
  messageId: string;
  content: string;
  role: "user" | "assistant";
  starred: boolean;
  timestamp: number;
  navigationIndex?: number;
  historyIndex?: number;
}

export interface ServerUserNavigationSearchResult {
  category: string;
  role: string;
  historyIndex: number;
  timestamp: number;
  messageId: string;
  fullText?: string;
  snippet: string;
  starred: boolean;
}

export function searchResultsToUserNavigationTargets(
  results: readonly ServerUserNavigationSearchResult[],
): UserNavigationTarget[] {
  return results
    .filter((result) => result.category === "user" || (result.category === "assistant" && result.starred))
    .sort((left, right) => left.historyIndex - right.historyIndex || left.timestamp - right.timestamp)
    .map((result, index) => {
      const isBoundaryUserMessage = result.role === "user";
      const blockId = isBoundaryUserMessage
        ? getTurnFeedBlockId(result.messageId)
        : getMessageFeedBlockId(result.messageId);
      return {
        key: blockId,
        turnId: result.messageId,
        blockId,
        messageId: result.messageId,
        content: result.fullText ?? result.snippet,
        role: result.role === "assistant" ? "assistant" : "user",
        starred: result.starred,
        timestamp: result.timestamp,
        navigationIndex: index,
        historyIndex: result.historyIndex,
      };
    });
}

export function mergeUserNavigationTargets(
  primaryTargets: readonly UserNavigationTarget[],
  visibleLocalTargets: readonly UserNavigationTarget[],
): UserNavigationTarget[] {
  const byMessageId = new Map(primaryTargets.map((target) => [target.messageId, target]));
  const merged = [...primaryTargets];
  for (const target of visibleLocalTargets) {
    if (byMessageId.has(target.messageId)) continue;
    byMessageId.set(target.messageId, target);
    merged.push(target);
  }
  return merged
    .sort(
      (left, right) =>
        (left.historyIndex ?? Number.MAX_SAFE_INTEGER) - (right.historyIndex ?? Number.MAX_SAFE_INTEGER) ||
        left.timestamp - right.timestamp,
    )
    .map((target, index) => ({ ...target, navigationIndex: index }));
}

export function collectUserNavigationTargets(
  turns: readonly Turn[],
  leaderSessionId: string,
  starredMessages?: Record<string, StarredMessageRecord>,
): UserNavigationTarget[] {
  const targets: UserNavigationTarget[] = [];

  for (const turn of turns) {
    const boundaryMessage = getEntryMessage(turn.userEntry);
    if (boundaryMessage && isUserNavigationTargetMessage(boundaryMessage, leaderSessionId, starredMessages)) {
      const blockId = getTurnFeedBlockId(turn.id);
      targets.push({
        key: blockId,
        turnId: turn.id,
        blockId,
        messageId: boundaryMessage.id,
        content: boundaryMessage.content,
        role: boundaryMessage.role === "assistant" ? "assistant" : "user",
        starred: Boolean(starredMessages?.[boundaryMessage.id]),
        timestamp: boundaryMessage.timestamp,
        navigationIndex: targets.length,
        historyIndex: boundaryMessage.historyIndex,
      });
    }

    for (const entry of turn.allEntries) {
      const message = getEntryMessage(entry);
      if (!message || !isUserNavigationTargetMessage(message, leaderSessionId, starredMessages)) continue;
      const blockId = getMessageFeedBlockId(message.id);
      targets.push({
        key: blockId,
        turnId: turn.id,
        blockId,
        messageId: message.id,
        content: message.content,
        role: message.role === "assistant" ? "assistant" : "user",
        starred: Boolean(starredMessages?.[message.id]),
        timestamp: message.timestamp,
        navigationIndex: targets.length,
        historyIndex: message.historyIndex,
      });
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

function isUserNavigationTargetMessage(
  message: ChatMessage,
  leaderSessionId: string,
  starredMessages?: Record<string, StarredMessageRecord>,
): boolean {
  if (message.role === "assistant")
    return message.metadata?.leaderUserMessage === true || Boolean(starredMessages?.[message.id]);
  if (message.role !== "user") return false;
  if (isInjectedEventMessage(message)) return false;

  const sourceId = message.agentSource?.sessionId;
  return sourceId == null || sourceId === leaderSessionId;
}

function getEntryMessage(entry: FeedEntry | null): ChatMessage | null {
  return entry?.kind === "message" ? entry.msg : null;
}
