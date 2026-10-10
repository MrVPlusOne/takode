// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import type { SessionNotification } from "../types.js";

const mockApi = vi.hoisted(() => ({
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
  getSessionNotifications: vi.fn(),
  setNotificationMuted: vi.fn(),
  snoozeNotification: vi.fn(),
}));
const mockUpdateThreadMonitoring = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../api.js", () => ({ api: mockApi }));
vi.mock("../api/thread-monitoring.js", () => ({ updateThreadMonitoring: mockUpdateThreadMonitoring }));

import { useStore } from "../store.js";
import {
  CLOSE_THREAD_TAB_EVENT,
  attentionItemMenuItems,
  markThreadRead,
  needsInputMenuItems,
} from "./attention-item-menu.js";
import type { NextAttentionItem } from "./next-attention.js";

const prompt = (overrides: Partial<SessionNotification> = {}) =>
  ({
    id: "n-1",
    category: "needs-input",
    summary: "Deploy?",
    timestamp: 1,
    done: false,
    ...overrides,
  }) as SessionNotification;
const labels = (items: { label: string }[]) => items.map((item) => item.label);

function unread(threadKey: string | null, sessionId = "leader"): NextAttentionItem {
  return {
    kind: "unread",
    key: `unread:${sessionId}:${threadKey ?? ""}`,
    sessionId,
    threadKey,
    label: "x",
    timestamp: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.getState().reset();
  useStore.setState({ currentSessionId: "leader" });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: createLeaderThreadTabsProjectionValue({
        tabState: { version: 1, orderedOpenThreadKeys: ["q-1", "q-2"], closedThreadTombstones: [], updatedAt: 1 },
        tabs: [
          createLeaderThreadTabsProjectionTab("q-1", { canClose: true }),
          createLeaderThreadTabsProjectionTab("q-2", { canClose: false }),
        ],
      }),
    }),
  );
});

describe("needsInputMenuItems", () => {
  it("offers mute and timed reminders for an active prompt, unmute when muted and cancel when snoozed", () => {
    // These are the prompt actions that used to sit inline on the row.
    const active = needsInputMenuItems("s1", prompt());
    expect(labels(active)).toEqual(["Mute", "Remind me later"]);
    expect(labels(active[1]!.children!)).toEqual(["15 min", "1 hour", "3 hours", "8 hours"]);
    expect(labels(needsInputMenuItems("s1", prompt({ muted: true })))).toEqual(["Unmute", "Remind me later"]);
    expect(labels(needsInputMenuItems("s1", prompt({ muted: true, snoozedUntil: 5 })))).toEqual(["Cancel snooze"]);
    expect(needsInputMenuItems("s1", prompt({ done: true }))).toEqual([]);
  });
});

describe("attentionItemMenuItems", () => {
  it("offers Acknowledge and Stop tracking for a Notify Me result", () => {
    const entry: ThreadMonitoringEntry = {
      sessionId: "other",
      sessionName: "Other",
      sessionNum: 2,
      threadKey: "q-9",
      title: "q-9",
      trackedAt: 0,
      pending: { id: "7", messageId: "m", timestamp: 1, summary: "done" },
    };
    const items = attentionItemMenuItems({
      kind: "notify-me",
      entry,
      key: "k",
      sessionId: "other",
      threadKey: "q-9",
      label: "q-9",
      timestamp: 1,
    });
    expect(labels(items)).toEqual(["Acknowledge", "Stop tracking"]);
    items[0]!.onClick();
    expect(mockUpdateThreadMonitoring).toHaveBeenCalledWith("other", "q-9", "acknowledge", "7");
  });

  it("offers Close tab only for a closable tab of the session on screen", () => {
    // Only that session's view can close its tabs, and Main never closes.
    expect(labels(attentionItemMenuItems(unread("q-1")))).toEqual(["Mark as read", "Close tab"]);
    expect(labels(attentionItemMenuItems(unread("q-2")))).toEqual(["Mark as read"]);
    expect(labels(attentionItemMenuItems(unread("main")))).toEqual(["Mark as read"]);
    expect(labels(attentionItemMenuItems(unread("q-1", "elsewhere")))).toEqual(["Mark as read"]);

    const closed = vi.fn();
    window.addEventListener(CLOSE_THREAD_TAB_EVENT, closed);
    attentionItemMenuItems(unread("q-1"))[1]!.onClick();
    window.removeEventListener(CLOSE_THREAD_TAB_EVENT, closed);
    expect((closed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sessionId: "leader", threadKey: "q-1" });
  });

  it("reads a session-level unread result through the session read route", () => {
    attentionItemMenuItems(unread(null, "worker"))[0]!.onClick();
    expect(mockApi.markSessionRead).toHaveBeenCalledWith("worker");
  });
});

describe("markThreadRead", () => {
  it("marks done the thread's active Ready results, loading notifications the browser has not seen", async () => {
    // Same notifications viewing the thread clears: its own results and
    // multi-quest summaries that name it, but not other threads' results.
    mockApi.getSessionNotifications.mockResolvedValue([
      { id: "r-1", category: "review", summary: "Thread ready: q-1", timestamp: 1, threadKey: "q-1", done: false },
      { id: "r-2", category: "review", summary: "2 quests ready for review: q-1, q-3", timestamp: 1, done: false },
      { id: "r-3", category: "review", summary: "Thread ready: q-2", timestamp: 1, threadKey: "q-2", done: false },
      { id: "r-4", category: "review", summary: "old", timestamp: 1, threadKey: "q-1", done: true },
    ]);
    await markThreadRead("other", "q-1");
    expect(mockApi.markNotificationDone.mock.calls.map((call) => call[1]).sort()).toEqual(["r-1", "r-2"]);
  });
});
