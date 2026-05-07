// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetSessionNotifications = vi.fn(async (_sessionId: string): Promise<any[]> => []);
const mockMarkNotificationDone = vi.fn(async (_sessionId: string, _notifId: string, _done = true) => ({ ok: true }));
const mockSendToSession = vi.fn((_sessionId: string, _msg: any) => true);
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
    markNotificationDone: (sessionId: string, notifId: string, done = true) =>
      mockMarkNotificationDone(sessionId, notifId, done),
  },
}));

vi.mock("../ws.js", () => ({
  sendToSession: (sessionId: string, msg: any) => mockSendToSession(sessionId, msg),
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
    mockSendToSession.mockReturnValue(true);
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
    expect(within(dialog).getByRole("button", { name: "Choose rollout" })).toBeInTheDocument();
    expect(within(dialog).getByText("#21 Leader")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Pick model" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Review")).not.toBeInTheDocument();
  });

  it("sends a structured multi-question response through the target session", () => {
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

    expect(mockSendToSession).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        content:
          "Answers for: Need rollout choices\n\n1. Which rollout?\nAnswer: staged\n\n2. When should it start?\nAnswer: after smoke test",
        replyContext: {
          messageId: "msg-123",
          notificationId: "n-questions",
          previewText: "Need rollout choices",
        },
        threadKey: "main",
      }),
    );
    expect(mockMarkNotificationDone).toHaveBeenCalledWith("s1", "n-questions", true);
    expect(mockRequestBottomAlignOnNextUserMessage).toHaveBeenCalledWith("s1");
  });

  it("jumps to the notification instead of marking done when direct delivery is unavailable", async () => {
    mockSendToSession.mockReturnValue(false);
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

    await waitFor(() => expect(window.location.hash).toContain("/session/41/msg/msg-123"));
    expect(mockRequestScrollToMessage).toHaveBeenCalledWith("s1", "msg-123");
    expect(mockSetExpandAllInTurn).toHaveBeenCalledWith("s1", "msg-123");
    expect(mockMarkNotificationDone).not.toHaveBeenCalled();
    expect(screen.getByText(/Opened the target session/)).toBeInTheDocument();
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
    resetStore({ sessionNotifications: new Map([["s1", notifications]]) });
    const { rerender } = render(<GlobalNeedsInputMenu />);
    expect(
      screen.getByRole("button", { name: "1 unresolved needs-input notification across sessions" }),
    ).toBeInTheDocument();

    resetStore({
      sessionNotifications: new Map([["s1", [{ ...notifications[0], done: true }]]]),
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
