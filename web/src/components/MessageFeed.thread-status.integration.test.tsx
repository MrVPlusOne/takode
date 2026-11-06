// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { rememberThreadNumbers, resetThreadNumbersForTest } from "../../shared/topic-thread-key.js";
import { sendThreadWindowSync } from "../../server/bridge/browser-transport-controller.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// A leader thread's current status (Thread Waiting/Ready) reaches the browser with that thread's
// own window and in live `leader_thread_status` updates, so every thread shows its chip however
// old the status is. These tests send the server's real window to the browser's real handler.
// The case behind them: Daily Leader's plain thread t-147 (not a quest, keyed `topic:<handle>`)
// ended with Thread Waiting, but its feed showed no chip.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"status"' }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-thread-status";
const THREAD_KEY = "topic:9c206818";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });

const waiting: LeaderThreadStatus = {
  kind: "waiting",
  label: "Thread Waiting",
  threadKey: THREAD_KEY,
  summary: "numbers coming; cap question open",
  messageId: "a-thread-waiting",
  timestamp: 1_700_000_003_000,
  updatedAt: 1_700_000_003_000,
};

const route = { threadKey: THREAD_KEY, threadRefs: [{ threadKey: THREAD_KEY, source: "explicit" as const }] };
const history: BrowserIncomingMessage[] = [
  {
    type: "user_message",
    id: "u-thread",
    content: "How do context limits matter?",
    timestamp: 1_700_000_001_000,
    ...route,
  },
  {
    type: "assistant",
    message: {
      id: "a-thread-waiting",
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text: "I asked the worker for the real numbers." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1_700_000_003_000,
    threadStatusMarkers: [waiting],
    ...route,
  } as BrowserIncomingMessage,
];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

beforeEach(() => {
  useStore.getState().reset();
  rememberThreadNumbers([[147, "9c206818-47dd-43c5-9ac3-ed7d439d86ad"]]);
  act(() => handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() }));
});
afterEach(() => {
  cleanup();
  resetThreadNumbersForTest();
});

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude-sdk",
    model: "claude-opus",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  } as SessionState;
}

/** The thread window the server sends for the session's saved statuses, as the browser receives it. */
function serverThreadWindow(
  statuses: Record<string, LeaderThreadStatus>,
  cachedWindowHash?: string,
): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const send = vi.fn();
  sendThreadWindowSync(
    { id: SESSION_ID, messageHistory: history, state: { leaderThreadStatuses: statuses } },
    { send },
    { threadKey: "t-147", fromItem: -1, sectionItemCount: 10, visibleItemCount: 10, cachedWindowHash },
  );
  return JSON.parse(send.mock.calls.at(-1)![0] as string);
}

const chipLabel = "Thread Waiting for thread:t-147: numbers coming; cap question open";

describe("thread status delivered with the thread's window", () => {
  it("shows a plain thread's status from its window, however old, and hides it in All Threads", () => {
    // The status is the only one saved and was set long ago: nothing ranks or bounds it away.
    const window = serverThreadWindow({ [THREAD_KEY]: waiting });
    expect(window.thread_status).toMatchObject({ kind: "waiting", threadKey: THREAD_KEY });
    act(() => handleMessage(SESSION_ID, window));

    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="t-147" />);
    expect(screen.getByText("I asked the worker for the real numbers.")).toBeInTheDocument();
    expect(screen.getByLabelText(chipLabel)).toBeInTheDocument();
    view.unmount();

    render(<MessageFeed sessionId={SESSION_ID} threadKey="all" />);
    expect(screen.queryByLabelText(chipLabel)).toBeNull();
  });

  it("follows live status updates and keeps the status through a cache hit", () => {
    const window = serverThreadWindow({ [THREAD_KEY]: waiting });
    act(() => handleMessage(SESSION_ID, window));
    render(<MessageFeed sessionId={SESSION_ID} threadKey="t-147" />);
    expect(screen.getByLabelText(chipLabel)).toBeInTheDocument();

    // New leader activity in the thread clears its status on the server, which says so at once.
    act(() => handleMessage(SESSION_ID, { type: "leader_thread_status", thread_key: THREAD_KEY, status: null }));
    expect(screen.queryByLabelText(chipLabel)).toBeNull();

    // A later Ready arrives live and replaces it.
    const ready: LeaderThreadStatus = { ...waiting, kind: "ready", label: "Thread Ready", summary: "numbers in" };
    act(() => handleMessage(SESSION_ID, { type: "leader_thread_status", thread_key: THREAD_KEY, status: ready }));
    expect(screen.getByLabelText("Thread Ready for thread:t-147: numbers in")).toBeInTheDocument();

    // Reopening with the window the browser holds is a cache hit: the hash covers the status, so
    // the cached status is the current one.
    const again = serverThreadWindow({ [THREAD_KEY]: waiting }, window.window.window_hash);
    expect(again.cache_hit).toBe(true);
    expect(again.thread_status).toBeUndefined();
    act(() => handleMessage(SESSION_ID, again));
    expect(screen.getByLabelText(chipLabel)).toBeInTheDocument();

    // A changed status changes the hash, so the browser gets the window with the new status.
    const changed = serverThreadWindow({}, window.window.window_hash);
    expect(changed.cache_hit).toBeUndefined();
    expect(changed.thread_status).toBeNull();
    act(() => handleMessage(SESSION_ID, changed));
    expect(screen.queryByLabelText(chipLabel)).toBeNull();
  });
});
