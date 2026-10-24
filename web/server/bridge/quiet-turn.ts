/**
 * Decides whether a worker's quiet-marked turn may be held instead of waking its
 * leader. The worker's `{[(Quiet: ...)]}` marker is only a request: any turn that
 * failed, asked something, changed its quest, answered a leader or user message,
 * or leaves nothing to resume the worker still reaches the leader.
 *
 * A Scribe (the agent that keeps a leader's topic pages) is quiet by default: its turns need no marker,
 * Takode resumes it with its next request, and a routine turn is dropped rather than
 * held, so the leader hears from it only when it failed, asked, or answered the leader.
 */
import { extractQuietMarkerFromText } from "../../shared/quiet-turn-marker.js";
import { LANDING_QUEUE_MESSAGE_SOURCE } from "../../shared/landing-queue.js";
import { LIBRARY_MESSAGE_SOURCE } from "../../shared/library-topics.js";
import type { ContentBlock, TakodeTurnEndEventData } from "../session-types.js";
import { isSystemSourceTag, isTimerSourceTag } from "./adapter-browser-routing-source-tags.js";

export interface QuietTurnSession {
  id: string;
  messageCountAtTurnStart: number;
  userMessageIdsThisTurn: number[];
  messageHistory: unknown[];
  pendingPermissions?: { size: number };
  notifications?: Array<{ category: string; timestamp: number }>;
}

export type QuietTurnOutcome = Pick<TakodeTurnEndEventData, "quiet" | "quiet_ignored">;

/**
 * Resolve the quiet outcome of a turn that is ending.
 * Returns nothing when the turn has no marker, `quiet` when it may be held, and
 * `quiet_ignored` with the reason when Takode delivers it normally anyway.
 */
export function resolveQuietTurn(
  session: QuietTurnSession,
  turn: TakodeTurnEndEventData,
  turnStartedAt: number | null,
  deps: {
    /** Whether something will start the worker's next turn: a timer, a background job, a lease queue, ... */
    hasResumeSource: (sessionId: string) => boolean;
    /** Whether the session is a leader's Scribe. */
    isScribe?: (sessionId: string) => boolean;
  },
): QuietTurnOutcome {
  if (deps.isScribe?.(session.id)) {
    const ignoredReason = quietIgnoredReason(session, turn, turnStartedAt, { hasResumeSource: () => true });
    if (ignoredReason) return { quiet_ignored: ignoredReason };
    return { quiet: { summary: findTurnQuietSummary(session) ?? "Scribe update", silent: true } };
  }
  const summary = findTurnQuietSummary(session);
  if (summary === null) return {};
  const ignoredReason = quietIgnoredReason(session, turn, turnStartedAt, deps);
  return ignoredReason ? { quiet_ignored: ignoredReason } : { quiet: { summary } };
}

function quietIgnoredReason(
  session: QuietTurnSession,
  turn: TakodeTurnEndEventData,
  turnStartedAt: number | null,
  deps: { hasResumeSource: (sessionId: string) => boolean },
): string | null {
  if (turn.interrupted || turn.reason !== "result") return "the turn was interrupted";
  if (turn.is_error) return "the turn failed";
  if (turn.awaiting_decision || askedQuestion(session, turnStartedAt)) return "the turn asked a question";
  if ((session.pendingPermissions?.size ?? 0) > 0) return "a permission request is open";
  if (turn.questChange) return "the quest status changed";
  if (answeredSomeone(session)) return "the turn answered a leader or user message";
  if (!deps.hasResumeSource(session.id)) return "nothing will resume the worker";
  return null;
}

/** The marker counts only in the turn's last text, so a later finding cannot hide behind it. */
function findTurnQuietSummary(session: QuietTurnSession): string | null {
  for (let index = session.messageHistory.length - 1; index >= session.messageCountAtTurnStart; index -= 1) {
    const message = session.messageHistory[index] as
      | { type?: string; parent_tool_use_id?: string | null; message?: { content?: ContentBlock[] } }
      | undefined;
    if (message?.type !== "assistant" || message.parent_tool_use_id) continue;
    const content = message.message?.content ?? [];
    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = content[blockIndex];
      if (block?.type === "text" && block.text.trim()) return extractQuietMarkerFromText(block.text).summary;
    }
  }
  return null;
}

function askedQuestion(session: QuietTurnSession, turnStartedAt: number | null): boolean {
  if (turnStartedAt === null) return false;
  return (session.notifications ?? []).some(
    (notification) => notification.category === "needs-input" && notification.timestamp >= turnStartedAt,
  );
}

/** A direct user message or another session's message (a leader's) started or joined this turn. */
function answeredSomeone(session: QuietTurnSession): boolean {
  return session.userMessageIdsThisTurn.some((historyIndex) => {
    const entry = session.messageHistory[historyIndex] as
      | { type?: string; agentSource?: { sessionId: string } }
      | undefined;
    if (entry?.type !== "user_message") return false;
    return !isTakodeNoticeSource(entry.agentSource);
  });
}

/** Messages Takode itself sends: system notices, timer firings, landing-queue and lease outcomes, Scribe requests. */
function isTakodeNoticeSource(agentSource: { sessionId: string } | undefined): boolean {
  if (!agentSource) return false;
  return (
    isSystemSourceTag(agentSource) ||
    isTimerSourceTag(agentSource) ||
    agentSource.sessionId === LANDING_QUEUE_MESSAGE_SOURCE.sessionId ||
    agentSource.sessionId === LIBRARY_MESSAGE_SOURCE.sessionId ||
    agentSource.sessionId.startsWith("resource-lease:")
  );
}
