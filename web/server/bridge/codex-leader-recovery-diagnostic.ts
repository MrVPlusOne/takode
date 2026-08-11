import type { BrowserIncomingMessage } from "../session-types.js";
import { routeFromHistoryEntry, type ThreadRouteMetadata } from "../thread-routing-metadata.js";

const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID = "system:codex-leader-recovery-diagnostic";
const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL = "Codex Recovery Diagnostic";

type CodexLeaderRecoveryDiagnosticSession = {
  messageHistory: BrowserIncomingMessage[];
};

type CodexLeaderRecoveryDiagnosticDeps<S extends CodexLeaderRecoveryDiagnosticSession> = {
  broadcastToBrowsers: (session: S, msg: BrowserIncomingMessage) => void;
};

export function appendCodexLeaderRecoveryDiagnostic<S extends CodexLeaderRecoveryDiagnosticSession>(
  session: S,
  route: ThreadRouteMetadata,
  deps: CodexLeaderRecoveryDiagnosticDeps<S>,
): void {
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
    threadKey: route.threadKey,
    ...(route.questId ? { questId: route.questId } : {}),
    ...(route.threadRefs?.length ? { threadRefs: route.threadRefs } : {}),
  };
  session.messageHistory.push(entry);
  deps.broadcastToBrowsers(session, entry);
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
    "Codex recovery diagnostic: automatic replay stopped after the partial leader response above.",
    "Takode already observed model activity for the original user delivery, so it did not inject that user payload again after recovery.",
    "No automatic replay will run because it could duplicate side effects. Review the preceding partial response and send a new continuation instruction only if the intended outcome is still missing.",
  ].join("\n");
}
