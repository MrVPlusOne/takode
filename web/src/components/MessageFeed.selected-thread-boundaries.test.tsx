// @vitest-environment jsdom
// Loading older and newer selected-thread content at the window boundaries, and navigator jumps.
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BrowserIncomingMessage, ThreadWindowEntry } from "../types.js";
import { makeMessage } from "./MessageFeed.messagefeed-section-windowing.test-helpers.js";
import {
  installSectionWindowingTestHooks,
  mockSendToSession,
  mockSearchSessionMessages,
  mockScrollIntoView,
  mediaState,
  setStoreThreadReadingPosition,
  setStoreSessionState,
  buildMessageSearchResponse,
  setStoreSelectedThreadWindow,
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
import { cacheThreadWindow } from "../utils/history-window-cache.js";

installSectionWindowingTestHooks();

describe("MessageFeed selected-thread boundaries", () => {
  it("does not auto-load newer selected-thread content on stationary mobile top overscroll", () => {
    // q-1050 follow-up: on mobile, pulling upward at the top of a short completed
    // selected-thread window can produce scroll events without changing scrollTop.
    // That must not be treated as a downward/newer boundary scroll, or the feed
    // snaps back toward latest while showing "Loading older section...".
    mediaState.touchDevice = true;
    const sid = "test-selected-thread-mobile-top-overscroll";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    const selectedThreadMessages = [
      makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 3 }),
      makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 4 }),
      makeMessage({ id: "u4", role: "user", content: "Completed q-1027 turn 4", timestamp: 5 }),
      makeMessage({ id: "a4", role: "assistant", content: "Completed q-1027 reply 4", timestamp: 6 }),
    ];
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 6,
      totalItems: 10,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: selectedThreadMessages,
    });

    const { container } = render(
      <MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />,
    );
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 380, 340, 0);

    fireEvent.scroll(scrollContainer);

    expect(mockSendToSession).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: 4,
      }),
    );
    expect(screen.getByText("Load older section")).toBeTruthy();
    expect(screen.getByText("Load newer section")).toBeTruthy();
  });

  it("auto-loads older selected-thread content on an upward boundary scroll", () => {
    const sid = "test-selected-thread-upward-boundary-scroll";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 6,
      totalItems: 10,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 3 }),
        makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 4 }),
        makeMessage({ id: "u4", role: "user", content: "Completed q-1027 turn 4", timestamp: 5 }),
        makeMessage({ id: "a4", role: "assistant", content: "Completed q-1027 reply 4", timestamp: 6 }),
      ],
    });

    const { container } = render(
      <MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />,
    );
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 1000, 340, 120);
    fireEvent.scroll(scrollContainer);
    mockSendToSession.mockClear();

    setElementScrollMetrics(scrollContainer, 1000, 340, 0);
    fireEvent.scroll(scrollContainer);

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: 0,
        item_count: 8,
      }),
    );
    expect(screen.getByText("Loading older section...")).toBeTruthy();
  });

  it("requests an older selected-thread window and scrolls to the previous user-message target after sync", () => {
    const sid = "test-selected-thread-user-navigation-window";
    const threadKey = "q-1027";
    setStoreThreadReadingPosition(sid, threadKey, "u3");
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 4,
      totalItems: 8,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 5 }),
        makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 6 }),
        makeMessage({ id: "u4", role: "user", content: "Completed q-1027 turn 4", timestamp: 5 }),
        makeMessage({ id: "a4", role: "assistant", content: "Completed q-1027 reply 4", timestamp: 6 }),
      ],
    });

    const { rerender } = render(
      <MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />,
    );
    mockSendToSession.mockClear();
    fireEvent.click(screen.getByLabelText("Previous user message"));

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: threadKey,
        from_item: 0,
        item_count: 6,
      }),
    );

    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 0,
      itemCount: 6,
      totalItems: 8,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u1", role: "user", content: "Completed q-1027 turn 1", timestamp: 1 }),
        makeMessage({ id: "a1", role: "assistant", content: "Completed q-1027 reply 1", timestamp: 2 }),
        makeMessage({ id: "u2", role: "user", content: "Completed q-1027 turn 2", timestamp: 3 }),
        makeMessage({ id: "a2", role: "assistant", content: "Completed q-1027 reply 2", timestamp: 4 }),
        makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 3 }),
        makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 4 }),
      ],
    });
    rerender(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />);

    const scrollContext = mockScrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;
    expect(scrollContext?.getAttribute("data-turn-id")).toBe("u2");
  });

  it("uses global selected-thread user-message targets for the expanded navigator", async () => {
    const sid = "test-selected-thread-global-user-navigation";
    const threadKey = "q-1027";
    setStoreThreadReadingPosition(sid, threadKey, "u3");
    const globalMessages = [
      makeMessage({
        id: "u1",
        role: "user",
        content: "Global oldest prompt",
        timestamp: 1,
        historyIndex: 0,
      }),
      makeMessage({
        id: "u2",
        role: "user",
        content: "Global middle prompt",
        timestamp: 3,
        historyIndex: 2,
      }),
      makeMessage({
        id: "u3",
        role: "user",
        content: "Loaded prompt three",
        timestamp: 5,
        historyIndex: 4,
      }),
      makeMessage({
        id: "u4",
        role: "user",
        content: "Loaded newest prompt",
        timestamp: 7,
        historyIndex: 6,
      }),
    ];
    mockSearchSessionMessages.mockImplementation((calledSessionId: string, options = {}) =>
      Promise.resolve(
        buildMessageSearchResponse(
          calledSessionId,
          options as { scope?: string; threadKey?: string | null },
          globalMessages,
        ),
      ),
    );
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 4,
      totalItems: 8,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u3", role: "user", content: "Loaded prompt three", timestamp: 5, historyIndex: 4 }),
        makeMessage({ id: "a3", role: "assistant", content: "Reply three", timestamp: 6, historyIndex: 5 }),
        makeMessage({ id: "u4", role: "user", content: "Loaded newest prompt", timestamp: 7, historyIndex: 6 }),
        makeMessage({ id: "a4", role: "assistant", content: "Reply four", timestamp: 8, historyIndex: 7 }),
      ],
    });

    render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />);

    await waitFor(() =>
      expect(mockSearchSessionMessages).toHaveBeenCalledWith(
        sid,
        expect.objectContaining({
          query: "",
          scope: "current_thread",
          threadKey,
          filters: { user: true, assistant: true, event: false },
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const trigger = await screen.findByRole("button", { name: /Message navigator, \d+ of 4/ });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "User message selector" });
    expect(within(dialog).getByText("Global oldest prompt")).toBeTruthy();
    expect(within(dialog).getByText("Global middle prompt")).toBeTruthy();
    expect(within(dialog).getByText("Loaded prompt three")).toBeTruthy();
    expect(within(dialog).getByText("Loaded newest prompt")).toBeTruthy();

    mockSendToSession.mockClear();
    fireEvent.click(within(dialog).getByText("Global oldest prompt"));

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: threadKey,
        from_item: 0,
        item_count: 6,
      }),
    );
  });

  it("requests selected-thread navigator jumps by stable message id, not display position", async () => {
    const sid = "test-selected-thread-global-user-navigation-target-id";
    const threadKey = "main";
    setStoreThreadReadingPosition(sid, threadKey, "u15");
    const globalMessages = Array.from({ length: 163 }, (_, index) => {
      const messageNumber = index + 1;
      return makeMessage({
        id: "u" + messageNumber,
        role: "user",
        content: "Long prompt " + messageNumber,
        timestamp: messageNumber,
        historyIndex: index * 2,
      });
    });
    mockSearchSessionMessages.mockImplementation((calledSessionId: string, options = {}) =>
      Promise.resolve(
        buildMessageSearchResponse(
          calledSessionId,
          options as { scope?: string; threadKey?: string | null },
          globalMessages,
        ),
      ),
    );
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 14,
      itemCount: 12,
      totalItems: 163,
      sectionItemCount: 4,
      visibleItemCount: 3,
      messages: [globalMessages[14]!],
    });

    render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={4} />);

    const trigger = await screen.findByRole("button", { name: "Message navigator, 15 of 163" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "User message selector" });

    mockSendToSession.mockClear();
    fireEvent.click(within(dialog).getByText("Long prompt 160"));

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: threadKey,
        target_message_id: "u160",
      }),
    );
  });

  it("loads older selected-thread content from the boundary button when the viewport cannot scroll upward", () => {
    const sid = "test-selected-thread-short-viewport-button-load";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 6,
      totalItems: 10,
      sectionItemCount: 2,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u3", role: "user", content: "Sparse selected-thread tail", timestamp: 3 }),
        makeMessage({ id: "a3", role: "assistant", content: "Only one short turn is visible", timestamp: 4 }),
      ],
    });

    render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Load older section" }));

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: 0,
        item_count: 8,
      }),
    );
    expect(screen.getByText("Loading older section...")).toBeTruthy();
  });

  it("waits for a jump's full window instead of paging from its partial first window", () => {
    // The server answers a jump with the conversations around the target, then the full
    // window. Paging from the small window would send a request whose answer replaces the
    // full window that is already on its way.
    const sid = "test-selected-thread-partial-window";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 40,
      itemCount: 3,
      totalItems: 100,
      sectionItemCount: 10,
      visibleItemCount: 3,
      partial: true,
      messages: [makeMessage({ id: "u-target", role: "user", content: "Jump target", timestamp: 3 })],
    });

    const { container } = render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} />);
    const scrollContainer = getScrollContainer(container);
    mockSendToSession.mockClear();
    setElementScrollMetrics(scrollContainer, 1000, 340, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(mockSendToSession).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: threadKey }),
    );
  });

  it("sends a cached selected-thread window hash for nearby boundary reuse", () => {
    // The first older load adds 60 ranges to the initial 30; cache identity must include that expanded budget.
    const sid = "test-selected-thread-cached-boundary-window";
    const threadKey = "q-1027";
    const cachedMessage = {
      type: "user_message",
      id: "cached-thread-user",
      content: "cached thread range",
      timestamp: 1,
    } as BrowserIncomingMessage;
    cacheThreadWindow(
      sid,
      {
        thread_key: threadKey,
        from_item: 10,
        item_count: 90,
        total_items: 100,
        has_older_items: true,
        has_newer_items: false,
        source_history_length: 200,
        section_item_count: 10,
        visible_item_count: 3,
        window_hash: "cached-thread-window",
      },
      [{ message: cachedMessage, history_index: 1 } as ThreadWindowEntry],
    );
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 70,
      itemCount: 30,
      totalItems: 100,
      sectionItemCount: 10,
      visibleItemCount: 3,
      messages: [
        makeMessage({ id: "u-tail", role: "user", content: "Completed q-1027 tail", timestamp: 3 }),
        makeMessage({ id: "a-tail", role: "assistant", content: "Completed q-1027 reply tail", timestamp: 4 }),
      ],
    });

    const { container } = render(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} />);
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 1000, 340, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: 10,
        item_count: 90,
        cached_window_hash: "cached-thread-window",
      }),
    );
  });

  it("hides selected-thread boundary affordances when explicit server availability is false", () => {
    const sid = "test-selected-thread-explicit-unavailable";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 2,
      itemCount: 6,
      totalItems: 10,
      sectionItemCount: 2,
      visibleItemCount: 3,
      hasOlderItems: false,
      hasNewerItems: false,
      messages: [
        makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 3 }),
        makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 4 }),
      ],
    });

    const { container } = render(
      <MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />,
    );
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 1000, 340, 660);
    fireEvent.wheel(scrollContainer, { deltaY: 80 });

    expect(screen.queryByText("Load older section")).toBeNull();
    expect(screen.queryByText("Load newer section")).toBeNull();
    expect(screen.queryByText("Latest section below")).toBeNull();
    expect(mockSendToSession).not.toHaveBeenCalledWith(sid, expect.objectContaining({ type: "thread_window_request" }));
  });

  it("clears pending selected-thread loading after an authoritative no-op sync rerender", () => {
    const sid = "test-selected-thread-noop-sync-clears-pending";
    const threadKey = "q-1027";
    setStoreSessionState(sid, { isOrchestrator: true });
    const messages = [
      makeMessage({ id: "u3", role: "user", content: "Completed q-1027 turn 3", timestamp: 3 }),
      makeMessage({ id: "a3", role: "assistant", content: "Completed q-1027 reply 3", timestamp: 4 }),
    ];
    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 0,
      itemCount: 6,
      totalItems: 12,
      sectionItemCount: 2,
      visibleItemCount: 3,
      hasOlderItems: false,
      hasNewerItems: true,
      messages,
    });

    const { container, rerender } = render(
      <MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />,
    );
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 1000, 340, 660);
    fireEvent.wheel(scrollContainer, { deltaY: 80 });

    expect(screen.getByText("Loading newer section...")).toBeTruthy();

    setStoreSelectedThreadWindow({
      sessionId: sid,
      threadKey,
      fromItem: 0,
      itemCount: 6,
      totalItems: 12,
      sectionItemCount: 2,
      visibleItemCount: 3,
      hasOlderItems: false,
      hasNewerItems: true,
      messages,
    });
    rerender(<MessageFeed sessionId={sid} threadKey={threadKey} projectThreadRoutes={false} sectionTurnCount={2} />);

    expect(screen.queryByText("Loading newer section...")).toBeNull();
    expect(screen.getByText("Load newer section")).toBeTruthy();
  });
});
