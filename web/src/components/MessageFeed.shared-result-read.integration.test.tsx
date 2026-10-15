// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
} from "../../server/leader-thread-response.js";
import { recordAnswerUnreadNotifications } from "../../server/bridge/session-notification-controller.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, SessionNotification, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// An answer the leader posts in one tab also shows in the tab where the user
// asked. A settled answer is an unread notification in the thread it was
// written in. Reading the answer in a quest tab reads it everywhere it appears,
// Main included. Reading it in Main never clears another thread's result, and a
// thread's other unread results stay unread. These tests replay a leader
// history through the server's answer routing, answer unread notifications and
// thread-window producer, then render each tab.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
const markNotificationDone = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"shared"' }),
    markNotificationDone,
  },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-shared-result-read";
const ASKING_QUEST = "q-2224";
const ANSWERING_QUEST = "q-2300";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
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
  markNotificationDone.mockClear();
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

function route(threadKey: string) {
  return threadKey === "main"
    ? { threadKey: "main" }
    : { threadKey, questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] };
}

function at(history: BrowserIncomingMessage[]): number {
  return 1_700_000_000_000 + history.length * 1000;
}

function ask(history: BrowserIncomingMessage[], id: string, answerId: string, threadKey: string): void {
  history.push({
    type: "user_message",
    id,
    content: `Question ${answerId}`,
    timestamp: at(history),
    leaderUserMessageId: answerId,
    leaderResponseCoverageVersion: 1,
    ...route(threadKey),
  });
}

function ready(threadKey: string, messageId: string, timestamp: number): LeaderThreadStatus {
  return {
    kind: "ready",
    label: "Thread Ready",
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    summary: `${messageId} done`,
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

/** A leader message written in `authoredIn`, marking each of `readyFor` Ready. */
function say(
  history: BrowserIncomingMessage[],
  id: string,
  authoredIn: string,
  readyFor: string[],
  answers?: string[],
): Assistant {
  const timestamp = at(history);
  const message: Assistant = {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: answers ? "answer" : "commentary",
    ...route(authoredIn),
    threadStatusMarkers: readyFor.map((threadKey) => ready(threadKey, id, timestamp)),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text: `Text of ${id}` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  if (answers) {
    message.leaderAnswerUserMessageIds = answers;
    message.leaderAnswerObservedHistoryLength = history.length;
  }
  history.push(message);
  if (answers) {
    expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, message).finalized).toBe(
      true,
    );
  }
  return message;
}

/**
 * The QA Data case: asked in one quest tab, answered in another, which then
 * marks itself Ready on a separate status message. Plus two Main requests whose
 * answers are written in that quest, and a quest request answered from Main.
 */
function leaderHistory(): { history: BrowserIncomingMessage[]; notifications: SessionNotification[] } {
  const history: BrowserIncomingMessage[] = [];
  const answers: Assistant[] = [];
  ask(history, "ask-quest", "u7", ASKING_QUEST);
  answers.push(say(history, "shared-answer", ANSWERING_QUEST, [ANSWERING_QUEST], ["u7"]));
  say(history, "quest-only-status", ANSWERING_QUEST, [ANSWERING_QUEST]);
  ask(history, "ask-main", "u8", "main");
  answers.push(say(history, "main-answer", ANSWERING_QUEST, ["main", ANSWERING_QUEST], ["u8"]));
  ask(history, "ask-main-again", "u9", "main");
  answers.push(say(history, "main-only-ready-answer", ANSWERING_QUEST, ["main"], ["u9"]));
  ask(history, "ask-quest-again", "u10", ASKING_QUEST);
  answers.push(say(history, "main-written-answer", "main", ["main"], ["u10"]));

  const session = { id: SESSION_ID, messageHistory: history, notifications: [] as SessionNotification[] };
  recordAnswerUnreadNotifications(session, answers, { persistSession: () => {} });
  return { history, notifications: session.notifications };
}

/** Deliver the session, its notifications and the server's window for `threadKey`. */
function deliver(threadKey: string): SessionNotification[] {
  const { history, notifications } = leaderHistory();
  const projection = buildLeaderThreadResponseState({ id: SESSION_ID, messageHistory: history }, threadKey).projection;
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey,
    fromItem: -1,
    itemCount: 20,
    sectionItemCount: 20,
    visibleItemCount: 4,
    currentThreadResponseProjection: projection,
  });
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, {
      type: "notification_update",
      notifications,
      notificationUrgency: "review",
      activeNotificationCount: notifications.length,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: notifications.length,
      notificationStatusVersion: 1,
      notificationStatusUpdatedAt: 1,
    });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: threadKey,
      entries: sync.entries,
      window: sync.window,
      ...(sync.threadResponseProjection ? { response_state: sync.threadResponseProjection } : {}),
    });
  });
  return notifications;
}

function notificationId(notifications: SessionNotification[], threadKey: string, messageId: string): string {
  return notifications.find((n) => n.threadKey === threadKey && n.messageId === messageId)!.id;
}

function markedRead(): string[] {
  return markNotificationDone.mock.calls.map((call) => (call as unknown[])[1] as string).sort();
}

describe("an answer shown in several tabs", () => {
  // The user's report: an answer written in a quest tab also shows in Main,
  // where it was asked, and it left both tabs unread for the same message.
  // Only the thread the answer was written in counts it unread.
  it("counts as unread only in the thread it was written in", () => {
    const { notifications } = leaderHistory();

    expect(notifications.filter((n) => n.messageId === "main-answer").map((n) => n.threadKey)).toEqual([
      ANSWERING_QUEST,
    ]);
    expect(notifications.filter((n) => n.messageId === "main-only-ready-answer").map((n) => n.threadKey)).toEqual([
      ANSWERING_QUEST,
    ]);
  });

  it("adds no unread for a status message marked Ready without an answer", () => {
    const { notifications } = leaderHistory();

    expect(notifications.some((n) => n.messageId === "quest-only-status")).toBe(false);
  });
});

describe("reading a shared answer in a quest tab", () => {
  it("reads the other threads' results on the answers it shows, but not their other unread results", () => {
    const notifications = deliver(ASKING_QUEST);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={ASKING_QUEST} markSharedResultsRead />);

    expect(view.container.querySelector('[data-message-id="shared-answer"]')).not.toBeNull();
    expect(view.container.querySelector('[data-message-id="main-written-answer"]')).not.toBeNull();
    expect(markedRead()).toEqual(
      [
        notificationId(notifications, ANSWERING_QUEST, "shared-answer"),
        notificationId(notifications, "main", "main-written-answer"),
      ].sort(),
    );
  });

  it("never reads another thread's result from Main", () => {
    deliver("main");
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" markSharedResultsRead />);

    expect(view.container.querySelector('[data-message-id="main-answer"]')).not.toBeNull();
    expect(markedRead()).toEqual([]);
  });

  it("reads nothing where the feed is not the user's selected view", () => {
    deliver(ASKING_QUEST);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={ASKING_QUEST} />);

    expect(markedRead()).toEqual([]);
  });
});
