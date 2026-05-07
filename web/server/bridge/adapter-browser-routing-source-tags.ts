import type { BrowserOutgoingMessage } from "../session-types.js";

type BrowserUserMessage = Extract<BrowserOutgoingMessage, { type: "user_message" }>;
type InterruptSource = "user" | "leader" | "system";

export function isSystemSourceTag(agentSource: BrowserUserMessage["agentSource"]): boolean {
  if (!agentSource) return false;
  return agentSource.sessionId === "system" || agentSource.sessionId.startsWith("system:");
}

export function isTimerSourceTag(agentSource: BrowserUserMessage["agentSource"]): boolean {
  return agentSource?.sessionId.startsWith("timer:") ?? false;
}

export function isTimerReminderContent(content: string | undefined): boolean {
  return /^\[⏰ Timer [^\]\s]+ reminder\]/.test(content ?? "");
}

export function getInterruptSourceFromActorSessionId(actorSessionId: string | undefined): InterruptSource {
  if (!actorSessionId) return "user";
  return isSystemSourceTag({ sessionId: actorSessionId }) ? "system" : "leader";
}
