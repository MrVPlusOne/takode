// @vitest-environment jsdom
/**
 * The sessions panel's Threads view: every leader's threads (quest threads from each leader's synced
 * tab projection, its other threads, the leader log while Main waits) in one list ordered by what
 * needs the user, each row with its leader's picture, topic and counts; then the leaders and the
 * other sessions. Jiayi: on desktop the panel is a place to see what needs attention across
 * leaders, and a thread they just started must show prominently, not only quest threads.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const queue = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("../../hooks/useNextAttention.js", () => ({ useNextAttention: () => ({ queue: queue.items }) }));
vi.mock("../library/topic-questions.js", () => ({ questOf: (entry: { questId?: string }) => entry.questId ?? null }));
vi.mock("../../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/leader-topics.js")>()),
  useQuestTopicsOf: () => (_leaderId: string, questId: string) =>
    questId === "q-1" ? { id: "t1", name: "Library" } : null,
}));
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../../utils/routing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/routing.js")>()),
  navigateToSessionThread,
}));
import type { LeaderThreadTabsProjectionTab } from "../../../shared/leader-thread-tabs-projection.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { SidebarThreadsMode, threadRows, type LeaderThreadsInput } from "./SidebarThreadsMode.js";

afterEach(() => {
  cleanup();
  queue.items = [];
  navigateToSessionThread.mockReset();
});

function node(id: string, name: string): RecentSessionNode {
  return {
    leader: { id, name, isOrchestrator: true, sessionNum: 7, createdAt: 0 },
    workers: [],
    spaceId: "s",
    spaceName: "Takode",
    recentAt: 0,
  } as unknown as RecentSessionNode;
}

function tab(questId: string, overrides: Partial<LeaderThreadTabsProjectionTab> = {}): LeaderThreadTabsProjectionTab {
  return {
    threadKey: questId,
    questId,
    title: `Quest ${questId}`,
    journey: { currentPhaseId: "work" },
    completed: false,
    updatedAt: 1,
    groupChangedAt: 1,
    ...overrides,
  } as unknown as LeaderThreadTabsProjectionTab;
}

const TAKODE = node("takode", "DevBox takode");
const MSI = node("msi", "Daily Leader");
const LEADERS: LeaderThreadsInput[] = [
  {
    node: TAKODE,
    tabs: [
      tab("q-1", { groupChangedAt: 10 }),
      tab("q-2", { completed: true, groupChangedAt: 50 }),
      tab("q-4", { groupChangedAt: 20 }),
    ],
    runningQuestIds: ["q-4"],
    threads: [
      // Just started: the leader is answering in it.
      {
        id: "aa",
        key: "topic:aa",
        name: "Phone can't reach Takode",
        leaderId: "takode",
        createdAt: 90,
        activityAt: 90,
      },
      {
        id: "bb",
        key: "topic:bb",
        name: "Old question",
        leaderId: "takode",
        createdAt: 5,
        activityAt: 5,
        settledAt: 6,
      },
    ],
    writingThreadKey: "topic:aa",
  },
  {
    node: MSI,
    tabs: [tab("q-3", { completed: true, groupChangedAt: 30 })],
    runningQuestIds: [],
    threads: [],
  },
];

describe("threadRows", () => {
  it("files every leader's threads in the status row's groups: Needs you, Unread, In progress, Idle", () => {
    queue.items = [
      // A worker's question about q-1 counts in q-1.
      { kind: "needs-input", key: "n", sessionId: "worker", entry: { questId: "q-1" }, threadKey: "q-1" },
      { kind: "unread", key: "u", sessionId: "msi", threadKey: "q-3" },
      // Main's answer waits in the leader log.
      { kind: "unread", key: "m", sessionId: "takode", threadKey: "main" },
    ];
    const rows = threadRows(LEADERS, queue.items as never, () => null);
    expect(rows.map((row) => [row.threadKey, row.group])).toEqual([
      ["q-1", "needs-input"],
      ["q-3", "new-results"],
      // Leader log: Main's waiting answer, at the leader's last interaction.
      ["all", "new-results"],
      // In progress only while work goes on: the running quest and the thread the leader answers in.
      ["topic:aa", "in-progress"],
      ["q-4", "in-progress"],
      // Idle: nothing running and nothing unread, newest interaction first.
      ["q-2", "idle"],
      ["topic:bb", "idle"],
    ]);
    const counts = Object.fromEntries(rows.map((row) => [row.threadKey, row.counts]));
    expect(counts["q-1"]).toEqual({ permission: 1, unread: 0, running: 0 });
    expect(counts["q-4"]).toEqual({ permission: 0, unread: 0, running: 1 });
    // The thread the leader is answering in shows as running.
    expect(counts["topic:aa"]).toEqual({ permission: 0, unread: 0, running: 1 });
    expect(rows.find((row) => row.threadKey === "q-4")!.detail).toBe("q-4 · Work");
    expect(rows.find((row) => row.threadKey === "topic:aa")!.detail).toBe("Thread");
  });
});

describe("threadRows across leaders", () => {
  it("lists a quest in two leaders' tabs once, under the leader whose board holds it", () => {
    const rows = threadRows(
      [
        { node: TAKODE, tabs: [tab("q-7", { ownership: "other-leader" })], runningQuestIds: [], threads: [] },
        { node: MSI, tabs: [tab("q-7", { ownership: "own" })], runningQuestIds: [], threads: [] },
      ],
      [],
      () => null,
    );
    expect(rows.map((row) => [row.threadKey, row.leader.leader.id])).toEqual([["q-7", "msi"]]);
  });
});

describe("SidebarThreadsMode", () => {
  it("lists the threads with their leader, topic and counts, then the leaders and other sessions", () => {
    queue.items = [{ kind: "needs-input", key: "n", sessionId: "takode", entry: { questId: "q-1" }, threadKey: "q-1" }];
    const onOpened = vi.fn();
    render(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={onOpened}
        otherSessions={() => <div data-testid="other-sessions" />}
      />,
    );
    const rows = within(screen.getByTestId("threads-mode-threads")).getAllByTestId("threads-mode-row");
    expect(rows[0]!.dataset.threadKey).toBe("q-1");
    expect(within(rows[0]!).getByTestId("threads-mode-topic").textContent).toBe("Library");
    expect(within(rows[0]!).getByTestId("status-count-permission").textContent).toBe("1");
    fireEvent.click(rows[0]!);
    expect(navigateToSessionThread).toHaveBeenCalledWith("takode", "q-1");
    expect(onOpened).toHaveBeenCalled();
    expect(screen.getAllByTestId("threads-mode-leader").map((row) => row.textContent)).toEqual([
      expect.stringContaining("DevBox takode"),
      expect.stringContaining("Daily Leader"),
    ]);
    expect(screen.getByTestId("other-sessions")).toBeTruthy();
  });

  it("shows the newest Idle threads, the rest behind N older", () => {
    const many: LeaderThreadsInput = {
      node: TAKODE,
      tabs: Array.from({ length: 35 }, (_, index) =>
        tab(`q-${index + 10}`, { completed: true, groupChangedAt: index }),
      ),
      runningQuestIds: [],
      threads: [],
    };
    render(
      <SidebarThreadsMode
        data={{ leaders: [many], others: [] }}
        currentSessionId={null}
        onOpened={() => {}}
        otherSessions={() => null}
      />,
    );
    expect(screen.getAllByTestId("threads-mode-row")).toHaveLength(30);
    expect(screen.getAllByTestId("threads-mode-row")[0]!.dataset.threadKey).toBe("q-44");
    fireEvent.click(screen.getByTestId("threads-mode-more"));
    expect(screen.getAllByTestId("threads-mode-row")).toHaveLength(35);
  });
});
