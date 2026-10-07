// @vitest-environment jsdom

// jsdom does not implement scrollIntoView; polyfill it before any React rendering
const mockScrollIntoView = vi.fn();
const mockScrollTo = vi.fn();
const mediaState = { touchDevice: false };

beforeAll(() => {
  Element.prototype.scrollIntoView = mockScrollIntoView;
  Element.prototype.scrollTo = mockScrollTo;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(hover: none) and (pointer: coarse)" ? mediaState.touchDevice : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ChatMessage, ContentBlock } from "../types.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

// Build a mock for the store that returns configurable values per session
const mockStoreValues: Record<string, unknown> = {};
const mockToggleTurnActivity = vi.fn();
const mockFocusTurn = vi.fn();
const mockClearScrollToTurn = vi.fn();
const mockClearScrollToMessage = vi.fn();
const mockSetActiveTaskTurnId = vi.fn();
const mockKeepTurnExpanded = vi.fn();
const mockSetCollapsibleTurnIds = vi.fn();
const mockSetFeedScrollPosition = vi.fn();
const mockCollapseAllTurnActivity = vi.fn();
const mockClearBottomAlignOnNextUserMessage = vi.fn();
const mockSetComposerDraft = vi.fn();
const mockSendToSession: any = vi.fn(() => true);

vi.mock("../ws.js", () => ({
  sendToSession: (sessionId: string, msg: any) => mockSendToSession(sessionId, msg),
}));

vi.mock("../store.js", () => {
  const useStore: any = (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      messages: mockStoreValues.messages ?? new Map(),
      composerDrafts: mockStoreValues.composerDrafts ?? new Map(),
      messageFrozenCounts: mockStoreValues.messageFrozenCounts ?? new Map(),
      messageFrozenRevisions: mockStoreValues.messageFrozenRevisions ?? new Map(),
      historyLoading: mockStoreValues.historyLoading ?? new Map(),
      historyWindows: mockStoreValues.historyWindows ?? new Map(),
      streamingStartedAt: mockStoreValues.streamingStartedAt ?? new Map(),
      streamingOutputTokens: mockStoreValues.streamingOutputTokens ?? new Map(),
      streamingPausedDuration: mockStoreValues.streamingPausedDuration ?? new Map(),
      streamingPauseStartedAt: mockStoreValues.streamingPauseStartedAt ?? new Map(),
      sessionStatus: mockStoreValues.sessionStatus ?? new Map(),
      sessionStuck: mockStoreValues.sessionStuck ?? new Map(),
      sessions: mockStoreValues.sessions ?? new Map(),
      toolProgress: mockStoreValues.toolProgress ?? new Map(),
      toolResults: mockStoreValues.toolResults ?? new Map(),
      toolStartTimestamps: mockStoreValues.toolStartTimestamps ?? new Map(),
      sdkSessions: mockStoreValues.sdkSessions ?? [],
      feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
      turnActivityOverrides: mockStoreValues.turnActivityOverrides ?? new Map(),
      autoExpandedTurnIds: mockStoreValues.autoExpandedTurnIds ?? new Map(),
      toggleTurnActivity: mockToggleTurnActivity,
      scrollToTurnId: mockStoreValues.scrollToTurnId ?? new Map(),
      clearScrollToTurn: mockClearScrollToTurn,
      scrollToMessageId: mockStoreValues.scrollToMessageId ?? new Map(),
      clearScrollToMessage: mockClearScrollToMessage,
      expandAllInTurn: mockStoreValues.expandAllInTurn ?? new Map(),
      clearExpandAllInTurn: vi.fn(),
      bottomAlignNextUserMessage: mockStoreValues.bottomAlignNextUserMessage ?? new Set(),
      sessionTaskHistory: mockStoreValues.sessionTaskHistory ?? new Map(),
      pendingUserUploads: mockStoreValues.pendingUserUploads ?? new Map(),
      pendingCodexInputs: mockStoreValues.pendingCodexInputs ?? new Map(),
      activeTaskTurnId: mockStoreValues.activeTaskTurnId ?? new Map(),
      setActiveTaskTurnId: mockSetActiveTaskTurnId,
      backgroundAgentNotifs: mockStoreValues.backgroundAgentNotifs ?? new Map(),
      sessionNotifications: mockStoreValues.sessionNotifications ?? new Map(),
      sessionAttentionRecords: mockStoreValues.sessionAttentionRecords ?? new Map(),
      syncedProjectionValues: mockStoreValues.syncedProjectionValues ?? new Map(),
      syncedProjectionKeys: mockStoreValues.syncedProjectionKeys ?? new Set(),
      sessionSearch: mockStoreValues.sessionSearch ?? new Map(),
      compactToolActivity: mockStoreValues.compactToolActivity ?? false,
    };
    return selector(state);
  };
  useStore.getState = () => ({
    feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
    setFeedScrollPosition: mockSetFeedScrollPosition,
    collapseAllTurnActivity: mockCollapseAllTurnActivity,
    setCollapsibleTurnIds: mockSetCollapsibleTurnIds,
    turnActivityOverrides: mockStoreValues.turnActivityOverrides ?? new Map(),
    autoExpandedTurnIds: mockStoreValues.autoExpandedTurnIds ?? new Map(),
    toggleTurnActivity: mockToggleTurnActivity,
    focusTurn: mockFocusTurn,
    keepTurnExpanded: mockKeepTurnExpanded,
    clearBottomAlignOnNextUserMessage: mockClearBottomAlignOnNextUserMessage,
    setComposerDraft: mockSetComposerDraft,
    removePendingUserUpload: vi.fn(),
    updatePendingUserUpload: vi.fn(),
    focusComposer: vi.fn(),
  });
  return {
    useStore,
    getSessionSearchState: (state: Record<string, unknown>, _sessionId: string) => {
      return { query: "", isOpen: false, mode: "strict", category: "all", matches: [], currentMatchIndex: -1 };
    },
    sessionSearchMessageMatchesCategory: () => true,
  };
});

import { MessageFeed } from "./MessageFeed.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function setStoreMessages(sessionId: string, msgs: ChatMessage[]) {
  const map = new Map();
  map.set(sessionId, msgs);
  mockStoreValues.messages = map;
}

function setStoreSessionBackend(sessionId: string, backend: "claude" | "codex") {
  const map = new Map();
  map.set(sessionId, { backend_type: backend });
  mockStoreValues.sessions = map;
}

function makeHerdEvent(
  id: string,
  content: string,
  options: {
    eventKey?: string;
    eventType?: string;
    sessionNum?: number;
    lifecycle?: NonNullable<ChatMessage["takodeHerdEvents"]>[number]["lifecycle"];
    routine?: boolean;
    metadata?: ChatMessage["metadata"];
  } = {},
): ChatMessage {
  return makeMessage({
    id,
    role: "user",
    content,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.eventKey ? { takodeHerdEventKeys: [options.eventKey] } : {}),
    ...(options.eventType
      ? {
          takodeHerdEvents: [
            {
              event: options.eventType as NonNullable<ChatMessage["takodeHerdEvents"]>[number]["event"],
              sessionId: `worker-${options.sessionNum ?? 2444}`,
              sessionNum: options.sessionNum ?? 2444,
              ts: Date.now(),
              routine:
                options.routine ??
                (options.eventType === "turn_end" ||
                  options.eventType === "worker_stream" ||
                  options.eventType === "board_stalled"),
              ...(options.lifecycle?.length ? { lifecycle: options.lifecycle } : {}),
            },
          ],
        }
      : {}),
  });
}

function turnEndEventKey(overrides: { interrupted?: boolean; isError?: boolean; userMessageCount?: number } = {}) {
  return [
    "turn_end",
    "worker-2444",
    "stop",
    "31300",
    overrides.isError ? "true" : "",
    overrides.interrupted ? "true" : "",
    overrides.interrupted ? "system" : "",
    "",
    "",
    "",
    "",
    "",
    "q-1789",
    "q-1789",
    "Bash:5",
    "Low remains healthy.",
    "1160",
    "1174",
    "",
    "",
    "",
    overrides.userMessageCount == null ? "" : String(overrides.userMessageCount),
    "",
    "leader",
  ].join("|");
}

function resetStore() {
  mockToggleTurnActivity.mockReset();
  mockFocusTurn.mockReset();
  mockClearScrollToTurn.mockReset();
  mockClearScrollToMessage.mockReset();
  mockSetActiveTaskTurnId.mockReset();
  mockKeepTurnExpanded.mockReset();
  mockSetCollapsibleTurnIds.mockReset();
  mockSetFeedScrollPosition.mockReset();
  mockCollapseAllTurnActivity.mockReset();
  mockClearBottomAlignOnNextUserMessage.mockReset();
  mockSetComposerDraft.mockReset();
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockStoreValues.messages = new Map();
  mockStoreValues.messageFrozenCounts = new Map();
  mockStoreValues.messageFrozenRevisions = new Map();
  mockStoreValues.historyWindows = new Map();
  mockStoreValues.streamingStartedAt = new Map();
  mockStoreValues.streamingOutputTokens = new Map();
  mockStoreValues.streamingPausedDuration = new Map();
  mockStoreValues.streamingPauseStartedAt = new Map();
  mockStoreValues.sessionStatus = new Map();
  mockStoreValues.sessions = new Map();
  mockStoreValues.syncedProjectionValues = new Map();
  mockStoreValues.syncedProjectionKeys = new Set();
  mockStoreValues.toolProgress = new Map();
  mockStoreValues.toolResults = new Map();
  mockStoreValues.toolStartTimestamps = new Map();
  mockStoreValues.turnActivityOverrides = new Map();
  mockStoreValues.autoExpandedTurnIds = new Map();
  mockStoreValues.backgroundAgentNotifs = new Map();
  mockStoreValues.scrollToTurnId = new Map();
  mockStoreValues.scrollToMessageId = new Map();
  mockStoreValues.expandAllInTurn = new Map();
  mockStoreValues.bottomAlignNextUserMessage = new Set();
  mockStoreValues.sessionTaskHistory = new Map();
  mockStoreValues.pendingCodexInputs = new Map();
  mockStoreValues.activeTaskTurnId = new Map();
  mockStoreValues.sdkSessions = [];
  mockStoreValues.compactToolActivity = false;
}

/** Set explicit overrides for turn activity expansion per session.
 *  Each entry: [turnId, expanded: boolean]. */
async function flushFeedObservers() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetStore();
  mockScrollIntoView.mockClear();
  mockScrollTo.mockClear();
  mediaState.touchDevice = false;
});

describe("MessageFeed - compact activity", () => {
  it("batches consecutive tool-only messages into one compact activity row", () => {
    // Separate protocol messages should still read as one lightweight run until the user asks for details.
    const sid = "test-compact-tool-run";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Inspect and verify" }),
      makeMessage({
        id: "tools-read",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/src/a.ts" } }],
      }),
      makeMessage({
        id: "tools-bash",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "bun test" } }],
      }),
      makeMessage({ id: "a-final", role: "assistant", content: "Everything passes." }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    expect(screen.getByText("Read file, ran command")).toBeTruthy();
    // The final text follows the run, so the collapsed group shows only its heading.
    expect(screen.queryAllByTestId("compact-tool-activity-line")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Show all 2 tool calls/ }));
    // Each tool is a short line; its chip details stay hidden until that line is opened.
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "Read/src/a.ts",
      "Bashbun test",
    ]);
    expect(screen.getAllByText("bun test")).toHaveLength(1);
    expect(screen.getByText("Everything passes.")).toBeTruthy();
    const compactRow = screen.getByTestId("compact-tool-activity").closest("[data-compact-tool-activity-row]");
    expect(compactRow).toBeTruthy();
    expect(compactRow?.querySelector(".rounded-full")).toBeNull();
    expect(compactRow?.closest(".turn-container")?.className).toContain("sm:space-y-3");

    fireEvent.click(screen.getByRole("button", { name: "Show Bash: bun test" }));
    expect(screen.getAllByText("bun test")).toHaveLength(2);
  });

  it("keeps the rolling window only for the group that ends the feed", () => {
    // The newest group is still active and shows its latest three activities.
    // A group followed by agent text collapses to its heading.
    const sid = "test-compact-active-group";
    mockStoreValues.compactToolActivity = true;
    const bashMessage = (id: string) =>
      makeMessage({
        id: `msg-${id}`,
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id, name: "Bash", input: { command: `echo ${id}` } }],
      });
    const history = [
      makeMessage({ id: "u1", role: "user", content: "Inspect and verify" }),
      bashMessage("mid-1"),
      bashMessage("mid-2"),
      makeMessage({ id: "a-mid", role: "assistant", content: "Checking more." }),
      bashMessage("live-1"),
      bashMessage("live-2"),
      bashMessage("live-3"),
      bashMessage("live-4"),
    ];
    setStoreMessages(sid, history);

    const { unmount } = render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(2);
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "Bashecho live-2",
      "Bashecho live-3",
      "Bashecho live-4",
    ]);
    expect(screen.getByTestId("compact-tool-activity-earlier").textContent).toBe("+1 earlier");
    unmount();

    // Agent text arriving after the live group makes it inactive too.
    setStoreMessages(sid, [...history, makeMessage({ id: "a-final", role: "assistant", content: "Done." })]);
    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(2);
    expect(screen.queryAllByTestId("compact-tool-activity-line")).toHaveLength(0);
    expect(screen.queryByTestId("compact-tool-activity-earlier")).toBeNull();
  });

  it("lets only agent text split an activity group, folding thinking in as thought lines", () => {
    // Producer-shaped Claude history (as in a real leader thread): normalization
    // copies thinking text into `content`, and a thinking block with text can
    // precede a tool in one message. Both must join the group, not split it.
    const sid = "test-compact-thought-run";
    mockStoreValues.compactToolActivity = true;
    const assistant = (id: string, content: ContentBlock[], historyIndex: number) =>
      normalizeHistoryMessageToChatMessages(
        {
          type: "assistant",
          message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: null },
          parent_tool_use_id: null,
          timestamp: 1_791_272_100_000 + historyIndex,
        } as Parameters<typeof normalizeHistoryMessageToChatMessages>[0],
        historyIndex,
      )[0];
    const bash = (id: string, description: string): ContentBlock => ({
      type: "tool_use",
      id,
      name: "Bash",
      input: { command: `echo ${id}`, description },
    });
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Inspect and verify" }),
      assistant("m1", [{ type: "thinking", thinking: "" }, bash("t1", "Revise Journey suffix")], 1),
      assistant("m2", [bash("t2", "Check board revise syntax")], 2),
      assistant("m3", [{ type: "thinking", thinking: "Plan the retest notice" }, bash("t3", "Notify user")], 3),
      assistant("m4", [bash("t4", "Link board wait")], 4),
      assistant("m5", [{ type: "thinking", thinking: "Verify the result" }], 5),
      makeMessage({ id: "a-final", role: "assistant", content: "Everything passes." }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Show all 6 tool calls/ }));
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "BashRevise Journey suffix",
      "BashCheck board revise syntax",
      "ThoughtPlan the retest notice",
      "BashNotify user",
      "BashLink board wait",
      "ThoughtVerify the result",
    ]);
    expect(screen.getByText("Everything passes.")).toBeTruthy();
  });

  it("merges a mixed tool message with the following tool-only message", () => {
    // Codex can put Bash and Read blocks in one assistant payload, then emit another Read payload immediately after it.
    const sid = "test-compact-mixed-tool-boundary";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Inspect the implementation" }),
      makeMessage({
        id: "tools-mixed",
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "tool_use", id: "bash-1", name: "Bash", input: { command: "git status" } },
          { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/src/a.ts" } },
        ],
      }),
      makeMessage({
        id: "tools-read",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/src/b.ts" } }],
      }),
      makeMessage({ id: "a-final", role: "assistant", content: "Inspection complete." }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    expect(screen.getByText("Ran command, read files")).toBeTruthy();
    expect(screen.queryByText("Read file")).toBeNull();
  });

  it("sanitizes stale root Codex reasoning before grouping sibling tools", () => {
    // Already-hydrated pre-fix state can still carry reasoning in both content fields; it must not split the tool run.
    const sid = "test-stale-root-reasoning-tool-group";
    mockStoreValues.compactToolActivity = true;
    setStoreSessionBackend(sid, "codex");
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Inspect the implementation" }),
      makeMessage({
        id: "tools-with-stale-reasoning",
        role: "assistant",
        content: "Stale root reasoning",
        contentBlocks: [
          { type: "thinking", thinking: "Stale root reasoning" },
          { type: "tool_use", id: "bash-1", name: "Bash", input: { command: "git status" } },
        ],
      }),
      makeMessage({
        id: "tools-read",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/src/a.ts" } }],
      }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    expect(screen.getByText("Ran command, read file")).toBeTruthy();
    expect(screen.queryByText("Stale root reasoning")).toBeNull();
  });

  it("merges compact tools across feed entries that render no visible row", () => {
    // Empty retained assistant payloads are not meaningful visual boundaries between adjacent tool activity.
    const sid = "test-compact-tool-invisible-boundary";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Run the checks" }),
      makeMessage({
        id: "tools-bash",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "bun test" } }],
      }),
      makeMessage({ id: "empty-retained", role: "assistant", content: "" }),
      makeMessage({
        id: "tools-read",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/src/a.ts" } }],
      }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    expect(screen.getByText("Ran command, read file")).toBeTruthy();
  });

  it("groups routine herd events into compact worker-event activity with full expanded details", () => {
    // Producer-shaped herd metadata lets routine worker completion events hide
    // behind the existing quiet activity summary without parsing prose.
    const sid = "test-compact-worker-events";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Monitor worker progress" }),
      makeMessage({
        id: "tools-bash",
        role: "assistant",
        content: "",
        contentBlocks: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "takode scan 2444" } }],
      }),
      makeHerdEvent(
        "herd-1",
        '1 event from 1 session\n\n#2444 | turn_end | ok 31.3s | tools: 5 | [1160]-[1174]\n  [1174] asst: "Low remains healthy."',
        { eventKey: turnEndEventKey() },
      ),
      makeHerdEvent(
        "herd-2",
        '1 event from 1 session\n\n#2444 | turn_end | ok 36.6s | tools: 5 | [1176]-[1190]\n  [1190] asst: "Monitoring continues."',
        { eventKey: turnEndEventKey() },
      ),
      makeMessage({ id: "a-final", role: "assistant", content: "Worker is still healthy." }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
    expect(screen.getByText("Ran command, 2 worker events")).toBeTruthy();
    expect(screen.queryByText(/tools: 5/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show all 3 activity items/ }));
    // Worker events are lines naming the session and event; their bodies stay behind each line.
    expect(screen.getAllByTestId("compact-tool-activity-line").map((line) => line.textContent)).toEqual([
      "Bashtakode scan 2444",
      "Event#2444 | turn_end",
      "Event#2444 | turn_end",
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: "Show Event: #2444 | turn_end" })[0]);

    expect(screen.getByText(/31\.3s.*tools: 5/)).toBeTruthy();
    expect(screen.getByText(/Low remains healthy/)).toBeTruthy();
    expect(screen.getByText("Worker is still healthy.")).toBeTruthy();
  });

  it("compacts interrupted herd chips while preserving permission decisions", () => {
    // Interrupted worker-event chips are compacted into activity, but actual
    // permission/decision UI remains visible outside the quiet worker summary.
    const sid = "test-actionable-worker-event-boundary";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Monitor worker progress" }),
      makeHerdEvent("routine-herd", "1 event from 1 session\n\n#2444 | turn_end | ok 31.3s", {
        eventKey: turnEndEventKey(),
      }),
      makeHerdEvent(
        "interrupted-herd",
        "1 event from 1 session\n\n#2444 | turn_end | Work interrupted | recovery pending",
        {
          eventKey: turnEndEventKey({ interrupted: true }),
          eventType: "turn_end",
          lifecycle: ["interrupted"],
          routine: false,
        },
      ),
      makeHerdEvent(
        "permission-herd",
        "1 event from 1 session\n\n#2444 | permission_request | waiting for decision; Work preserved | Bash needs approval",
        {
          eventType: "permission_request",
          lifecycle: ["waiting_for_decision"],
          routine: false,
        },
      ),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("2 worker events")).toBeTruthy();
    expect(screen.queryByText(/^Work interrupted$/)).toBeNull();
    expect(screen.getByText(/permission_request/)).toBeTruthy();
    expect(screen.getAllByText(/waiting for decision; Work preserved/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId("compact-tool-activity")).toHaveLength(1);
  });

  it("renders notification UI outside a compacted tool-only notify command", () => {
    // Tool-only notify messages bypass MessageBubble, so the feed-level compact group must preserve the fallback panel.
    const sid = "test-compact-tool-notification";
    mockStoreValues.compactToolActivity = true;
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Tell me when it is ready" }),
      makeMessage({
        id: "notify-tool-message",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "notify-tool",
            name: "Bash",
            input: { command: 'takode notify review "Ready for review"' },
          },
        ],
      }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    // A single compact tool is one light row naming its own command, not a generic "Ran command".
    expect(screen.queryByText("Ran command")).toBeNull();
    const row = screen.getByRole("button", { name: /Show Bash: takode notify review/ });
    expect(screen.getAllByText("Ready for review")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mark as reviewed" })).toBeTruthy();

    fireEvent.click(row);
    expect(screen.getAllByText("Ready for review")).toHaveLength(1);
  });
});
