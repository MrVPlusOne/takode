// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
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

// A leader's earlier answers sit in collapsed turns, showing the answer with its
// image thumbnails. Sending a message briefly invalidates the thread's answer
// presentation (the new message shows before the server's response state lists
// it as pending), and a later Ready restores it. Each switch used to render the
// collapsed turn through a different component tree, so every earlier answer
// remounted and its thumbnails blanked and loaded again (seen on the iPhone).
// These tests replay that sequence through the real producers and require the
// thumbnail to keep its DOM node.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"answer"' }),
    getFsImageUrl: (path: string, variant?: string) => `/api/fs/image?path=${path}&variant=${variant}`,
  },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-answer-images";
const QUEST_ID = "q-4500";
const handleMessage = createWsMessageHandler({
  disconnectSession: vi.fn(),
  sendToSession,
});
const ROUTES = {
  [QUEST_ID]: {
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
  },
  main: { threadKey: "main" },
};
let threadKey: keyof typeof ROUTES = QUEST_ID;
type Assistant = Extract<BrowserIncomingMessage, { type: "assistant" }>;
type UserMessage = Extract<BrowserIncomingMessage, { type: "user_message" }>;

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
  revision = 0;
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

function readyMarker(messageId: string, historyIndex: number): LeaderThreadStatus {
  return {
    kind: "ready",
    label: "Thread Ready",
    threadKey,
    ...(threadKey === QUEST_ID ? { questId: QUEST_ID } : {}),
    summary: "answered",
    messageId,
    timestamp: timestampAt(historyIndex),
    updatedAt: timestampAt(historyIndex),
  };
}

function userMessage(history: BrowserIncomingMessage[], id: string, answerId: string): UserMessage {
  const message: UserMessage = {
    type: "user_message",
    id,
    content: `Request ${answerId}`,
    timestamp: timestampAt(history.length),
    leaderUserMessageId: answerId,
    leaderResponseCoverageVersion: 1,
    ...ROUTES[threadKey],
  };
  history.push(message);
  return message;
}

function assistant(history: BrowserIncomingMessage[], id: string, text: string): Assistant {
  const message: Assistant = {
    type: "assistant",
    timestamp: timestampAt(history.length),
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...ROUTES[threadKey],
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  history.push(message);
  return message;
}

/** A routed answer to `answerId` that marks the thread Ready, finalized as the server does. */
function readyAnswer(history: BrowserIncomingMessage[], id: string, text: string, answerId: string): void {
  const answer = assistant(history, id, text);
  answer.threadStatusMarkers = [readyMarker(id, history.length - 1)];
  answer.leaderThreadRole = "answer";
  answer.leaderAnswerUserMessageIds = [answerId];
  answer.leaderAnswerObservedHistoryLength = history.length - 1;
  expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, answer)).toMatchObject({
    finalized: true,
  });
}

function latestReady(history: BrowserIncomingMessage[]): LeaderThreadStatus | null {
  let latest: LeaderThreadStatus | null = null;
  for (const message of history) {
    for (const marker of (message as { threadStatusMarkers?: LeaderThreadStatus[] }).threadStatusMarkers ?? []) {
      latest = marker;
    }
  }
  return latest;
}

let revision = 0;

/** Deliver the server's selected-thread window, response state and thread status. */
function deliver(history: BrowserIncomingMessage[], status: LeaderThreadStatus | null): void {
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
  revision += 1;
  act(() => {
    if (revision === 1)
      handleMessage(SESSION_ID, {
        type: "session_init",
        session: leaderSession(),
      });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: threadKey,
      entries: sync.entries,
      window: { ...sync.window, window_hash: `window-${revision}` },
      ...(sync.threadResponseProjection ? { response_state: sync.threadResponseProjection } : {}),
    });
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: SESSION_ID,
        revision,
        value: createLeaderThreadTabsProjectionValue({
          tabs: [],
          activePhaseSummary: [],
          threadStatuses: status ? { [threadKey]: status } : {},
        }),
      }),
    );
  });
}

function turnNode(container: HTMLElement, turnId: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`)!;
}

function thumbnailIn(container: HTMLElement, turnId: string): HTMLElement | null {
  return container.querySelector(`[data-turn-id="${turnId}"] [data-testid="image-preview-thumbnail-image"]`);
}

function herdEvent(history: BrowserIncomingMessage[], id: string): void {
  history.push({
    type: "user_message",
    id,
    content: "1 event from 1 session\n\n#12 | turn_end | complete",
    timestamp: timestampAt(history.length),
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...ROUTES[threadKey],
  });
}

/** Simulates the browser finishing the hidden preload of a path-mentioned screenshot. */
function finishPreloads(container: HTMLElement): void {
  const preloads = container.querySelectorAll('[data-testid="image-preview-preload"]');
  expect(preloads.length).toBeGreaterThan(0);
  act(() => {
    for (const preload of preloads) fireEvent.load(preload);
  });
}

/**
 * The user sends a message and the leader answers it with a fresh Ready, in the
 * order the browser receives them; `check` runs after every delivery.
 */
function sendAndAnswer(history: BrowserIncomingMessage[], check: () => void): void {
  // The server broadcasts the message before the next window lists it as
  // pending, so the answer presentation is briefly unavailable.
  const request = userMessage(history, "request-2", "u2");
  act(() => {
    handleMessage(SESSION_ID, request);
  });
  check();
  // The next window lists the message as pending.
  deliver(history, latestReady(history));
  check();
  // The leader answers and marks the thread Ready again.
  readyAnswer(history, "answer-2", "Second answer.", "u2");
  deliver(history, latestReady(history));
  check();
}

describe.each([
  { thread: QUEST_ID as keyof typeof ROUTES, label: "a quest thread" },
  { thread: "main" as keyof typeof ROUTES, label: "Main" },
])("MessageFeed answer image stability in $label", ({ thread }) => {
  beforeEach(() => {
    threadKey = thread;
  });

  it("keeps an earlier answer's loaded thumbnail mounted while a new message is sent and answered", () => {
    const history: BrowserIncomingMessage[] = [];
    userMessage(history, "request-1", "u1");
    readyAnswer(history, "answer-1", "Done. Screenshot: /tmp/takode/phone-preview.png", "u1");
    // A worker report after the answer makes the answer a sub-conclusion when
    // no answer presentation applies.
    herdEvent(history, "herd-1");
    deliver(history, latestReady(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={threadKey} />);
    finishPreloads(view.container);
    const thumbnail = thumbnailIn(view.container, "request-1");
    expect(thumbnail).not.toBeNull();

    sendAndAnswer(history, () => {
      expect(thumbnailIn(view.container, "request-1")).toBe(thumbnail);
      expect(view.container.querySelector('[data-testid="image-preview-preload"]')).toBeNull();
    });
  });

  it("keeps a loaded thumbnail mounted in an expanded turn while a new message is sent and answered", () => {
    const history: BrowserIncomingMessage[] = [];
    userMessage(history, "request-1", "u1");
    readyAnswer(history, "answer-1", "Done. Screenshot: /tmp/takode/phone-preview.png", "u1");
    userMessage(history, "request-1b", "u3");
    readyAnswer(history, "answer-1b", "Follow-up answer.", "u3");
    deliver(history, latestReady(history));
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={threadKey} />);
    // The user opens the earlier answered turn's activity; that choice lasts.
    fireEvent.click(
      within(turnNode(view.container, "request-1")).getByRole("button", {
        name: /Show turn activity/,
      }),
    );
    finishPreloads(view.container);
    const thumbnail = thumbnailIn(view.container, "request-1");
    expect(thumbnail).not.toBeNull();

    sendAndAnswer(history, () => {
      expect(thumbnailIn(view.container, "request-1")).toBe(thumbnail);
    });
  });
});
