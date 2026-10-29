// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import { SEEN_DWELL_MS, readsWhenSeen, useUnreadMessagesSeen } from "./use-unread-messages-seen.js";

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
  return elements;
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

  it("counts the unread messages above the view, oldest first, and leaves out what is on screen", () => {
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
    expect(result.current?.first.id).toBe("unloaded");
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
});
