import type { ContentBlock, TakodeTurnEndEventData } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";

export type TurnToolSummary = Pick<
  TakodeTurnEndEventData,
  "tools" | "resultPreview" | "msgRange" | "questChange" | "userMsgs"
>;

/** Build the compact turn-end summary consumed by lifecycle and herd events. */
export function buildTurnToolSummary(session: Session): TurnToolSummary {
  const toolCounts: Record<string, number> = {};
  let resultPreview: string | undefined;
  const history = session.messageHistory;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    // Stop at the prior user/result boundary; the current result is appended later.
    if (message.type === "user_message" || message.type === "result") {
      if (message.type === "result") {
        resultPreview = (message as { data?: { result?: string } }).data?.result?.slice(0, 200);
      }
      break;
    }
    if (message.type !== "assistant") continue;
    const content = (message as { message?: { content?: ContentBlock[] } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use") toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
    }
  }

  const msgFrom = session.messageCountAtTurnStart;
  const msgTo = history.length > 0 ? history.length - 1 : 0;
  const msgRange = msgFrom < msgTo ? { from: msgFrom, to: msgTo } : undefined;
  const currentQuestStatus = session.state.claimedQuestStatus ?? null;
  const previousQuestStatus = session.questStatusAtTurnStart;
  const questChange =
    previousQuestStatus !== currentQuestStatus && session.state.claimedQuestId
      ? {
          questId: session.state.claimedQuestId,
          from: previousQuestStatus || "none",
          to: currentQuestStatus || "none",
        }
      : undefined;
  const userMsgs =
    session.userMessageIdsThisTurn.length > 0
      ? { count: session.userMessageIdsThisTurn.length, ids: [...session.userMessageIdsThisTurn] }
      : undefined;

  return {
    ...(Object.keys(toolCounts).length > 0 ? { tools: toolCounts } : {}),
    ...(resultPreview ? { resultPreview } : {}),
    ...(msgRange ? { msgRange } : {}),
    ...(questChange ? { questChange } : {}),
    ...(userMsgs ? { userMsgs } : {}),
  };
}
