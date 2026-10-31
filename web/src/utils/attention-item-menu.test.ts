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
const mockSetThreadReminder = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../api/thread-reminders.js", () => ({
  setThreadReminder: mockSetThreadReminder,
  cancelThreadReminder: vi.fn().mockResolvedValue(undefined),
}));
// jsdom lays nothing out, so whether a side column is on screen is the test's choice.
const side = vi.hoisted(() => ({
  onScreen: false,
  openConversationInSide: vi.fn(() => true),
  openQuestInSide: vi.fn(),
  openInSide: vi.fn(),
}));
vi.mock("./side-column.js", () => ({
  canOpenInSide: () => side.onScreen,
  openConversationInSide: side.openConversationInSide,
  openQuestInSide: side.openQuestInSide,
  openInSide: side.openInSide,
}));
const mockWriteClipboardText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./copy-utils.js", () => ({ writeClipboardText: mockWriteClipboardText }));

import { useStore } from "../store.js";
import {
  attentionItemMenuItems,
  markThreadRead,
  needsInputMenuItems,
  overviewTopicMenuItems,
  runningQuestMenuItems,
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
  side.onScreen = false;
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
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "other-leader",
      value: createLeaderThreadTabsProjectionValue({
        tabState: { version: 1, orderedOpenThreadKeys: ["q-1"], closedThreadTombstones: [], updatedAt: 1 },
        tabs: [createLeaderThreadTabsProjectionTab("q-1", { canClose: true })],
      }),
    }),
  );
});

describe("needsInputMenuItems", () => {
  it("offers mute and timed reminders for an active prompt, unmute when muted and cancel when snoozed", () => {
    // These are the prompt actions that used to sit inline on the row.
    const active = needsInputMenuItems("s1", prompt());
    expect(labels(active)).toEqual(["Mute", "Remind me later"]);
    // The attention list's quick choices: soon, later today, or tomorrow morning.
    expect(labels(active[1]!.children!)).toEqual(["30 minutes", "2 hours", "Tomorrow 9 AM"]);
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
    expect(labels(items)).toEqual(["Acknowledge", "Remind me later", "Stop tracking"]);
    items[0]!.onClick();
    expect(mockUpdateThreadMonitoring).toHaveBeenCalledWith("other", "q-9", "acknowledge", "7");
  });

  it("snoozes a reminder that came back: it returns later at the same message, acknowledged until then", async () => {
    // Jiayi: a reminder row offered only Acknowledge and Stop tracking, so it could not be put off again.
    const entry: ThreadMonitoringEntry = {
      sessionId: "leader",
      sessionName: "Leader",
      sessionNum: 1,
      threadKey: "q-9",
      title: "q-9",
      trackedAt: 0,
      pending: { id: "8", messageId: "m-5", timestamp: 1, summary: "Reminder", reminder: true },
    };
    const items = attentionItemMenuItems({
      kind: "notify-me",
      entry,
      key: "k",
      sessionId: "leader",
      threadKey: "q-9",
      label: "q-9",
      timestamp: 1,
    });
    const remind = items.find((item) => item.label === "Remind me later")!;
    remind.children![0]!.onClick();
    await vi.waitFor(() =>
      expect(mockUpdateThreadMonitoring).toHaveBeenCalledWith("leader", "q-9", "acknowledge", "8"),
    );
    expect(mockSetThreadReminder).toHaveBeenCalledWith("leader", "q-9", expect.any(Number), "m-5");
  });

  it("offers no Close tab, even for a tab its leader could close", () => {
    // Tabs are no longer closed from attention lists: with the breadcrumb every place stays in the
    // menus, and leaders with topics off close tabs from their own tab row. q-1 is closable in the
    // seeded projections of both leaders.
    expect(labels(attentionItemMenuItems(unread("q-1")))).toEqual(["Mark as read"]);
    expect(labels(attentionItemMenuItems(unread("q-1", "other-leader")))).toEqual(["Mark as read"]);
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

describe("runningQuestMenuItems", () => {
  it("opens the worker, reminds later and copies the thread link, and opens in the side column only where there is one", () => {
    // Jiayi: Running now rows showed the browser's own menu; they get Takode's like the other rows.
    useStore.setState({ sdkSessions: [{ sessionId: "leader", sessionNum: 12 }] } as never);
    const quest = { leaderId: "leader", questId: "q-3", workerId: "worker", workerNum: 7 };
    const items = runningQuestMenuItems(quest);
    // With no side column on screen, it is not offered.
    expect(labels(items)).toEqual(["Open worker #7", "Remind me later", "Copy link"]);
    items[0]!.onClick();
    expect(window.location.hash).toBe("#/session/worker");
    items[2]!.onClick();
    expect(mockWriteClipboardText).toHaveBeenCalledWith(expect.stringMatching(/#\/session\/12\?thread=q-3$/));

    side.onScreen = true;
    const wide = runningQuestMenuItems(quest);
    expect(labels(wide)).toEqual(["Open in side column", "Open worker #7", "Remind me later", "Copy link"]);
    wide[0]!.onClick();
    expect(side.openConversationInSide).toHaveBeenCalledWith("leader", "q-3");
    // Openings let a dropdown or sheet holding the row close.
    const onLeave = vi.fn();
    runningQuestMenuItems({ ...quest, onLeave })[1]!.onClick();
    expect(onLeave).toHaveBeenCalledTimes(1);
    // Without a worker there is nothing to open there.
    expect(labels(runningQuestMenuItems({ leaderId: "leader", questId: "q-3" }))).not.toContain("Open worker");
  });

  it("reminds about the quest's thread and counts it read until then", async () => {
    runningQuestMenuItems({ leaderId: "leader", questId: "q-3" })
      .find((item) => item.label === "Remind me later")!
      .children![0]!.onClick();
    await vi.waitFor(() =>
      expect(mockSetThreadReminder).toHaveBeenCalledWith("leader", "q-3", expect.any(Number), undefined),
    );
  });
});

describe("overviewTopicMenuItems", () => {
  it("opens the topic's page in the side column where there is one, and copies its conversation's link", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "leader", sessionNum: 12 }] } as never);
    expect(labels(overviewTopicMenuItems("leader", "relay"))).toEqual(["Copy link"]);
    side.onScreen = true;
    const items = overviewTopicMenuItems("leader", "relay");
    expect(labels(items)).toEqual(["Open in side column", "Copy link"]);
    items[0]!.onClick();
    expect(side.openInSide).toHaveBeenCalledWith("leader", { kind: "topic", topicId: "relay" });
    items[1]!.onClick();
    expect(mockWriteClipboardText).toHaveBeenCalledWith(expect.stringContaining("#/session/12?thread=topic"));
  });
});
