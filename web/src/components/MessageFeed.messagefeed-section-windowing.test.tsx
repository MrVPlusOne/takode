// @vitest-environment jsdom
// Local section windows, section-aware navigation and restoring scroll targets.
import { render, screen, fireEvent } from "@testing-library/react";
import {
  makeLeaderSectionedMessages,
  makeMessage,
  makeSectionedMessages,
  makeSectionTurns,
} from "./MessageFeed.messagefeed-section-windowing.test-helpers.js";
import {
  installSectionWindowingTestHooks,
  mockFocusTurn,
  mockClearScrollToTurn,
  mockClearScrollToMessage,
  mockKeepTurnExpanded,
  mockScrollIntoView,
  setStoreMessages,
  setStoreFeedScrollPosition,
  setStoreSdkSessionRole,
  setStoreScrollToTurn,
  setStoreScrollToMessage,
  setElementScrollMetrics,
  getScrollContainer,
  makeDomRect,
  makePositionedDomRect,
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

import {
  MessageFeed,
  buildFeedSections,
  findSectionWindowStartIndexForTarget,
  findVisibleSectionEndIndex,
  findVisibleSectionStartIndex,
} from "./MessageFeed.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT } from "../../shared/history-window.js";

installSectionWindowingTestHooks();

describe("MessageFeed section windowing", () => {
  it("chunks turns into fixed-size default sections", () => {
    const turns = makeSectionTurns(120);
    const sections = buildFeedSections(turns);
    const expectedSectionCount = Math.ceil(turns.length / HISTORY_WINDOW_SECTION_TURN_COUNT);

    expect(sections).toHaveLength(expectedSectionCount);
    expect(sections.map((section) => section.turns.length)).toEqual(
      Array.from({ length: expectedSectionCount }, (_, index) =>
        index === expectedSectionCount - 1
          ? turns.length - HISTORY_WINDOW_SECTION_TURN_COUNT * index
          : HISTORY_WINDOW_SECTION_TURN_COUNT,
      ),
    );
    expect(findVisibleSectionStartIndex(sections, 3)).toBe(Math.max(0, expectedSectionCount - 3));
    expect(findVisibleSectionEndIndex(sections, 0, 3)).toBe(Math.min(expectedSectionCount, 3));
    expect(findVisibleSectionStartIndex(sections, 2)).toBe(Math.max(0, expectedSectionCount - 2));
    expect(findVisibleSectionEndIndex(sections, 1, 2)).toBe(Math.min(expectedSectionCount, 3));
  });

  it("marks the feed scroll surface for animation-stability overrides", () => {
    const sid = "test-feed-mobile-animation-stability";
    setStoreMessages(sid, makeSectionedMessages(1, 2));

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    const scrollContainer = getScrollContainer(container);
    expect(scrollContainer.classList.contains("message-feed-scroll-surface")).toBe(true);
    expect(scrollContainer.classList.contains("mobile-scroll-stable-surface")).toBe(true);
  });

  it("clamps target window selection for section-aware jumps", () => {
    const sections = buildFeedSections(makeSectionTurns(200), 50);

    expect(findSectionWindowStartIndexForTarget(sections, 0, 3)).toBe(0);
    expect(findSectionWindowStartIndexForTarget(sections, 1, 3)).toBe(0);
    expect(findSectionWindowStartIndexForTarget(sections, 2, 3)).toBe(1);
    expect(findSectionWindowStartIndexForTarget(sections, 3, 3)).toBe(1);
  });

  it("slides a bounded three-section window when the user scrolls older and then newer", () => {
    const sid = "test-section-window";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    const scrollContainer = getScrollContainer(container);

    expect(screen.queryByText("Section 1 marker")).toBeNull();
    expect(screen.getByText("Section 2 marker")).toBeTruthy();
    expect(screen.getByText("Section 4 marker")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load older section" })).toBeTruthy();
    expect(screen.queryByText("Loading older section...")).toBeNull();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);

    setElementScrollMetrics(scrollContainer, 1000, 300, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(screen.getByText("Section 1 marker")).toBeTruthy();
    expect(screen.queryByText("Section 4 marker")).toBeNull();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);

    setElementScrollMetrics(scrollContainer, 1000, 300, 700);
    fireEvent.wheel(scrollContainer, { deltaY: 80 });

    expect(screen.queryByText("Section 1 marker")).toBeNull();
    expect(screen.getByText("Section 2 marker")).toBeTruthy();
    expect(screen.getByText("Section 4 marker")).toBeTruthy();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
  });

  it("sections leader-driven worker feeds by herding leader user messages", () => {
    const sid = "test-leader-worker-section-boundaries";
    setStoreSdkSessionRole(sid, { herdedBy: "leader-session" });
    setStoreMessages(sid, makeLeaderSectionedMessages(4, 2));

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(screen.queryByText("Leader section 1 marker")).toBeNull();
    expect(screen.getByText("Leader section 2 marker")).toBeTruthy();
    expect(screen.getByText("Leader section 4 marker")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load older section" })).toBeTruthy();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-user-turn]")).toHaveLength(6);
  });

  it("shows newer-section boundary text after loading older history", () => {
    const sid = "test-section-newer-control";
    setStoreMessages(sid, makeSectionedMessages(4, 2));

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    const scrollContainer = getScrollContainer(container);
    setElementScrollMetrics(scrollContainer, 1000, 300, 0);
    fireEvent.wheel(scrollContainer, { deltaY: -80 });

    expect(screen.getByRole("button", { name: "Load newer section" })).toBeTruthy();
    expect(screen.queryByText("Loading newer section...")).toBeNull();
    setElementScrollMetrics(scrollContainer, 1000, 300, 700);
    fireEvent.wheel(scrollContainer, { deltaY: 80 });
    expect(screen.queryByText("Section 1 marker")).toBeNull();
    expect(screen.getByText("Section 2 marker")).toBeTruthy();
    expect(screen.getByText("Section 4 marker")).toBeTruthy();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
  });

  it("navigates to leader-authored user text without treating injected event messages as user targets", () => {
    const sid = "test-leader-user-navigation-target";
    setStoreMessages(sid, [
      makeMessage({ id: "u-real", role: "user", content: "Human prompt", timestamp: 1 }),
      makeMessage({
        id: "timer-event",
        role: "user",
        content: "Timer fired",
        timestamp: 2,
        agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" },
      }),
      makeMessage({
        id: "leader-visible",
        role: "assistant",
        content: "Leader-origin visible user text",
        timestamp: 3,
        metadata: { leaderUserMessage: true },
      }),
      makeMessage({ id: "assistant-tail", role: "assistant", content: "Worker response", timestamp: 4 }),
    ]);
    setStoreFeedScrollPosition(sid, { scrollTop: 240, scrollHeight: 900, isAtBottom: false });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("data-message-id") === "leader-visible") return makePositionedDomRect(-80, -40);
      if (this.getAttribute("data-message-id") === "timer-event") return makePositionedDomRect(-20, 20);
      if (this.getAttribute("data-testid") === "message-feed-scroll-container") return makePositionedDomRect(0, 400);
      return makeDomRect(40);
    });

    render(<MessageFeed sessionId={sid} />);
    fireEvent.click(screen.getByLabelText("Previous user message"));

    const scrollContext = mockScrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;
    expect(scrollContext?.getAttribute("data-message-id")).toBe("leader-visible");
    rectSpy.mockRestore();
  });

  it("treats herding leader user-source messages as user navigation targets", () => {
    const sid = "test-herding-leader-user-navigation-target";
    setStoreSdkSessionRole(sid, { herdedBy: "leader-session" });
    setStoreMessages(sid, [
      makeMessage({ id: "u-real", role: "user", content: "Human prompt", timestamp: 1 }),
      makeMessage({
        id: "timer-event",
        role: "user",
        content: "Timer fired",
        timestamp: 2,
        agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" },
      }),
      makeMessage({
        id: "leader-routed",
        role: "user",
        content: "Leader routed prompt",
        timestamp: 3,
        agentSource: { sessionId: "leader-session", sessionLabel: "Leader" },
      }),
      makeMessage({ id: "assistant-tail", role: "assistant", content: "Worker response", timestamp: 4 }),
    ]);
    setStoreFeedScrollPosition(sid, { scrollTop: 240, scrollHeight: 900, isAtBottom: false });
    let leaderTurnElement: HTMLElement | null = null;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === leaderTurnElement) return makePositionedDomRect(-80, -40);
      if (this.getAttribute("data-message-id") === "leader-routed") return makePositionedDomRect(-80, -40);
      if (this.getAttribute("data-message-id") === "timer-event") return makePositionedDomRect(-20, 20);
      if (this.getAttribute("data-testid") === "message-feed-scroll-container") return makePositionedDomRect(0, 400);
      return makeDomRect(40);
    });

    render(<MessageFeed sessionId={sid} />);
    leaderTurnElement = screen.getByText("Leader routed prompt").closest("[data-turn-id]");
    try {
      fireEvent.click(screen.getByLabelText("Previous user message"));

      const scrollContext = mockScrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;
      expect(scrollContext).toBe(leaderTurnElement);
      expect(scrollContext?.getAttribute("data-user-turn")).toBe("true");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("loads hidden local sections before scrolling to previous and next user-message targets", () => {
    const sid = "test-local-section-user-navigation";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    setStoreFeedScrollPosition(sid, { scrollTop: 240, scrollHeight: 900, isAtBottom: false });

    render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);
    fireEvent.click(screen.getByLabelText("Previous user message"));

    expect(screen.getByText("Section 1 turn 2")).toBeTruthy();
    let scrollContext = mockScrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;
    expect(scrollContext?.getAttribute("data-turn-id")).toBe("u2");
    expect(scrollContext?.classList.contains("message-scroll-highlight")).toBe(true);

    mockScrollIntoView.mockClear();
    fireEvent.click(screen.getByLabelText("Next user message"));

    expect(screen.getByText("Section 4 marker")).toBeTruthy();
    scrollContext = mockScrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;
    expect(scrollContext?.getAttribute("data-turn-id")).toBe("u7");
    expect(scrollContext?.classList.contains("message-scroll-highlight")).toBe(true);
  });

  it("remounts the correct section window before scrolling to an older turn", async () => {
    const sid = "test-section-scroll-to-turn";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    setStoreScrollToTurn(sid, "u1");

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(await screen.findByText("Section 1 marker")).toBeTruthy();
    expect(screen.queryByText("Section 4 marker")).toBeNull();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
    expect(mockKeepTurnExpanded).toHaveBeenCalledWith(sid, "u1");
    expect(mockClearScrollToTurn).toHaveBeenCalledWith(sid);
  });

  it("remounts the correct section window before scrolling to an older message", async () => {
    const sid = "test-section-scroll-to-message";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    setStoreScrollToMessage(sid, "u1");

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(await screen.findByText("Section 1 marker")).toBeTruthy();
    expect(screen.queryByText("Section 4 marker")).toBeNull();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
    expect(mockFocusTurn).toHaveBeenCalledWith(sid, "u1");
    expect(mockClearScrollToMessage).toHaveBeenCalledWith(sid);
  });

  // q-274: notifications anchored to tool-use-only assistant messages (like
  // codex-tool_use-call_NTK7...) get grouped into tool_msg_group entries by
  // the feed model, so the scroll search must also check tool_msg_group.firstId.
  // The DOM scroll step must also find the element via data-feed-block-id
  // (tool groups don't have data-message-id).
  it("scrolls to the correct turn when notification targets a tool-use-only assistant message", async () => {
    const sid = "test-scroll-tool-use-only";
    const toolUseMessageId = "codex-tool_use-call_NTK7xAS0zqfp1eNdSC9vV7yL";
    // Build a realistic turn: user message, then a tool-use-only assistant
    // message (no text, only tool_use content blocks). The feed model groups
    // this into a tool_msg_group entry with firstId = the assistant message id.
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Run the quest transition", timestamp: 1000 }),
      makeMessage({
        id: toolUseMessageId,
        role: "assistant",
        content: "", // no text -- tool-use only
        contentBlocks: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "quest done q-261" } }],
        timestamp: 1001,
      }),
    ]);
    // Target the tool-use-only assistant message (simulates a notification
    // created by `takode notify review` when the last assistant message was
    // a tool invocation with no text content)
    setStoreScrollToMessage(sid, toolUseMessageId);

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={50} />);

    // The turn lookup should resolve the tool_msg_group entry and focus the turn
    expect(mockClearScrollToMessage).toHaveBeenCalledWith(sid);
    expect(mockFocusTurn).toHaveBeenCalledWith(sid, "u1");

    // The DOM should contain the tool group element with data-feed-block-id
    // (tool_msg_group entries render with data-feed-block-id, not data-message-id).
    // This is what the scroll step querySelector falls back to.
    const toolGroupElement = container.querySelector(`[data-feed-block-id="tool-group:${toolUseMessageId}"]`);
    expect(toolGroupElement).not.toBeNull();
    // And confirm there's no data-message-id for this ID (would indicate it
    // wasn't actually grouped into tool_msg_group)
    const messageElement = container.querySelector(`[data-message-id="${toolUseMessageId}"]`);
    expect(messageElement).toBeNull();
  });

  // Generic fallback: when messageId genuinely doesn't exist in any turn entry
  // (e.g. compacted away), fall back to the last turn rather than doing nothing.
  it("falls back to last turn when scroll-to-message target is completely absent", async () => {
    const sid = "test-scroll-to-message-fallback";
    setStoreMessages(sid, makeSectionedMessages(2, 2));
    setStoreScrollToMessage(sid, "completely-nonexistent-id");

    render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(mockClearScrollToMessage).toHaveBeenCalledWith(sid);
    // Falls back to the last turn (u4 in a 2-section × 2-turn grid)
    expect(mockFocusTurn).toHaveBeenCalledWith(sid, "u4");
  });

  it("restores a saved older-section anchor instead of falling back to latest", async () => {
    const sid = "test-section-anchor-restore";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    setStoreFeedScrollPosition(sid, {
      scrollTop: 240,
      scrollHeight: 1600,
      isAtBottom: false,
      anchorTurnId: "u1",
      anchorOffsetTop: 0,
    });

    const { container } = render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(await screen.findByText("Section 1 marker")).toBeTruthy();
    expect(screen.queryByText("Section 4 marker")).toBeNull();
    expect(container.querySelectorAll("[data-feed-section-id]")).toHaveLength(3);
  });

  it("shows the latest pill when restore lands on an older section with newer sections below", async () => {
    const sid = "test-section-latest-pill-on-restore";
    setStoreMessages(sid, makeSectionedMessages(4, 2));
    setStoreFeedScrollPosition(sid, {
      scrollTop: 240,
      scrollHeight: 1600,
      isAtBottom: false,
      anchorTurnId: "u1",
      anchorOffsetTop: 0,
      lastSeenContentBottom: 1180,
    });

    render(<MessageFeed sessionId={sid} sectionTurnCount={2} />);

    expect(await screen.findByText("Section 1 marker")).toBeTruthy();
    expect(screen.getByLabelText("Jump to latest")).toBeTruthy();
    expect(screen.getByText("Latest section below")).toBeTruthy();
  });
});
