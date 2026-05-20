import type { BrowserIncomingMessage } from "../session-types.js";
import { routeFromHistoryEntry, type ThreadRouteMetadata } from "../thread-routing-metadata.js";

const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID = "system:codex-leader-recovery-diagnostic";
const CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL = "Codex Recovery Diagnostic";
const CODEX_ASSISTANT_ONLY_RESUME_RETRY_CAP = 2;

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
    "Codex recovery diagnostic: automatic recovery exhausted after the partial leader response above.",
    `Takode retried the interrupted assistant-only turn ${CODEX_ASSISTANT_ONLY_RESUME_RETRY_CAP} times, but no final response was recovered.`,
    "No further automatic retry will run to avoid duplicate side effects. Review the preceding partial response and continue or retry this thread if the intended outcome is still missing.",
  ].join("\n");
}
