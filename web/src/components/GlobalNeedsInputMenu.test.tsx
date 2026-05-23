// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetSessionNotifications = vi.fn(async (_sessionId: string): Promise<any[]> => []);
const mockFetchNotificationContext = vi.fn(
  async (_sessionId: string, _notifId: string): Promise<string | null> => null,
);
const mockSendNeedsInputResponse = vi.fn(async (_sessionId: string, _notifId: string, _response: any) => ({
  ok: true,
  sessionId: _sessionId,
  notificationId: _notifId,
  delivery: "accepted",
}));
const mockSetSessionNotifications = vi.fn((sessionId: string, notifications: any[]) => {
  mockStoreState.sessionNotifications.set(sessionId, notifications);
});
const mockRequestScrollToMessage = vi.fn();
const mockSetExpandAllInTurn = vi.fn();
const mockRequestBottomAlignOnNextUserMessage = vi.fn();

const mockStoreState: Record<string, any> = {
  sessionNotifications: new Map(),
  sessionNames: new Map(),
  sdkSessions: [],
  messages: new Map(),
  setSessionNotifications: mockSetSessionNotifications,
  requestScrollToMessage: mockRequestScrollToMessage,
  setExpandAllInTurn: mockSetExpandAllInTurn,
  requestBottomAlignOnNextUserMessage: mockRequestBottomAlignOnNextUserMessage,
};

vi.mock("../store.js", () => {
  const useStore: any = (selector: (state: any) => unknown) => selector(mockStoreState);
  useStore.getState = () => mockStoreState;
  useStore.setState = (update: any) => {
    const next = typeof update === "function" ? update(mockStoreState) : update;
    if (next && next !== mockStoreState) Object.assign(mockStoreState, next);
  };
  return { useStore };
});

vi.mock("../api.js", () => ({
  api: {
    getSessionNotifications: (sessionId: string) => mockGetSessionNotifications(sessionId),
    fetchNotificationContext: (sessionId: string, notifId: string) => mockFetchNotificationContext(sessionId, notifId),
    sendNeedsInputResponse: (sessionId: string, notifId: string, response: any) =>
      mockSendNeedsInputResponse(sessionId, notifId, response),
  },
}));

import { GlobalNeedsInputMenu } from "./GlobalNeedsInputMenu.js";

function installChatFeedWidth(width: number): () => void {
  const feed = document.createElement("div");
  feed.setAttribute("data-chat-feed-width-source", "true");
  Object.defineProperty(feed, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: 800,
      left: 0,
      width,
      height: 800,
      toJSON: () => ({}),
    }),
  });
  document.body.append(feed);
  return () => feed.remove();
}

function setElementWidth(element: Element, width: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 44,
      right: width,
      bottom: 600,
      left: 0,
      width,
      height: 556,
      toJSON: () => ({}),
    }),
  });
}

function resetStore(overrides: Partial<typeof mockStoreState> = {}) {
  mockStoreState.sessionNotifications = new Map();
  mockStoreState.sessionNames = new Map();
  mockStoreState.sdkSessions = [];
  Object.assign(mockStoreState, overrides);
}

describe("GlobalNeedsInputMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
    resetStore();
    mockSendNeedsInputResponse.mockResolvedValue({
      ok: true,
      sessionId: "s1",
      notificationId: "n-1",
      delivery: "accepted",
    });
    mockFetchNotificationContext.mockResolvedValue(null);
  });

  it("renders nothing when there are no unresolved needs-input notifications", () => {
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "review",
              category: "review",
              summary: "Review",
              timestamp: Date.now(),
              messageId: "m1",
              done: false,
            },
            {
              id: "done",
              category: "needs-input",
              summary: "Done",
              timestamp: Date.now(),
              messageId: "m2",
              done: true,
            },
          ],
        ],
      ]),
    });

    const { container } = render(<GlobalNeedsInputMenu />);

    expect(container).toBeEmptyDOMElement();
  });

  it("opens a needs-input-only menu across multiple sessions", () => {
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            { id: "n-1", category: "needs-input", summary: "Pick model", timestamp: 10, messageId: "m1", done: false },
            { id: "review", category: "review", summary: "Review", timestamp: 20, messageId: "m2", done: false },
          ],
        ],
        [
          "s2",
          [
            {
              id: "n-2",
              category: "needs-input",
              summary: "Choose rollout",
              timestamp: 30,
              messageId: "m3",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [
        { sessionId: "s1", sessionNum: 21, name: "Leader", createdAt: 1 },
        { sessionId: "s2", sessionNum: 22, name: "Worker", createdAt: 2 },
      ],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "2 unresolved needs-input notifications across sessions" }));

    const dialog = screen.getByRole("dialog", { name: "Global needs-input notifications" });
    expect(dialog.className).toContain("w-[min(42rem,calc(100vw-1.5rem))]");
    expect(dialog.className).toContain("max-h-[min(78vh,38rem)]");
    expect(within(dialog).getByText("#22 Worker")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Go to source for Choose rollout" })).toBeInTheDocument();
    expect(within(dialog).getByText("#21 Leader")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Go to source for Pick model" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Review")).not.toBeInTheDocument();
  });

  it("shows expandable source context from the target session without repeating the prompt as body copy", async () => {
    window.location.hash = "#/session/current";
    mockFetchNotificationContext.mockResolvedValueOnce(
      "The SVG candidates are ready for approval.\n\nCodex reads well at 18px, but compresses at 14px.",
    );
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-context",
              category: "needs-input",
              summary: "approve backend SVG logo candidates",
              suggestedAnswers: ["approve", "revise"],
              timestamp: Date.now(),
              messageId: "msg-context",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Leader", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));

    const context = await screen.findByTestId("global-needs-input-source-context");
    expect(context).toHaveTextContent("Codex reads well at 18px");
    expect(context.className).toContain("line-clamp-3");
    expect(screen.getAllByText("approve backend SVG logo candidates")).toHaveLength(1);
    expect(screen.queryByText("Jump")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Answer for approve backend SVG logo candidates")).toBeInTheDocument();

    const expandButton = screen.getByRole("button", { name: "Show more" });
    expect(context.nextElementSibling).toBe(expandButton);
    fireEvent.click(expandButton);
    expect(window.location.hash).toBe("#/session/current");
    expect(screen.getByTestId("global-needs-input-source-context").className).not.toContain("line-clamp-3");

    fireEvent.click(screen.getByRole("button", { name: "Go to source for approve backend SVG logo candidates" }));

    expect(window.location.hash).toContain("#/session/31/msg/msg-context");
    expect(mockRequestScrollToMessage).toHaveBeenCalledWith("s1", "msg-context");
    expect(mockSetExpandAllInTurn).toHaveBeenCalledWith("s1", "msg-context");
  });

  it("keeps global notification titles as content while Go to owns navigation", () => {
    window.location.hash = "#/session/current";
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-go-to",
              category: "needs-input",
              summary: "choose validation path",
              timestamp: Date.now(),
              messageId: "msg-go-to",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Leader", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));

    const title = screen.getByTestId("global-needs-input-source-target");
    expect(title).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("button", { name: "Open source message for choose validation path" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go to source for choose validation path" }));

    expect(window.location.hash).toContain("#/session/31/msg/msg-go-to");
    expect(mockRequestScrollToMessage).toHaveBeenCalledWith("s1", "msg-go-to");
  });

  it("dismisses after Go to when the global menu covers more than 65 percent of the chat feed", () => {
    const cleanupFeed = installChatFeedWidth(600);
    window.location.hash = "#/session/current";
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-wide",
              category: "needs-input",
              summary: "open narrow feed target",
              timestamp: Date.now(),
              messageId: "msg-wide",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 41, name: "Worker", createdAt: 1 }],
    });

    try {
      render(<GlobalNeedsInputMenu />);
      fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
      const dialog = screen.getByRole("dialog", { name: "Global needs-input notifications" });
      setElementWidth(dialog, 420);

      fireEvent.click(screen.getByRole("button", { name: "Go to source for open narrow feed target" }));

      expect(window.location.hash).toContain("#/session/41/msg/msg-wide");
      expect(screen.queryByRole("dialog", { name: "Global needs-input notifications" })).toBeNull();
    } finally {
      cleanupFeed();
    }
  });

  it("keeps the global menu open after Go to when it covers 65 percent or less of the chat feed", () => {
    const cleanupFeed = installChatFeedWidth(600);
    window.location.hash = "#/session/current";
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-desktop",
              category: "needs-input",
              summary: "open desktop target",
              timestamp: Date.now(),
              messageId: "msg-desktop",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 51, name: "Worker", createdAt: 1 }],
    });

    try {
      render(<GlobalNeedsInputMenu />);
      fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
      const dialog = screen.getByRole("dialog", { name: "Global needs-input notifications" });
      setElementWidth(dialog, 390);

      fireEvent.click(screen.getByRole("button", { name: "Go to source for open desktop target" }));

      expect(window.location.hash).toContain("#/session/51/msg/msg-desktop");
      expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();
    } finally {
      cleanupFeed();
    }
  });

  it("uses an explicit Main thread route when opening a Main-owned notification", () => {
    window.location.hash = "#/session/current?thread=q-1287";
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-main",
              category: "needs-input",
              summary: "approve Main-thread checkpoint",
              timestamp: Date.now(),
              messageId: "msg-main",
              threadKey: "main",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Leader", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to source for approve Main-thread checkpoint" }));

    expect(window.location.hash).toBe("#/session/31/msg/msg-main?thread=main");
    expect(mockRequestScrollToMessage).toHaveBeenCalledWith("s1", "msg-main");
  });

  it("renders Markdown source context inline without the redundant preview affordance", async () => {
    window.location.hash = "#/session/current";
    mockFetchNotificationContext.mockResolvedValueOnce(
      "Proposed quest and dispatch plan:\n\n**Goal / Scope**\nPersist the query.\n\n- Keep current mode.\n- Read the [docs](https://example.com/docs).",
    );
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-preview",
              category: "needs-input",
              summary: "approve Universal Search query persistence quest",
              timestamp: Date.now(),
              messageId: "msg-preview",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 1476, name: "Misc Leader 5", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));

    await screen.findByTestId("global-needs-input-source-context");
    const sourceTarget = screen.getByTestId("global-needs-input-source-target");
    expect(sourceTarget).not.toHaveAttribute("title");

    fireEvent.mouseEnter(sourceTarget);
    expect(screen.queryByTestId("global-needs-input-source-preview")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Preview source message" })).not.toBeInTheDocument();
    const context = screen.getByTestId("global-needs-input-source-context");
    expect(context.querySelector("strong")).toHaveTextContent("Goal / Scope");
    expect(within(context).getByText("Keep current mode.")).toBeInTheDocument();
    const markdownLink = within(context).getByRole("link", { name: "docs" });
    expect(markdownLink.closest("button")).toBeNull();

    expect(window.location.hash).toBe("#/session/current");
    expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
  });

  it("omits source context when the source is only a duplicate fallback prompt", async () => {
    mockFetchNotificationContext.mockResolvedValueOnce("Needs input: Confirm scope");
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-duplicate",
              category: "needs-input",
              summary: "Confirm scope",
              suggestedAnswers: ["yes"],
              timestamp: Date.now(),
              messageId: "msg-duplicate",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 41, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));

    await waitFor(() => expect(mockFetchNotificationContext).toHaveBeenCalledWith("s1", "n-duplicate"));
    expect(screen.queryByTestId("global-needs-input-source-context")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Confirm scope")).toHaveLength(1);
  });

  it("excludes stale needs-input notifications when sessions are archived or removed from the active list", () => {
    // Stale sessionNotifications can outlive the session-list snapshot; only
    // current non-archived sdkSessions should be allowed into the global count.
    resetStore({
      sessionNotifications: new Map([
        [
          "active",
          [
            {
              id: "active-needs-input",
              category: "needs-input",
              summary: "Active session needs input",
              timestamp: 30,
              messageId: "m-active",
              done: false,
            },
          ],
        ],
        [
          "archived",
          [
            {
              id: "archived-needs-input",
              category: "needs-input",
              summary: "Archived session should not count",
              timestamp: 40,
              messageId: "m-archived",
              done: false,
            },
          ],
        ],
        [
          "removed",
          [
            {
              id: "removed-needs-input",
              category: "needs-input",
              summary: "Removed session should not count",
              timestamp: 50,
              messageId: "m-removed",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [
        { sessionId: "active", sessionNum: 31, name: "Active", createdAt: 1 },
        { sessionId: "archived", sessionNum: 32, name: "Archived", archived: true, createdAt: 2 },
      ],
    });

    const { rerender } = render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    expect(screen.getByRole("button", { name: "Go to source for Active session needs input" })).toBeInTheDocument();
    expect(screen.queryByText("Archived session should not count")).not.toBeInTheDocument();
    expect(screen.queryByText("Removed session should not count")).not.toBeInTheDocument();

    resetStore({
      sessionNotifications: new Map(mockStoreState.sessionNotifications),
      sdkSessions: [],
    });
    rerender(<GlobalNeedsInputMenu />);

    expect(screen.queryByRole("button", { name: /unresolved needs-input/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Global needs-input notifications" })).not.toBeInTheDocument();
  });

  it("closes reliably when the open trigger is clicked", async () => {
    // The popover is portaled outside the trigger, so this exercises the
    // mousedown-then-click sequence that previously closed and reopened it.
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Confirm scope",
              timestamp: Date.now(),
              messageId: "m1",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    const trigger = screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole("dialog", { name: "Global needs-input notifications" })).not.toBeInTheDocument();
  });

  it("sends a structured multi-question response in place through the notification response API", async () => {
    window.location.hash = "#/session/current?thread=q-100";
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-questions",
              category: "needs-input",
              summary: "Need rollout choices",
              questions: [
                { prompt: "Which rollout?", suggestedAnswers: ["staged", "full"] },
                { prompt: "When should it start?", suggestedAnswers: ["now", "after review"] },
              ],
              timestamp: Date.now(),
              messageId: "msg-123",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "staged" }));
    expect(screen.getByLabelText("Answer for Which rollout?")).toHaveValue("staged");
    expect(screen.getByLabelText("Answer for When should it start?")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Answer for When should it start?"), {
      target: { value: "after smoke test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Response" }));

    await waitFor(() =>
      expect(mockSendNeedsInputResponse).toHaveBeenCalledWith(
        "s1",
        "n-questions",
        expect.objectContaining({
          content:
            "Answers for: Need rollout choices\n\n1. Which rollout?\nAnswer: staged\n\n2. When should it start?\nAnswer: after smoke test",
          threadKey: "main",
        }),
      ),
    );
    expect(window.location.hash).toBe("#/session/current?thread=q-100");
    expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
    expect(mockSetExpandAllInTurn).not.toHaveBeenCalled();
    expect(mockSetSessionNotifications).toHaveBeenCalledWith(
      "s1",
      expect.arrayContaining([expect.objectContaining({ id: "n-questions", done: true })]),
    );
    expect(mockRequestBottomAlignOnNextUserMessage).toHaveBeenCalledWith("s1");
  });

  it("uses notification thread metadata when sending a global response", async () => {
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-thread",
              category: "needs-input",
              summary: "Approve quest plan?",
              suggestedAnswers: ["yes"],
              timestamp: Date.now(),
              messageId: "msg-123",
              threadKey: "q-1242",
              questId: "q-1242",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 31, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Response" }));

    await waitFor(() =>
      expect(mockSendNeedsInputResponse).toHaveBeenCalledWith(
        "s1",
        "n-thread",
        expect.objectContaining({
          content: "Approve quest plan?\n\nAnswer: yes",
          threadKey: "q-1242",
          questId: "q-1242",
        }),
      ),
    );
  });

  it("shows a retryable failure without navigating when delivery fails", async () => {
    window.location.hash = "#/session/current?thread=q-100";
    mockSendNeedsInputResponse.mockRejectedValueOnce(new Error("Session is archived"));
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Confirm scope",
              suggestedAnswers: ["yes"],
              timestamp: Date.now(),
              messageId: "msg-123",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 41, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Response" }));

    expect(await screen.findByText(/Response could not be delivered/)).toHaveTextContent("Session is archived");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/session/current?thread=q-100");
    expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
    expect(mockSetExpandAllInTurn).not.toHaveBeenCalled();
    expect(mockRequestBottomAlignOnNextUserMessage).not.toHaveBeenCalled();
  });

  it("retries a failed global response without navigating", async () => {
    window.location.hash = "#/session/current";
    mockSendNeedsInputResponse.mockRejectedValueOnce(new Error("Temporary failure"));
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Confirm scope",
              suggestedAnswers: ["yes"],
              timestamp: Date.now(),
              messageId: "msg-123",
              done: false,
            },
          ],
        ],
      ]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 41, name: "Worker", createdAt: 1 }],
    });

    render(<GlobalNeedsInputMenu />);
    fireEvent.click(screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Response" }));
    await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mockSendNeedsInputResponse).toHaveBeenCalledTimes(2));
    expect(window.location.hash).toBe("#/session/current");
    expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
  });

  it("updates the aggregate when a needs-input notification is resolved", () => {
    const notifications = [
      {
        id: "n-1",
        category: "needs-input",
        summary: "Confirm scope",
        timestamp: Date.now(),
        messageId: "m1",
        done: false,
      },
    ];
    resetStore({
      sessionNotifications: new Map([["s1", notifications]]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 51, name: "Worker", createdAt: 1 }],
    });
    const { rerender } = render(<GlobalNeedsInputMenu />);
    expect(
      screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }),
    ).toBeInTheDocument();

    resetStore({
      sessionNotifications: new Map([["s1", [{ ...notifications[0], done: true }]]]),
      sdkSessions: [{ sessionId: "s1", sessionNum: 51, name: "Worker", createdAt: 1 }],
    });
    rerender(<GlobalNeedsInputMenu />);

    expect(screen.queryByRole("button", { name: /unresolved needs-input/ })).not.toBeInTheDocument();
  });

  it("loads notification details for sessions whose snapshot says needs-input is active", async () => {
    const liveNotifications = [
      {
        id: "n-1",
        category: "needs-input",
        summary: "Confirm scope",
        timestamp: Date.now(),
        messageId: "m1",
        done: false,
      },
    ];
    mockGetSessionNotifications.mockResolvedValueOnce(liveNotifications);
    resetStore({
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          notificationUrgency: "needs-input",
          activeNotificationCount: 1,
          notificationStatusVersion: 2,
        },
      ],
    });

    render(<GlobalNeedsInputMenu />);

    await waitFor(() => expect(mockStoreState.sessionNotifications.get("s1")).toEqual(liveNotifications));
    expect(mockStoreState.sdkSessions[0]).toMatchObject({
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 1,
      activeReviewNotificationCount: 0,
      notificationStatusVersion: 2,
    });
  });

  it("does not let a late global fetch revive notifications after a newer cleared summary", async () => {
    // A lazy global fetch can be requested while the session summary is active,
    // then resolve after the session has already broadcast a newer clear. The
    // response must respect notification freshness instead of repopulating the
    // global bell from stale full-inbox data.
    let resolveNotifications!: (notifications: any[]) => void;
    const request = new Promise<any[]>((resolve) => {
      resolveNotifications = resolve;
    });
    const staleNotifications = [
      {
        id: "n-stale",
        category: "needs-input",
        summary: "Already answered",
        timestamp: Date.now(),
        messageId: "m1",
        done: false,
      },
    ];
    mockGetSessionNotifications.mockReturnValueOnce(request);
    resetStore({
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          notificationUrgency: "needs-input",
          activeNotificationCount: 1,
          activeNeedsInputNotificationCount: 1,
          notificationStatusVersion: 2,
          notificationStatusUpdatedAt: 2000,
        },
      ],
    });

    const { rerender } = render(<GlobalNeedsInputMenu />);
    await waitFor(() => expect(mockGetSessionNotifications).toHaveBeenCalledWith("s1"));

    resetStore({
      sessionNotifications: new Map(),
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          notificationUrgency: null,
          activeNotificationCount: 0,
          activeNeedsInputNotificationCount: 0,
          notificationStatusVersion: 3,
          notificationStatusUpdatedAt: 3000,
        },
      ],
    });
    rerender(<GlobalNeedsInputMenu />);

    await act(async () => {
      resolveNotifications(staleNotifications);
      await request;
    });

    expect(mockStoreState.sessionNotifications.get("s1")).toBeUndefined();
    expect(mockSetSessionNotifications).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /unresolved needs-input/ })).not.toBeInTheDocument();
  });
});
