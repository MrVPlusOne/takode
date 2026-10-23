// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendHistoryWindowSync } from "../../server/bridge/browser-transport-controller.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// In All Threads a leader's feed shows the session history window, which the
// server cuts at backend turns. On a busy leader the latest window starts at a
// herd event in the middle of a leader turn. That clipped turn must keep the same
// id when an older window extends it: scrolling up keeps the reading position by
// that id, and when it changed the feed jumped to the top, where a phone could
// not scroll up to load anything older.

vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: null }) },
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-all-threads-leading-turn";
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
  sendToSession.mockClear();
});
afterEach(cleanup);

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "codex",
    model: "gpt-5",
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

const result = (index: number) =>
  ({
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      session_id: `result-${index}`,
    },
  }) as BrowserIncomingMessage;

const assistant = (id: string, timestamp: number) =>
  ({
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5",
      content: [{ type: "text", text: `Reply ${id}` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) as BrowserIncomingMessage;

/** One human request, then herd-event turns the leader answers, as the server stores them. */
function history(): BrowserIncomingMessage[] {
  const messages: BrowserIncomingMessage[] = [
    { type: "user_message", id: "human-request", content: "Run the evals", timestamp: 1_000 },
    assistant("answer", 1_001),
    result(0),
  ];
  for (let index = 0; index < 12; index++) {
    messages.push(
      {
        type: "user_message",
        id: `herd-${index}`,
        content: `1 event from 1 session\n\n#7 | turn_end | progress ${index}`,
        timestamp: 2_000 + index * 10,
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      } as BrowserIncomingMessage,
      assistant(`ack-${index}`, 2_001 + index * 10),
      result(index + 1),
    );
  }
  return messages;
}

/** Deliver a history window through the server's own sender and the browser's handler. */
function deliverWindow(messages: BrowserIncomingMessage[], fromTurn: number, turnCount: number) {
  const sent: BrowserIncomingMessage[] = [];
  sendHistoryWindowSync(
    { messageHistory: messages },
    { send: (data: string) => sent.push(JSON.parse(data) as BrowserIncomingMessage) },
    { fromTurn, turnCount, sectionTurnCount: turnCount, visibleSectionCount: 1 },
  );
  act(() => handleMessage(SESSION_ID, sent[0]!));
}

const turnIds = () =>
  [...document.querySelectorAll<HTMLElement>("[data-turn-id]")].map((element) => element.dataset.turnId);

describe("All Threads leading turn across history windows", () => {
  it("keeps the clipped leading turn's id when an older window extends it", () => {
    const messages = history();
    act(() => handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() }));
    // The latest window starts at a herd event inside the human request's turn.
    deliverWindow(messages, 9, 4);
    render(<MessageFeed sessionId={SESSION_ID} threadKey="all" />);
    expect(turnIds()[0]).toBe("human-request");

    // An older window still clips the same turn, from an earlier herd event.
    deliverWindow(messages, 3, 10);
    expect(turnIds()[0]).toBe("human-request");

    // The whole history includes the human message itself: the same turn, now whole.
    deliverWindow(messages, 0, 13);
    expect(turnIds()[0]).toBe("human-request");
  });
});
