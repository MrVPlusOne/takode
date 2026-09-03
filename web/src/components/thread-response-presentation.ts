import { leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { ChatMessage, LeaderThreadResponseProjection, LeaderThreadResponseState } from "../types.js";
import { filterMessagesForThread, normalizeThreadKey } from "../utils/thread-projection.js";
import { extractQuestQuizMarkerIds, stripQuestQuizMarkers } from "./AssistantQuestQuizContent.js";
import type { FeedSection } from "./message-feed-sections.js";
import { isUserBoundaryEntry } from "../hooks/use-feed-model.js";

export interface CurrentThreadResponsePresentationItem {
  response: LeaderThreadResponseState;
  anchorUserMessageId: string;
  anchorTurnId: string;
  anchorOrder: number;
  sourceTurnId: string;
  messageEntry: Extract<FeedEntry, { kind: "message" }>;
  collapsedMessageEntry: Extract<FeedEntry, { kind: "message" }>;
}

export interface ThreadResponsePresentation {
  ready: boolean;
  cutoverHistoryIndex: number;
  pendingMessageCount: number;
  currentResponses: readonly CurrentThreadResponsePresentationItem[];
  currentResponseMessageIds: ReadonlySet<string>;
  quizQuestIds: readonly string[];
  quizHostTurnId: string | null;
  layoutSignature: string;
}

function presentationEntries(turn: Turn): FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function collapsedResponseEntry(
  entry: Extract<FeedEntry, { kind: "message" }>,
): Extract<FeedEntry, { kind: "message" }> {
  const visibleContent = stripQuestQuizMarkers(entry.msg.content);
  return visibleContent === entry.msg.content ? entry : { ...entry, msg: { ...entry.msg, content: visibleContent } };
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isAuthoritativeCurrentResponseMessage(
  message: ChatMessage,
  response: LeaderThreadResponseState,
  threadKey: string,
): boolean {
  const metadata = message.metadata;
  const revision = metadata?.threadResponse;
  const isResponseMessage =
    metadata?.leaderThreadRole === "response" ||
    (metadata?.leaderUserMessage === true && metadata.leaderThreadRole == null);
  if (
    message.role !== "assistant" ||
    !isResponseMessage ||
    metadata?.codexSubagent ||
    message.parentToolUseId != null ||
    !revision ||
    revision.logicalResponseId !== response.logicalResponseId ||
    revision.revisionId !== response.currentRevisionId ||
    revision.revisionNumber !== response.revisionCount ||
    revision.batchId !== response.batchId ||
    revision.batchObservedHistoryLength !== response.batchObservedHistoryLength ||
    !stringArraysEqual(revision.coveredUserMessageIds, response.coveredUserMessageIds)
  ) {
    return false;
  }
  if (typeof message.historyIndex === "number" && message.historyIndex !== response.currentHistoryIndex) return false;
  return filterMessagesForThread([message], threadKey).some((candidate) => candidate.id === message.id);
}

function collectQuestQuizIds(sections: readonly FeedSection[], cutoverHistoryIndex: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const turn of section.turns) {
      for (const entry of presentationEntries(turn)) {
        if (
          entry.kind !== "message" ||
          entry.msg.role !== "assistant" ||
          !Number.isInteger(entry.msg.historyIndex) ||
          entry.msg.historyIndex! < cutoverHistoryIndex
        )
          continue;
        for (const questId of extractQuestQuizMarkerIds(entry.msg.content)) {
          if (seen.has(questId)) continue;
          seen.add(questId);
          ids.push(questId);
        }
      }
    }
  }
  return ids;
}

function entryHistoryIndex(entry: FeedEntry | null | undefined): number | null {
  return entry?.kind === "message" && Number.isInteger(entry.msg.historyIndex) ? entry.msg.historyIndex! : null;
}

export function readyThreadResponseAppliesToTurn(turn: Turn, presentation: ThreadResponsePresentation): boolean {
  const boundaryHistoryIndex = entryHistoryIndex(turn.userEntry);
  if (boundaryHistoryIndex != null) return boundaryHistoryIndex >= presentation.cutoverHistoryIndex;

  const messageHistoryIndexes = turn.allEntries
    .map((entry) => entryHistoryIndex(entry))
    .filter((historyIndex): historyIndex is number => historyIndex != null);
  const firstMessageHistoryIndex = messageHistoryIndexes.length > 0 ? Math.min(...messageHistoryIndexes) : null;
  return firstMessageHistoryIndex != null && firstMessageHistoryIndex >= presentation.cutoverHistoryIndex;
}

export function resolveThreadResponses(
  sections: readonly FeedSection[],
  state: LeaderThreadResponseProjection | null | undefined,
  threadKey: string,
  enabled = true,
): ThreadResponsePresentation | null {
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  if (!enabled || normalizedThreadKey === "all") return null;
  if (
    !state ||
    !Number.isInteger(state.cutoverHistoryIndex) ||
    state.cutoverHistoryIndex < 0 ||
    normalizeThreadKey(state.threadKey) !== normalizedThreadKey ||
    state.currentResponses.length === 0
  ) {
    return null;
  }

  if (state.ready !== (state.pendingMessageCount === 0)) return null;
  const directUsers = new Map<string, { turnId: string; order: number; historyIndex: number }>();
  const visibleDirectUserIds = new Set<string>();
  let duplicateVisibleDirectUser = false;
  const responseEntries = new Map<string, { turnId: string; entry: Extract<FeedEntry, { kind: "message" }> }>();
  let order = 0;
  for (const section of sections) {
    for (const turn of section.turns) {
      if (isUserBoundaryEntry(turn.userEntry) && turn.userEntry?.kind === "message") {
        const userMessage = turn.userEntry.msg;
        if (
          userMessage.metadata?.leaderResponseCoverageVersion === 1 &&
          leaderResponseOwnerThreadKey(userMessage.metadata) === normalizedThreadKey
        ) {
          if (visibleDirectUserIds.has(userMessage.id)) duplicateVisibleDirectUser = true;
          visibleDirectUserIds.add(userMessage.id);
          if (typeof userMessage.historyIndex === "number") {
            directUsers.set(userMessage.id, {
              turnId: turn.id,
              order,
              historyIndex: userMessage.historyIndex,
            });
          }
        }
      }
      for (const entry of presentationEntries(turn)) {
        if (entry.kind === "message") responseEntries.set(entry.msg.id, { turnId: turn.id, entry });
      }
      order += 1;
    }
  }

  if (duplicateVisibleDirectUser) return null;

  const pendingIds = new Set<string>();
  let pendingMessageCount = 0;
  for (const batch of state.pendingBatches) {
    if (
      batch.messageCount !== batch.userMessageIds.length ||
      batch.messageCount === 0 ||
      batch.firstHistoryIndex > batch.lastHistoryIndex
    ) {
      return null;
    }
    pendingMessageCount += batch.messageCount;
    for (const messageId of batch.userMessageIds) {
      if (pendingIds.has(messageId)) return null;
      pendingIds.add(messageId);
    }
  }
  if (pendingMessageCount !== state.pendingMessageCount) return null;

  const coveredIds = new Set<string>();
  const currentResponses: CurrentThreadResponsePresentationItem[] = [];
  for (const response of state.currentResponses) {
    if (
      normalizeThreadKey(response.threadKey) !== normalizedThreadKey ||
      response.coveredUserMessageIds.length === 0 ||
      new Set(response.coveredUserMessageIds).size !== response.coveredUserMessageIds.length
    ) {
      return null;
    }
    const located = responseEntries.get(response.currentMessageId);
    if (!located || !isAuthoritativeCurrentResponseMessage(located.entry.msg, response, normalizedThreadKey))
      return null;

    const anchors = response.coveredUserMessageIds.map((messageId) => directUsers.get(messageId));
    if (anchors.some((anchor) => !anchor || anchor.historyIndex < state.cutoverHistoryIndex)) return null;
    for (let index = 1; index < anchors.length; index += 1) {
      if (anchors[index - 1]!.order >= anchors[index]!.order) return null;
    }
    for (const messageId of response.coveredUserMessageIds) {
      if (coveredIds.has(messageId) || pendingIds.has(messageId)) return null;
      coveredIds.add(messageId);
    }
    const lastAnchor = anchors.at(-1)!;
    currentResponses.push({
      response,
      anchorUserMessageId: response.coveredUserMessageIds.at(-1)!,
      anchorTurnId: lastAnchor.turnId,
      anchorOrder: lastAnchor.order,
      sourceTurnId: located.turnId,
      messageEntry: located.entry,
      collapsedMessageEntry: collapsedResponseEntry(located.entry),
    });
  }

  for (const messageId of visibleDirectUserIds) {
    if (!coveredIds.has(messageId) && !pendingIds.has(messageId)) return null;
  }

  currentResponses.sort((left, right) => left.anchorOrder - right.anchorOrder);
  const quizQuestIds = collectQuestQuizIds(sections, state.cutoverHistoryIndex);
  const lastResponse = currentResponses.at(-1) ?? null;
  const pendingSignature = state.pendingBatches
    .map(
      (batch) =>
        `${batch.userMessageIds.join(",")}:${batch.messageCount}:${batch.firstHistoryIndex}:${batch.lastHistoryIndex}`,
    )
    .join("|");
  const responseSignature = currentResponses
    .map(
      ({ response }) =>
        `${response.logicalResponseId}:${response.currentRevisionId}:${response.currentMessageId}:${response.revisionCount}:${response.coveredUserMessageIds.join(",")}`,
    )
    .join("|");

  return {
    ready: state.ready,
    cutoverHistoryIndex: state.cutoverHistoryIndex,
    pendingMessageCount: state.pendingMessageCount,
    currentResponses,
    currentResponseMessageIds: new Set(currentResponses.map(({ response }) => response.currentMessageId)),
    quizQuestIds,
    quizHostTurnId: lastResponse?.anchorTurnId ?? null,
    layoutSignature: `${state.cutoverHistoryIndex}:${state.ready ? "ready" : "active"}:${state.pendingMessageCount}:${responseSignature}:${pendingSignature}`,
  };
}
