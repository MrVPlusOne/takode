// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// A needs-input card's partly entered answers are local draft state. Sending
// another message in the same thread (which regroups the feed and replaces the
// thread window) must not wipe them; only submitting the card or the server
// resolving the notification ends the draft.

const apiMocks = vi.hoisted(() => ({
  sendNeedsInputResponse: vi.fn().mockResolvedValue({}),
  markNotificationDone: vi.fn().mockResolvedValue({}),
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));

vi.mock("../api.js", () => ({ api: apiMocks }));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

type ThreadWindowSync = Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>;
type NotificationUpdate = Extract<BrowserIncomingMessage, { type: "notification_update" }>;

const SESSION_ID = "leader-needs-input-draft";
const QUEST_ID = "q-77";
const NOTIFICATION_ID = "n-migration";
const route = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });

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
  apiMocks.sendNeedsInputResponse.mockClear();
});

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude-sdk",
    model: "claude-opus-4-20250514",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "2.1.0",
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

function userMessage(id: string, text: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content: text, timestamp, ...route };
}

function assistantMessage(id: string, text: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...route,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/** Producer-shaped quest thread window: a request, then the leader's decision prompt, then any later messages. */
function questWindow(later: BrowserIncomingMessage[] = []): ThreadWindowSync {
  const entries = [
    userMessage("user-request", "Plan the migration off the laptop.", 1_700_000_001_000),
    assistantMessage("decision-prompt", "Here are the migration steps to choose from.", 1_700_000_002_000),
    ...later,
  ].map((message, index) => ({ history_index: 40 + index, message }));
  return {
    type: "thread_window_sync",
    thread_key: QUEST_ID,
    entries,
    window: {
      thread_key: QUEST_ID,
      from_item: 0,
      item_count: entries.length,
      total_items: entries.length,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 40 + entries.length,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
  };
}

function notificationUpdate(done: boolean, version: number, included = true): NotificationUpdate {
  return {
    type: "notification_update",
    notifications: included
      ? [
          {
            id: NOTIFICATION_ID,
            category: "needs-input",
            summary: "Migration off the laptop: choose which steps to take",
            questions: [
              { prompt: "Move the leader to a new DevBox session?", suggestedAnswers: ["yes", "Not yet"] },
              { prompt: "Back up the unpushed commits?", suggestedAnswers: ["Push a branch", "Bundle"] },
            ],
            timestamp: 1_700_000_002_500,
            messageId: "decision-prompt",
            done,
            ...route,
          },
        ]
      : [],
    notificationStatusVersion: version,
  };
}

function answerFields(): HTMLTextAreaElement[] {
  return within(screen.getByTestId("notification-answer-actions")).getAllByPlaceholderText(
    "Your answer",
  ) as HTMLTextAreaElement[];
}

function renderPartlyAnsweredCard() {
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, questWindow());
    handleMessage(SESSION_ID, notificationUpdate(false, 1));
  });
  const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
  // Pick a suggested answer for the first question and type a custom answer for the second.
  fireEvent.click(within(screen.getAllByTestId("notification-question-block")[0]).getByText("yes"));
  fireEvent.change(answerFields()[1], { target: { value: "Bundle it onto NFS first" } });
  expect(answerFields().map((field) => field.value)).toEqual(["yes", "Bundle it onto NFS first"]);
  return view;
}

describe("needs-input answer drafts", () => {
  it("keeps partly entered answers after the user sends another message in the same thread", () => {
    const view = renderPartlyAnsweredCard();

    // The user's separate message arrives in the thread window and the feed regroups.
    act(() => {
      handleMessage(
        SESSION_ID,
        questWindow([userMessage("user-comment", "One more thought on step 3.", 1_700_000_003_000)]),
      );
    });
    // Also cover a full remount of the feed, e.g. after switching threads and back.
    view.unmount();
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("One more thought on step 3.")).toBeInTheDocument();
    expect(answerFields().map((field) => field.value)).toEqual(["yes", "Bundle it onto NFS first"]);
  });

  it("clears the draft once the server reports the notification resolved", () => {
    renderPartlyAnsweredCard();

    act(() => handleMessage(SESSION_ID, notificationUpdate(true, 2)));
    expect(useStore.getState().needsInputDrafts.get(SESSION_ID)).toBeUndefined();

    // Reopening (Mark unhandled) starts from an empty card rather than the stale draft.
    act(() => handleMessage(SESSION_ID, notificationUpdate(false, 3)));
    expect(answerFields().map((field) => field.value)).toEqual(["", ""]);
  });

  it("clears the draft once the server drops the notification", () => {
    renderPartlyAnsweredCard();

    act(() => handleMessage(SESSION_ID, notificationUpdate(false, 2, false)));

    expect(useStore.getState().needsInputDrafts.get(SESSION_ID)).toBeUndefined();
  });

  it("clears the draft after the answers are submitted", async () => {
    renderPartlyAnsweredCard();
    fireEvent.change(answerFields()[0], { target: { value: "yes, this week" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });

    expect(apiMocks.sendNeedsInputResponse).toHaveBeenCalledWith(
      SESSION_ID,
      NOTIFICATION_ID,
      expect.objectContaining({ content: expect.stringContaining("Bundle it onto NFS first") }),
    );
    expect(useStore.getState().needsInputDrafts.get(SESSION_ID)).toBeUndefined();
    expect(answerFields().map((field) => field.value)).toEqual(["", ""]);
  });
});
