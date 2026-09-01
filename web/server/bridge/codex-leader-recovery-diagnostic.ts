import type { BrowserIncomingMessage } from "../session-types.js";
import { routeFromHistoryEntry, type ThreadRouteMetadata } from "../thread-routing-metadata.js";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  isCodexLeaderRecoveryDiagnosticSourceId,
} from "../../shared/injected-event-message.js";

type CodexLeaderRecoveryDiagnosticSession = {
  messageHistory: BrowserIncomingMessage[];
};

type CodexLeaderRecoveryDiagnosticDeps<S extends CodexLeaderRecoveryDiagnosticSession> = {
  broadcastToBrowsers: (session: S, msg: BrowserIncomingMessage) => void;
};

export type CodexLeaderRecoveryDiagnosticAppendResult = "appended" | "existing_unresolved" | "resolved_conflict";

export function appendCodexLeaderRecoveryDiagnostic<S extends CodexLeaderRecoveryDiagnosticSession>(
  session: S,
  recoveryId: string,
  route: ThreadRouteMetadata,
  deps: CodexLeaderRecoveryDiagnosticDeps<S>,
): CodexLeaderRecoveryDiagnosticAppendResult {
  const existing = session.messageHistory.filter(
    (message): message is Extract<BrowserIncomingMessage, { type: "user_message" }> =>
      message.type === "user_message" &&
      message.codexTurnRecoveryId === recoveryId &&
      isCodexLeaderRecoveryDiagnosticSourceId(message.agentSource?.sessionId),
  );
  if (existing.some((message) => message.codexTurnRecoveryResolvedAt == null)) return "existing_unresolved";
  if (existing.length > 0) return "resolved_conflict";
  const timestamp = Date.now();
  const entry: Extract<BrowserIncomingMessage, { type: "user_message" }> = {
    type: "user_message",
    id: `codex-leader-recovery-diagnostic-${timestamp}-${session.messageHistory.length}`,
    timestamp,
    content: buildCodexLeaderRecoveryDiagnosticContent(),
    agentSource: {
      sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
      sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
    },
    codexTurnRecoveryId: recoveryId,
    threadKey: route.threadKey,
    ...(route.questId ? { questId: route.questId } : {}),
    ...(route.threadRefs?.length ? { threadRefs: route.threadRefs } : {}),
  };
  session.messageHistory.push(entry);
  deps.broadcastToBrowsers(session, entry);
  return "appended";
}

export function leaderRouteFromRecoveredAssistant(
  isLeaderSession: boolean,
  entry: BrowserIncomingMessage,
): ThreadRouteMetadata | null {
  if (!isLeaderSession) return null;
  if (entry.type !== "assistant") return null;
  return routeFromHistoryEntry(entry);
}

function buildCodexLeaderRecoveryDiagnosticContent(): string {
  return [
    "Takode stopped after the partial response above.",
    "Some model or tool activity had already happened, so retrying automatically could repeat actions.",
    'Review the partial response. If the intended outcome is still missing, send a new instruction in this thread. If the work is already complete, open "Check interrupted work" and choose "Work is complete" to clear this notice.',
  ].join("\n");
}
