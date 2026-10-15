// @vitest-environment jsdom
// When the feed asks the server for history and selected-thread windows, and what it shows meanwhile.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BrowserIncomingMessage } from "../types.js";
import { makeMessage, makeSectionedMessages } from "./MessageFeed.messagefeed-section-windowing.test-helpers.js";
import {
  installSectionWindowingTestHooks,
  mockStoreValues,
  mockClearScrollToMessage,
  mockClearPendingScrollToMessageId,
  mockSetFeedScrollPosition,
  mockSendToSession,
  setStoreMessages,
  setStoreHistoryLoading,
  setStoreConnectionStatus,
  setStoreHistoryWindow,
  setStoreThreadReadingPosition,
  setStoreSessionState,
  setStoreScrollToMessage,
  setStoreSelectedThreadWindow,
  setStoreThreadWindowRevisions,
  flushFeedObservers,
  setElementScrollMetrics,
  getScrollContainer,
} from "./MessageFeed.section-windowing.test-harness.js";

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));
vi.mock("../ws.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockWsModule());
vi.mock("../api.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockApiModule());
vi.mock("../store.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockStoreModule());

import { MessageFeed } from "./MessageFeed.js";
import {
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../../shared/history-window.js";
import { cacheHistoryWindow } from "../utils/history-window-cache.js";

installSectionWindowingTestHooks();

describe("MessageFeed server history and thread window requests", () => {
  it("requests an older history window from the server when the loaded feed is windowed", () => {
    const sid = "test-windowed-history-request";
    setStoreMessages(sid, makeSectionedMessages(3, 2));
    const windows = new Map();
    windows.set(sid, {
      from_turn: 2,
      turn_count: 6,
      total_turns: 10,
      has_older_items: true,
      has_newer_items: true,
      start_index: 2,
      section_turn_count: 2,
      visible_section_count: 3,
    });
    mockStoreValues.historyWindows = windows;

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    const scrollContainer = getScrollContainer(container);
    mockSendToSession.mockClear();

    setElementScrollMetrics(scrollContainer, 1000, 300, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(mockSendToSession).toHaveBeenCalledWith(sid, {
      type: "history_window_request",
      from_turn: 0,
      turn_count: 8,
      section_turn_count: 2,
      visible_section_count: 3,
      activate_view: true,
    });
    expect(screen.getByText("Loading older section...")).toBeTruthy();
  });

  it("announces a cached selected thread view so live server filtering follows warm tab switches", async () => {
    const sid = "test-cached-thread-view-update";
    const threadKey = "q-1831";
    // Cached bounds alone cannot own a restoration; model valid older reading.
    setStoreThreadReadingPosition(sid, threadKey, "selected");
    setStoreSessionState(sid, { isOrchestrator: true });
    mockStoreValues.connectionStatus = new Map([[sid, "connected"]]);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 4,
      itemCount: 6,
      totalItems: 12,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [makeMessage({ id: "selected", role: "assistant", content: "selected", timestamp: 1 })],
    });

    render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />);

    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith(sid, {
        type: "conversation_view_update",
        view: "thread",
        thread_key: threadKey,
        from: 4,
        count: 6,
        section_count: 2,
        visible_count: 3,
      }),
    );
  });

  it("sends a cached history window hash with scroll-triggered server window requests", () => {
    const sid = "test-windowed-history-cached-request";
    setStoreMessages(sid, makeSectionedMessages(3, 2));
    cacheHistoryWindow(
      sid,
      {
        from_turn: 0,
        turn_count: 8,
        total_turns: 10,
        has_older_items: false,
        has_newer_items: true,
        start_index: 0,
        section_turn_count: 2,
        visible_section_count: 3,
        window_hash: "cached-history-window",
      },
      [{ type: "user_message", id: "cached-u1", content: "cached", timestamp: 1 } as BrowserIncomingMessage],
    );
    const windows = new Map();
    windows.set(sid, {
      from_turn: 2,
      turn_count: 6,
      total_turns: 10,
      has_older_items: true,
      has_newer_items: true,
      start_index: 2,
      section_turn_count: 2,
      visible_section_count: 3,
    });
    mockStoreValues.historyWindows = windows;

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    const scrollContainer = getScrollContainer(container);
    mockSendToSession.mockClear();
    setElementScrollMetrics(scrollContainer, 1000, 300, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(mockSendToSession).toHaveBeenCalledWith(sid, {
      type: "history_window_request",
      from_turn: 0,
      turn_count: 8,
      section_turn_count: 2,
      visible_section_count: 3,
      activate_view: true,
      cached_window_hash: "cached-history-window",
    });
  });

  it("requests a newer history window with adjacent context for smooth reverse scrolling", () => {
    const sid = "test-windowed-history-newer-context-request";
    setStoreMessages(sid, makeSectionedMessages(3, 2));
    const windows = new Map();
    windows.set(sid, {
      from_turn: 0,
      turn_count: 6,
      total_turns: 12,
      has_older_items: false,
      has_newer_items: true,
      start_index: 0,
      section_turn_count: 2,
      visible_section_count: 3,
    });
    mockStoreValues.historyWindows = windows;

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    const scrollContainer = getScrollContainer(container);
    mockSendToSession.mockClear();

    setElementScrollMetrics(scrollContainer, 1000, 300, 700);
    fireEvent.wheel(scrollContainer, { deltaY: 80 });

    expect(mockSendToSession).toHaveBeenCalledWith(sid, {
      type: "history_window_request",
      from_turn: 0,
      turn_count: 12,
      section_turn_count: 2,
      visible_section_count: 3,
      activate_view: true,
    });
    expect(screen.getByText("Loading newer section...")).toBeTruthy();
  });

  it("renders a temporary five-section history window without showing an unavailable older boundary", () => {
    const sid = "test-windowed-history-expanded-context-render";
    setStoreMessages(sid, makeSectionedMessages(5, 2));
    const windows = new Map();
    windows.set(sid, {
      from_turn: 0,
      turn_count: 10,
      total_turns: 12,
      has_older_items: false,
      has_newer_items: true,
      start_index: 0,
      section_turn_count: 2,
      visible_section_count: 3,
    });
    mockStoreValues.historyWindows = windows;

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(5);
    expect(screen.queryByText("Load older section")).toBeNull();
    expect(screen.getByText("Load newer section")).toBeTruthy();
  });

  it("keeps leader Main loading while the selected thread window hydrates", async () => {
    const sid = "test-leader-main-selected-window-cold-start";
    const mainTail = makeMessage({
      id: "u-main-tail",
      role: "user",
      content: "Persisted Main history tail",
      timestamp: 100,
      historyIndex: 42,
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [mainTail]);
    setStoreHistoryWindow(sid);

    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Loading conversation...")).toBeTruthy();
    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        from_item: -1,
        item_count: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        section_item_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_item_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );

    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 7,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 37,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [mainTail],
    });
    rerender(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.getByText("Persisted Main history tail")).toBeTruthy();
    expect(screen.queryByText("Start a conversation")).toBeNull();
  });

  it("does not duplicate the thread request already carried by session_subscribe", async () => {
    const sid = "test-leader-subscribed-selected-window";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreHistoryLoading(sid, true);
    mockStoreValues.pendingThreadWindowRequests = new Map([[sid, "main"]]);

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.getByText("Loading conversation...")).toBeTruthy();
    await flushFeedObservers();
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: "main" }),
    );
  });

  // Returning to a leader: its cached window renders at once, and the session
  // subscribe already revalidates it, so the feed must not ask for the same
  // latest window a second time (on a slow link that doubled the bytes).
  it("shows a cached thread window without re-requesting what session_subscribe carries", async () => {
    const sid = "test-leader-cached-window-subscribed";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 0,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 1,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [
        makeMessage({ id: "u-cached", role: "user", content: "Cached Main thread", timestamp: 1, historyIndex: 0 }),
      ],
    });
    // The reconnect invalidated the cached copy, which on its own asks for a refresh.
    setStoreThreadWindowRevisions({ sessionId: sid, threadKey: "main", refreshRevision: 1, appliedRevision: 0 });
    mockStoreValues.pendingThreadWindowRequests = new Map([[sid, "main"]]);

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.getByText("Cached Main thread")).toBeTruthy();
    await flushFeedObservers();
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: "main" }),
    );
  });

  it("does not duplicate an in-flight initial thread window request after rerender", async () => {
    const sid = "test-leader-inflight-selected-window";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreHistoryLoading(sid, true);

    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="main" />);
    await flushFeedObservers();
    rerender(<MessageFeed sessionId={sid} threadKey="main" />);
    await flushFeedObservers();

    expect(mockSendToSession).toHaveBeenCalledTimes(1);
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: "main" }),
    );
  });

  // Authoritative session refreshes can invalidate selected leader windows, but
  // already-visible cached content should stay rendered while the fresh window is requested.
  it("keeps stale leader Main content visible while refreshing after history replacement", async () => {
    const sid = "test-leader-main-stale-window-visible-during-refresh";
    const refreshedHistoryTail = makeMessage({
      id: "u-main-authoritative-tail",
      role: "user",
      content: "Authoritative raw history after session switch",
      timestamp: 200,
      historyIndex: 42,
    });
    const visibleWindowMessage = makeMessage({
      id: "u-main-visible-window",
      role: "user",
      content: "Visible Main thread before refresh",
      timestamp: 100,
      historyIndex: 40,
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [refreshedHistoryTail]);
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 7,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 37,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [visibleWindowMessage],
    });
    setStoreThreadWindowRevisions({
      sessionId: sid,
      threadKey: "main",
      refreshRevision: 1,
      appliedRevision: 0,
    });

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.getByText("Visible Main thread before refresh")).toBeTruthy();
    expect(screen.queryByText("Loading conversation...")).toBeNull();
    expect(screen.queryByText("Start a conversation")).toBeNull();
    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        from_item: -1,
      }),
    );
  });

  it("requests a selected-thread window containing a missing message deep-link target", async () => {
    const sid = "test-leader-main-deep-link-target-window";
    const target = makeMessage({
      id: "u-starred-target",
      role: "user",
      content: "Starred target outside the current window",
      timestamp: 100,
      historyIndex: 1,
    });
    const recent = makeMessage({
      id: "u-recent-window",
      role: "user",
      content: "Recent selected window content",
      timestamp: 200,
      historyIndex: 42,
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [target, recent]);
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 7,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 37,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [recent],
    });
    setStoreScrollToMessage(sid, target.id);

    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(mockClearScrollToMessage).not.toHaveBeenCalledWith(sid);
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        target_message_id: target.id,
      }),
    );

    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 0,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 37,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [target, recent],
    });
    setStoreThreadWindowRevisions({ sessionId: sid, threadKey: "main", refreshRevision: 1, appliedRevision: 1 });
    rerender(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(screen.getByText("Starred target outside the current window")).toBeTruthy();
    expect(mockClearScrollToMessage).toHaveBeenCalledWith(sid);
    expect(mockClearPendingScrollToMessageId).toHaveBeenCalledWith(sid);
    expect(mockSetFeedScrollPosition).toHaveBeenCalledWith(
      `${sid}:thread:main`,
      expect.objectContaining({ anchorMessageId: target.id }),
    );
  });

  // Revalidating a held window around a saved anchor must still name the held
  // window's hash, so an unchanged window comes back as a small cache hit
  // instead of the whole window again.
  it("sends the held window hash with a target-centered revalidation", async () => {
    const sid = "test-leader-targeted-revalidation-hash";
    const target = makeMessage({ id: "u-anchor", role: "user", content: "Anchor", timestamp: 1, historyIndex: 0 });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "main",
      fromItem: 0,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 1,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [target],
    });
    const heldWindows = mockStoreValues.threadWindows as Map<string, Map<string, Record<string, unknown>>>;
    Object.assign(heldWindows.get(sid)!.get("main")!, { window_hash: "held-hash" });
    mockStoreValues.pendingScrollToMessageId = new Map([[sid, target.id]]);
    mockStoreValues.scrollToMessageId = new Map([[sid, target.id]]);

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        target_message_id: target.id,
        cached_window_hash: "held-hash",
      }),
    );
  });

  it("uses a pending route message id for the initial selected Main window request", async () => {
    // A stable /msg/<id>?thread=main route can arrive before the selected Main
    // window has hydrated. The first request must be target-centered so the
    // route target is not consumed by a default latest window.
    const sid = "test-initial-main-target-window";
    const target = makeMessage({ id: "u-old-target", role: "user", content: "Old target", timestamp: 10 });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [target]);
    mockStoreValues.pendingScrollToMessageId = new Map([[sid, target.id]]);
    mockStoreValues.scrollToMessageId = new Map([[sid, target.id]]);

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        target_message_id: target.id,
      }),
    );
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: "main", target_message_id: undefined }),
    );
  });

  // Non-Main selected leader threads follow the same stale-but-visible path; the
  // regression was a temporary loading/empty state before thread_window_sync arrived.
  it("keeps stale leader quest-thread content visible while refreshing after history replacement", async () => {
    const sid = "test-leader-quest-stale-window-visible-during-refresh";
    const visibleWindowMessage = makeMessage({
      id: "u-project-visible-window",
      role: "user",
      content: "Visible project thread before refresh",
      timestamp: 100,
      historyIndex: 40,
      metadata: { threadRefs: [{ threadKey: "project-alpha", questId: "project-alpha", source: "explicit" }] },
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [
      makeMessage({
        id: "u-main-authoritative-tail",
        role: "user",
        content: "Main raw history after session switch",
        timestamp: 200,
        historyIndex: 42,
      }),
    ]);
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "project-alpha",
      fromItem: 7,
      itemCount: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      totalItems: 37,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [visibleWindowMessage],
    });
    setStoreThreadWindowRevisions({
      sessionId: sid,
      threadKey: "project-alpha",
      refreshRevision: 1,
      appliedRevision: 0,
    });

    render(<MessageFeed sessionId={sid} threadKey="project-alpha" />);

    expect(screen.getByText("Visible project thread before refresh")).toBeTruthy();
    expect(screen.queryByText("Loading conversation...")).toBeNull();
    expect(screen.queryByText("Start a conversation")).toBeNull();
    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "project-alpha",
        from_item: -1,
      }),
    );
  });

  it("retries the selected Main window request after the browser socket connects", async () => {
    const sid = "test-leader-main-selected-window-connect-retry";
    const mainTail = makeMessage({
      id: "u-main-connect-retry",
      role: "user",
      content: "Persisted Main history waiting on socket",
      timestamp: 100,
      historyIndex: 42,
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [mainTail]);
    setStoreHistoryWindow(sid);
    setStoreConnectionStatus(sid, "connecting");
    mockSendToSession.mockReturnValueOnce(false).mockReturnValue(true);

    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Loading conversation...")).toBeTruthy();

    setStoreConnectionStatus(sid, "connected");
    rerender(<MessageFeed sessionId={sid} threadKey="main" />);

    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledTimes(2);
    expect(mockSendToSession).toHaveBeenLastCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        from_item: -1,
      }),
    );
  });

  it("requests the Main selected window when returning from a quest tab", async () => {
    const sid = "test-leader-main-request-after-quest-tab";
    const mainTail = makeMessage({
      id: "u-main-tail-after-quest",
      role: "user",
      content: "Main content after quest return",
      timestamp: 100,
      historyIndex: 42,
    });
    const questTail = makeMessage({
      id: "u-quest-tail",
      role: "user",
      content: "Quest thread content",
      timestamp: 200,
      historyIndex: 43,
    });
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreMessages(sid, [mainTail]);
    setStoreHistoryWindow(sid);
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey: "q-1162",
      fromItem: 0,
      itemCount: 1,
      totalItems: 1,
      sectionItemCount: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visibleItemCount: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      messages: [questTail],
    });
    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="q-1162" />);
    await flushFeedObservers();
    mockSendToSession.mockClear();

    rerender(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Loading conversation...")).toBeTruthy();
    await flushFeedObservers();
    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "main",
        from_item: -1,
      }),
    );
  });
});
