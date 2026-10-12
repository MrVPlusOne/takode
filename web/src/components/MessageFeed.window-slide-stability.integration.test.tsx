// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// The selected thread shows the server's latest window: its last N conversation
// items. Each new message slides that window forward by one item, which moves
// every feed section boundary. Turns that are still in view must stay mounted
// through that slide; remounting them re-rendered every visible message and made
// image thumbnails disappear and load again each time the user sent a message.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"quest"' }),
    getFsImageUrl: (path: string, variant?: string) => `/api/fs/image?path=${path}&variant=${variant}`,
  },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-window-slide";
const QUEST_ID = "q-4400";
const SCREENSHOT_REPLY = "Here is the screenshot: /tmp/takode/phone-preview.png";
const questRoute = {
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
  windowRevision = 0;
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

function userMessage(history: BrowserIncomingMessage[], id: string, content: string): void {
  history.push({
    type: "user_message",
    id,
    content,
    timestamp: 1_700_000_000_000 + history.length * 1000,
    ...questRoute,
  });
}

function assistant(history: BrowserIncomingMessage[], id: string, text: string): void {
  history.push({
    type: "assistant",
    timestamp: 1_700_000_000_000 + history.length * 1000,
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...questRoute,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
}

/** A quest thread longer than the latest window, with a screenshot reply near the end. */
function longThreadHistory(): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  for (let turn = 0; turn < 30; turn++) {
    userMessage(history, `request-${turn}`, `Request ${turn}`);
    assistant(history, `reply-${turn}`, turn === 27 ? SCREENSHOT_REPLY : `Reply ${turn}`);
  }
  return history;
}

let windowRevision = 0;

/** Deliver the server's latest selected-thread window, as after each new message. */
function deliverLatestWindow(history: BrowserIncomingMessage[]): void {
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: -1,
    itemCount: 20,
    sectionItemCount: 20,
    visibleItemCount: 4,
  });
  windowRevision += 1;
  act(() => {
    if (windowRevision === 1) handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: { ...sync.window, window_hash: `window-${windowRevision}` },
    });
  });
}

function sectionIds(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll("[data-feed-section-id]")].map((node) =>
    node.getAttribute("data-feed-section-id"),
  );
}

describe("MessageFeed latest-window slide", () => {
  it("keeps visible turns and loaded image thumbnails mounted when a new message slides the window", () => {
    const history = longThreadHistory();
    deliverLatestWindow(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    // Speculative path previews load hidden first; simulate the browser finishing that load.
    const preload = view.container.querySelector('[data-testid="image-preview-preload"]');
    expect(preload).not.toBeNull();
    act(() => {
      fireEvent.load(preload!);
    });
    const thumbnail = view.container.querySelector('[data-testid="image-preview-thumbnail-image"]');
    const screenshotTurn = view.container.querySelector('[data-turn-id="request-27"]');
    expect(thumbnail).not.toBeNull();
    const sectionsBefore = sectionIds(view.container);

    // The user sends a new message: the server's latest window now starts one item later.
    userMessage(history, "request-new", "Next question");
    deliverLatestWindow(history);

    // Section boundaries moved with the window...
    expect(sectionIds(view.container)).not.toEqual(sectionsBefore);
    // ...but the turn and its already-loaded thumbnail are the same DOM nodes,
    // with no new hidden preload, so nothing reloads.
    expect(view.container.querySelector('[data-turn-id="request-27"]')).toBe(screenshotTurn);
    expect(view.container.querySelector('[data-testid="image-preview-thumbnail-image"]')).toBe(thumbnail);
    expect(view.container.querySelector('[data-testid="image-preview-preload"]')).toBeNull();
  });
});
