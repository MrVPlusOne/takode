import { createContext, useMemo } from "react";
import { isCanonicalLeaderUserMessageId } from "../../shared/leader-user-message-id.js";
import type { AnsweredMessageReference, ChatMessage } from "../types.js";
import type {
  ThreadResponsePresentation,
  ThreadResponseReferencedUserMessage,
} from "./thread-response-presentation.js";
import type { AnswerChrome } from "./ThreadResponsePresentationChrome.js";

/** What an answer row shows about the messages it answers. */
export interface AnswerReferenceData {
  answerCount: number;
  /** The answered messages' history IDs in answer order; empty when they are not all loaded. */
  referencedHistoryIds: readonly string[];
  referencedMessages?: readonly ThreadResponseReferencedUserMessage[];
}

/**
 * Answer references for views without a thread projection (All Threads), read
 * from each answer's settled `threadAnswer` metadata. Display only: they carry
 * no coverage or Ready authority.
 */
export const AnswerReferencesContext = createContext<ReadonlyMap<string, AnswerReferenceData> | null>(null);

interface AnswerIds {
  messageId: string;
  historyIndex: number;
  answerIds: readonly string[];
}

/**
 * Answers whose every answered message a later answer answers again. They stay
 * in the feed as history and get no answer chrome when their turn is expanded;
 * an answer naming no message is never superseded.
 */
function supersededAnswerIds(answers: readonly AnswerIds[]): Set<string> {
  const superseded = new Set<string>();
  for (const answer of answers) {
    if (answer.answerIds.length === 0) continue;
    const later = answers.filter((other) => other.historyIndex > answer.historyIndex);
    if (answer.answerIds.every((id) => later.some((other) => other.answerIds.includes(id)))) {
      superseded.add(answer.messageId);
    }
  }
  return superseded;
}

/**
 * The selected thread's answers that are still current somewhere. Coverage is
 * per thread, so an answer written for another tab's request shows here with
 * none, yet it is that request's current answer and must look like one.
 */
export function presentationAnswerReferences(
  presentation: ThreadResponsePresentation,
): Map<string, AnswerReferenceData> {
  const superseded = supersededAnswerIds(
    presentation.currentResponses.map(({ response }) => ({
      messageId: response.currentMessageId,
      historyIndex: response.currentHistoryIndex,
      answerIds: response.answerUserMessageIds,
    })),
  );
  const references = new Map<string, AnswerReferenceData>();
  for (const { response, referencedUserMessages } of presentation.currentResponses) {
    if (superseded.has(response.currentMessageId)) continue;
    references.set(response.currentMessageId, {
      answerCount: response.answerUserMessageIds.length,
      referencedHistoryIds: response.referencedUserMessageIds,
      referencedMessages: referencedUserMessages,
    });
  }
  return references;
}

/**
 * Current answers among loaded messages, from their own settled metadata. The
 * answered messages are matched by their `uN` IDs among loaded messages, then
 * among the answered messages the history window sends for requests outside
 * it; when one is in neither, the answer shows only its count.
 */
export function allThreadsAnswerReferences(
  messages: readonly ChatMessage[],
  answeredMessages: readonly AnsweredMessageReference[] = [],
): Map<string, AnswerReferenceData> {
  // A duplicated ID proves nothing about which message it names.
  const requests = new Map<string, ThreadResponseReferencedUserMessage | null>();
  const addRequest = (request: ThreadResponseReferencedUserMessage) =>
    requests.set(request.userMessageId, requests.has(request.userMessageId) ? null : request);
  for (const message of messages) {
    const userMessageId = message.metadata?.leaderUserMessageId;
    if (message.role !== "user" || !userMessageId) continue;
    const attachmentCount = Math.max(message.images?.length ?? 0, message.localImages?.length ?? 0);
    const annotations = message.metadata?.annotations;
    addRequest({
      historyMessageId: message.id,
      userMessageId,
      content: message.content,
      ...(attachmentCount > 0 ? { attachmentCount } : {}),
      ...(annotations?.length ? { annotations } : {}),
    });
  }
  for (const answered of answeredMessages) {
    // The window sends only requests outside it; a loaded copy is the same message.
    if (requests.get(answered.user_message_id)?.historyMessageId === answered.history_message_id) continue;
    addRequest({
      historyMessageId: answered.history_message_id,
      userMessageId: answered.user_message_id,
      content: answered.content,
      ...(answered.attachment_count ? { attachmentCount: answered.attachment_count } : {}),
      ...(answered.annotations?.length ? { annotations: answered.annotations } : {}),
    });
  }

  const answers: Array<AnswerIds & { message: ChatMessage }> = [];
  for (const message of messages) {
    const answerIds = message.metadata?.threadAnswer?.answerUserMessageIds;
    if (
      message.role !== "assistant" ||
      message.metadata?.leaderThreadRole !== "answer" ||
      message.metadata.codexSubagent ||
      message.parentToolUseId != null ||
      !Array.isArray(answerIds) ||
      !answerIds.every(isCanonicalLeaderUserMessageId) ||
      new Set(answerIds).size !== answerIds.length
    ) {
      continue;
    }
    answers.push({ message, messageId: message.id, historyIndex: message.historyIndex ?? Infinity, answerIds });
  }

  const superseded = supersededAnswerIds(answers);
  const references = new Map<string, AnswerReferenceData>();
  for (const { message, answerIds } of answers) {
    if (superseded.has(message.id)) continue;
    const referenced = answerIds.map((id) => requests.get(id));
    const complete = referenced.every((request): request is ThreadResponseReferencedUserMessage => request != null);
    references.set(message.id, {
      answerCount: answerIds.length,
      referencedHistoryIds: complete ? referenced.map((request) => request!.historyMessageId) : [],
      referencedMessages: complete ? (referenced as ThreadResponseReferencedUserMessage[]) : undefined,
    });
  }
  return references;
}

/**
 * All Threads' answer references, or null when `enabled` is false (other tabs
 * take theirs from the thread projection). `answeredMessages` are the requests
 * outside the loaded window that its history window sends.
 */
export function useAllThreadsAnswerReferences(
  enabled: boolean,
  messages: readonly ChatMessage[],
  answeredMessages: readonly AnsweredMessageReference[] | undefined,
): ReadonlyMap<string, AnswerReferenceData> | null {
  return useMemo(
    () => (enabled ? allThreadsAnswerReferences(messages, answeredMessages) : null),
    [enabled, messages, answeredMessages],
  );
}

/**
 * The answer chrome for `message`, or null when it is not a current answer.
 * `followsMessageId` names the user message rendered right above it, when it is
 * the first thing under that message.
 */
export function answerChromeFor(
  message: ChatMessage,
  references: ReadonlyMap<string, AnswerReferenceData> | null,
  followsMessageId?: string,
): AnswerChrome | null {
  const reference = references?.get(message.id);
  if (!reference) return null;
  return {
    message,
    messageCount: reference.answerCount,
    referencedMessages: reference.referencedMessages,
    answersMessageAbove:
      followsMessageId !== undefined &&
      reference.referencedHistoryIds.length === 1 &&
      reference.referencedHistoryIds[0] === followsMessageId,
  };
}
