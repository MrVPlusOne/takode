// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(within(dialog).getByText("#22 Worker")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open source message for Choose rollout" })).toBeInTheDocument();
    expect(within(dialog).getByText("#21 Leader")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open source message for Pick model" })).toBeInTheDocument();
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
    expect(screen.getAllByText("approve backend SVG logo candidates")).toHaveLength(1);
    expect(screen.queryByText("Jump")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Answer for approve backend SVG logo candidates")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(window.location.hash).toBe("#/session/current");
    expect(screen.getByTestId("global-needs-input-source-context").className).toContain("whitespace-pre-line");

    fireEvent.click(
      screen.getByRole("button", { name: "Open source message for approve backend SVG logo candidates" }),
    );

    expect(window.location.hash).toContain("#/session/31/msg/msg-context");
    expect(mockRequestScrollToMessage).toHaveBeenCalledWith("s1", "msg-context");
    expect(mockSetExpandAllInTurn).toHaveBeenCalledWith("s1", "msg-context");
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
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: "Open source message for Active session needs input" }),
    ).toBeInTheDocument();
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

    await waitFor(() => expect(mockSetSessionNotifications).toHaveBeenCalledWith("s1", liveNotifications));
  });
});
