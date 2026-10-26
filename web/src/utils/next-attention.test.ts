import { describe, expect, it } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import type { GlobalNeedsInputEntry } from "./global-needs-input.js";
import {
  attentionCursorFor,
  attentionSection,
  buildNextAttentionQueue,
  buildSessionAttentionQueue,
  collectUnreadAttention,
  pickAttentionAfter,
} from "./next-attention.js";

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
  it("orders questions, then unread, then Notify Me, newest first within each section", () => {
    // Questions come first, then unread answers, then results of watched quests (Jiayi's order
    // for the topic-first design, Oct 26); newest first inside each, so a fresh unread result
    // never jumps ahead of an older question.
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
      "unread:e:",
      "unread:d:",
      "notify-me:c:q-2:r-q-2",
      "notify-me:c:q-1:r-q-1",
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

describe("sections and topics", () => {
  it("puts reminders that came due right after questions, and groups unread answers by topic", () => {
    // A "Remind me later" that came due returns as a Notify Me result marked as a reminder: it
    // is shown and visited before unread answers. Unread answers are grouped by their quest's
    // topic, the topic with the newest answer first, and newest first inside a topic.
    const reminder = notifyMe("a", "q-5", 10);
    reminder.pending = { ...reminder.pending!, reminder: true };
    const answer = (id: string, threadKey: string, timestamp: number) => ({
      sessionId: "a",
      threadKey,
      label: threadKey,
      timestamp,
      notification: { id, category: "review", timestamp, messageId: `m-${id}`, done: false } as SessionNotification,
    });
    const topics: Record<string, { id: string; name: string }> = {
      "q-1": { id: "t-relay", name: "Relay" },
      "q-2": { id: "t-relay", name: "Relay" },
      "q-3": { id: "t-voice", name: "Voice" },
    };
    const queue = buildNextAttentionQueue({
      needsInput: [needsInput("a", "ask", 1)],
      notifyMe: [notifyMe("a", "q-8", 500), reminder],
      unread: [answer("u1", "q-1", 100), answer("u2", "q-3", 300), answer("u3", "q-2", 200), answer("u4", "q-9", 50)],
      topicOf: (_sessionId, threadKey) => (threadKey ? (topics[threadKey] ?? null) : null),
    });
    expect(queue.map((item) => [attentionSection(item), item.key])).toEqual([
      ["needs-input", "needs-input:a:ask"],
      ["reminder", "notify-me:a:q-5:r-q-5"],
      ["unread", "unread:a:u2"],
      ["unread", "unread:a:u3"],
      ["unread", "unread:a:u1"],
      ["unread", "unread:a:u4"],
      ["notify-me", "notify-me:a:q-8:r-q-8"],
    ]);
    // Next walks the same order, topic by topic.
    const visited = [];
    let cursor = null;
    for (const _ of queue) {
      const next = pickAttentionAfter(queue, cursor)!;
      visited.push(next.item.key);
      cursor = attentionCursorFor(next.item);
    }
    expect(visited).toEqual(queue.map((item) => item.key));
  });
});

describe("pickAttentionAfter", () => {
  const queue = buildNextAttentionQueue({
    needsInput: [needsInput("a", "n2", 300), needsInput("a", "n1", 200)],
    notifyMe: [notifyMe("b", "q-1", 100)],
    unread: [{ sessionId: "c", threadKey: null, label: "c", timestamp: 50 }],
  });
  const keys = queue.map((item) => item.key);

  it("starts at the top without a position", () => {
    expect(pickAttentionAfter(queue, null)).toMatchObject({ item: { key: keys[0] }, position: 0 });
  });

  it("walks the whole list into lower-priority groups and wraps at the end", () => {
    // The user's complaint: Next kept landing in the needs-input group. Each
    // step must move past the last opened item, through Notify Me and unread.
    const visited: string[] = [];
    let cursor = null;
    for (let step = 0; step < 5; step += 1) {
      const next = pickAttentionAfter(queue, cursor)!;
      visited.push(next.item.key);
      cursor = attentionCursorFor(next.item);
    }
    expect(visited).toEqual([...keys, keys[0]]);
  });

  it("keeps its place when the opened item leaves the queue", () => {
    // Answering the opened prompt removes it; the walk continues with the item
    // after its place instead of restarting at the top.
    const cursor = attentionCursorFor(queue[1]!);
    const withoutIt = queue.filter((item) => item.key !== keys[1]);
    expect(pickAttentionAfter(withoutIt, cursor)?.item.key).toBe(keys[2]);
  });

  it("visits a new item when the walk reaches its place, without resetting", () => {
    // A newer prompt sorts before the cursor, so the walk finishes the list and
    // reaches it after wrapping; an older unread result is reached on the way.
    const cursor = attentionCursorFor(queue[1]!);
    const grown = buildNextAttentionQueue({
      needsInput: [needsInput("a", "n3", 900), needsInput("a", "n2", 300), needsInput("a", "n1", 200)],
      notifyMe: [notifyMe("b", "q-1", 100)],
      unread: [
        { sessionId: "c", threadKey: null, label: "c", timestamp: 50 },
        { sessionId: "d", threadKey: null, label: "d", timestamp: 40 },
      ],
    });
    expect(pickAttentionAfter(grown, cursor)?.item.key).toBe("unread:c:");
    expect(pickAttentionAfter(grown, attentionCursorFor(grown.at(-1)!))?.item.key).toBe("needs-input:a:n3");
  });

  it("returns null for an empty queue", () => {
    expect(pickAttentionAfter([], null)).toBeNull();
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
    const attention = (reviewUnread: boolean, updatedAt: number, reviewSummary?: string) => ({
      needsInput: false,
      mutedNeedsInput: false,
      reviewUnread,
      updatedAt,
      ...(reviewSummary ? { reviewSummary } : {}),
    });
    const tab = (threadKey: string, reviewUnread: boolean, updatedAt: number, reviewSummary?: string) => ({
      threadKey,
      questId: threadKey,
      title: `${threadKey} title`,
      attention: attention(reviewUnread, updatedAt, reviewSummary),
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
            tabs: [tab("q-1", true, 70, "Answer in q-1 | It reads as an open call"), tab("q-2", false, 80)],
            mainAttention: attention(true, 60),
            // The reported case: q-1's unread result is an earlier answer, and the
            // leader later marked q-1 Ready for a quiet check that made nothing
            // unread. The row names the answer, never that later Ready summary.
            threadStatuses: {
              "q-1": {
                kind: "ready",
                label: "Thread Ready",
                threadKey: "q-1",
                summary: "12 PM check quiet",
                messageId: "m",
                timestamp: 1,
                updatedAt: 1,
              },
              main: {
                kind: "ready",
                label: "Thread Ready",
                threadKey: "main",
                summary: "nothing pending",
                messageId: "m",
                timestamp: 1,
                updatedAt: 1,
              },
            },
            activePhaseSummary: [],
          },
        ],
      ]),
    });
    expect(candidates).toEqual([
      // No result text known: the row falls back to its generic label.
      { sessionId: "leader", threadKey: "main", label: "Main", timestamp: 60 },
      {
        sessionId: "leader",
        threadKey: "q-1",
        label: "q-1 title",
        timestamp: 70,
        summary: "Answer in q-1 | It reads as an open call",
      },
    ]);
  });
});

describe("collectUnreadAttention per message", () => {
  it("lists each unread answer of a leader once its notifications are known", () => {
    // Unread is per message: each open answer, report or finished quest is its own item, in
    // its thread, named by the tab's title. Read ones and questions are left out.
    const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, "leader");
    const review = (id: string, threadKey: string, timestamp: number, done = false) =>
      ({
        id,
        category: "review",
        threadKey,
        timestamp,
        messageId: `m-${id}`,
        summary: id,
        done,
      }) as SessionNotification;
    const notifications = [
      review("a1", "q-1", 10),
      review("a2", "q-1", 20),
      review("a3", "main", 30),
      review("read", "q-1", 40, true),
      { id: "ask", category: "needs-input", threadKey: "q-1", timestamp: 50, messageId: null, done: false },
    ] as SessionNotification[];
    const candidates = collectUnreadAttention({
      sdkSessions: [{ sessionId: "leader", state: "connected", cwd: "/", createdAt: 1, isOrchestrator: true }],
      sessionNotifications: new Map([["leader", notifications]]),
      syncedProjectionKeys: new Set([entryId]),
      syncedProjectionValues: new Map([
        [
          entryId,
          {
            currentQuestStateVersion: 1,
            tabState: null,
            tabs: [
              {
                threadKey: "q-1",
                questId: "q-1",
                title: "Relay",
                attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 20 },
              },
            ],
            mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 30 },
            threadStatuses: {},
            activePhaseSummary: [],
          },
        ],
      ]),
    });
    expect(candidates.map((candidate) => [candidate.notification?.id, candidate.threadKey, candidate.label])).toEqual([
      ["a1", "q-1", "Relay"],
      ["a2", "q-1", "Relay"],
      ["a3", "main", "Main"],
    ]);
  });
});

describe("buildSessionAttentionQueue", () => {
  it("keeps only this session's items, in Next's group order and coverage", () => {
    // The feed chip shows one session's queue: its prompts, then its Notify Me
    // results, then its unread threads. Items of other sessions stay out, and
    // a thread already queued for a prompt is not repeated as unread.
    const queue = buildSessionAttentionQueue({
      sessionId: "a",
      sessionName: "Leader",
      sessionNum: 7,
      needsInput: [needsInput("a", "n-old", 100, "q-7").notification, needsInput("a", "n-new", 200).notification],
      notifyMe: [notifyMe("a", "q-2", 50), notifyMe("b", "q-3", 900)],
      unread: [
        { sessionId: "a", threadKey: "q-7", label: "covered", timestamp: 999 },
        { sessionId: "a", threadKey: "q-9", label: "q-9 title", timestamp: 10 },
        { sessionId: "b", threadKey: "q-4", label: "other session", timestamp: 999 },
      ],
    });

    expect(queue.map((item) => item.key)).toEqual([
      "needs-input:a:n-new",
      "needs-input:a:n-old",
      "unread:a:q-9",
      "notify-me:a:q-2:r-q-2",
    ]);
  });
});
