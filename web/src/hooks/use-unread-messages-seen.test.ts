// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import {
  SCROLL_ATTENTION_MS,
  SEEN_DWELL_MS,
  readsWhenSeen,
  useUnreadMessagesSeen,
} from "./use-unread-messages-seen.js";

/**
 * Unread answers are read once seen, as in Slack: a message counts as read after it has been
 * on screen for a second, in whichever view shows it, and the first unread message on screen
 * gets a "New" line. Finished quests and agent-sent results still read with their thread.
 */

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) };
}

/** A visible feed (top 0, 600 tall) with messages at the given tops. */
function mountFeed(threadKey: string, messages: Array<{ id: string; top: number; height?: number }>) {
  return mountFeedElement(threadKey, messages).elements;
}

function mountFeedElement(threadKey: string, messages: Array<{ id: string; top: number; height?: number }>) {
  const feed = document.createElement("div");
  feed.dataset.testid = "message-feed-scroll-container";
  feed.dataset.feedSessionId = "leader";
  feed.dataset.feedThreadKey = threadKey;
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
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useUnreadMessagesSeen", () => {
  it("reads an answer after a second on screen, and leaves one off screen unread", () => {
    const elements = mountFeed("topic:t1", [
      { id: "m-a1", top: 100 },
      { id: "m-a2", top: 900 },
    ]);
    const onSeen = vi.fn();
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "topic:t1",
        notifications: [answer("a1", 1), answer("a2", 2)],
        enabled: true,
        inFeed: () => true,
        onSeen,
      }),
    );
    // The oldest unread message on screen gets the "New" line.
    expect(elements["m-a1"]!.getAttribute("data-unread-start")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS / 2);
    });
    expect(onSeen).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS);
    });
    expect(onSeen.mock.calls).toEqual([["a1"]]);
  });

  it("keeps the New line when the feed replaces the message's element, after it was read", () => {
    // A window update can re-render the message as a new element: the line follows it, and it
    // stays after the message is read, until the view changes.
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 100 }]);
    const notifications = [answer("a1", 1)];
    const { rerender } = renderHook(
      ({ list }) =>
        useUnreadMessagesSeen({
          sessionId: "leader",
          feedKey: "q-1",
          notifications: list,
          enabled: true,
          inFeed: () => true,
          onSeen: vi.fn(),
        }),
      { initialProps: { list: notifications } },
    );
    const replacement = elements["m-a1"]!.cloneNode() as HTMLElement;
    replacement.removeAttribute("data-unread-start");
    replacement.getBoundingClientRect = () => rect(100, 100);
    elements["m-a1"]!.replaceWith(replacement);
    rerender({ list: [{ ...notifications[0]!, done: true }] });
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS);
    });
    expect(replacement.getAttribute("data-unread-start")).toBe("true");
  });

  it("restarts the wait when the message leaves the screen, and removes the New line with the view", () => {
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    const { unmount } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        inFeed: () => true,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS / 2);
    });
    elements["m-a1"]!.getBoundingClientRect = () => rect(2000, 100);
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS);
    });
    expect(onSeen).not.toHaveBeenCalled();
    unmount();
    expect(elements["m-a1"]!.hasAttribute("data-unread-start")).toBe(false);
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
        feedKey: "q-1",
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

  it("puts one New line above unread answers that are together at the bottom", () => {
    // The usual case: everything after the last read answer is unread, so a line says it.
    const elements = mountFeed("q-1", [
      { id: "m-read", top: 0 },
      { id: "m-u1", top: 150 },
      { id: "m-u2", top: 300 },
    ]);
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "q-1",
        notifications: [answer("read", 1, { done: true }), answer("u1", 2), answer("u2", 3)],
        enabled: true,
        inFeed: () => true,
        onSeen: vi.fn(),
      }),
    );
    expect(elements["m-u1"]!.getAttribute("data-unread-start")).toBe("true");
    expect(document.querySelectorAll("[data-unread-start]").length).toBe(1);
    expect(document.querySelectorAll("[data-unread-answer]").length).toBe(0);
  });

  it("tags each unread answer when a read one sits below an unread one, as in a joined thread", () => {
    // Jiayi (Nov 1): the Scribe joined a newer thread, already read, onto an older conversation
    // whose last answer was still unread. A New line above that answer said everything below was
    // unread; each unread answer now gets its own tag, and read ones none, kept while the view lasts.
    const elements = mountFeed("q-1", [
      { id: "m-early", top: 0 },
      { id: "m-joined-read", top: 150 },
      { id: "m-joined-unread", top: 300 },
    ]);
    const { rerender, unmount } = renderHook(
      ({ list }) =>
        useUnreadMessagesSeen({
          sessionId: "leader",
          feedKey: "q-1",
          notifications: list,
          enabled: true,
          inFeed: () => true,
          onSeen: vi.fn(),
        }),
      {
        initialProps: {
          list: [
            answer("early", 1),
            answer("joined-read", 5, { done: true }),
            answer("joined-unread", 6, { unreadReason: "report" }),
          ],
        },
      },
    );
    const tagged = () =>
      Object.entries(elements)
        .filter(([, element]) => element.getAttribute("data-unread-answer") === "true")
        .map(([id]) => id);
    expect(tagged()).toEqual(["m-early", "m-joined-unread"]);
    expect(document.querySelectorAll("[data-unread-start]").length).toBe(0);
    // Read on screen, the tags stay for this view, then go with it.
    rerender({
      list: [
        answer("early", 1, { done: true }),
        answer("joined-read", 5, { done: true }),
        answer("joined-unread", 6, { unreadReason: "report", done: true }),
      ],
    });
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS);
    });
    expect(tagged()).toEqual(["m-early", "m-joined-unread"]);
    unmount();
    expect(tagged()).toEqual([]);
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
          feedKey: "q-1",
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
        feedKey: "q-1",
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
        feedKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        inFeed: () => true,
        onSeen: vi.fn(),
      }),
    );
    expect(result.current?.count).toBe(1);
    // Scrolled to it and seen for a second: it no longer waits above.
    elements["m-a1"]!.getBoundingClientRect = () => rect(100, 100);
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS + 500);
    });
    expect(result.current).toBeNull();
  });

  it("leaves an answer arriving in a chat that isn't focused unread, and reads it once the user scrolls there", () => {
    // Jiayi (Oct 31): with the main view and side panes on screen, an answer that shows up by
    // itself in a pane the user isn't working in stays unread; scrolling that pane is deliberate
    // attention, so what is on screen then reads as usual. Focusing the chat reads it too.
    const { feed } = mountFeedElement("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused: false,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS * 5);
    });
    expect(onSeen).not.toHaveBeenCalled();

    // The user scrolls the pane: the answer on screen now counts, after the usual second.
    act(() => {
      feed.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(SEEN_DWELL_MS + 500);
    });
    expect(onSeen).toHaveBeenCalledWith("a1");
  });

  it("reads what arrives on screen once the chat is focused", () => {
    mountFeedElement("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    let focused = false;
    const { rerender } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
        focused,
        onSeen,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(SCROLL_ATTENTION_MS + SEEN_DWELL_MS);
    });
    expect(onSeen).not.toHaveBeenCalled();
    focused = true;
    rerender();
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS + 500);
    });
    expect(onSeen).toHaveBeenCalledWith("a1");
  });
});
