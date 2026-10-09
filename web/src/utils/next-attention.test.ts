import { describe, expect, it } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import type { GlobalNeedsInputEntry } from "./global-needs-input.js";
import { buildNextAttentionQueue, collectUnreadAttention, pickNextAttention } from "./next-attention.js";

function needsInput(sessionId: string, id: string, timestamp: number, threadKey = "main"): GlobalNeedsInputEntry {
  const notification = {
    id,
    category: "needs-input",
    timestamp,
    threadKey,
    summary: `ask ${id}`,
  } as SessionNotification;
  return { sessionId, sessionName: sessionId, sessionNum: null, notification };
}

function notifyMe(sessionId: string, threadKey: string, timestamp: number, pending = true): ThreadMonitoringEntry {
  return {
    sessionId,
    sessionName: sessionId,
    sessionNum: null,
    threadKey,
    title: `${threadKey} result`,
    trackedAt: 0,
    pending: pending ? { id: `r-${threadKey}`, messageId: `m-${threadKey}`, timestamp, summary: "done" } : null,
  };
}

describe("buildNextAttentionQueue", () => {
  it("orders needs-input, then Notify Me, then unread, newest first within each group", () => {
    // The user chose group priority with newest-first inside each group, so a
    // fresh unread result never jumps ahead of an older needs-input prompt.
    const queue = buildNextAttentionQueue({
      needsInput: [needsInput("a", "n-old", 100), needsInput("b", "n-new", 300)],
      notifyMe: [notifyMe("c", "q-1", 200), notifyMe("c", "q-2", 400), notifyMe("c", "q-3", 999, false)],
      unread: [
        { sessionId: "d", threadKey: null, label: "d", timestamp: 50 },
        { sessionId: "e", threadKey: null, label: "e", timestamp: 900 },
      ],
    });

    expect(queue.map((item) => item.key)).toEqual([
      "needs-input:b:n-new",
      "needs-input:a:n-old",
      "notify-me:c:q-2:r-q-2",
      "notify-me:c:q-1:r-q-1",
      "unread:e:",
      "unread:d:",
    ]);
  });

  it("does not repeat a thread or session as unread when an earlier group already covers it", () => {
    const queue = buildNextAttentionQueue({
      needsInput: [needsInput("a", "n1", 100, "q-7")],
      notifyMe: [notifyMe("b", "q-9", 100)],
      unread: [
        { sessionId: "a", threadKey: "q-7", label: "covered thread", timestamp: 500 },
        { sessionId: "b", threadKey: null, label: "covered session", timestamp: 500 },
        { sessionId: "a", threadKey: "main", label: "other thread", timestamp: 400 },
      ],
    });

    expect(queue.filter((item) => item.kind === "unread").map((item) => item.label)).toEqual(["other thread"]);
  });
});

describe("pickNextAttention", () => {
  const queue = buildNextAttentionQueue({
    needsInput: [needsInput("a", "n2", 300), needsInput("a", "n1", 200)],
    notifyMe: [notifyMe("b", "q-1", 100)],
    unread: [],
  });

  it("starts at the newest item when the current view holds none of them", () => {
    expect(pickNextAttention(queue, { sessionId: "z", threadKey: null }, null)?.item.key).toBe("needs-input:a:n2");
  });

  it("advances past the item being viewed and wraps around at the end", () => {
    expect(pickNextAttention(queue, { sessionId: "b", threadKey: "q-1" }, null)?.item.key).toBe("needs-input:a:n2");
  });

  it("uses the last opened item to keep advancing through several items in one thread", () => {
    // Both prompts live in session a's Main thread. Without the remembered key,
    // the second tap would match n2 again and bounce between the two forever.
    const first = pickNextAttention(queue, { sessionId: "a", threadKey: null }, null);
    expect(first?.item.key).toBe("needs-input:a:n1");
    const second = pickNextAttention(queue, { sessionId: "a", threadKey: "main" }, first!.item.key);
    expect(second).toMatchObject({ item: { key: "notify-me:b:q-1:r-q-1" }, position: 2 });
  });

  it("returns null for an empty queue", () => {
    expect(pickNextAttention([], { sessionId: "a", threadKey: null }, null)).toBeNull();
  });
});

describe("collectUnreadAttention", () => {
  const session = (sessionId: string, extra: Partial<SdkSessionInfo> = {}): SdkSessionInfo => ({
    sessionId,
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    lastActivityAt: 10,
    name: sessionId,
    ...extra,
  });

  it("keeps review and error unread sessions, skipping needs-input and archived ones", () => {
    const candidates = collectUnreadAttention({
      sdkSessions: [session("review"), session("error"), session("action"), session("old", { archived: true })],
      sessionAttention: new Map([
        ["review", "review"],
        ["error", "error"],
        ["action", "action"],
        ["old", "review"],
      ]),
    });
    expect(candidates.map((candidate) => candidate.sessionId)).toEqual(["review", "error"]);
  });

  it("lists a leader's unread threads from its tab projection instead of the whole session", () => {
    // Ready results live in leader threads; Next should open the exact thread.
    const attention = (reviewUnread: boolean, updatedAt: number) => ({
      needsInput: false,
      mutedNeedsInput: false,
      reviewUnread,
      updatedAt,
    });
    const tab = (threadKey: string, reviewUnread: boolean, updatedAt: number) => ({
      threadKey,
      questId: threadKey,
      title: `${threadKey} title`,
      attention: attention(reviewUnread, updatedAt),
    });
    const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, "leader");
    const candidates = collectUnreadAttention({
      sdkSessions: [session("leader", { isOrchestrator: true })],
      sessionAttention: new Map([["leader", "review"]]),
      syncedProjectionKeys: new Set([entryId]),
      syncedProjectionValues: new Map([
        [
          entryId,
          {
            currentQuestStateVersion: 1,
            tabState: null,
            tabs: [tab("q-1", true, 70), tab("q-2", false, 80)],
            mainAttention: attention(true, 60),
            threadStatuses: {},
            activePhaseSummary: [],
          },
        ],
      ]),
    });
    expect(candidates).toEqual([
      { sessionId: "leader", threadKey: "main", label: "leader", timestamp: 60 },
      { sessionId: "leader", threadKey: "q-1", label: "q-1 title", timestamp: 70 },
    ]);
  });
});
