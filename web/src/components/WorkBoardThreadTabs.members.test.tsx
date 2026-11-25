// @vitest-environment jsdom
/**
 * Who the status row holds besides the leader's quest tabs: its other threads, the leader log
 * while something from Main still waits there, and questions other sessions (its workers) ask about
 * its quests, which open the question where it was asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const needsInput = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("../hooks/useGlobalNeedsInputEntries.js", () => ({
  useGlobalNeedsInputEntries: () => ({ entries: needsInput.entries, mutedEntries: [], sdkSessions: [] }),
}));
const openAttentionItem = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useNextAttention.js", () => ({ openAttentionItem }));
const threads = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/leader-topics.js")>()),
  useLeaderThreads: () => threads.list,
}));
import { useStore } from "../store.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { ThreadTabRail, useLeaderThreadMembers, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

afterEach(() => {
  cleanup();
  needsInput.entries = [];
  threads.list = [];
  openAttentionItem.mockReset();
  useLeaderThreadMembers.setState({ byLeader: {} });
});

function chip(threadKey: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    questId: threadKey,
    title: `Title ${threadKey}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
    ...overrides,
  };
}

function question(sessionId: string, sessionNum: number, questId: string, timestamp = 5) {
  return {
    sessionId,
    sessionNum,
    sessionName: `Worker ${sessionNum}`,
    notification: {
      id: `n-${sessionId}`,
      category: "needs-input",
      summary: "Resume?",
      timestamp,
      questId,
      done: false,
    },
  };
}

function renderRail(
  tabs: PrimaryThreadChip[],
  mainState?: PrimaryThreadChip,
  threadStatuses?: Record<string, LeaderThreadStatus>,
) {
  const onSelectThread = vi.fn();
  render(
    <ThreadTabRail
      tabs={tabs}
      mainState={mainState}
      threadStatuses={threadStatuses}
      sessionId="leader"
      currentThreadKey="main"
      onSelectThread={onSelectThread}
      board={{ helpers: null, open: false, dots: [], onToggle: () => {} }}
    />,
  );
  return onSelectThread;
}

const groupTab = (group: string) =>
  screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === group);

describe("ThreadTabRail members", () => {
  it("leaves cancelled quests out of the row and the members Home lists", () => {
    // Jiayi (Nov 1): a cancelled quest showed as "Not on board" in Idle. It leaves every thread
    // list; search, Questmaster, links and its own thread still reach it.
    useStore.getState().upsertQuestTitlePreview({ questId: "q-7", title: "Dropped", version: 2, cancelled: true });
    try {
      renderRail([chip("q-7", { completed: true }), chip("q-8", { completed: true })]);
      expect(groupTab("idle")!.dataset.count).toBe("1");
      expect(useLeaderThreadMembers.getState().byLeader.leader!.map((member) => member.threadKey)).toEqual(["q-8"]);
    } finally {
      useStore.setState({ questTitlePreviews: new Map() });
    }
  });

  it("puts a worker's question about one of the leader's quests under Needs you, opening the question", () => {
    // q-4 is the leader's; q-99 is not, and the leader's own questions are its tabs' already.
    needsInput.entries = [
      question("worker-1", 3301, "q-4"),
      question("worker-2", 3302, "q-99"),
      question("leader", 1, "q-4"),
    ];
    renderRail([chip("q-4", { title: "Compress old histories" }), chip("q-5")]);
    const needs = groupTab("needs-input")!;
    expect(needs.dataset.count).toBe("1");
    fireEvent.contextMenu(needs, { clientX: 1, clientY: 1 });
    const row = within(screen.getByTestId("thread-tab-group-list")).getByTestId("thread-tab-list-row");
    expect(row.dataset.threadKey).toBe("q-4");
    expect(row.textContent).toContain("Compress old histories");
    expect(row.textContent).toContain("Question from #3301");
    fireEvent.click(within(row).getByTestId("thread-tab-list-row-select"));
    expect(openAttentionItem).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "needs-input", sessionId: "worker-1" }),
      expect.anything(),
    );
  });

  it("holds the leader's other threads and the leader log while Main has a question, for Home too", () => {
    threads.list = [
      {
        id: "aa11",
        key: "topic:aa11",
        name: "Tailscale on the phone",
        leaderId: "leader",
        createdAt: 1,
        activityAt: 9,
      },
      // A thread whose first message never arrived is no conversation yet.
      {
        id: "bb22",
        key: "topic:bb22",
        name: "Never sent",
        leaderId: "leader",
        createdAt: 1,
        activityAt: 1,
        empty: true,
      },
    ];
    const onSelect = renderRail([chip("q-4")], chip("main", { questId: undefined, title: "Main", needsInput: true }));
    const keys = useLeaderThreadMembers.getState().byLeader.leader!.map((member) => member.threadKey);
    expect(keys).toEqual(["q-4", "topic:aa11", "all"]);
    // Main's question is read in the leader log.
    fireEvent.click(groupTab("needs-input")!);
    expect(onSelect).toHaveBeenCalledWith("all");
  });

  it("puts an idle thread under Idle and the one the leader is answering in under In progress", () => {
    // Jiayi: idle threads under In progress weren't making progress. A thread is In progress only
    // while the leader writes in it (quests: while the board says they run).
    threads.list = [
      { id: "aa11", key: "topic:aa11", name: "Answering now", leaderId: "leader", createdAt: 1, activityAt: 9 },
      { id: "cc33", key: "topic:cc33", name: "Quiet", leaderId: "leader", createdAt: 1, activityAt: 5 },
    ];
    useStore.setState({
      sessionStatus: new Map([["leader", "running"]]),
      activeTurnRoutes: new Map([["leader", { threadKey: "topic:aa11" }]]),
    } as never);
    try {
      renderRail([]);
      const members = Object.fromEntries(
        useLeaderThreadMembers.getState().byLeader.leader!.map((member) => [member.threadKey, member.running]),
      );
      expect(members).toEqual({ "topic:aa11": true, "topic:cc33": false });
      expect(screen.getAllByTestId("thread-tab-group-chip").map((chip) => chip.dataset.group)).toEqual([
        "idle",
        "in-progress",
      ]);
    } finally {
      useStore.setState({ sessionStatus: new Map(), activeTurnRoutes: new Map() } as never);
    }
  });

  it("counts a thread the leader marked Waiting as In progress, even when its quest is done", () => {
    // Jiayi (Nov 25): a done quest's thread that waits on its side quests sat under Idle. A thread
    // is In progress while the leader's latest status for it is Waiting; Ready or no status is Idle.
    const status = (threadKey: string, kind: "waiting" | "ready"): LeaderThreadStatus => ({
      kind,
      label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
      threadKey,
      summary: "side quests running",
      messageId: `m-${threadKey}`,
      timestamp: 1,
      updatedAt: 1,
    });
    // The board runs no quest: only statuses can make these threads In progress.
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader",
        value: { ...createLeaderThreadTabsProjectionValue(), runningQuestIds: [] },
      }),
    );
    threads.list = [
      {
        id: "aa11",
        key: "topic:aa11",
        name: "Waiting thread",
        leaderId: "leader",
        createdAt: 1,
        activityAt: 9,
        status: status("topic:aa11", "waiting"),
      },
      {
        id: "cc33",
        key: "topic:cc33",
        name: "Ready thread",
        leaderId: "leader",
        createdAt: 1,
        activityAt: 5,
        status: status("topic:cc33", "ready"),
      },
    ];
    try {
      renderRail(
        [chip("q-1", { completed: true }), chip("q-2", { completed: true }), chip("q-3", { completed: true })],
        undefined,
        { "q-1": status("q-1", "waiting"), "q-2": status("q-2", "ready") },
      );
      const running = () =>
        Object.fromEntries(
          useLeaderThreadMembers.getState().byLeader.leader!.map((member) => [member.threadKey, member.running]),
        );
      expect(running()).toEqual({
        "q-1": true,
        "q-2": false,
        "q-3": false,
        "topic:aa11": true,
        "topic:cc33": false,
      });
      // A status sent live replaces the loaded one: the leader marks q-1 Ready and q-3 Waiting.
      act(() => {
        useStore.getState().setThreadStatus("leader", "q-1", status("q-1", "ready"));
        useStore.getState().setThreadStatus("leader", "q-3", status("q-3", "waiting"));
      });
      expect(running()).toMatchObject({ "q-1": false, "q-3": true });
    } finally {
      useStore.setState({ threadStatuses: new Map() } as never);
    }
  });

  it("uses the slim row on desktop and the taller one on phones", () => {
    // Jiayi (Nov 1): desktop is short on height; on phones the tabs are thumb targets.
    const width = window.innerWidth;
    try {
      for (const [innerWidth, slim] of [
        [1440, "true"],
        [390, "false"],
      ] as const) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
        renderRail([chip("q-1")]);
        expect(screen.getByTestId("thread-group-bar").dataset.slim).toBe(slim);
        cleanup();
      }
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});
