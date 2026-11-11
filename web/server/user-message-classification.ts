import { formatAnnotatedMessage, type ConversationAnnotation } from "../shared/conversation-annotations.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { formatReplyContentForPreview, type ReplyContext } from "../shared/reply-context.js";
import { isCompactionRecoveryPrompt, isLeaderKickoffPrompt } from "../shared/injected-event-message.js";

export interface UserMessageSourceLike {
  type?: unknown;
  agentSource?: unknown;
  content?: unknown;
  timestamp?: unknown;
  codexSubagent?: unknown;
  annotations?: ConversationAnnotation[];
  replyContext?: ReplyContext;
}

export interface UserInputSourceLike {
  agentSource?: unknown;
  timestamp?: unknown;
}

/** Restore preview ownership across retained history and still-pending input. */
export function restoreSessionMessagePreview(session: {
  messageHistory: readonly UserMessageSourceLike[];
  pendingCodexInputs?: readonly UserMessageSourceLike[];
  lastUserMessage?: string;
  lastMessagePreviewAt?: number;
}): void {
  let latest: { content: string; replyContext?: ReplyContext; timestamp: number } | undefined;
  for (const candidate of [...(session.pendingCodexInputs ?? []), ...session.messageHistory]) {
    if (candidate.type !== undefined && (candidate.type !== "user_message" || candidate.codexSubagent)) continue;
    if (typeof candidate.content !== "string") continue;
    if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp)) continue;
    if (candidate.timestamp < (latest?.timestamp ?? -1)) continue;
    latest = {
      content: formatAnnotatedMessage(candidate.content, candidate.annotations),
      replyContext: candidate.replyContext,
      timestamp: candidate.timestamp,
    };
  }
  session.lastUserMessage = latest
    ? formatReplyContentForPreview(latest.content, latest.replyContext).slice(0, 80)
    : undefined;
  session.lastMessagePreviewAt = latest?.timestamp;
}

export function isActualHumanUserMessage(
  message: UserMessageSourceLike,
): message is UserMessageSourceLike & { type: "user_message" } {
  if (message.type !== "user_message") return false;
  if (message.agentSource != null) return false;
  if (typeof message.content === "string" && isInjectedUserPrompt(message.content)) return false;
  return true;
}

export function isActualHumanUserInput(input: UserInputSourceLike): boolean {
  return input.agentSource == null;
}

export interface SessionTurnMetrics {
  /** Human/operator-authored user_message entries. Used for the visible turns label. */
  userTurnCount: number;
  /**
   * Completed assistant turns, counted when a result closes a history span that
   * contained at least one top-level assistant message.
   */
  agentTurnCount: number;
}

interface TurnMetricsScan {
  userTurnCount: number;
  agentTurnCount: number;
  sawTopLevelAssistantSinceResult: boolean;
}

/** How far a history was counted: its length then and its last message, to see that it only grew since. */
const turnMetricsScans = new WeakMap<
  readonly BrowserIncomingMessage[],
  TurnMetricsScan & { length: number; last: BrowserIncomingMessage | undefined }
>();

/**
 * Turn counts of a history, plus `next` when given (a message about to be added).
 *
 * The session list asks for every session's counts on each poll and a result asks on every turn
 * end, and big sessions hold tens of thousands of messages, so a history that only grew since it
 * was last counted is counted from where that count stopped. A history that shrank or whose last
 * counted message was replaced is counted again from the start. Messages are not expected to
 * change type, sender or text once added.
 */
export function computeSessionTurnMetrics(
  messages: readonly BrowserIncomingMessage[],
  next?: BrowserIncomingMessage,
): SessionTurnMetrics {
  const cached = turnMetricsScans.get(messages);
  const resumable =
    cached !== undefined && cached.length <= messages.length && messages[cached.length - 1] === cached.last;
  const scan: TurnMetricsScan = resumable
    ? { ...cached }
    : { userTurnCount: 0, agentTurnCount: 0, sawTopLevelAssistantSinceResult: false };
  for (let i = resumable ? cached.length : 0; i < messages.length; i++) countTurn(scan, messages[i]!);
  turnMetricsScans.set(messages, { ...scan, length: messages.length, last: messages.at(-1) });
  if (next) countTurn(scan, next);
  return { userTurnCount: scan.userTurnCount, agentTurnCount: scan.agentTurnCount };
}

function countTurn(scan: TurnMetricsScan, message: BrowserIncomingMessage): void {
  if (isActualHumanUserMessage(message)) scan.userTurnCount++;
  if (isTopLevelAssistantMessage(message)) {
    scan.sawTopLevelAssistantSinceResult = true;
    return;
  }
  if (message.type !== "result") return;
  if (scan.sawTopLevelAssistantSinceResult) scan.agentTurnCount++;
  scan.sawTopLevelAssistantSinceResult = false;
}

export function getLastActualHumanUserMessageTimestamp(
  messages: readonly BrowserIncomingMessage[],
): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || !isActualHumanUserMessage(message)) continue;
    if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
  }
  return undefined;
}

export function getLastActualHumanInputTimestamp(
  messages: readonly BrowserIncomingMessage[],
  pendingInputs: readonly UserInputSourceLike[] = [],
): number | undefined {
  let latest = getLastActualHumanUserMessageTimestamp(messages);
  for (const input of pendingInputs) {
    if (!isActualHumanUserInput(input) || typeof input.timestamp !== "number" || !Number.isFinite(input.timestamp)) {
      continue;
    }
    if (latest === undefined || input.timestamp > latest) latest = input.timestamp;
  }
  return latest;
}

function isInjectedUserPrompt(content: string): boolean {
  return isCompactionRecoveryPrompt(content) || isLeaderKickoffPrompt(content);
}

function isTopLevelAssistantMessage(message: BrowserIncomingMessage): boolean {
  if (message.type !== "assistant") return false;
  return (message as { parent_tool_use_id?: string | null }).parent_tool_use_id == null;
}
