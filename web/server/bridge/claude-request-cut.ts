import { claudeRequestCutNotice } from "../../shared/claude-request-cut.js";
import type { BrowserOutgoingMessage } from "../session-types.js";
import { sessionTag } from "../session-tag.js";

/**
 * GitHub Copilot ends every streamed response about 631 s after the request,
 * whatever it is doing. Fable 5.2 at high effort sometimes thinks longer than
 * that on one request; Claude Code then sees ECONNRESET and retries the same
 * request from scratch, which gets cut the same way, again and again.
 *
 * When a request that had been streaming for 10 minutes fails without an HTTP
 * status, Takode lowers the session's effort one level, cancels Claude Code's
 * own retry (it would resend the old effort) and continues the turn with a
 * visible notice, so the next request thinks less and can finish. The
 * session's own effort comes back when the turn ends.
 */

/** Streamed this long before failing, a request was cut rather than lost to the network. */
export const CLAUDE_REQUEST_CUT_AFTER_MS = 600_000;

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Effort a session runs at when it sets none: Claude Code's default for its effort-capable models. */
const DEFAULT_EFFORT = "high";

export interface ClaudeRequestCutSession {
  id: string;
  isGenerating: boolean;
  claudeSdkAdapter: { sendBrowserMessage(msg: BrowserOutgoingMessage): boolean } | null;
}

export interface ClaudeRequestCutDeps {
  /** Add the visible notice that continues the turn (an injected, system-sourced user message). */
  continueTurn: (session: ClaudeRequestCutSession, content: string) => void;
  /** The effort the session itself is set to (a live change, else its launch effort), or null for Claude's default. */
  sessionEffort: (session: ClaudeRequestCutSession) => string | null;
}

interface Runtime {
  /** When the session's current request began streaming; null once a response finished. */
  streamStartedAt: number | null;
  /** The interrupt that cancels Claude Code's own retry is on its way. */
  awaitingAbort: { from: string; to: string } | null;
  /** The effort level this turn runs at since a cut, so a later cut in the turn lowers it further. */
  loweredTo: string | null;
}

const runtimes = new WeakMap<ClaudeRequestCutSession, Runtime>();

/**
 * Route one Claude SDK message through the request-cut policy. Returns true
 * when the message was consumed: the result of the interrupt that cancelled
 * Claude Code's retry, which must not end the turn.
 */
export function handleClaudeRequestCutMessage(
  session: ClaudeRequestCutSession,
  msg: any,
  deps: ClaudeRequestCutDeps,
): boolean {
  const runtime = getRuntime(session);
  if (msg.type === "stream_event" && !msg.parent_tool_use_id) {
    const eventType = msg.event?.type;
    if (eventType === "message_start") runtime.streamStartedAt = Date.now();
    // A finished response ends with message_delta (its stop reason). A cut one does not: Claude Code
    // 2.1.311 closes it with a synthesized message_stop and then reports the retry.
    if (eventType === "message_delta") runtime.streamStartedAt = null;
    return false;
  }

  if (msg.type === "system" && msg.subtype === "api_retry") {
    const startedAt = runtime.streamStartedAt;
    runtime.streamStartedAt = null;
    const cut =
      msg.error_status == null &&
      startedAt !== null &&
      Date.now() - startedAt >= CLAUDE_REQUEST_CUT_AFTER_MS &&
      session.isGenerating &&
      !runtime.awaitingAbort;
    if (cut) lowerEffortAndRestart(session, runtime, deps.sessionEffort(session));
    return false;
  }

  if (msg.type === "result" && runtime.awaitingAbort) {
    const { from, to } = runtime.awaitingAbort;
    runtime.awaitingAbort = null;
    deps.continueTurn(session, claudeRequestCutNotice(from, to));
    return true;
  }
  return false;
}

/** At the end of a turn, give the session its own effort back if a cut lowered it. */
export function restoreClaudeEffortAfterTurn(session: ClaudeRequestCutSession, sessionEffort: string | null): void {
  const runtime = runtimes.get(session);
  if (!runtime?.loweredTo) return;
  runtime.loweredTo = null;
  runtime.awaitingAbort = null;
  const own = sessionEffort ?? "";
  console.log(
    `[claude-request-cut] Restoring effort ${own || "(default)"} for session ${sessionTag(session.id)} after the turn`,
  );
  session.claudeSdkAdapter?.sendBrowserMessage({ type: "set_claude_reasoning_effort", effort: own });
}

function lowerEffortAndRestart(session: ClaudeRequestCutSession, runtime: Runtime, sessionEffort: string | null): void {
  const adapter = session.claudeSdkAdapter;
  const from = runtime.loweredTo ?? sessionEffort ?? DEFAULT_EFFORT;
  const to = lowerEffort(from);
  if (!adapter || !to) {
    console.warn(
      `[claude-request-cut] Request for session ${sessionTag(session.id)} was cut after 10 minutes; ` +
        `effort ${from} cannot go lower, so Claude Code retries it as it is`,
    );
    return;
  }
  console.warn(
    `[claude-request-cut] Request for session ${sessionTag(session.id)} was cut after 10 minutes; ` +
      `lowering effort ${from} -> ${to} for the rest of the turn and continuing`,
  );
  runtime.loweredTo = to;
  runtime.awaitingAbort = { from, to };
  // The effort change is applied before the interrupt, so the continuation's request uses it.
  adapter.sendBrowserMessage({ type: "set_claude_reasoning_effort", effort: to });
  adapter.sendBrowserMessage({ type: "interrupt", interruptSource: "system" });
}

function lowerEffort(effort: string): string | null {
  const index = EFFORT_LEVELS.indexOf(effort as (typeof EFFORT_LEVELS)[number]);
  return index > 0 ? EFFORT_LEVELS[index - 1] : null;
}

function getRuntime(session: ClaudeRequestCutSession): Runtime {
  let runtime = runtimes.get(session);
  if (!runtime) {
    runtime = { streamStartedAt: null, awaitingAbort: null, loweredTo: null };
    runtimes.set(session, runtime);
  }
  return runtime;
}
