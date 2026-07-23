import { getDefaultModelForBackend } from "../../shared/backend-defaults.js";
import type { BrowserIncomingMessage, ContentBlock, SessionState } from "../session-types.js";
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

export function hasMatchingRecoveredCodexAssistantReplay(
  session: CodexRecoveredAssistantRoutingSessionLike,
  text: string,
  limit: number,
): boolean {
  const incoming = canonicalRecoveredAssistantSegments(session, text);
  if (!incoming?.length) return false;

  const recentAssistants: AssistantHistoryEntry[] = [];
  for (let i = session.messageHistory.length - 1; i >= 0 && recentAssistants.length < limit; i--) {
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
    if (matches) return true;
  }

  return false;
}
