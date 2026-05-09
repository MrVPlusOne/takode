import type { BrowserIncomingMessage } from "./session-types.js";
import { isCompactionRecoveryPrompt, isLeaderKickoffPrompt } from "../shared/injected-event-message.js";

export interface UserMessageSourceLike {
  type?: unknown;
  agentSource?: unknown;
  content?: unknown;
  timestamp?: unknown;
}

export interface UserInputSourceLike {
  agentSource?: unknown;
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

export function computeSessionTurnMetrics(messages: readonly BrowserIncomingMessage[]): SessionTurnMetrics {
  let userTurnCount = 0;
  let agentTurnCount = 0;
  let sawTopLevelAssistantSinceResult = false;

  for (const message of messages) {
    if (isActualHumanUserMessage(message)) {
      userTurnCount++;
    }

    if (isTopLevelAssistantMessage(message)) {
      sawTopLevelAssistantSinceResult = true;
      continue;
    }

    if (message.type !== "result") continue;
    if (sawTopLevelAssistantSinceResult) {
      agentTurnCount++;
    }
    sawTopLevelAssistantSinceResult = false;
  }

  return { userTurnCount, agentTurnCount };
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

function isInjectedUserPrompt(content: string): boolean {
  return isCompactionRecoveryPrompt(content) || isLeaderKickoffPrompt(content);
}

function isTopLevelAssistantMessage(message: BrowserIncomingMessage): boolean {
  if (message.type !== "assistant") return false;
  return (message as { parent_tool_use_id?: string | null }).parent_tool_use_id == null;
}
