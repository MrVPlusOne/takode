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

  it("restarts the wait when the message leaves the screen, and removes the New line with the view", () => {
    const elements = mountFeed("q-1", [{ id: "m-a1", top: 100 }]);
    const onSeen = vi.fn();
    const { unmount } = renderHook(() =>
      useUnreadMessagesSeen({
        sessionId: "leader",
        feedKey: "q-1",
        notifications: [answer("a1", 1)],
        enabled: true,
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
});
