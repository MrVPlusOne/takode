import { describe, expect, it } from "vitest";
import type { SessionNotification } from "../types.js";
import { sharedReviewNotificationIdsForThread } from "./use-shared-result-read.js";

// Unread Ready results are review notifications anchored on the message that
// carries the Thread Ready mark. When that message also shows in another tab
// (an answer posted in one quest tab that covers a request asked in another),
// reading it in a quest tab reads it everywhere. Reading in Main never clears
// another thread's result, because Main shows many answers shared with quest tabs.

function review(id: string, threadKey: string, messageId: string, extra: Partial<SessionNotification> = {}) {
  return {
    id,
    category: "review",
    summary: `Thread ready: ${threadKey}`,
    timestamp: 1,
    messageId,
    done: false,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    ...extra,
  } satisfies SessionNotification;
}

const shown = (...ids: string[]) => ids.map((id) => ({ id }));

describe("sharedReviewNotificationIdsForThread", () => {
  it("reads another quest's result whose message this quest tab shows", () => {
    const notifications = [review("n-9", "q-2300", "answer"), review("n-10", "q-2300", "status-in-q-2300")];
    // The asking tab shows the shared answer but not q-2300's own status message,
    // so only the result on the answer is read; q-2300 keeps its other unread result.
    expect(sharedReviewNotificationIdsForThread(notifications, shown("question", "answer"), "q-2224")).toEqual(["n-9"]);
  });

  it("reads Main's result from a quest tab, but never another thread's result from Main", () => {
    const notifications = [review("n-1", "main", "answer"), review("n-2", "q-2300", "answer")];
    expect(sharedReviewNotificationIdsForThread(notifications, shown("answer"), "q-2300")).toEqual(["n-1"]);
    expect(sharedReviewNotificationIdsForThread(notifications, shown("answer"), "main")).toEqual([]);
    expect(sharedReviewNotificationIdsForThread(notifications, shown("answer"), "all")).toEqual([]);
  });

  it("leaves the tab's own, done, needs-input and unshown results alone", () => {
    const notifications: SessionNotification[] = [
      review("own", "q-2224", "answer"),
      review("done", "q-2300", "answer", { done: true }),
      { ...review("prompt", "q-2300", "answer"), category: "needs-input" },
      review("elsewhere", "q-2300", "not-shown"),
    ];
    expect(sharedReviewNotificationIdsForThread(notifications, shown("answer"), "q-2224")).toEqual([]);
  });
});
