// @vitest-environment jsdom
/**
 * Who the status row holds besides the leader's quest tabs: its other threads, the leader log
 * while something from Main still waits there, and questions other sessions (its workers) ask about
 * its quests, which open the question where it was asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function renderRail(tabs: PrimaryThreadChip[], mainState?: PrimaryThreadChip) {
  const onSelectThread = vi.fn();
  render(
    <ThreadTabRail
      tabs={tabs}
      mainState={mainState}
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
        "in-progress",
        "idle",
      ]);
    } finally {
      useStore.setState({ sessionStatus: new Map(), activeTurnRoutes: new Map() } as never);
    }
  });
});
