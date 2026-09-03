import { normalizeCodexMessagePhase } from "../../shared/codex-message-phase.js";
import { sameCodexNativeSubagentOwnership } from "../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { routeFromHistoryEntry, sameThreadRoute } from "../thread-routing-metadata.js";
import type { Session } from "./ws-bridge-session.js";

const CODEX_ASSISTANT_REPLAY_DEDUP_WINDOW_MS = 15_000;
const CODEX_ASSISTANT_REPLAY_SCAN_LIMIT = 200;

type AssistantMessage = Extract<BrowserIncomingMessage, { type: "assistant" }>;
type ToolUseBlock = Extract<AssistantMessage["message"]["content"][number], { type: "tool_use" }>;

type SyntheticPlanState = {
  block: ToolUseBlock;
  blockIndex: number;
  key: string;
  sequence: number;
  signature: string;
};

export type CodexPlanReplayPreparation = {
  message: AssistantMessage;
  isDuplicate: boolean;
};

function extractSyntheticPlan(message: AssistantMessage): SyntheticPlanState | null {
  const blockIndex = message.message.content.findIndex(
    (block) => block.type === "tool_use" && block.name === "TodoWrite" && block.id.startsWith("codex-plan-"),
  );
  if (blockIndex < 0) return null;
  const block = message.message.content[blockIndex] as ToolUseBlock;
  const match = block.id.match(/^codex-plan-(.+)-(\d+)$/);
  if (!match || !Array.isArray(block.input.todos)) return null;
  return {
    block,
    blockIndex,
    key: match[1],
    sequence: Number.parseInt(match[2], 10),
    signature: JSON.stringify(block.input.todos),
  };
}

function leaderAnswerIdsKey(message: AssistantMessage): string {
  if (message.leaderThreadRole !== "answer") return "";
  return (message.threadAnswer?.answerUserMessageIds ?? message.leaderAnswerUserMessageIds ?? []).join(",");
}

function samePlanReplayScope(existing: AssistantMessage, incoming: AssistantMessage): boolean {
  return (
    sameCodexNativeSubagentOwnership(existing.codexSubagent, incoming.codexSubagent) &&
    existing.parent_tool_use_id === incoming.parent_tool_use_id &&
    sameThreadRoute(routeFromHistoryEntry(existing), routeFromHistoryEntry(incoming)) &&
    existing.leaderThreadRole === incoming.leaderThreadRole &&
    leaderAnswerIdsKey(existing) === leaderAnswerIdsKey(incoming) &&
    normalizeCodexMessagePhase(existing.codexMessagePhase) === normalizeCodexMessagePhase(incoming.codexMessagePhase)
  );
}

/**
 * A recreated Codex item manager restarts its synthetic plan sequence at one.
 * Reconcile that local sequence with persisted same-turn history before generic
 * assistant replay dedup: latest identical state is replay, while changed state
 * with a reused sequence is rekeyed to the next authoritative sequence.
 */
export function prepareCodexPlanAssistantReplay(
  session: Pick<Session, "messageHistory">,
  message: AssistantMessage,
): CodexPlanReplayPreparation {
  const incoming = extractSyntheticPlan(message);
  if (!incoming) return { message, isDuplicate: false };

  let latestSignature: string | null = null;
  let maxSequence = 0;
  for (let index = session.messageHistory.length - 1; index >= 0; index -= 1) {
    const entry = session.messageHistory[index];
    if (entry.type !== "assistant") continue;
    const existing = extractSyntheticPlan(entry);
    if (!existing || existing.key !== incoming.key) continue;
    // Sequence IDs remain session-global so generic replay and browser tool-ID
    // dedup cannot collide across routes or native-child owners. Only the
    // latest-state replay decision is scoped to the matching owner and route.
    maxSequence = Math.max(maxSequence, existing.sequence);
    if (samePlanReplayScope(entry, message)) latestSignature ??= existing.signature;
  }

  if (latestSignature === incoming.signature) return { message, isDuplicate: true };
  if (incoming.sequence > maxSequence) return { message, isDuplicate: false };

  const nextSequence = maxSequence + 1;
  const nextToolUseId = `codex-plan-${incoming.key}-${nextSequence}`;
  const nextContent = message.message.content.map((block, index) =>
    index === incoming.blockIndex ? { ...incoming.block, id: nextToolUseId } : block,
  );
  const expectedMessageId = `codex-tool_use-${incoming.block.id}`;
  const nextMessageId =
    message.message.id === expectedMessageId
      ? `codex-tool_use-${nextToolUseId}`
      : `${message.message.id}-plan-sequence-${nextSequence}`;
  const nextToolStartTimes = message.tool_start_times
    ? Object.fromEntries(
        Object.entries(message.tool_start_times).map(([toolUseId, startedAt]) => [
          toolUseId === incoming.block.id ? nextToolUseId : toolUseId,
          startedAt,
        ]),
      )
    : undefined;

  return {
    isDuplicate: false,
    message: {
      ...message,
      message: { ...message.message, id: nextMessageId, content: nextContent },
      ...(nextToolStartTimes ? { tool_start_times: nextToolStartTimes } : {}),
    },
  };
}

/**
 * Codex can replay prior assistant messages after reconnect. Deduplicate only
 * when the canonical assistant ID matches, or when timestamp + content +
 * parent tool context all match a recent assistant. This keeps the fallback
 * filter narrow so legitimate repeated text still appears.
 */
export function isDuplicateCodexAssistantReplay(
  session: Session,
  msg: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): boolean {
  const incomingId = typeof msg.message?.id === "string" ? msg.message.id : null;
  if (!incomingId && typeof msg.timestamp !== "number") return false;

  const incomingTimestamp = typeof msg.timestamp === "number" ? msg.timestamp : null;
  const incomingParentToolUseId = msg.parent_tool_use_id;
  const incomingContentKey = JSON.stringify(msg.message.content);

  let scannedAssistants = 0;
  for (let i = session.messageHistory.length - 1; i >= 0; i--) {
    const entry = session.messageHistory[i];
    if (entry.type !== "assistant") continue;
    scannedAssistants += 1;
    if (scannedAssistants > CODEX_ASSISTANT_REPLAY_SCAN_LIMIT) break;

    const existing = entry as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    const sameOwnership = sameCodexNativeSubagentOwnership(existing.codexSubagent, msg.codexSubagent);
    if (
      incomingId &&
      existing.message?.id === incomingId &&
      sameOwnership &&
      existing.leaderThreadRole === msg.leaderThreadRole &&
      leaderAnswerIdsKey(existing) === leaderAnswerIdsKey(msg)
    )
      return true;
    if (!sameOwnership) continue;
    if (existing.parent_tool_use_id !== incomingParentToolUseId) continue;
    if (!sameThreadRoute(routeFromHistoryEntry(existing), routeFromHistoryEntry(msg))) continue;
    if (existing.leaderThreadRole !== msg.leaderThreadRole) continue;
    if (leaderAnswerIdsKey(existing) !== leaderAnswerIdsKey(msg)) continue;
    if (normalizeCodexMessagePhase(existing.codexMessagePhase) !== normalizeCodexMessagePhase(msg.codexMessagePhase)) {
      continue;
    }
    if (incomingTimestamp == null || typeof existing.timestamp !== "number") continue;
    if (Math.abs(existing.timestamp - incomingTimestamp) > CODEX_ASSISTANT_REPLAY_DEDUP_WINDOW_MS) continue;
    if (JSON.stringify(existing.message.content) !== incomingContentKey) continue;

    return true;
  }

  return false;
}
