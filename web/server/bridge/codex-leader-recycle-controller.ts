import type { BrowserIncomingMessage, CodexLeaderRecycleTrigger } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";

export interface CodexLeaderRecycleSessionDeps {
  clearAllCodexToolResultWatchdogs: (session: Session) => void;
  markCodexIntentionalRelaunch: (session: Session, reason: string, guardMs: number) => void;
  persistSession: (session: Session) => void;
  replaceQueuedTurnLifecycleEntries: (session: Session) => void;
  setGenerating: (session: Session, generating: boolean, reason: string) => void;
}

export function buildCodexLeaderRecycleTokenUsage(session: Session) {
  const tokenDetails = session.state.codex_token_details;
  if (!tokenDetails && typeof session.state.context_used_percent !== "number") return undefined;
  return {
    contextTokensUsed: tokenDetails?.contextTokensUsed,
    contextUsedPercent: session.state.context_used_percent,
    modelContextWindow: tokenDetails?.modelContextWindow,
    inputTokens: tokenDetails?.inputTokens,
    cachedInputTokens: tokenDetails?.cachedInputTokens,
    outputTokens: tokenDetails?.outputTokens,
    reasoningOutputTokens: tokenDetails?.reasoningOutputTokens,
  };
}

export function prepareCodexLeaderRecycleSession(
  session: Session,
  trigger: CodexLeaderRecycleTrigger,
  guardMs: number,
  deps: CodexLeaderRecycleSessionDeps,
): void {
  const continuation = buildCodexLeaderRecycleContinuation(session, trigger);
  deps.clearAllCodexToolResultWatchdogs(session);
  session.pendingMessages = [];
  session.forceCompactPending = false;
  session.pendingCodexTurns = [];
  session.pendingCodexInputs = [];
  session.pendingCodexRollback = null;
  session.pendingCodexRollbackError = null;
  session.pendingCodexRollbackWaiter = null;
  session.pendingPermissions.clear();
  session.pendingQuestCommands.clear();
  session.codexFreshTurnRequiredUntilTurnId = null;
  session.lastOutboundUserNdjson = null;
  session.state.is_compacting = false;
  session.codexLeaderRecycleContinuation = continuation;
  deps.replaceQueuedTurnLifecycleEntries(session);
  session.interruptedDuringTurn = true;
  session.interruptSourceDuringTurn = "system";
  deps.markCodexIntentionalRelaunch(session, `leader_recycle:${trigger}`, guardMs);
  session.relaunchPending = true;
  deps.setGenerating(session, false, "codex_leader_recycle");
  deps.persistSession(session);
}

function buildCodexLeaderRecycleContinuation(
  session: Session,
  trigger: CodexLeaderRecycleTrigger,
): Session["codexLeaderRecycleContinuation"] {
  const requestedAt = Date.now();
  const recent = summarizeRecentLeaderTurnContext(session.messageHistory);
  const route = session.activeTurnRoute ?? recent.route;
  const routeText =
    route?.threadKey || route?.questId ? `\nActive thread before recycle: ${route.threadKey ?? route.questId}` : "";
  const content = [
    "Codex leader recycle interrupted the previous leader turn before it reached a final response.",
    "Do not treat any partial assistant text before this message as a completed continuation.",
    "Recover enough context from this session's recent history and durable quest/board state, then continue the interrupted workflow if it is safe. If you cannot continue safely, say exactly what is recoverable or what user/leader action is needed.",
    `Recycle trigger: ${trigger}.${routeText}`,
    recent.summary,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    trigger,
    requestedAt,
    content,
    ...(route?.threadKey ? { threadKey: route.threadKey } : {}),
    ...(route?.questId ? { questId: route.questId } : {}),
  };
}

function summarizeRecentLeaderTurnContext(history: BrowserIncomingMessage[]): {
  summary: string;
  route: Session["activeTurnRoute"] | null;
} {
  const selected = history
    .slice(-30)
    .filter(
      (entry) => entry.type === "user_message" || entry.type === "assistant" || entry.type === "tool_result_preview",
    )
    .slice(-8);
  const lines: string[] = [];
  let route: Session["activeTurnRoute"] | null = null;
  for (const entry of selected) {
    if (!route && (entry as { threadKey?: string; questId?: string }).threadKey) {
      route = {
        threadKey: (entry as { threadKey: string }).threadKey,
        questId: (entry as { questId?: string }).questId,
      };
    }
    const summary = summarizeHistoryEntry(entry);
    if (summary) lines.push(summary);
  }
  return {
    summary: lines.length ? `Recent visible context before recycle:\n${lines.join("\n")}` : "",
    route,
  };
}

function summarizeHistoryEntry(entry: BrowserIncomingMessage): string | null {
  if (entry.type === "user_message") return `- user: ${truncateOneLine(entry.content)}`;
  if (entry.type === "assistant") {
    const text = (entry.message.content || [])
      .map((block) => (block.type === "text" ? block.text : block.type === "tool_use" ? `tool:${block.name}` : ""))
      .filter(Boolean)
      .join(" ");
    return text ? `- assistant: ${truncateOneLine(text)}` : null;
  }
  if (entry.type === "tool_result_preview") {
    const text = entry.previews
      .map((preview) => `${preview.tool_use_id}: ${preview.content}`)
      .filter(Boolean)
      .join(" ");
    return text ? `- tool result: ${truncateOneLine(text)}` : null;
  }
  return null;
}

function truncateOneLine(text: string, max = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
