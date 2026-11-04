// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import { MARK_GRACE_MS, readsWhenSeen, useUnreadMessagesSeen } from "./use-unread-messages-seen.js";

/**
 * Unread answers are read once seen, as in Slack: a message counts as read the moment its
 * beginning shows in the focused chat, in whichever view shows it. Each unread answer the view
 * marks gets a blue bar ("true") that turns grey when read ("read") and clears when the chat loses
 * focus. Finished quests and agent-sent results still read with their thread.
 */

const MARK = "data-unread-answer";
/** Whether the window has focus, as `document.hasFocus()` reports it. */
let windowFocused = true;

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) };
}

/** A visible feed (top 0, 600 tall) with messages at the given tops. */
function mountFeed(threadKey: string, messages: Array<{ id: string; top: number; height?: number }>) {
  return mountFeedElement(threadKey, messages).elements;
}

/** `feedKey` is a side pane's own feed key (`data-feed-key`); the main view's feed has none. */
function mountFeedElement(
  threadKey: string,
  messages: Array<{ id: string; top: number; height?: number }>,
  feedKey?: string,
) {
  const feed = document.createElement("div");
  feed.dataset.testid = "message-feed-scroll-container";
  feed.dataset.feedSessionId = "leader";
  feed.dataset.feedThreadKey = threadKey;
  if (feedKey) feed.dataset.feedKey = feedKey;
  feed.getBoundingClientRect = () => rect(0, 600);
  feed.getClientRects = () => [rect(0, 600)] as unknown as DOMRectList;
  const elements: Record<string, HTMLElement> = {};
  for (const message of messages) {
    const element = document.createElement("div");
    element.dataset.messageId = message.id;
    element.getBoundingClientRect = () => rect(message.top, message.height ?? 100);
    feed.appendChild(element);
    elements[message.id] = element;
  }
  document.body.appendChild(feed);
  return { feed, elements };
}

function answer(id: string, timestamp: number, extra: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id,
    category: "review",
    unreadReason: "answer",
    messageId: `m-${id}`,
    threadKey: "q-1",
    timestamp,
    done: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  windowFocused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => windowFocused);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useUnreadMessagesSeen", () => {
  it("reads an answer the moment its beginning shows, and leaves one off screen unread", () => {
    const elements = mountFeed("topic:t1", [
      { id: "m-a1", top: 100 },
      { id: "m-a2", top: 900 },
    ]);
    const onSeen = vi.fn();
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "topic:t1",
        notifications: [answer("a1", 1), answer("a2", 2)],
        enabled: true,
        inFeed: () => true,
        onSeen,
      }),
    );
    // Both were unread when the view opened, so both are marked; the one on screen is read at once,
    // and its bar turns into the grey "read" mark.
    expect(onSeen.mock.calls).toEqual([["a1"]]);
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("read");
    expect(elements["m-a2"]!.getAttribute(MARK)).toBe("true");
  });

  it("does not read a long answer whose beginning is above the view", () => {
    // Its middle fills the screen, but the user hasn't seen how it starts.
    const elements = mountFeed("q-1", [{ id: "m-a1", top: -300, height: 1200 }]);
    const onSeen = vi.fn();
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onSeen).not.toHaveBeenCalled();
    elements["m-a1"]!.getBoundingClientRect = () => rect(500, 1200);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSeen).toHaveBeenCalledWith("a1");
  });

  it("puts the read mark back without its animation when the feed replaces the message's element", () => {
    // A window update can re-render the message as a new element: the mark follows it, as the
    // settled read mark ("seen") so the animation does not play again.
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 100 }]);
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        inFeed: () => true,
        onSeen: vi.fn(),
      }),
    );
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("read");
    const replacement = elements["m-a1"]!.cloneNode() as HTMLElement;
    replacement.removeAttribute(MARK);
    replacement.getBoundingClientRect = () => rect(100, 100);
    elements["m-a1"]!.replaceWith(replacement);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(replacement.getAttribute(MARK)).toBe("seen");
  });

  it("clears the read marks when the chat loses focus, and keeps the unread ones", () => {
    // Jiayi (Nov 2): the read marks show what just got read while the user is in the chat.
    const elements = mountFeed("q-1", [
      { id: "m-a1", top: 100 },
      { id: "m-a2", top: 900 },
    ]);
    const { rerender, unmount } = renderHook(
      ({ focused }) =>
        useUnreadMessagesSeen({
          sessionId: "leader",
          threadKey: "q-1",
          notifications: [answer("a1", 1), answer("a2", 2)],
          enabled: true,
          focused,
          onSeen: vi.fn(),
        }),
      { initialProps: { focused: true } },
    );
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("read");
    rerender({ focused: false });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(elements["m-a1"]!.hasAttribute(MARK)).toBe(false);
    expect(elements["m-a2"]!.getAttribute(MARK)).toBe("true");
    unmount();
    expect(elements["m-a2"]!.hasAttribute(MARK)).toBe(false);
  });

  it("clears the read marks when the window loses focus", () => {
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 100 }]);
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        onSeen: vi.fn(),
      }),
    );
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("read");
    windowFocused = false;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(elements["m-a1"]!.hasAttribute(MARK)).toBe(false);
  });

  it("shows an answer read elsewhere as read", () => {
    // Read by replying, or in another browser: its mark turns grey too.
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 900 }]);
    const { rerender } = renderHook(
      ({ list }) =>
        useUnreadMessagesSeen({
          sessionId: "leader",
          threadKey: "q-1",
          notifications: list,
          enabled: true,
          onSeen: vi.fn(),
        }),
      { initialProps: { list: [answer("a1", 1)] } },
    );
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("true");
    rerender({ list: [answer("a1", 1, { done: true })] });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(elements["m-a1"]!.getAttribute(MARK)).toBe("read");
  });

  it("reads and marks in its own feed when the main view and a side pane show the same thread", () => {
    // Jiayi, Nov 3: a thread open in both the main view (scrolled to its latest, the answer above)
    // and a side pane (the answer on screen). Both feeds share the session and thread, and the
    // pane's hook used to find the main view's feed first: focusing and scrolling the pane never
    // read the answer, and its blue bar and "1 new" stayed.
    const main = mountFeedElement("q-1", [{ id: "m-a1", top: -800 }]).elements;
    const side = mountFeedElement("q-1", [{ id: "m-a1", top: 200 }], "side:leader:q-1").elements;
    const mainSeen = vi.fn();
    const sideSeen = vi.fn();
    let sideFocused = false;
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused: !sideFocused,
        onSeen: mainSeen,
      }),
    );
    const { rerender } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        feedKey: "side:leader:q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused: sideFocused,
        onSeen: sideSeen,
      }),
    );
    // Each view marks its own element; the main view, focused, does not read an answer it shows
    // scrolled away.
    expect(main["m-a1"]!.getAttribute(MARK)).toBe("true");
    expect(side["m-a1"]!.getAttribute(MARK)).toBe("true");
    expect(mainSeen).not.toHaveBeenCalled();
    // Focusing the pane, where the answer's beginning shows, reads it there.
    sideFocused = true;
    rerender();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(sideSeen.mock.calls).toEqual([["a1"]]);
    expect(side["m-a1"]!.getAttribute(MARK)).toBe("read");
    expect(mainSeen).not.toHaveBeenCalled();
  });

  it("leaves finished quests and agent-sent results to the thread rule", () => {
    expect(readsWhenSeen(answer("a", 1))).toBe(true);
    expect(readsWhenSeen(answer("r", 1, { unreadReason: "report" }))).toBe(true);
    expect(readsWhenSeen(answer("q", 1, { unreadReason: "quest-complete" }))).toBe(false);
    expect(readsWhenSeen(answer("x", 1, { unreadReason: undefined }))).toBe(false);
    expect(readsWhenSeen(answer("n", 1, { messageId: null }))).toBe(false);
    expect(readsWhenSeen(answer("d", 1, { done: true }))).toBe(false);
  });

  it("counts the unread messages above the view, and leaves out what is on screen", () => {
    // A conversation opened at its latest says how many unread wait above: one scrolled past,
    // one not loaded (older than the window), but not the one on screen nor another thread's.
    mountFeed("q-1", [
      { id: "m-above", top: -400 },
      { id: "m-shown", top: 100 },
    ]);
    const { result } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [
          answer("above", 3),
          answer("unloaded", 2),
          answer("shown", 4),
          answer("elsewhere", 1, { threadKey: "q-2" }),
        ],
        enabled: true,
        inFeed: (ownerThreadKey) => ownerThreadKey === "q-1",
        onSeen: vi.fn(),
      }),
    );
    expect(result.current?.count).toBe(2);
    // A jump goes to the nearest: the one scrolled past, before the one above the loaded window.
    expect(result.current?.next.id).toBe("above");
  });

  it("steps the jump up through unread answers one at a time, skipping read ones between", () => {
    // Two unread answers above the view with a read one between: the pill's jump goes to the
    // nearer first, then (once it is read) to the next, never to the farthest straight away.
    const elements = mountFeed("q-1", [
      { id: "m-far", top: -900 },
      { id: "m-read", top: -650 },
      { id: "m-near", top: -400 },
      { id: "m-latest", top: 300 },
    ]);
    const { result, rerender } = renderHook(
      ({ list }) =>
        useUnreadMessagesSeen({
          sessionId: "leader",
          threadKey: "q-1",
          notifications: list,
          enabled: true,
          inFeed: () => true,
          onSeen: vi.fn(),
        }),
      {
        initialProps: {
          list: [answer("far", 1), answer("read", 2, { done: true }), answer("near", 3), answer("latest", 4)],
        },
      },
    );
    expect(result.current?.count).toBe(2);
    expect(result.current?.next.id).toBe("near");
    elements["m-near"]!.getBoundingClientRect = () => rect(100, 100);
    elements["m-far"]!.getBoundingClientRect = () => rect(-500, 100);
    rerender({
      list: [
        answer("far", 1),
        answer("read", 2, { done: true }),
        answer("near", 3, { done: true }),
        answer("latest", 4, { done: true }),
      ],
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current?.count).toBe(1);
    expect(result.current?.next.id).toBe("far");
  });

  it("does not count unloaded messages while a newer section is unloaded too", () => {
    // Reading an older window, a message outside it may be below rather than above.
    const elements = mountFeed("q-1", [{ id: "m-shown", top: 100 }]);
    elements["m-shown"]!.parentElement!.dataset.feedHasNewer = "true";
    const { result } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("unloaded", 2)],
        enabled: true,
        inFeed: () => true,
        onSeen: vi.fn(),
      }),
    );
    expect(result.current).toBeNull();
  });

  it("drops a message from the count once it has been read", () => {
    const elements = mountFeed("q-1", [{ id: "m-a1", top: -400 }]);
    const { result } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        inFeed: () => true,
        onSeen: vi.fn(),
      }),
    );
    expect(result.current?.count).toBe(1);
    // Scrolled to it: it no longer waits above.
    elements["m-a1"]!.getBoundingClientRect = () => rect(100, 100);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBeNull();
  });

  it("leaves an answer arriving in a chat that isn't focused unread", () => {
    // Jiayi (Oct 31): with the main view and side panes on screen, an answer that shows up by
    // itself in a pane the user isn't working in stays unread. Scrolling the pane focuses it
    // (chat-focus.ts), and then it reads as usual (the next test).
    mountFeedElement("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused: false,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onSeen).not.toHaveBeenCalled();
  });

  it("reads what arrives on screen once the chat is focused", () => {
    mountFeedElement("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    let focused = false;
    const { rerender } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        threadKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onSeen).not.toHaveBeenCalled();
    focused = true;
    rerender();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSeen).toHaveBeenCalledWith("a1");
  });

  // Jiayi (Nov 1): chatting in a thread, the leader's reply came in with a New line that stayed. A
  // reply watched as it arrives is not news; the marker is for what the user did not see arrive.
  describe("answers that arrive while the view is open", () => {
    const marks = () => document.querySelectorAll(`[${MARK}]`).length;
    const renderView = (focused = true) => {
      const onSeen = vi.fn();
      const hook = renderHook(
        ({ list }: { list: SessionNotification[] }) =>
          useUnreadMessagesSeen({
            sessionId: "leader",
            threadKey: "q-1",
            notifications: list,
            enabled: true,
            focused,
            onSeen,
          }),
        { initialProps: { list: [answer("old", 1, { done: true })] } },
      );
      return { ...hook, onSeen };
    };

    it("get no marker when read on screen in the focused chat", () => {
      mountFeed("q-1", [
        { id: "m-old", top: 0 },
        { id: "m-reply", top: 150 },
      ]);
      const { rerender, onSeen } = renderView();
      rerender({ list: [answer("old", 1, { done: true }), answer("reply", Date.now())] });
      // It shows up between two polls: the next one reads it.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onSeen).toHaveBeenCalledWith("reply");
      act(() => {
        vi.advanceTimersByTime(MARK_GRACE_MS * 2);
      });
      expect(marks()).toBe(0);
    });

    it("are marked once their grace runs out unread, when they arrive scrolled away", () => {
      const elements = mountFeed("q-1", [
        { id: "m-old", top: 0 },
        { id: "m-reply", top: 900 },
      ]);
      const { rerender, onSeen } = renderView();
      rerender({ list: [answer("old", 1, { done: true }), answer("reply", Date.now())] });
      act(() => {
        vi.advanceTimersByTime(MARK_GRACE_MS / 2);
      });
      expect(marks()).toBe(0);
      act(() => {
        vi.advanceTimersByTime(MARK_GRACE_MS);
      });
      expect(elements["m-reply"]!.getAttribute(MARK)).toBe("true");
      expect(onSeen).not.toHaveBeenCalled();
    });

    it("are marked when they arrive on screen in a chat that isn't focused", () => {
      const elements = mountFeed("q-1", [{ id: "m-reply", top: 150 }]);
      const { rerender } = renderView(false);
      rerender({ list: [answer("reply", Date.now())] });
      act(() => {
        vi.advanceTimersByTime(MARK_GRACE_MS + 1_000);
      });
      expect(elements["m-reply"]!.getAttribute(MARK)).toBe("true");
    });

    it("are marked at once when they came while the page was hidden", () => {
      // Coming back to the page is like opening the view: the reply wasn't watched.
      const elements = mountFeed("q-1", [{ id: "m-reply", top: 150 }]);
      const { rerender } = renderView();
      let visibility = "hidden";
      const spy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as never);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      rerender({ list: [answer("reply", Date.now())] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      visibility = "visible";
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // Marked, and read at once on screen: it keeps the read mark.
      expect(elements["m-reply"]!.getAttribute(MARK)).toBe("read");
      spy.mockRestore();
    });

    it("are marked at once when they were there before the view opened but loaded after", () => {
      // A fresh page: the notifications reach the browser a moment after the view opens.
      const elements = mountFeed("q-1", [{ id: "m-reply", top: 150 }]);
      const { rerender } = renderView();
      rerender({ list: [answer("reply", Date.now() - 60_000)] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(elements["m-reply"]!.getAttribute(MARK)).toBe("read");
    });
  });
});
