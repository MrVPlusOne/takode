import { getDefaultModelForBackend } from "../../shared/backend-defaults.js";
import { normalizeCodexMessagePhase } from "../../shared/codex-message-phase.js";
import type { CodexResumeTurnSnapshot } from "../codex-adapter.js";
import type { BrowserIncomingMessage, CodexOutboundTurn, ContentBlock, SessionState } from "../session-types.js";
import type { ThreadRouteMetadata } from "../thread-routing-metadata.js";
import { leaderRouteFromRecoveredAssistant } from "./codex-leader-recovery-diagnostic.js";
import {
  normalizeLeaderAssistantRouting,
  splitLeaderAssistantContentAtThreadRouteBoundaries,
} from "./thread-routing-reminder.js";

type AssistantHistoryEntry = Extract<BrowserIncomingMessage, { type: "assistant" }>;

export type CodexRecoveredAssistantRouteFields = Pick<
  AssistantHistoryEntry,
  "threadKey" | "questId" | "threadRefs" | "threadRoutingError"
> & { content: ContentBlock[] };

export interface CodexRecoveredAssistantRoutingSessionLike {
  state: Pick<SessionState, "isOrchestrator" | "model">;
  messageHistory: BrowserIncomingMessage[];
  _frozenCount?: number;
}

function isLeaderSessionForRecoveredAssistantRouting(session: CodexRecoveredAssistantRoutingSessionLike): boolean {
  return session.state.isOrchestrator === true;
}

function normalizeCodexRecoveredAssistantText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function buildCodexRecoveredAssistantRouteSegments(
  session: CodexRecoveredAssistantRoutingSessionLike,
  text: string,
): CodexRecoveredAssistantRouteFields[] {
  const isLeaderSession = isLeaderSessionForRecoveredAssistantRouting(session);
  return splitLeaderAssistantContentAtThreadRouteBoundaries(isLeaderSession, [{ type: "text", text }], null).map(
    (contentSegment) => normalizeLeaderAssistantRouting(isLeaderSession, contentSegment, null),
  );
}

export function codexRecoveredAssistantModel(session: CodexRecoveredAssistantRoutingSessionLike): string {
  return session.state.model || getDefaultModelForBackend("codex");
}

function canonicalRouteKeyForRecoveredAssistant(
  entry: Pick<AssistantHistoryEntry, "threadKey" | "questId" | "threadRefs" | "threadRoutingError">,
  routed: CodexRecoveredAssistantRouteFields,
): string {
  const routedKey = routed.threadKey || routed.questId;
  if (routedKey) return routedKey.trim().toLowerCase() || "main";
  if (entry.threadKey) return entry.threadKey.trim().toLowerCase() || "main";
  if (entry.questId) return entry.questId.trim().toLowerCase() || "main";
  const explicitRef = (entry.threadRefs ?? []).find((ref) => ref.source !== "backfill" && ref.threadKey);
  return explicitRef?.threadKey.trim().toLowerCase() || "main";
}

function canonicalRecoveredAssistantFromRouteFields(
  routed: CodexRecoveredAssistantRouteFields,
  entry: Pick<AssistantHistoryEntry, "threadKey" | "questId" | "threadRefs" | "threadRoutingError"> = {},
): { text: string; routeKey: string } | null {
  const textBlocks = routed.content.filter((block) => block.type === "text");
  if (textBlocks.length !== 1) return null;
  const normalizedText = normalizeCodexRecoveredAssistantText(textBlocks[0].text || "");
  if (!normalizedText) return null;
  return {
    text: normalizedText,
    routeKey: canonicalRouteKeyForRecoveredAssistant(entry, routed),
  };
}

function canonicalRecoveredAssistant(
  session: CodexRecoveredAssistantRoutingSessionLike,
  text: string,
  entry: Pick<AssistantHistoryEntry, "threadKey" | "questId" | "threadRefs" | "threadRoutingError"> = {},
): { text: string; routeKey: string } | null {
  const segments = buildCodexRecoveredAssistantRouteSegments(session, text);
  if (segments.length !== 1) return null;
  return canonicalRecoveredAssistantFromRouteFields(segments[0]!, entry);
}

function canonicalRecoveredAssistantSegments(
  session: CodexRecoveredAssistantRoutingSessionLike,
  text: string,
): Array<{ text: string; routeKey: string }> | null {
  const canonical = buildCodexRecoveredAssistantRouteSegments(session, text).map((segment) =>
    canonicalRecoveredAssistantFromRouteFields(segment),
  );
  return canonical.every(Boolean) ? (canonical as Array<{ text: string; routeKey: string }>) : null;
}

function canonicalExistingRecoveredAssistant(
  session: CodexRecoveredAssistantRoutingSessionLike,
  existing: AssistantHistoryEntry,
): { text: string; routeKey: string } | null {
  const textBlocks = existing.message.content.filter((block) => block.type === "text");
  if (textBlocks.length !== 1) return null;
  return canonicalRecoveredAssistant(session, textBlocks[0].text || "", existing);
}

export function findMatchingRecoveredCodexAssistantReplay(
  session: CodexRecoveredAssistantRoutingSessionLike,
  text: string,
  limit: number,
  afterHistoryIndex = -1,
): AssistantHistoryEntry[] | null {
  const incoming = canonicalRecoveredAssistantSegments(session, text);
  if (!incoming?.length) return null;

  const recentAssistants: AssistantHistoryEntry[] = [];
  for (let i = session.messageHistory.length - 1; i >= 0 && recentAssistants.length < limit; i--) {
    const absoluteHistoryIndex = (session._frozenCount ?? 0) + i;
    if (absoluteHistoryIndex <= afterHistoryIndex) break;
    const entry = session.messageHistory[i];
    if (entry.type === "assistant" && entry.parent_tool_use_id === null) {
      recentAssistants.push(entry);
    }
  }
  recentAssistants.reverse();

  for (let start = 0; start <= recentAssistants.length - incoming.length; start++) {
    let matches = true;
    for (let offset = 0; offset < incoming.length; offset++) {
      const existing = canonicalExistingRecoveredAssistant(session, recentAssistants[start + offset]!);
      if (!existing || existing.text !== incoming[offset]!.text || existing.routeKey !== incoming[offset]!.routeKey) {
        matches = false;
        break;
      }
    }
    if (matches) return recentAssistants.slice(start, start + incoming.length);
  }

  return null;
}

export function recoverAgentMessagesFromResumedTurn<S extends CodexRecoveredAssistantRoutingSessionLike>(
  session: S,
  turn: CodexResumeTurnSnapshot,
  pending: Pick<CodexOutboundTurn, "disconnectedAt" | "historyIndex">,
  deps: {
    codexAssistantReplayScanLimit: number;
    broadcastToBrowsers: (session: S, message: BrowserIncomingMessage) => void;
  },
): { count: number; latestLeaderRoute: ThreadRouteMetadata | null } {
  let matchedOrRecovered = 0;
  let latestLeaderRoute: ThreadRouteMetadata | null = null;
  const isLeaderSession = session.state.isOrchestrator === true;
  const baseTs = pending.disconnectedAt ?? Date.now();
  for (let i = 0; i < turn.items.length; i++) {
    const item = turn.items[i];
    if (item.type !== "agentMessage") continue;
    const text = typeof item.text === "string" ? item.text : "";
    if (!text.trim()) continue;
    const itemId = typeof item.id === "string" ? item.id : `${turn.id}-${i}`;
    const isGenericItemId = /^item-\d+$/.test(itemId);
    const replayMatches = isGenericItemId
      ? findMatchingRecoveredCodexAssistantReplay(
          session,
          text,
          deps.codexAssistantReplayScanLimit,
          pending.historyIndex,
        )
      : null;
    if (replayMatches) {
      for (const replayMatch of replayMatches) {
        latestLeaderRoute = leaderRouteFromRecoveredAssistant(isLeaderSession, replayMatch) ?? latestLeaderRoute;
      }
      matchedOrRecovered++;
      continue;
    }
    const assistantId = isGenericItemId ? `codex-agent-${turn.id}-${itemId}` : `codex-agent-${itemId}`;
    const alreadyExists = session.messageHistory.find((message) => {
      return message.type === "assistant" && message.message?.id === assistantId;
    });
    if (alreadyExists?.type === "assistant") {
      latestLeaderRoute = leaderRouteFromRecoveredAssistant(isLeaderSession, alreadyExists) ?? latestLeaderRoute;
      matchedOrRecovered++;
      continue;
    }
    for (const [segmentIndex, routed] of buildCodexRecoveredAssistantRouteSegments(session, text).entries()) {
      const segmentAssistantId = segmentIndex === 0 ? assistantId : `${assistantId}:route-${segmentIndex}`;
      const assistant: BrowserIncomingMessage = {
        type: "assistant",
        message: {
          id: segmentAssistantId,
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
        timestamp: baseTs + i + 1 + segmentIndex / 1000,
        ...(routed.threadKey ? { threadKey: routed.threadKey } : {}),
        ...(routed.questId ? { questId: routed.questId } : {}),
        ...(routed.threadRefs ? { threadRefs: routed.threadRefs } : {}),
        ...(routed.threadRoutingError ? { threadRoutingError: routed.threadRoutingError } : {}),
      };
      session.messageHistory.push(assistant);
      deps.broadcastToBrowsers(session, assistant);
      latestLeaderRoute = leaderRouteFromRecoveredAssistant(isLeaderSession, assistant) ?? latestLeaderRoute;
      matchedOrRecovered++;
    }
  }
  return { count: matchedOrRecovered, latestLeaderRoute };
}
