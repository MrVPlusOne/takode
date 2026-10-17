// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

const revertToMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
const markNotificationDoneMock = vi.hoisted(() => vi.fn(async () => ({})));
const sendNeedsInputResponseMock = vi.hoisted(() =>
  vi.fn(async (_sessionId: string, _notifId: string, _response: unknown) => ({
    ok: true,
    sessionId: _sessionId,
    notificationId: _notifId,
    delivery: "sent",
  })),
);
const sendToSessionMock = vi.hoisted(() => vi.fn((_sessionId: string, _msg: unknown) => true));
vi.mock("../api.js", () => ({
  api: {
    revertToMessage: revertToMessageMock,
    markNotificationDone: markNotificationDoneMock,
    sendNeedsInputResponse: sendNeedsInputResponseMock,
  },
}));

vi.mock("../ws.js", () => ({
  sendToSession: (sessionId: string, msg: unknown) => sendToSessionMock(sessionId, msg),
}));

vi.mock("react-markdown", () => ({
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: { p?: (props: { children: string }) => ReactNode };
  }) => {
    if (components?.p) {
      return <div data-testid="markdown">{components.p({ children })}</div>;
    }
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { MessageBubble, NotificationMarker } from "./MessageBubble.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function installIntersectionObserverMock() {
  let callback: IntersectionObserverCallback | null = null;
  let observedTarget: Element | null = null;
  const observe = vi.fn((target: Element) => {
    observedTarget = target;
  });
  const disconnect = vi.fn();

  vi.stubGlobal(
    "IntersectionObserver",
    class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [0];

      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }

      observe(target: Element) {
        observe(target);
      }

      unobserve() {}

      disconnect() {
        disconnect();
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  );

  return {
    observe,
    disconnect,
    trigger(isIntersecting: boolean) {
      if (!callback || !observedTarget) return;
      callback(
        [
          {
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            target: observedTarget,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    },
  };
}

describe("MessageBubble notification markers", () => {
  beforeEach(() => {
    revertToMessageMock.mockClear();
    markNotificationDoneMock.mockClear();
    sendNeedsInputResponseMock.mockClear();
    sendToSessionMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the local toggle override for preview markers instead of the notification API", () => {
    // Playground previews should be able to demonstrate the review checkbox
    // locally without routing clicks through the real session notification API.
    const onToggleDone = vi.fn();

    render(
      <NotificationMarker
        category="review"
        summary="Ready for review"
        doneOverride={false}
        onToggleDone={onToggleDone}
        showReplyAction={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark as reviewed" }));

    expect(onToggleDone).toHaveBeenCalledTimes(1);
    expect(markNotificationDoneMock).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Reply to this notification")).toBeNull();
  });

  it("does not auto-resolve review notifications from inline marker visibility", () => {
    const observer = installIntersectionObserverMock();
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-review-hidden",
        category: "review",
        summary: "q-345 ready for review",
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="review"
          summary="q-345 ready for review"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-review-hidden"
        />,
      );

      expect(observer.observe).not.toHaveBeenCalled();
      expect(markNotificationDoneMock).not.toHaveBeenCalled();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("keeps review notifications unresolved when their inline marker becomes visible", () => {
    const observer = installIntersectionObserverMock();
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-review-visible",
        category: "review",
        summary: "q-345 ready for review",
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="review"
          summary="q-345 ready for review"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-review-visible"
        />,
      );

      act(() => observer.trigger(true));

      expect(observer.observe).not.toHaveBeenCalled();
      expect(markNotificationDoneMock).not.toHaveBeenCalledWith("notify-session", "n-review-visible", true);
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("does not auto-resolve amber needs-input markers merely because they are visible", () => {
    const observer = installIntersectionObserverMock();
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-input-visible",
        category: "needs-input",
        summary: "Deploy now?",
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Deploy now?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-input-visible"
        />,
      );

      act(() => observer.trigger(true));

      expect(markNotificationDoneMock).not.toHaveBeenCalled();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("fills inline answers from more than three suggestions without mutating the composer draft", async () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevDrafts = useStore.getState().composerDrafts;
    const prevReplyContexts = useStore.getState().replyContexts;
    const prevFocusTrigger = useStore.getState().focusComposerTrigger;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-17",
        category: "needs-input",
        summary: "Deploy now?",
        suggestedAnswers: ["yes", "no", "revise", "later"],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    const drafts = new Map(prevDrafts);
    drafts.set("notify-session", {
      text: "existing draft",
      images: [{ id: "img-1", name: "keep.png", base64: "abc", mediaType: "image/png", status: "ready" }],
    });
    useStore.setState({ sessionNotifications: notifications, composerDrafts: drafts });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Deploy now?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-17"
        />,
      );

      const actionRow = screen.getByTestId("notification-answer-actions");
      expect(actionRow.contains(screen.getByRole("button", { name: "Use suggested answer: yes" }))).toBe(true);
      expect(actionRow.contains(screen.getByRole("button", { name: "Use suggested answer: no" }))).toBe(true);
      expect(actionRow.contains(screen.getByRole("button", { name: "Use suggested answer: revise" }))).toBe(true);
      expect(actionRow.contains(screen.getByRole("button", { name: "Use suggested answer: later" }))).toBe(true);
      expect(screen.queryByRole("button", { name: "Custom answer" })).toBeNull();
      const input = screen.getByLabelText("Answer for Deploy now?") as HTMLInputElement;
      const reply = screen.getByRole("button", { name: "Reply" }) as HTMLButtonElement;
      expect(input.placeholder).toBe("Your answer");
      expect(reply.disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: yes" }));

      expect(input.value).toBe("yes");
      expect(reply.disabled).toBe(false);
      expect(useStore.getState().replyContexts.get("notify-session")).toBeUndefined();
      expect(useStore.getState().composerDrafts.get("notify-session")).toMatchObject({
        text: "existing draft",
        images: [{ id: "img-1" }],
      });
      expect(useStore.getState().focusComposerTrigger).toBe(prevFocusTrigger);

      fireEvent.click(reply);

      await waitFor(() =>
        expect(sendNeedsInputResponseMock).toHaveBeenCalledWith("notify-session", "n-17", {
          content: "Deploy now?\n\nAnswer: yes",
          threadKey: "main",
        }),
      );
      expect(sendToSessionMock).not.toHaveBeenCalled();
      expect(markNotificationDoneMock).not.toHaveBeenCalled();
      expect(useStore.getState().composerDrafts.get("notify-session")).toMatchObject({
        text: "existing draft",
        images: [{ id: "img-1" }],
      });
    } finally {
      useStore.setState({
        sessionNotifications: prevNotifications,
        composerDrafts: prevDrafts,
        replyContexts: prevReplyContexts,
        focusComposerTrigger: prevFocusTrigger,
      });
    }
  });

  it("lays out long suggested answers as full-width wrapping actions", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    const longAnswer = "Continue the rollout now; the canary looks healthy and the current error budget is acceptable.";
    notifications.set("notify-session", [
      {
        id: "n-long",
        category: "needs-input",
        summary: "Choose rollout mode",
        suggestedAnswers: [longAnswer, "Hold for manual smoke checks before continuing."],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Choose rollout mode"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-long"
        />,
      );

      const actionColumn = screen.getByTestId("notification-answer-actions");
      const longAnswerButton = screen.getByRole("button", { name: `Use suggested answer: ${longAnswer}` });

      expect(actionColumn.className).toContain("flex-col");
      expect(longAnswerButton.className).toContain("w-full");
      expect(longAnswerButton.className).toContain("whitespace-normal");
      expect(longAnswerButton.className).toContain("break-words");
      expect(longAnswerButton.className).not.toContain("truncate");
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("stacks single-answer inline controls below the custom answer field", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    const longAnswer =
      "Continue the rollout now. The canary looks healthy, the rollback owner is online, and the final smoke check should include mobile notification coverage.";
    notifications.set("notify-session", [
      {
        id: "n-stacked-actions",
        category: "needs-input",
        summary: "Approve the rollout?",
        suggestedAnswers: [longAnswer],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Approve the rollout?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-stacked-actions"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: `Use suggested answer: ${longAnswer}` }));

      const actionColumn = screen.getByTestId("notification-answer-actions");
      const footer = screen.getByTestId("notification-answer-footer");
      const answer = screen.getByLabelText("Answer for Approve the rollout?");
      const reply = screen.getByRole("button", { name: "Reply" });
      const composerReply = screen.getByRole("button", { name: "reply in composer" });
      const fieldRow = footer.previousElementSibling;

      expect(actionColumn.className).toContain("flex-col");
      expect(footer.contains(reply)).toBe(true);
      expect(footer.contains(composerReply)).toBe(true);
      expect(footer.contains(answer)).toBe(false);
      expect(fieldRow?.contains(answer)).toBe(true);
      expect(answer).toMatchObject({ value: longAnswer });
      expect((reply as HTMLButtonElement).disabled).toBe(false);
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("keeps the Reply button at the right edge of the action row for right-thumb reach", () => {
    // On phones the primary send action must sit where the composer's send button does: right-aligned and last,
    // with secondary actions to its left. The snooze picker must wrap below the whole row rather than between
    // Remind me later and Reply.
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-right-actions",
        category: "needs-input",
        summary: "Approve the rollout?",
        suggestedAnswers: ["yes", "no"],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Approve the rollout?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-right-actions"
        />,
      );

      const footer = screen.getByTestId("notification-answer-footer");
      const buttons = within(footer).getAllByRole("button");
      expect(footer.className).toContain("justify-end");
      expect(buttons.map((button) => button.textContent?.trim() || button.getAttribute("aria-label"))).toEqual([
        "Remind me later",
        "reply in composer",
        "Reply",
      ]);
      expect(footer.lastElementChild).toBe(screen.getByRole("button", { name: "Reply" }));

      fireEvent.click(screen.getByRole("button", { name: "Remind me later" }));
      const picker = screen.getByRole("group", { name: "Remind me in" }).parentElement!;
      expect(picker.className).toContain("order-last");
      expect(picker.className).toContain("basis-full");
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("switches to the notification owner thread before sending an inline quick answer", () => {
    const onSelectThread = vi.fn();
    vi.useFakeTimers();
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevDrafts = useStore.getState().composerDrafts;
    const prevReplyContexts = useStore.getState().replyContexts;
    const prevFocusTrigger = useStore.getState().focusComposerTrigger;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-20",
        category: "needs-input",
        summary: "Deploy now?",
        suggestedAnswers: ["yes", "no"],
        timestamp: Date.now(),
        messageId: "asst-notify",
        threadKey: "q-977",
        questId: "q-977",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Deploy now?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-20"
          currentThreadKey="all"
          onSelectThread={onSelectThread}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: yes" }));
      expect(screen.getByLabelText("Answer for Deploy now?")).toMatchObject({ value: "yes" });
      expect(onSelectThread).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      expect(onSelectThread).toHaveBeenCalledWith("q-977");
      expect(useStore.getState().replyContexts.get("notify-session")).toBeUndefined();
      expect(sendToSessionMock).not.toHaveBeenCalled();

      act(() => {
        vi.runOnlyPendingTimers();
      });

      expect(sendNeedsInputResponseMock).toHaveBeenCalledWith(
        "notify-session",
        "n-20",
        expect.objectContaining({
          content: "Deploy now?\n\nAnswer: yes",
          threadKey: "q-977",
          questId: "q-977",
        }),
      );
      expect(sendToSessionMock).not.toHaveBeenCalled();
      expect(useStore.getState().composerDrafts.get("notify-session")).toBeUndefined();
      expect(useStore.getState().focusComposerTrigger).toBe(prevFocusTrigger);
    } finally {
      vi.useRealTimers();
      useStore.setState({
        sessionNotifications: prevNotifications,
        composerDrafts: prevDrafts,
        replyContexts: prevReplyContexts,
        focusComposerTrigger: prevFocusTrigger,
      });
    }
  });

  it("uses notification metadata IDs through the real assistant message path", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevDrafts = useStore.getState().composerDrafts;
    const prevReplyContexts = useStore.getState().replyContexts;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-2",
        category: "needs-input",
        summary: "Second prompt",
        suggestedAnswers: ["ship", "hold"],
        timestamp: Date.now(),
        messageId: "asst-shared-anchor",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      const msg = makeMessage({
        id: "asst-shared-anchor",
        role: "assistant",
        content: "I need one more decision.",
        notification: {
          id: "n-2",
          category: "needs-input",
          timestamp: Date.now(),
          summary: "Second prompt",
          suggestedAnswers: ["ship", "hold"],
        },
      });

      render(<MessageBubble message={msg} sessionId="notify-session" />);
      fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: ship" }));
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));

      expect(sendNeedsInputResponseMock).toHaveBeenCalledWith(
        "notify-session",
        "n-2",
        expect.objectContaining({
          content: "Second prompt\n\nAnswer: ship",
          threadKey: "main",
        }),
      );
      expect(sendToSessionMock).not.toHaveBeenCalled();
      expect(useStore.getState().replyContexts.get("notify-session")).toBeUndefined();
      expect(useStore.getState().composerDrafts.get("notify-session")).toBeUndefined();
    } finally {
      useStore.setState({
        sessionNotifications: prevNotifications,
        composerDrafts: prevDrafts,
        replyContexts: prevReplyContexts,
      });
    }
  });

  it("fails closed instead of reviving an embedded snapshot when authoritative targets are ambiguous", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-first",
        category: "needs-input",
        summary: "First live prompt",
        timestamp: Date.now(),
        messageId: "asst-ambiguous-anchor",
        done: false,
      },
      {
        id: "n-second",
        category: "needs-input",
        summary: "Second live prompt",
        timestamp: Date.now(),
        messageId: "asst-ambiguous-anchor",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <MessageBubble
          sessionId="notify-session"
          message={makeMessage({
            id: "asst-ambiguous-anchor",
            role: "assistant",
            content: "Ambiguous prompt source",
            notification: {
              id: "n-stale",
              category: "needs-input",
              summary: "Stale embedded prompt",
              timestamp: Date.now() - 1_000,
            },
          })}
        />,
      );

      expect(screen.getByText("Ambiguous prompt source")).toBeTruthy();
      expect(screen.queryByText("First live prompt")).toBeNull();
      expect(screen.queryByText("Second live prompt")).toBeNull();
      expect(screen.queryByText("Stale embedded prompt")).toBeNull();
      expect(screen.queryByRole("button", { name: /Mark handled|Mark unhandled/ })).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("does not revive an embedded snapshot after authoritative notification state loads without a match", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevSdkSessions = useStore.getState().sdkSessions;
    useStore.getState().setSdkSessions([
      {
        sessionId: "notify-session",
        state: "connected",
        cwd: "/tmp",
        createdAt: 1,
        archived: false,
      },
    ]);
    applySessionNotifications(
      "notify-session",
      [],
      { notificationStatusVersion: 1, notificationStatusUpdatedAt: 1 },
      { authoritativeStatus: true },
    );

    try {
      render(
        <MessageBubble
          sessionId="notify-session"
          message={makeMessage({
            id: "asst-resolved-anchor",
            role: "assistant",
            content: "Resolved prompt source",
            notification: {
              id: "n-resolved",
              category: "needs-input",
              summary: "Resolved embedded prompt",
              timestamp: Date.now() - 1_000,
            },
          })}
        />,
      );

      expect(screen.getByText("Resolved prompt source")).toBeTruthy();
      expect(screen.queryByText("Resolved embedded prompt")).toBeNull();
      expect(screen.queryByRole("button", { name: /Mark handled|Mark unhandled/ })).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications, sdkSessions: prevSdkSessions });
    }
  });

  it("prefers the authoritative anchored notification over a stale embedded snapshot", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-current",
        category: "needs-input",
        summary: "Current deployment decision",
        suggestedAnswers: ["ship", "hold"],
        timestamp: Date.now(),
        messageId: "asst-current-anchor",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <MessageBubble
          sessionId="notify-session"
          message={makeMessage({
            id: "asst-current-anchor",
            role: "assistant",
            content: "Choose the deployment boundary.",
            notification: {
              id: "n-stale",
              category: "needs-input",
              summary: "Outdated embedded decision",
              suggestedAnswers: ["old option"],
              timestamp: Date.now() - 1_000,
            },
          })}
        />,
      );

      expect(screen.getByText("Current deployment decision")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Use suggested answer: ship" })).toBeTruthy();
      expect(screen.queryByText("Outdated embedded decision")).toBeNull();
      expect(screen.queryByRole("button", { name: "Use suggested answer: old option" })).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("uses the composer reply icon without replacing the existing draft", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevDrafts = useStore.getState().composerDrafts;
    const prevReplyContexts = useStore.getState().replyContexts;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-18",
        category: "needs-input",
        summary: "Choose rollout mode",
        suggestedAnswers: ["fast", "slow"],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    const drafts = new Map(prevDrafts);
    drafts.set("notify-session", { text: "keep this text", images: [] });
    useStore.setState({ sessionNotifications: notifications, composerDrafts: drafts });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Choose rollout mode"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-18"
        />,
      );

      const composerReply = screen.getByRole("button", { name: "reply in composer" });
      expect(composerReply.getAttribute("title")).toBe("reply in composer");
      fireEvent.click(composerReply);

      expect(useStore.getState().replyContexts.get("notify-session")).toMatchObject({
        messageId: "asst-notify",
        notificationId: "n-18",
      });
      expect(useStore.getState().composerDrafts.get("notify-session")?.text).toBe("keep this text");
    } finally {
      useStore.setState({
        sessionNotifications: prevNotifications,
        composerDrafts: prevDrafts,
        replyContexts: prevReplyContexts,
      });
    }
  });

  it("hides answer actions for addressed needs-input notifications", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-19",
        category: "needs-input",
        summary: "Deploy now?",
        suggestedAnswers: ["yes", "no"],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: true,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Deploy now?"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-19"
        />,
      );

      expect(screen.getByRole("button", { name: "Mark unhandled" })).not.toBeNull();
      expect(screen.queryByTestId("notification-answer-actions")).toBeNull();
      expect(screen.queryByRole("button", { name: "Use suggested answer: yes" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Custom answer" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reply to this notification" })).toBeNull();
      expect(screen.queryByRole("button", { name: "reply in composer" })).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("renders structured inline questions with scoped suggestions and a combined reply", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const prevDrafts = useStore.getState().composerDrafts;
    const prevReplyContexts = useStore.getState().replyContexts;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-questions",
        category: "needs-input",
        summary: "Need rollout choices",
        questions: [
          { prompt: "Which rollout?", suggestedAnswers: ["staged", "full"] },
          { prompt: "When should it start?", suggestedAnswers: ["now", "after review"] },
        ],
        timestamp: Date.now(),
        messageId: "asst-notify",
        done: false,
      },
    ]);
    const drafts = new Map(prevDrafts);
    drafts.set("notify-session", { text: "do not touch", images: [] });
    useStore.setState({ sessionNotifications: notifications, composerDrafts: drafts });

    try {
      render(
        <NotificationMarker
          category="needs-input"
          summary="Need rollout choices"
          sessionId="notify-session"
          messageId="asst-notify"
          notificationId="n-questions"
        />,
      );

      expect(screen.getAllByTestId("notification-question-block")).toHaveLength(2);
      const reply = screen.getByRole("button", { name: "Reply" }) as HTMLButtonElement;
      expect(reply.disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: staged" }));
      expect(screen.getByLabelText("Answer for Which rollout?")).toMatchObject({ value: "staged" });
      expect(screen.getByLabelText("Answer for When should it start?")).toMatchObject({ value: "" });
      expect(reply.disabled).toBe(true);

      fireEvent.change(screen.getByLabelText("Answer for When should it start?"), {
        target: { value: "after smoke test" },
      });
      expect(reply.disabled).toBe(false);
      fireEvent.click(reply);

      expect(sendNeedsInputResponseMock).toHaveBeenCalledWith(
        "notify-session",
        "n-questions",
        expect.objectContaining({
          content:
            "Answers for: Need rollout choices\n\n1. Which rollout?\n   Answer: staged\n\n2. When should it start?\n   Answer: after smoke test",
          threadKey: "main",
        }),
      );
      expect(sendToSessionMock).not.toHaveBeenCalled();
      expect(useStore.getState().composerDrafts.get("notify-session")?.text).toBe("do not touch");
    } finally {
      useStore.setState({
        sessionNotifications: prevNotifications,
        composerDrafts: prevDrafts,
        replyContexts: prevReplyContexts,
      });
    }
  });

  // Leader read markers ("Answer in q-N | ...", "q-N ready for review: ...") only make a
  // thread unread. They used to render as bell chips with a reply button under the answer,
  // which read as questions, so the feed shows none for them, read or not. An ordinary
  // review notification on another message keeps its chip.
  it("shows no feed chip for leader read markers while other review chips stay", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-answer",
        category: "review",
        summary: "Answer in q-7 | The fix is in.",
        timestamp: Date.now(),
        messageId: "asst-answer",
        unreadReason: "answer",
        threadKey: "q-7",
        done: false,
      },
      {
        id: "n-complete",
        category: "review",
        summary: "q-7 ready for review: Fix the thing",
        timestamp: Date.now(),
        messageId: "asst-closing",
        unreadReason: "quest-complete",
        threadKey: "q-7",
        done: true,
      },
      {
        id: "n-review",
        category: "review",
        summary: "q-8 ready for review",
        timestamp: Date.now(),
        messageId: "asst-review",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      const { container } = render(
        <>
          <MessageBubble
            message={makeMessage({ id: "asst-answer", role: "assistant", content: "The fix is in." })}
            sessionId="notify-session"
          />
          <MessageBubble
            message={makeMessage({ id: "asst-closing", role: "assistant", content: "Wrapping up." })}
            sessionId="notify-session"
          />
          <MessageBubble
            message={makeMessage({ id: "asst-review", role: "assistant", content: "Ready to look at." })}
            sessionId="notify-session"
          />
        </>,
      );

      const chips = [...container.querySelectorAll("[data-notification-category]")];
      expect(chips.map((chip) => chip.getAttribute("data-notification-id"))).toEqual(["n-review"]);
      expect(screen.queryByText(/Answer in q-7/)).toBeNull();
      expect(screen.queryByText(/q-7 ready for review/)).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  // An inline `takode notify review` chip finds its notification by message. It must not
  // pick up a read marker on the same message and offer to reply to it.
  it("does not bind an inline review chip to a read marker on the same message", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const notifications = new Map(prevNotifications);
    notifications.set("notify-session", [
      {
        id: "n-answer",
        category: "review",
        summary: "Answer in Main | Done.",
        timestamp: Date.now(),
        messageId: "asst-answer",
        unreadReason: "answer",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: notifications });

    try {
      render(<NotificationMarker category="review" sessionId="notify-session" messageId="asst-answer" />);

      expect(screen.queryByRole("button", { name: "reply in composer" })).toBeNull();
      expect(screen.getByRole("button", { name: "Mark as reviewed" })).toHaveProperty("disabled", true);
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });
});
