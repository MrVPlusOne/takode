// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { fingerTap } from "../test-fixtures/finger-tap.js";

const mockMarkNotificationDone = vi.fn(async (_sessionId: string, _notifId: string, _done = true) => ({ ok: true }));
// Like the server, answers with the changed notification.
const mockSetNotificationMuted = vi.fn(async (sessionId: string, notifId: string, muted: boolean) => ({
  ok: true,
  muted,
  changed: true,
  notification: { ...mockNotifications.get(sessionId)?.find((entry) => entry.id === notifId), id: notifId, muted },
}));
const mockSnoozeNotification = vi.fn(async (sessionId: string, notifId: string, durationMs: number) => ({
  ok: true,
  notification: {
    ...mockNotifications.get(sessionId)?.find((entry) => entry.id === notifId),
    id: notifId,
    muted: true,
    snoozedUntil: Date.now() + durationMs,
  },
}));
const mockRequestScrollToMessage = vi.fn();
const mockMarkSessionRead = vi.fn(async (_sessionId: string, _options?: any) => ({ ok: true }));
const mockSetExpandAllInTurn = vi.fn();
const mockNotifications = new Map<string, Array<any>>();
const mockSetSessionNotifications = vi.fn((sessionId: string, notifications: Array<any>) => {
  mockNotifications.set(sessionId, notifications);
});

const mockStoreState: Record<string, any> = {
  sessionNotifications: mockNotifications,
  messages: new Map(),
  threadWindowMessages: new Map(),
  quests: [],
  sessionBoards: new Map(),
  sessionCompletedBoards: new Map(),
  sessionNames: new Map(),
  sdkSessions: [],
  zoomLevel: 1,
  requestScrollToMessage: mockRequestScrollToMessage,
  setExpandAllInTurn: mockSetExpandAllInTurn,
  setSessionNotifications: mockSetSessionNotifications,
};

vi.mock("../store.js", () => {
  const useStore: any = (selector: (state: any) => unknown) => selector(mockStoreState);
  useStore.getState = () => mockStoreState;
  useStore.setState = (updater: any) => {
    const patch = typeof updater === "function" ? updater(mockStoreState) : updater;
    if (patch && patch !== mockStoreState) Object.assign(mockStoreState, patch);
  };
  return { useStore };
});

vi.mock("../api.js", () => ({
  api: {
    markNotificationDone: (sessionId: string, notifId: string, done = true) =>
      mockMarkNotificationDone(sessionId, notifId, done),
    setNotificationMuted: (sessionId: string, notifId: string, muted: boolean) =>
      mockSetNotificationMuted(sessionId, notifId, muted),
    snoozeNotification: (sessionId: string, notifId: string, durationMs: number) =>
      mockSnoozeNotification(sessionId, notifId, durationMs),
    markSessionRead: (sessionId: string, options?: any) => mockMarkSessionRead(sessionId, options),
  },
}));

import { ATTENTION_NEXT_IN_SESSION_EVENT, NotificationChip } from "./NotificationChip.js";
import { resetAttentionCursorsForTest } from "../hooks/useAttentionNavigator.js";
import { resetLeaderTopicsForTest, seedLeaderTopics } from "../utils/leader-topics.js";

/** The chip's list, named for one session (the top bar's list is "Everything that needs attention"). */
const LIST_NAME = "What needs attention here";

/** The chip's button: a next step while items are listed, otherwise the inbox toggle. */
function chipButton() {
  return within(screen.getByTestId("session-attention-chip")).getByRole("button");
}

/** Open the inbox the way a right-click or long-press does; a tap steps to the next item. */
function openInbox() {
  fireEvent.contextMenu(chipButton());
}

function setNotifications(sessionId: string, notifications: Array<any>) {
  mockNotifications.set(sessionId, notifications);
}

function setNotificationSummary(
  sessionId: string,
  summary: {
    notificationUrgency: "needs-input" | "review" | null;
    activeNotificationCount: number;
    activeNeedsInputNotificationCount?: number;
    activeReviewNotificationCount?: number;
    notificationStatusVersion: number;
    notificationStatusUpdatedAt?: number;
  },
) {
  mockStoreState.sdkSessions = [
    {
      sessionId,
      state: "connected",
      cwd: "/repo",
      createdAt: 1,
      archived: false,
      ...summary,
    },
  ];
}

describe("NotificationChip", () => {
  beforeEach(() => {
    mockNotifications.clear();
    mockStoreState.sessionNotifications = mockNotifications;
    mockStoreState.messages = new Map();
    mockStoreState.threadWindowMessages = new Map();
    mockStoreState.quests = [];
    mockStoreState.sessionNames = new Map();
    mockStoreState.sdkSessions = [];
    mockStoreState.sessionAttention = undefined;
    resetAttentionCursorsForTest();
    mockMarkSessionRead.mockClear();
    mockMarkNotificationDone.mockClear();
    mockSetNotificationMuted.mockClear();
    mockRequestScrollToMessage.mockClear();
    mockSetExpandAllInTurn.mockClear();
    mockSetSessionNotifications.mockClear();
    resetLeaderTopicsForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when there are no active notifications", () => {
    // The floating bell should stay hidden when the inbox has only completed
    // notifications or no notifications at all.
    setNotifications("s1", [{ id: "done-1", category: "review", summary: "done", timestamp: Date.now(), done: true }]);
    const { container } = render(<NotificationChip sessionId="s1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for waiting-only status markers", () => {
    // Waiting markers are transient status, not unresolved notifications that
    // should create chip counts or resolver work.
    setNotifications("s1", [
      { id: "waiting-1", category: "waiting", summary: "Waiting on reviewer", timestamp: Date.now(), done: false },
    ]);

    const { container } = render(<NotificationChip sessionId="s1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("filters waiting status markers out of mixed notification chips and lists", () => {
    // A legacy/live waiting payload may arrive beside actionable notifications,
    // but it must not add count text or a list row.
    setNotifications("s1", [
      { id: "waiting-1", category: "waiting", summary: "Waiting on reviewer", timestamp: Date.now(), done: false },
      { id: "input-1", category: "needs-input", summary: "Need answer", timestamp: Date.now(), done: false },
    ]);
    render(<NotificationChip sessionId="s1" />);

    const chip = chipButton();
    expect(chip).toHaveTextContent("1/1·Next");
    expect(chip).not.toHaveTextContent("Waiting");

    openInbox();
    const list = screen.getByRole("dialog", { name: LIST_NAME });
    expect(within(list).getAllByTestId("attention-item-row")).toHaveLength(1);
    expect(list).toHaveTextContent("Need answer");
    expect(list).not.toHaveTextContent("Waiting on reviewer");
  });

  it("renders no lower-right chip for review-only notifications", () => {
    // Blue review state is owned by thread tabs, so a review-only inbox should
    // not create a lower-right count or panel entry.
    setNotifications("s1", [
      { id: "review-1", category: "review", summary: "Needs review", timestamp: Date.now(), done: false },
      { id: "review-2", category: "review", summary: "Also review", timestamp: Date.now(), done: true },
    ]);
    const { container } = render(<NotificationChip sessionId="s1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("prioritizes needs-input on the chip surface when needs-input and review are both active", () => {
    // Mixed inboxes should show only unresolved needs-input count. The review
    // nudge remains visible on thread tabs instead of the lower-right chip.
    setNotifications("s1", [
      { id: "review-1", category: "review", summary: "Needs review", timestamp: Date.now(), done: false },
      { id: "input-1", category: "needs-input", summary: "Need answer", timestamp: Date.now(), done: false },
      { id: "input-2", category: "needs-input", summary: "Need second answer", timestamp: Date.now(), done: false },
    ]);
    render(<NotificationChip sessionId="s1" />);

    // The chip now names the next item to open; reviews are not attention items here.
    const chip = chipButton();
    const needsInputBell = chip.querySelector("svg");
    expect(chip).toHaveTextContent("1/2·Next");
    expect(chip).not.toHaveTextContent("review");
    expect(needsInputBell?.className.baseVal ?? needsInputBell?.getAttribute("class")).toContain("text-cc-attention");
    expect(within(chip).queryByTestId("notification-chip-review")).not.toBeInTheDocument();
  });

  it("uses a newer active summary when the cached full inbox is still review-only", () => {
    // Global session_activity_update can arrive before the full notification
    // inbox refreshes. The chip should follow the newer server summary instead
    // of briefly turning back to review urgency from stale cached details.
    setNotifications("s1", [
      { id: "review-1", category: "review", summary: "Needs review", timestamp: Date.now(), done: false },
    ]);
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 6,
      notificationStatusUpdatedAt: 6000,
    });

    render(<NotificationChip sessionId="s1" />);

    const chip = screen.getByRole("button", { name: "Notification inbox: 1 needs-input notification" });
    expect(within(chip).queryByTestId("notification-chip-review")).toBeNull();
    const needsInputBadge = within(chip).getByTestId("notification-chip-needs-input");
    const needsInputBell = needsInputBadge.querySelector("svg");
    expect(needsInputBell?.className.baseVal ?? needsInputBell?.getAttribute("class")).toContain("text-cc-attention");
  });

  it("shows an active summary even before the full notification payload arrives", () => {
    // A stale empty/done-only full inbox should not hide a new needs-input
    // summary while the current-session snapshot/notification_update catches up.
    setNotifications("s1", [
      { id: "old-review", category: "review", summary: "Old review", timestamp: Date.now(), done: true },
    ]);
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
    });

    render(<NotificationChip sessionId="s1" />);

    expect(screen.getByRole("button", { name: "Notification inbox: 1 needs-input notification" })).toBeInTheDocument();
  });

  it("uses needs-input-specific summary counts when review notifications are also active", () => {
    // Session activity snapshots still preserve total/review counts for other
    // surfaces, but the lower-right chip must stay needs-input-only.
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 3,
      activeNeedsInputNotificationCount: 1,
      activeReviewNotificationCount: 2,
      notificationStatusVersion: 9,
      notificationStatusUpdatedAt: 9000,
    });

    render(<NotificationChip sessionId="s1" />);

    const chip = screen.getByRole("button", { name: "Notification inbox: 1 needs-input notification" });
    expect(chip).toHaveTextContent("1needs input");
    expect(chip).not.toHaveTextContent("review");
  });

  it("keeps a newer needs-input summary when stale clear state is still cached", () => {
    // Protects the observed transition: stale clear/review local notification
    // state must not override a newer authoritative needs-input summary.
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 8,
      notificationStatusUpdatedAt: 8000,
    });

    render(<NotificationChip sessionId="s1" />);

    expect(screen.getByRole("button", { name: "Notification inbox: 1 needs-input notification" })).toBeInTheDocument();
  });

  it("closes the list when the chip is tapped again", () => {
    // With nothing to step to, a tap toggles the list. The list closes on
    // presses outside it and a tap sends the press before the click, so the
    // chip must count as inside or its click would reopen the list.
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 8,
      notificationStatusUpdatedAt: 8000,
    });
    vi.useFakeTimers();
    try {
      render(<NotificationChip sessionId="s1" />);
      const chip = screen.getByRole("button", { name: "Notification inbox: 1 needs-input notification" });

      fingerTap(chip);
      act(() => vi.runAllTimers());
      expect(screen.getByRole("dialog", { name: LIST_NAME })).toBeInTheDocument();

      fingerTap(chip);
      expect(screen.queryByRole("dialog", { name: LIST_NAME })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists this session's items like the top bar's list, naming each row's topic and not the session", () => {
    // Jiayi found the old list hard to read next to the top bar's Needs attention list. It now has
    // the same sections and rows; every row is this leader's, so none names the session number,
    // and each names the Library topic it belongs to instead (unread answers are grouped by it).
    setNotificationSummary("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 1,
    });
    mockStoreState.sdkSessions[0].sessionNum = 2851;
    seedLeaderTopics("s1", {
      "q-7": { id: "hosts", name: "Host links" },
      "q-5": { id: "release", name: "Releases" },
      "q-6": { id: "review", name: "Code review" },
    });
    setNotifications("s1", [
      {
        id: "ask",
        category: "needs-input",
        summary: "Pick a chip style",
        timestamp: 100,
        messageId: "m-1",
        threadKey: "q-7",
        questId: "q-7",
        done: false,
      },
    ]);
    render(
      <NotificationChip
        sessionId="s1"
        attentionPreview={{
          notifyMe: [
            {
              sessionId: "s1",
              sessionName: "Leader",
              sessionNum: 2851,
              threadKey: "q-5",
              title: "q-5 Ship it",
              trackedAt: 0,
              pending: { id: "9", messageId: "m-9", timestamp: 90, summary: "Landed" },
            },
          ],
          unread: [{ sessionId: "s1", threadKey: "q-6", label: "q-6 Review", timestamp: 80 }],
        }}
      />,
    );
    openInbox();

    const list = screen.getByRole("dialog", { name: LIST_NAME });
    expect(list).toHaveTextContent(/^Needs attention\(3\)Next1\/3/);
    expect(list).not.toHaveTextContent("#2851");
    const sections = [...list.querySelectorAll("[data-attention-section]")].map((section) =>
      section.getAttribute("data-attention-section"),
    );
    expect(sections).toEqual(["needs-input", "unread", "notify-me"]);

    const question = within(list).getByRole("region", { name: "Questions for you" });
    expect(within(question).getByTestId("attention-item-row")).toHaveAttribute("data-attention-next", "true");
    expect(within(question).getByTestId("attention-item-topic")).toHaveTextContent("Host links");
    expect(within(question).getByTestId("attention-item-place")).toHaveTextContent(/^Host links›q-7/);
    // Unread answers are one row per topic, named by it.
    const unread = within(list).getByRole("region", { name: "Unread results" });
    expect(within(unread).getByTestId("attention-place-row")).toHaveTextContent(/^Code review/);
    const notifyMe = within(list).getByRole("region", { name: "Notify Me results" });
    expect(within(notifyMe).getByTestId("attention-item-topic")).toHaveTextContent("Releases");
  });

  it("keeps muted questions in the collapsed Muted questions section, which Next skips", () => {
    setNotifications("s1", [
      { id: "open", category: "needs-input", summary: "Open ask", timestamp: 200, messageId: "m-1", done: false },
      { id: "quiet", category: "needs-input", summary: "Muted ask", timestamp: 100, done: false, muted: true },
    ]);
    render(<NotificationChip sessionId="s1" />);
    expect(chipButton()).toHaveTextContent("1/1·Next");

    openInbox();
    const list = screen.getByRole("dialog", { name: LIST_NAME });
    expect(within(list).getByRole("region", { name: "Questions for you" })).toHaveTextContent("Open ask");
    expect(list).not.toHaveTextContent("Muted ask");
    fireEvent.click(within(list).getByRole("button", { name: /Muted questions/ }));
    expect(within(list).getByRole("region", { name: "Muted questions" })).toHaveTextContent("Muted ask");
  });

  it("opens an item from its Go to and closes the list", () => {
    setNotifications("s1", [
      { id: "ask", category: "needs-input", summary: "Pick one", timestamp: 100, messageId: "m-1", done: false },
    ]);
    render(<NotificationChip sessionId="s1" />);
    openInbox();

    fireEvent.click(screen.getByRole("button", { name: "Go to Pick one" }));
    expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-1");
    expect(screen.queryByRole("dialog", { name: LIST_NAME })).not.toBeInTheDocument();
  });

  it("opens inside the chat feed, above the chip and never wider or taller than the feed", () => {
    // Jiayi's preference: the list belongs to the chat, so it opens over the feed, right-aligned
    // with the chip, and stops at the feed's left edge instead of covering the side column.
    setNotifications("s1", [
      { id: "ask", category: "needs-input", summary: "Pick one", timestamp: 100, messageId: "m-1", done: false },
    ]);
    vi.stubGlobal("innerWidth", 1400);
    vi.stubGlobal("innerHeight", 900);
    let feedLeft = 300;
    const rect = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top }) as DOMRect;
    const boxes = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === "feed-box") return rect(feedLeft, 50, 1000, 850);
      if (this.dataset.testid === "session-attention-chip") return rect(900, 800, 990, 830);
      return rect(0, 0, 0, 0);
    });
    try {
      const feed = (
        <div data-testid="feed-box">
          <div data-feed-floating-stack="right">
            <NotificationChip sessionId="s1" />
          </div>
        </div>
      );
      const view = render(feed);
      openInbox();
      let style = screen.getByRole("dialog", { name: LIST_NAME }).style;
      expect([style.right, style.bottom, style.width, style.maxHeight]).toEqual(["410px", "108px", "448px", "576px"]);

      // A narrow feed (a wide side column beside it) gets a narrower list.
      fireEvent.keyDown(document, { key: "Escape" });
      feedLeft = 700;
      view.rerender(feed);
      openInbox();
      style = screen.getByRole("dialog", { name: LIST_NAME }).style;
      expect(style.width).toBe("282px");
    } finally {
      boxes.mockRestore();
    }
  });

  describe("session attention navigator", () => {
    it("steps through the session's prompts newest first on each tap and wraps around", () => {
      // A tap is a next step, not a list toggle: each one opens the next item
      // and the label names the one after it. No banner says where it went
      // (the user found it distracting): the opened item shows that.
      setNotifications("s1", [
        { id: "old", category: "needs-input", summary: "Older ask", timestamp: 100, messageId: "m-old", done: false },
        { id: "new", category: "needs-input", summary: "Newer ask", timestamp: 200, messageId: "m-new", done: false },
      ]);
      render(<NotificationChip sessionId="s1" />);

      expect(chipButton()).toHaveTextContent("1/2·Next");
      fireEvent.click(chipButton());
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-new");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(chipButton()).toHaveTextContent("2/2·Next");
      fireEvent.click(chipButton());
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-old");
      fireEvent.click(chipButton());
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-new");
      expect(screen.queryByRole("dialog", { name: LIST_NAME })).not.toBeInTheDocument();
    });

    it("steps on the Next Item in This Session shortcut for its own session only", () => {
      // The shortcut takes the same step as a tap on the chip of the session on
      // screen, and shares its position; other sessions' chips ignore it.
      setNotifications("s1", [
        { id: "old", category: "needs-input", summary: "Older ask", timestamp: 100, messageId: "m-old", done: false },
        { id: "new", category: "needs-input", summary: "Newer ask", timestamp: 200, messageId: "m-new", done: false },
      ]);
      render(<NotificationChip sessionId="s1" />);
      const shortcut = (sessionId: string) =>
        act(() => {
          window.dispatchEvent(new CustomEvent(ATTENTION_NEXT_IN_SESSION_EVENT, { detail: { sessionId } }));
        });

      shortcut("s2");
      expect(mockRequestScrollToMessage).not.toHaveBeenCalled();

      shortcut("s1");
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-new");
      expect(chipButton()).toHaveTextContent("2/2·Next");
      fireEvent.click(chipButton());
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-old");
      shortcut("s1");
      expect(mockRequestScrollToMessage).toHaveBeenLastCalledWith("s1", "m-new");
    });

    it("does nothing on the shortcut when nothing is left to step through", () => {
      // A tap with only a muted prompt opens the list; the shortcut leaves the
      // feed alone instead, so a key pressed in passing never covers it.
      setNotifications("s1", [
        { id: "muted", category: "needs-input", summary: "Muted", timestamp: 1, done: false, muted: true },
      ]);
      render(<NotificationChip sessionId="s1" />);
      act(() => {
        window.dispatchEvent(new CustomEvent(ATTENTION_NEXT_IN_SESSION_EVENT, { detail: { sessionId: "s1" } }));
      });
      expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: LIST_NAME })).not.toBeInTheDocument();
    });

    it("walks from the prompts into unread and Notify Me results and lists them after the prompts", () => {
      // The walk must not stay in the top group, and the inbox (right-click or
      // long-press) lists every item in the same order and marks the next one:
      // questions, then unread answers, then watched quests' results.
      setNotifications("s1", [
        { id: "ask", category: "needs-input", summary: "Pick one", timestamp: 100, messageId: "m-1", done: false },
      ]);
      render(
        <NotificationChip
          sessionId="s1"
          attentionPreview={{
            notifyMe: [
              {
                sessionId: "s1",
                sessionName: "Leader",
                sessionNum: 1,
                threadKey: "q-5",
                title: "q-5 Ship it",
                trackedAt: 0,
                pending: { id: "9", messageId: "m-9", timestamp: 90, summary: "Landed" },
              },
            ],
            unread: [{ sessionId: "s1", threadKey: "q-6", label: "q-6 Review", timestamp: 80 }],
          }}
        />,
      );

      // The chip always reads "Next"; the kind shows in its tinted icon and is named in its
      // accessible label.
      expect(chipButton()).toHaveTextContent("1/3·Next");
      expect(chipButton().getAttribute("aria-label")).toContain("Needs input, 1 of 3");
      fireEvent.click(chipButton());
      expect(chipButton()).toHaveTextContent("2/3·Next");
      expect(chipButton().getAttribute("aria-label")).toContain("Unread result, 2 of 3");
      fireEvent.click(chipButton());
      expect(chipButton()).toHaveTextContent("3/3·Next");
      expect(chipButton().getAttribute("aria-label")).toContain("of 3");

      openInbox();
      const dialog = screen.getByRole("dialog", { name: LIST_NAME });
      expect(dialog).toHaveTextContent(/^Needs attention\(3\)/);
      const prompt = within(dialog).getByRole("region", { name: "Questions for you" });
      const notifyMe = within(dialog).getByRole("region", { name: "Notify Me results" });
      const unread = within(dialog).getByRole("region", { name: "Unread results" });
      expect(notifyMe).toHaveTextContent("q-5 Ship it");
      expect(notifyMe).toHaveTextContent("Landed");
      expect(unread).toHaveTextContent("q-6 Review");
      expect(within(notifyMe).getByTestId("attention-item-row")).toHaveAttribute("data-attention-next", "true");
      expect(prompt.compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(unread.compareDocumentPosition(notifyMe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("names the thread tab of prompts and Notify Me results on their second line", () => {
      // In the session's list the quest replaces nothing but the bare time:
      // prompts show their quest, and Notify Me rows lead with the result and
      // move the quest title to the second line instead of repeating it.
      mockStoreState.quests = [{ questId: "q-7", title: "Offline hosts", status: "in_progress" }];
      setNotifications("s1", [
        {
          id: "ask",
          category: "needs-input",
          summary: "Pick a chip style",
          timestamp: 100,
          messageId: "m-1",
          threadKey: "q-7",
          questId: "q-7",
          done: false,
        },
      ]);
      render(
        <NotificationChip
          sessionId="s1"
          attentionPreview={{
            notifyMe: [
              {
                sessionId: "s1",
                sessionName: "Leader",
                sessionNum: 1,
                threadKey: "q-5",
                title: "q-5 Ship it",
                trackedAt: 0,
                pending: { id: "9", messageId: "m-9", timestamp: 90, summary: "Landed" },
              },
            ],
            unread: [],
          }}
        />,
      );
      openInbox();

      const dialog = screen.getByRole("dialog", { name: LIST_NAME });
      const question = within(dialog).getByRole("region", { name: "Questions for you" });
      expect(within(question).getByTestId("attention-item-place")).toHaveTextContent(/^q-7 Offline hosts/);
      const notifyMe = within(dialog).getByRole("region", { name: "Notify Me results" });
      expect(within(notifyMe).getByRole("button", { name: "Go to Landed" })).toBeInTheDocument();
      expect(within(notifyMe).getByTestId("attention-item-place")).toHaveTextContent(/^q-5 Ship it· /);
    });

    it("opens a row's own menu on right-click or long-press without stepping the chip or closing the list", () => {
      // The chip's gestures (tap steps, long-press opens the list) and the
      // rows' gestures (menu) must not fight: a row gesture only opens the
      // row's menu, and using that menu leaves the list open.
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);
      try {
        render(
          <NotificationChip
            sessionId="s1"
            attentionPreview={{
              notifyMe: [
                {
                  sessionId: "s1",
                  sessionName: "Leader",
                  sessionNum: 1,
                  threadKey: "q-5",
                  title: "q-5 Ship it",
                  trackedAt: 0,
                  pending: { id: "9", messageId: "m-9", timestamp: 90, summary: "Landed" },
                },
              ],
              unread: [{ sessionId: "s1", threadKey: "q-6", label: "q-6 Review", timestamp: 80 }],
            }}
          />,
        );
        openInbox();
        const dialog = screen.getByRole("dialog", { name: LIST_NAME });
        // Unread results show one row per place; the Notify Me result is its own row.
        const unreadRow = within(dialog).getByTestId("attention-place-row");
        const notifyRow = within(dialog).getByTestId("attention-item-row");
        // Only Go to stays inline.
        expect(within(notifyRow!).queryByRole("button", { name: /Acknowledge/ })).toBeNull();
        expect(
          within(notifyRow!)
            .getAllByRole("button")
            .map((button) => button.textContent),
        ).toEqual(["Go to"]);

        fireEvent.contextMenu(notifyRow!);
        fireEvent.pointerDown(screen.getByRole("button", { name: "Acknowledge" }));
        fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toContainEqual(
          expect.stringContaining("/thread-monitoring/q-5"),
        );
        expect(screen.getByRole("dialog", { name: LIST_NAME })).toBeInTheDocument();

        fireEvent.touchStart(unreadRow!, { touches: [{ clientX: 5, clientY: 5 }] });
        act(() => {
          vi.advanceTimersByTime(600);
        });
        fireEvent.touchEnd(unreadRow!);
        expect(screen.getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
        expect(chipButton()).toHaveTextContent("1/2·Next");
        expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("names each unread place first and its newest result below", () => {
      // Counting by place: a row names the place (the thread tab here, no topic) and says what
      // is new there, with the newest result's words.
      // The second line is always the thread tab the item belongs to, so an
      // unread row's first line is the result itself rather than the tab title.
      render(
        <NotificationChip
          sessionId="s1"
          attentionPreview={{
            notifyMe: [],
            unread: [
              {
                sessionId: "s1",
                threadKey: "q-6",
                label: "Review the gate",
                timestamp: 80,
                summary: "landed and completed",
              },
              { sessionId: "s1", threadKey: "q-8", label: "Older work", timestamp: 70 },
            ],
          }}
        />,
      );
      openInbox();
      const [ready, noSummary] = within(screen.getByRole("dialog", { name: LIST_NAME })).getAllByTestId(
        "attention-place-row",
      );
      expect(ready).toHaveTextContent(/^q-6 Review the gate/);
      expect(within(ready!).getByTestId("attention-place-summary")).toHaveTextContent(
        "1 new answer· landed and completed",
      );
      expect(noSummary).toHaveTextContent(/^q-8 Older work/);
      expect(within(noSummary!).getByTestId("attention-place-summary")).toHaveTextContent("1 new answer· New result");
    });

    it("keeps its place across remounts, like switching threads", () => {
      // The feed chip remounts when the selected thread changes; the walk must
      // not restart at the top each time.
      setNotifications("s1", [
        { id: "a", category: "needs-input", summary: "First", timestamp: 300, messageId: "m-a", done: false },
        { id: "b", category: "needs-input", summary: "Second", timestamp: 200, messageId: "m-b", done: false },
      ]);
      const view = render(<NotificationChip sessionId="s1" />);
      fireEvent.click(chipButton());
      view.unmount();
      render(<NotificationChip sessionId="s1" />);
      expect(chipButton()).toHaveTextContent("2/2·Next");
    });

    it("shows an unread result on its own and reads the session when opened", () => {
      // A session whose only attention is an unread result still gets the chip;
      // opening a session-level unread item marks the session read, as Next does.
      mockStoreState.sdkSessions = [{ sessionId: "s1", name: "Worker", state: "idle", cwd: "/", createdAt: 1 }];
      mockStoreState.sessionAttention = new Map([["s1", "review"]]);
      render(<NotificationChip sessionId="s1" />);

      expect(chipButton()).toHaveTextContent("1/1·Next");
      fireEvent.click(chipButton());
      expect(mockMarkSessionRead).toHaveBeenCalledWith("s1", { mode: "session-view" });
    });

    it("opens the inbox on a phone long-press without stepping to the next item", () => {
      // The phone gesture uses the shared long-press hook: holding the chip
      // opens the list, and the click iOS emulates on lift must not step.
      vi.useFakeTimers();
      try {
        setNotifications("s1", [
          { id: "a", category: "needs-input", summary: "First", timestamp: 1, messageId: "m-a", done: false },
        ]);
        render(<NotificationChip sessionId="s1" />);
        fireEvent.touchStart(chipButton(), { touches: [{ clientX: 5, clientY: 5 }] });
        act(() => {
          vi.advanceTimersByTime(600);
        });
        fireEvent.touchEnd(chipButton());
        fireEvent.click(chipButton());

        expect(screen.getByRole("dialog", { name: LIST_NAME })).toBeInTheDocument();
        expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens the list right away on right-click, with no close-tab menu", () => {
      // Tabs no longer close: the gesture that once offered "Close tab and go to next" and
      // "Show list" now always opens the list.
      setNotifications("s1", [
        { id: "here", category: "needs-input", summary: "Here", timestamp: 300, threadKey: "q-1", done: false },
        { id: "next", category: "needs-input", summary: "Next", timestamp: 200, threadKey: "q-2", done: false },
      ]);
      render(<NotificationChip sessionId="s1" />);

      fireEvent.contextMenu(chipButton());
      expect(screen.getByRole("dialog", { name: LIST_NAME })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Close tab/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show list" })).not.toBeInTheDocument();
    });

    it("opens the inbox on a tap when only muted prompts remain", () => {
      // Nothing to step through: the tap falls back to the list.
      setNotifications("s1", [
        { id: "m", category: "needs-input", summary: "Later", timestamp: 1, done: false, muted: true },
      ]);
      render(<NotificationChip sessionId="s1" />);
      fireEvent.click(chipButton());
      expect(screen.getByRole("dialog", { name: LIST_NAME })).toBeInTheDocument();
    });
  });
});
