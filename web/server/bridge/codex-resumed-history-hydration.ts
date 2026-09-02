import { normalizeCodexMessagePhase } from "../../shared/codex-message-phase.js";
import { formatReplyContentForPreview } from "../../shared/reply-context.js";
import type { CodexResumeSnapshot } from "../codex-adapter.js";
import type { BrowserIncomingMessage, SessionState } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import { extractUserTextFromResumedTurn } from "./codex-delivery-ownership.js";
import {
  buildCodexRecoveredAssistantRouteSegments,
  codexRecoveredAssistantModel,
} from "./codex-recovered-assistant-routing.js";

interface CodexResumedHistorySessionLike {
  id: string;
  state: Pick<SessionState, "isOrchestrator" | "model">;
  messageHistory: BrowserIncomingMessage[];
  pendingCodexTurns: unknown[];
  _frozenCount?: number;
  lastUserMessage?: string;
  lastMessagePreviewAt?: number;
}

export function hydrateCodexResumedHistory<TSession extends CodexResumedHistorySessionLike>(
  session: TSession,
  snapshot: CodexResumeSnapshot,
  deps: {
    broadcastToBrowsers: (session: TSession, message: BrowserIncomingMessage) => void;
    persistSession: (session: TSession) => void;
  },
): number {
  if (session.messageHistory.length > 0 || session.pendingCodexTurns.length > 0) return 0;
  if (!Array.isArray(snapshot.turns) || snapshot.turns.length === 0) return 0;

  const totalEntries = snapshot.turns.reduce((count, turn) => {
    let turnCount = 0;
    for (const item of turn.items) {
      if (item.type === "userMessage" || item.type === "agentMessage") turnCount += 1;
    }
    return count + turnCount;
  }, 0);
  if (totalEntries === 0) return 0;

  let hydrated = 0;
  let syntheticTimestamp = Math.max(1, Date.now() - totalEntries - 1);
  for (const turn of snapshot.turns) {
    for (let i = 0; i < turn.items.length; i++) {
      const item = turn.items[i];
      if (item.type === "userMessage") {
        const text = extractUserTextFromResumedTurn({ ...turn, items: [item] });
        if (!text.trim()) continue;
        const userMessage: Extract<BrowserIncomingMessage, { type: "user_message" }> = {
          type: "user_message",
          content: text,
          timestamp: ++syntheticTimestamp,
          id: `codex-resume-user-${turn.id || "turn"}-${i}`,
        };
        session.messageHistory.push(userMessage);
        session.lastUserMessage = formatReplyContentForPreview(text).slice(0, 80);
        session.lastMessagePreviewAt = syntheticTimestamp;
        deps.broadcastToBrowsers(session, userMessage);
        hydrated += 1;
        continue;
      }

      if (item.type !== "agentMessage") continue;
      const text = typeof item.text === "string" ? item.text : "";
      if (!text.trim()) continue;
      const itemId = typeof item.id === "string" ? item.id : `${turn.id || "turn"}-${i}`;
      const assistantId = `codex-agent-${itemId}`;
      const alreadyExists = session.messageHistory.some(
        (msg) => msg.type === "assistant" && msg.message?.id === assistantId,
      );
      if (alreadyExists) continue;

      for (const [segmentIndex, routed] of buildCodexRecoveredAssistantRouteSegments(session, text).entries()) {
        const assistant: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
          type: "assistant",
          message: {
            id: segmentIndex === 0 ? assistantId : `${assistantId}:route-${segmentIndex}`,
            type: "message",
            role: "assistant",
            model: codexRecoveredAssistantModel(session),
            content: routed.content,
            stop_reason: null,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
          parent_tool_use_id: null,
          codexMessagePhase: normalizeCodexMessagePhase(item.phase),
          timestamp: ++syntheticTimestamp,
          ...(routed.threadKey ? { threadKey: routed.threadKey } : {}),
          ...(routed.questId ? { questId: routed.questId } : {}),
          ...(routed.threadRefs ? { threadRefs: routed.threadRefs } : {}),
          ...(routed.threadRoutingError ? { threadRoutingError: routed.threadRoutingError } : {}),
        };
        session.messageHistory.push(assistant);
        deps.broadcastToBrowsers(session, assistant);
        hydrated += 1;
      }
    }
  }

  if (hydrated > 0) {
    console.log(
      `[ws-bridge] Hydrated ${hydrated} resumed Codex history message(s) for session ${sessionTag(session.id)} from thread ${snapshot.threadId}`,
    );
    deps.persistSession(session);
  }
  return hydrated;
}
