import {
  leaderResponseExactAnswerThreadKey,
  leaderResponseMessageIsAssociatedWithThread,
  leaderResponseOwnerThreadKey,
} from "../../shared/leader-thread-response-routing.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { ChatMessage, LeaderThreadResponseProjection, LeaderThreadResponseState } from "../types.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
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

export interface ThreadResponseQuizGroup {
  hostTurnId: string;
  questIds: readonly string[];
}

export interface ThreadResponsePresentation {
  ready: boolean;
  cutoverHistoryIndex: number;
  pendingMessageCount: number;
  currentResponses: readonly CurrentThreadResponsePresentationItem[];
  currentResponseMessageIds: ReadonlySet<string>;
  quizGroups: readonly ThreadResponseQuizGroup[];
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

function isAuthoritativeCurrentResponseMessage(message: ChatMessage, answer: LeaderThreadResponseState): boolean {
  const metadata = message.metadata;
  const explicitProof =
    answer.source === "explicit" &&
    metadata?.leaderThreadRole === "answer" &&
    metadata.threadAnswer?.version === answer.version &&
    stringArraysEqual(metadata.threadAnswer.answerUserMessageIds, answer.answerUserMessageIds);
  const legacyProof =
    answer.source === "legacy" &&
    (metadata?.leaderThreadRole === "response" ||
      (metadata?.leaderUserMessage === true && metadata.leaderThreadRole == null)) &&
    stringArraysEqual(metadata?.threadResponse?.coveredUserMessageIds ?? [], answer.referencedUserMessageIds);
  if (
    message.role !== "assistant" ||
    (!explicitProof && !legacyProof) ||
    metadata?.codexSubagent ||
    message.parentToolUseId != null
  ) {
    return false;
  }
  if (!Number.isInteger(message.historyIndex) || message.historyIndex !== answer.currentHistoryIndex) return false;
  return leaderResponseExactAnswerThreadKey(metadata ?? {}) === normalizeThreadKey(answer.threadKey);
}

function collectQuestQuizGroups(
  sections: readonly FeedSection[],
  cutoverHistoryIndex: number,
): ThreadResponseQuizGroup[] {
  const groups: ThreadResponseQuizGroup[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const turn of section.turns) {
      const questIds: string[] = [];
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
          questIds.push(questId);
        }
      }
      // Ready collapse may relocate current responses to their covered prompt, but a Quiz
      // remains owned by the turn that actually carried its hidden directive.
      if (questIds.length > 0) groups.push({ hostTurnId: turn.id, questIds });
    }
  }
  return groups;
}

function entryHistoryIndex(entry: FeedEntry | null | undefined): number | null {
  return entry?.kind === "message" && Number.isInteger(entry.msg.historyIndex) ? entry.msg.historyIndex! : null;
}

export function threadResponsePresentationTouchesTurn(turn: Turn, presentation: ThreadResponsePresentation): boolean {
  return (
    presentation.currentResponses.some((item) => item.anchorTurnId === turn.id || item.sourceTurnId === turn.id) ||
    presentation.quizGroups.some((group) => group.hostTurnId === turn.id)
  );
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
    state.currentAnswers.length === 0
  ) {
    return null;
  }

  if (state.ready !== (state.pendingMessageCount === 0)) return null;
  const projectedUserMessageIds = new Map<string, string>();
  let conflictingProjectedUserMessageId = false;
  const registerProjectedUserMessageId = (historyMessageId: string, userMessageId: string) => {
    const existing = projectedUserMessageIds.get(historyMessageId);
    if (existing && existing !== userMessageId) conflictingProjectedUserMessageId = true;
    else projectedUserMessageIds.set(historyMessageId, userMessageId);
  };
  for (const pending of state.pendingMessages) {
    registerProjectedUserMessageId(pending.historyMessageId, pending.userMessageId);
  }
  for (const response of state.currentAnswers) {
    if (response.referencedUserMessageIds.length !== response.answerUserMessageIds.length) return null;
    response.referencedUserMessageIds.forEach((historyMessageId, index) => {
      registerProjectedUserMessageId(historyMessageId, response.answerUserMessageIds[index]!);
    });
  }
  if (conflictingProjectedUserMessageId) return null;

  const directUsers = new Map<
    string,
    { turnId: string; order: number; historyIndex: number; userMessageId: string; ownerThreadKey: string }
  >();
  const visibleOwnedDirectUserIds = new Set<string>();
  const seenVisibleDirectUserIds = new Set<string>();
  let duplicateVisibleDirectUser = false;
  let invalidVisibleDirectUser = false;
  const responseEntries = new Map<string, { turnId: string; entry: Extract<FeedEntry, { kind: "message" }> }>();
  const duplicateResponseEntryIds = new Set<string>();
  let order = 0;
  for (const section of sections) {
    for (const turn of section.turns) {
      if (isUserBoundaryEntry(turn.userEntry) && turn.userEntry?.kind === "message") {
        const userMessage = turn.userEntry.msg;
        const ownerThreadKey = leaderResponseOwnerThreadKey(userMessage.metadata ?? {});
        const projectedUserMessageId = projectedUserMessageIds.get(userMessage.id);
        const persistedUserMessageId = userMessage.metadata?.leaderUserMessageId;
        if (userMessage.metadata?.leaderResponseCoverageVersion === 1 && ownerThreadKey) {
          if (ownerThreadKey === normalizedThreadKey) visibleOwnedDirectUserIds.add(userMessage.id);
          if (!leaderResponseMessageIsAssociatedWithThread(userMessage.metadata, normalizedThreadKey)) continue;

          if (seenVisibleDirectUserIds.has(userMessage.id)) duplicateVisibleDirectUser = true;
          seenVisibleDirectUserIds.add(userMessage.id);
          if (persistedUserMessageId && projectedUserMessageId && persistedUserMessageId !== projectedUserMessageId) {
            invalidVisibleDirectUser = true;
          }
          const userMessageId = persistedUserMessageId ?? projectedUserMessageId;
          if (typeof userMessageId === "string" && typeof userMessage.historyIndex === "number") {
            directUsers.set(userMessage.id, {
              turnId: turn.id,
              order,
              historyIndex: userMessage.historyIndex,
              userMessageId,
              ownerThreadKey,
            });
          }
        }
      }
      for (const entry of presentationEntries(turn)) {
        if (entry.kind !== "message") continue;
        if (responseEntries.has(entry.msg.id)) duplicateResponseEntryIds.add(entry.msg.id);
        responseEntries.set(entry.msg.id, { turnId: turn.id, entry });
      }
      order += 1;
    }
  }

  if (duplicateVisibleDirectUser || invalidVisibleDirectUser) return null;

  const pendingIds = new Set<string>();
  const pendingAnswerIds = new Set<string>();
  for (const pending of state.pendingMessages) {
    const directUser = directUsers.get(pending.historyMessageId);
    if (
      pendingIds.has(pending.historyMessageId) ||
      pendingAnswerIds.has(pending.userMessageId) ||
      !directUser ||
      directUser.ownerThreadKey !== normalizedThreadKey ||
      directUser.userMessageId !== pending.userMessageId
    ) {
      return null;
    }
    pendingIds.add(pending.historyMessageId);
    pendingAnswerIds.add(pending.userMessageId);
  }
  if (state.pendingMessages.length !== state.pendingMessageCount) return null;

  const coveredIds = new Set<string>();
  const seenResponseMessageIds = new Set<string>();
  const seenResponseHistoryIndexes = new Set<number>();
  const currentResponses: CurrentThreadResponsePresentationItem[] = [];
  for (const response of state.currentAnswers) {
    const responseThreadKey = normalizeThreadKey(response.threadKey);
    const associationProjection = responseThreadKey !== normalizedThreadKey;
    if (
      (responseThreadKey !== "main" && !/^q-\d+$/.test(responseThreadKey)) ||
      (associationProjection && response.source !== "explicit") ||
      response.referencedUserMessageIds.length === 0 ||
      response.referencedUserMessageIds.length !== response.answerUserMessageIds.length ||
      response.coveredUserMessageIds.length === 0 ||
      response.coveredUserMessageIds.length !== response.coveredAnswerUserMessageIds.length ||
      new Set(response.referencedUserMessageIds).size !== response.referencedUserMessageIds.length ||
      new Set(response.coveredUserMessageIds).size !== response.coveredUserMessageIds.length ||
      response.coveredUserMessageIds.some((messageId) => !response.referencedUserMessageIds.includes(messageId)) ||
      seenResponseMessageIds.has(response.currentMessageId) ||
      seenResponseHistoryIndexes.has(response.currentHistoryIndex) ||
      duplicateResponseEntryIds.has(response.currentMessageId)
    ) {
      return null;
    }
    seenResponseMessageIds.add(response.currentMessageId);
    seenResponseHistoryIndexes.add(response.currentHistoryIndex);
    const located = responseEntries.get(response.currentMessageId);
    if (!located || !isAuthoritativeCurrentResponseMessage(located.entry.msg, response)) return null;

    const referencedAnchors = response.referencedUserMessageIds.map((messageId) => directUsers.get(messageId));
    if (
      referencedAnchors.some(
        (anchor, index) =>
          !anchor ||
          anchor.historyIndex < state.cutoverHistoryIndex ||
          anchor.ownerThreadKey !== responseThreadKey ||
          anchor.userMessageId !== response.answerUserMessageIds[index],
      )
    ) {
      return null;
    }
    const anchors = response.coveredUserMessageIds.map((messageId) => directUsers.get(messageId));
    if (
      anchors.some(
        (anchor, index) =>
          !anchor ||
          anchor.historyIndex < state.cutoverHistoryIndex ||
          anchor.ownerThreadKey !== responseThreadKey ||
          anchor.userMessageId !== response.coveredAnswerUserMessageIds[index],
      )
    ) {
      return null;
    }
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

  for (const messageId of visibleOwnedDirectUserIds) {
    if (!coveredIds.has(messageId) && !pendingIds.has(messageId)) return null;
  }

  currentResponses.sort((left, right) => left.anchorOrder - right.anchorOrder);
  const quizGroups = collectQuestQuizGroups(sections, state.cutoverHistoryIndex);
  const pendingSignature = state.pendingMessages
    .map((pending) => `${pending.userMessageId}:${pending.historyMessageId}:${pending.historyIndex}`)
    .join("|");
  const responseSignature = currentResponses
    .map(
      ({ response }) =>
        `${response.currentMessageId}:${response.threadKey}:${response.answerUserMessageIds.join(",")}:${response.coveredAnswerUserMessageIds.join(",")}:${response.source}`,
    )
    .join("|");

  const quizSignature = quizGroups.map((group) => `${group.hostTurnId}:${group.questIds.join(",")}`).join("|");

  return {
    ready: state.ready,
    cutoverHistoryIndex: state.cutoverHistoryIndex,
    pendingMessageCount: state.pendingMessageCount,
    currentResponses,
    currentResponseMessageIds: new Set(currentResponses.map(({ response }) => response.currentMessageId)),
    quizGroups,
    layoutSignature: `${state.cutoverHistoryIndex}:${state.ready ? "ready" : "active"}:${state.pendingMessageCount}:${responseSignature}:${pendingSignature}:${quizSignature}`,
  };
}
