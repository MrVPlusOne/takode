import { hasUsableNetwork } from "../network-availability.js";
import { hostHasUsableNetwork } from "../remote-host/session-machine.js";
import type { BrowserOutgoingMessage, SessionState } from "../session-types.js";
import { sessionTag } from "../session-tag.js";

/**
 * Claude turns that fail because the model API is unreachable (offline laptop,
 * DNS failure, refused or reset connections, timeouts) are paused instead of
 * failed: the error stays out of the feed and herd events, the turn keeps
 * running with a "waiting for connection" state, and Takode sends Claude a
 * model-only continuation once the network is back. Raw errors go to the
 * server log only.
 */

/** Model-only prompt that resumes the interrupted turn. It is never stored in the feed. */
export const CLAUDE_NETWORK_RESUME_PROMPT =
  "[System: connection restored] Your last model request failed because the network was unreachable, " +
  "and the connection is back. Continue the interrupted work from where you left off. " +
  "Do not repeat steps that already completed.";

/**
 * Delay before each resume attempt, indexed by consecutive failures. Every
 * attempt also runs Claude's own retry cycle (minutes long), so a short cap
 * still cannot become a retry storm.
 */
const RESUME_DELAYS_MS = [10_000, 30_000, 60_000];
/** How often to look again while the machine has no usable network at all. */
const OFFLINE_RECHECK_MS = 5_000;
/**
 * Hidden continues per outage. Each one runs Claude's full in-turn retry cycle
 * (about 6 minutes), so five cover roughly 40 minutes of an outage where the
 * machine looks online but the API stays unreachable. After that, Takode stops
 * adding prompts to Claude's conversation until something changes.
 */
const MAX_CONTINUES_PER_OUTAGE = 5;
/** How often a paused wait checks whether the machine dropped off and rejoined a network. */
const PAUSED_RECHECK_MS = 30_000;

/**
 * How Claude Code (checked against 2.1.289) words a model request that got no
 * HTTP response, after "API Error: ". SSL and proxy-tunnel failures are
 * configuration problems, not outages, so they stay visible.
 */
const NETWORK_FAILURE_PREFIXES = [
  "Connection lost while your computer was asleep",
  "Connection closed before the response finished",
  "No response from API",
  "Request timed out",
  "Connection error",
  "Connection dropped (",
  "Connection refused",
  "Can't reach the API server",
  "No internet route",
  "Unable to connect to API (",
  "Unable to connect to API. Check your internet connection",
];

export interface ClaudeNetworkWaitSession {
  id: string;
  isGenerating: boolean;
  interruptedDuringTurn: boolean;
  claudeSdkAdapter: {
    isConnected(): boolean;
    hasTurnInFlight(): boolean;
    sendBrowserMessage(msg: BrowserOutgoingMessage): boolean;
  } | null;
  state: Pick<SessionState, "claude_network_wait" | "host_id">;
}

export interface ClaudeNetworkWaitDeps {
  broadcastToBrowsers: (session: any, msg: Record<string, unknown>) => void;
  /** Whether the session's machine has any usable network; injectable for tests. */
  hasNetwork?: () => boolean;
}

interface WaitRuntime {
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  continues: number;
  /** A paused wait saw the machine without any network, so rejoining one is a real change. */
  sawOffline: boolean;
}

const runtimes = new WeakMap<ClaudeNetworkWaitSession, WaitRuntime>();

/** Whether a Claude error text describes an unreachable model API rather than a genuine API error. */
export function isClaudeNetworkFailureText(text: unknown): boolean {
  if (typeof text !== "string" || !text.startsWith("API Error: ")) return false;
  const message = text.slice("API Error: ".length);
  return NETWORK_FAILURE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

/**
 * Route one Claude SDK message through the network-outage policy. Returns true
 * when the message was consumed and must not reach normal handling.
 */
export function handleClaudeNetworkWaitMessage(
  session: ClaudeNetworkWaitSession,
  msg: any,
  deps: ClaudeNetworkWaitDeps,
): boolean {
  if (msg.type === "system" && msg.subtype === "api_retry") {
    // A null status means the request got no HTTP response at all.
    if (msg.error_status == null && session.isGenerating) {
      console.warn(
        `[claude-network] Model API unreachable for session ${sessionTag(session.id)}; Claude is retrying ` +
          `(attempt ${msg.attempt}/${msg.max_retries}, ${msg.error})`,
      );
      enterWait(session, deps);
    }
    return true;
  }

  if (msg.type === "assistant" && session.isGenerating && isSyntheticNetworkError(msg)) {
    // The result that follows carries the same failure and drives the wait.
    return true;
  }

  if (msg.type === "result" && isNetworkFailureResult(session, msg.data ?? msg)) {
    const runtime = getRuntime(session);
    runtime.failures++;
    console.warn(
      `[claude-network] Turn for session ${sessionTag(session.id)} failed: ${(msg.data ?? msg).result} ` +
        `(failure ${runtime.failures}); waiting for the connection before resuming`,
    );
    enterWait(session, deps);
    if (runtime.continues >= MAX_CONTINUES_PER_OUTAGE) {
      pauseAutoResume(session, deps);
    } else {
      scheduleResume(session, deps, RESUME_DELAYS_MS[Math.min(runtime.failures, RESUME_DELAYS_MS.length) - 1]);
    }
    return true;
  }

  if (session.state.claude_network_wait && isModelActivity(msg)) {
    console.log(`[claude-network] Model API reachable again for session ${sessionTag(session.id)}`);
    stopClaudeNetworkWait(session, deps);
  }
  return false;
}

/** End any network wait for the session, e.g. when its turn ends for another reason. */
export function stopClaudeNetworkWait(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps): void {
  const runtime = runtimes.get(session);
  if (runtime?.timer) clearTimeout(runtime.timer);
  runtimes.delete(session);
  if (!session.state.claude_network_wait) return;
  session.state.claude_network_wait = null;
  deps.broadcastToBrowsers(session, { type: "session_update", session: { claude_network_wait: null } });
}

function isNetworkFailureResult(session: ClaudeNetworkWaitSession, data: any): boolean {
  // Genuine API errors (auth, quota, invalid request) carry an HTTP status.
  return (
    session.isGenerating &&
    !session.interruptedDuringTurn &&
    data?.is_error === true &&
    data.api_error_status == null &&
    isClaudeNetworkFailureText(data.result)
  );
}

function isSyntheticNetworkError(msg: any): boolean {
  const message = msg.message;
  if (message?.model !== "<synthetic>" || !Array.isArray(message.content)) return false;
  return message.content.some((block: any) => block?.type === "text" && isClaudeNetworkFailureText(block.text));
}

function isModelActivity(msg: any): boolean {
  return (
    msg.type === "assistant" || msg.type === "stream_event" || msg.type === "tool_progress" || msg.type === "result"
  );
}

function enterWait(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps): void {
  if (session.state.claude_network_wait) return;
  publishWait(session, deps, { since: Date.now() });
}

function publishWait(
  session: ClaudeNetworkWaitSession,
  deps: ClaudeNetworkWaitDeps,
  wait: NonNullable<SessionState["claude_network_wait"]>,
): void {
  session.state.claude_network_wait = wait;
  deps.broadcastToBrowsers(session, { type: "session_update", session: { claude_network_wait: wait } });
}

/**
 * Stop sending continues but keep the turn waiting. Input from the user or a
 * leader still resumes Claude, and so does the machine visibly dropping off
 * and rejoining a network, which starts a fresh allowance.
 */
function pauseAutoResume(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps): void {
  const wait = session.state.claude_network_wait;
  if (wait && !wait.autoResumePaused) {
    console.warn(
      `[claude-network] Stopped resuming session ${sessionTag(session.id)} after ${MAX_CONTINUES_PER_OUTAGE} ` +
        "attempts; waiting for new input or a network change",
    );
    publishWait(session, deps, { ...wait, autoResumePaused: true });
  }
  schedule(session, PAUSED_RECHECK_MS, () => watchForReconnect(session, deps));
}

function watchForReconnect(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps): void {
  const wait = session.state.claude_network_wait;
  if (!wait) return;
  if (!session.isGenerating || !session.claudeSdkAdapter?.isConnected()) {
    stopClaudeNetworkWait(session, deps);
    return;
  }
  const runtime = getRuntime(session);
  if (!(deps.hasNetwork ?? hasUsableNetwork)()) {
    runtime.sawOffline = true;
  } else if (runtime.sawOffline) {
    console.log(`[claude-network] Session ${sessionTag(session.id)} rejoined a network; resuming automatically again`);
    runtime.failures = 0;
    runtime.continues = 0;
    runtime.sawOffline = false;
    publishWait(session, deps, { since: wait.since });
    tryResume(session, deps);
    return;
  }
  schedule(session, PAUSED_RECHECK_MS, () => watchForReconnect(session, deps));
}

function getRuntime(session: ClaudeNetworkWaitSession): WaitRuntime {
  let runtime = runtimes.get(session);
  if (!runtime) {
    runtime = { timer: null, failures: 0, continues: 0, sawOffline: false };
    runtimes.set(session, runtime);
  }
  return runtime;
}

function scheduleResume(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps, delayMs: number): void {
  schedule(session, delayMs, () => tryResume(session, deps));
}

/** One timer per session: scheduling replaces whatever was pending. */
function schedule(session: ClaudeNetworkWaitSession, delayMs: number, run: () => void): void {
  const runtime = getRuntime(session);
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = setTimeout(() => {
    runtime.timer = null;
    run();
  }, delayMs);
}

function tryResume(session: ClaudeNetworkWaitSession, deps: ClaudeNetworkWaitDeps): void {
  if (!session.state.claude_network_wait) return;
  const adapter = session.claudeSdkAdapter;
  if (!session.isGenerating || !adapter?.isConnected()) {
    stopClaudeNetworkWait(session, deps);
    return;
  }
  // Claude runs on the session's machine: a remote host reports its own network over the link.
  const hasNetwork =
    deps.hasNetwork ?? (session.state.host_id ? () => hostHasUsableNetwork(session.state.host_id!) : hasUsableNetwork);
  if (!hasNetwork()) {
    scheduleResume(session, deps, OFFLINE_RECHECK_MS);
    return;
  }
  // Input sent meanwhile (user, leader) already restarted Claude; its result decides what happens next.
  if (adapter.hasTurnInFlight()) return;
  const runtime = getRuntime(session);
  runtime.continues++;
  console.log(
    `[claude-network] Resuming interrupted turn for session ${sessionTag(session.id)} ` +
      `(continue ${runtime.continues}/${MAX_CONTINUES_PER_OUTAGE})`,
  );
  adapter.sendBrowserMessage({ type: "user_message", content: CLAUDE_NETWORK_RESUME_PROMPT });
}
