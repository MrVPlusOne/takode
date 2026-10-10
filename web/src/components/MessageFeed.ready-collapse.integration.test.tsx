// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
} from "../../server/leader-thread-response.js";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// When a leader marks a thread Ready, the thread's latest turn collapses to its
// essential content. These tests replay quest-thread histories through the
// server's thread-window producer and cover the ways that collapse used to be
// lost: opening the Ready result from attention navigation, an expansion made
// earlier in a long quest turn (worker events do not start new turns), and a
// Ready marker written in a message routed to another thread.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"ready"' }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-ready-collapse";
const QUEST_ID = "q-4300";
const ANSWER_TEXT = "Draft images now sync across devices.";
const DISPATCH_TEXT = "Dispatched the worker; I will report here.";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
const questRoute = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};
type Assistant = Extract<BrowserIncomingMessage, { type: "assistant" }>;

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
  sendToSession.mockClear();
  projectionRevision = 0;
});
afterEach(cleanup);

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
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/tmp/takode",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function timestampAt(historyIndex: number): number {
  return 1_700_000_000_000 + historyIndex * 1000;
}

function statusMarker(kind: "ready" | "waiting", messageId: string, historyIndex: number): LeaderThreadStatus {
  return {
    kind,
    label: kind === "ready" ? "Thread Ready" : "Thread Waiting",
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    summary: kind === "ready" ? "draft image sync landed" : "worker running",
    messageId,
    timestamp: timestampAt(historyIndex),
    updatedAt: timestampAt(historyIndex),
  };
}

function assistant(
  history: BrowserIncomingMessage[],
  id: string,
  text: string,
  options: { marker?: "ready" | "waiting"; route?: Partial<Assistant> } = {},
): Assistant {
  const message: Assistant = {
    type: "assistant",
    timestamp: timestampAt(history.length),
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...questRoute,
    ...options.route,
    ...(options.marker ? { threadStatusMarkers: [statusMarker(options.marker, id, history.length)] } : {}),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  history.push(message);
  return message;
}

function herdEvent(history: BrowserIncomingMessage[], id: string): void {
  history.push({
    type: "user_message",
    id,
    content: "1 event from 1 session\n\n#12 | turn_end | complete",
    timestamp: timestampAt(history.length),
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...questRoute,
  });
}

/** A request answered in its quest thread, then Ready after the worker's final report. */
function readyQuestHistory(): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  history.push({
    type: "user_message",
    id: "request-1",
    content: "Please sync draft images across devices.",
    timestamp: timestampAt(0),
    leaderUserMessageId: "u1",
    leaderResponseCoverageVersion: 1,
    ...questRoute,
  });
  assistant(history, "dispatch", DISPATCH_TEXT, { marker: "waiting" });
  herdEvent(history, "herd-1");
  const answer = assistant(history, "answer-1", ANSWER_TEXT, { marker: "ready" });
  answer.leaderThreadRole = "answer";
  answer.leaderAnswerUserMessageIds = ["u1"];
  answer.leaderAnswerObservedHistoryLength = history.length - 1;
  expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, answer).finalized).toBe(true);
  return history;
}

let projectionRevision = 0;

/** Deliver the server's selected-thread window and the leader's current thread status. */
function deliver(history: BrowserIncomingMessage[], status: LeaderThreadStatus | null): void {
  const projection = buildLeaderThreadResponseState({ id: SESSION_ID, messageHistory: history }, QUEST_ID).projection;
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: -1,
    itemCount: 20,
    sectionItemCount: 20,
    visibleItemCount: 4,
    currentThreadResponseProjection: projection,
  });
  projectionRevision += 1;
  act(() => {
    if (projectionRevision === 1) handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: { ...sync.window, window_hash: `window-${projectionRevision}` },
      ...(sync.threadResponseProjection ? { response_state: sync.threadResponseProjection } : {}),
    });
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: SESSION_ID,
        revision: projectionRevision,
        value: createLeaderThreadTabsProjectionValue({
          tabs: [],
          activePhaseSummary: [],
          threadStatuses: status ? { [QUEST_ID]: status } : {},
        }),
      }),
    );
  });
}

function latestStatus(history: BrowserIncomingMessage[]): LeaderThreadStatus | null {
  let latest: LeaderThreadStatus | null = null;
  for (const message of history) {
    for (const marker of (message as { threadStatusMarkers?: LeaderThreadStatus[] }).threadStatusMarkers ?? []) {
      if (marker.threadKey === QUEST_ID) latest = marker;
    }
  }
  return latest;
}

function latestTurn(container: HTMLElement): HTMLElement {
  const turns = container.querySelectorAll<HTMLElement>("[data-turn-id]");
  return turns[turns.length - 1]!;
}

function expectCollapsed(container: HTMLElement): void {
  const turn = latestTurn(container);
  expect(within(turn).getByRole("button", { name: /Show turn activity/ })).toBeInTheDocument();
  expect(within(turn).queryByText(DISPATCH_TEXT)).not.toBeInTheDocument();
}

function expectExpanded(container: HTMLElement): void {
  const turn = latestTurn(container);
  expect(within(turn).getByRole("button", { name: /Hide turn activity/ })).toBeInTheDocument();
  expect(within(turn).getByText(DISPATCH_TEXT)).toBeInTheDocument();
}

function openMessage(messageId: string): void {
  // The same store calls `navigateToSessionMessageId` makes when attention
  // navigation opens an unread Ready result or a notification.
  act(() => {
    useStore.getState().requestScrollToMessage(SESSION_ID, messageId);
    useStore.getState().setExpandAllInTurn(SESSION_ID, messageId);
  });
}

describe("MessageFeed Ready auto-collapse", () => {
  it("keeps the Ready turn collapsed when its result is opened from attention navigation", () => {
    const history = readyQuestHistory();
    deliver(history, latestStatus(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expectCollapsed(view.container);
    expect(within(latestTurn(view.container)).getByText(ANSWER_TEXT)).toBeInTheDocument();

    // Opening the Ready result used to focus (and so expand) the turn.
    openMessage("answer-1");
    expectCollapsed(view.container);
    expect(useStore.getState().scrollToMessageId.get(SESSION_ID)).toBeUndefined();
  });

  it("still expands the turn when navigation targets a message the collapsed view hides", () => {
    const history = readyQuestHistory();
    deliver(history, latestStatus(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expectCollapsed(view.container);

    openMessage("dispatch");
    expectExpanded(view.container);
  });

  it("collapses again on a later Ready even after the user expanded the earlier one", () => {
    const history = readyQuestHistory();
    deliver(history, latestStatus(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expectCollapsed(view.container);

    // The user expands the Ready turn to read the details; that choice holds.
    fireEvent.click(within(latestTurn(view.container)).getByRole("button", { name: /Show turn activity/ }));
    expectExpanded(view.container);
    deliver(history, latestStatus(history));
    expectExpanded(view.container);

    // The worker reports again and the leader marks the thread Ready once more.
    // Worker events do not start a new turn, so this is the same turn.
    herdEvent(history, "herd-2");
    assistant(history, "complete", `${QUEST_ID} is complete and goes live with the next restart.`, {
      marker: "ready",
    });
    deliver(history, latestStatus(history));
    expectCollapsed(view.container);
  });

  it("collapses a thread marked Ready from a message routed to another thread", () => {
    const history = readyQuestHistory();
    // Replace the quest-side Ready with a Waiting answer, then mark the quest
    // Ready from a Main message (which the quest thread's window omits).
    const answer = history[history.length - 1] as Assistant;
    answer.threadStatusMarkers = [statusMarker("waiting", "answer-1", history.length - 1)];
    const mainReady = assistant(history, "main-ready", "Main reply that also closes the quest thread.", {
      route: { threadKey: "main", questId: undefined, threadRefs: [{ threadKey: "main", source: "explicit" }] },
    });
    mainReady.threadStatusMarkers = [statusMarker("ready", "main-ready", history.length - 1)];
    deliver(history, latestStatus(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(screen.queryByText("Main reply that also closes the quest thread.")).not.toBeInTheDocument();
    expectCollapsed(view.container);

    // Opening that Ready result from the quest tab cannot find the Main message there.
    openMessage("main-ready");
    expectCollapsed(view.container);
  });
});
