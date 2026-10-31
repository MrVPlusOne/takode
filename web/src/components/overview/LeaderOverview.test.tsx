// @vitest-environment jsdom
/**
 * A leader's overview: what needs the user (from the attention queue) and what runs (from its work
 * board), counted per topic, in the order its Scribe gave and with the Scribe's short notes, while
 * Takode's own data decides what is listed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { OverviewOrder } from "../../../shared/library-topics.js";
import type { NextAttentionItem } from "../../utils/next-attention.js";

const attention = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock("../../hooks/useNextAttention.js", () => ({
  useNextAttention: () => ({ queue: attention.queue, open: () => {} }),
}));
const known = vi.hoisted(() => ({ order: null as OverviewOrder | null }));
vi.mock("../../utils/leader-topics.js", () => ({
  useLeaderTopics: () => ({
    map: { "q-1": { id: "t1", name: "Relay" }, "q-2": { id: "t1", name: "Relay" }, "q-3": { id: "t2", name: "Evals" } },
    topics: {
      t1: { name: "Relay", questIds: ["q-1", "q-2"], activityAt: 1 },
      t2: { name: "Evals", questIds: ["q-3", "q-9"], activityAt: 1 },
    },
  }),
  useOverviewOrder: () => known.order,
  useTopicKeyNamer: () => () => undefined,
  loadLeaderNamesOnce: () => {},
}));
import { useStore } from "../../store.js";
import { LeaderOverview, useLeaderOverview } from "./LeaderOverview.js";

const question = (key: string, sessionId: string, questId: string): NextAttentionItem =>
  ({
    kind: "needs-input",
    key,
    sessionId,
    threadKey: sessionId === "leader" ? questId : "main",
    label: `Question about ${questId}`,
    timestamp: 1,
    entry: {
      sessionId,
      sessionName: "S",
      sessionNum: 1,
      notification: {
        id: key,
        category: "needs-input",
        summary: `Question about ${questId}`,
        timestamp: 1,
        messageId: null,
        done: false,
        questId,
        threadKey: sessionId === "leader" ? questId : "main",
      },
    },
  }) as unknown as NextAttentionItem;
const unread = (key: string, threadKey: string, topic: { id: string; name: string } | null): NextAttentionItem =>
  ({
    kind: "unread",
    key,
    sessionId: "leader",
    threadKey,
    label: `Answer in ${threadKey}`,
    timestamp: 2,
    topic,
  }) as never;

function seed() {
  attention.queue = [
    question("n-own", "leader", "q-1"),
    // Asked by a worker about one of the leader's quests: it needs the user here too.
    question("n-worker", "worker", "q-9"),
    // Another leader's question about its own quest: not this leader's.
    question("n-other", "other-leader", "q-77"),
    unread("u-1", "q-2", { id: "t1", name: "Relay" }),
    unread("u-2", "q-3", { id: "t2", name: "Evals" }),
  ];
  useStore.setState({
    sessionBoards: new Map([
      [
        "leader",
        [
          { questId: "q-1", title: "Relay fix", status: "IMPLEMENTING", updatedAt: 10 },
          { questId: "q-3", title: "Eval sweep", status: "IMPLEMENTING", updatedAt: 20 },
          // Queued, proposed and checkpointed rows are not running: a checkpoint waits on the user.
          { questId: "q-4", title: "Later", status: "QUEUED", updatedAt: 30 },
          { questId: "q-5", title: "Idea", status: "PROPOSED", updatedAt: 40 },
          {
            questId: "q-2",
            title: "Relay layout",
            status: "USER_CHECKPOINTING",
            waitForInput: ["n-9"],
            updatedAt: 50,
          },
        ],
      ],
    ]),
    sessionBoardRowStatuses: new Map([
      ["leader", { "q-3": { worker: { sessionId: "w", sessionNum: 7, status: "running" } } }],
    ]),
  } as never);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  known.order = null;
  useStore.getState().reset();
});

describe("useLeaderOverview", () => {
  it("lists the leader's questions and results, questions about its quests, and its running quests", () => {
    seed();
    const { result } = renderHook(() => useLeaderOverview("leader"));
    expect(result.current.forYou.map((item) => item.key)).toEqual(["n-own", "n-worker", "u-1", "u-2"]);
    expect(result.current.running.map((quest) => quest.questId)).toEqual(["q-3", "q-1"]);
    expect(result.current.running[0]!.topic).toEqual({ id: "t2", name: "Evals" });
    expect(result.current.countsOf({ id: "t1", questIds: ["q-1", "q-2"] })).toEqual({
      needYou: 1,
      fresh: 1,
      running: 1,
    });
    expect(result.current.countsOf({ id: "t2", questIds: ["q-3", "q-9"] })).toEqual({
      needYou: 1,
      fresh: 1,
      running: 1,
    });
  });

  it("follows the Scribe's order, puts what it hasn't ranked first, and shows each note once", () => {
    seed();
    known.order = {
      writtenAt: 1,
      entries: [
        { key: "q-3", note: "Sweep half done; results tonight" },
        { key: "q-9", note: "Worker waits on the eval budget" },
        { key: "q-2" },
        { key: "q-1", note: "Fix is in review" },
      ],
    };
    const { result } = renderHook(() => useLeaderOverview("leader"));
    // In rank order (the list still shows questions before results, each in this order).
    expect(result.current.forYou.map((item) => item.key)).toEqual(["u-2", "n-worker", "u-1", "n-own"]);
    expect(result.current.noteFor(result.current.forYou[1]!)).toBe("Worker waits on the eval budget");
    // q-3's note shows on its result, so its running row has none; q-1's shows on its question.
    expect(result.current.running.map((quest) => [quest.questId, quest.note])).toEqual([
      ["q-3", undefined],
      ["q-1", undefined],
    ]);

    // A question the Scribe hasn't seen yet comes before everything it ranked.
    attention.queue = [question("n-new", "leader", "q-5"), ...attention.queue];
    const { result: next } = renderHook(() => useLeaderOverview("leader"));
    expect(next.current.forYou[0]!.key).toBe("n-new");
  });
});

describe("LeaderOverview", () => {
  it("shows one row per question and per thread with news, named by its quest, the rest folded", () => {
    // Jiayi (phone): the overview was a wall of text. Each row is now one line, named by the quest
    // it is about rather than only its topic, with the question's words or the Scribe's note under
    // it; what runs and the quiet topics wait behind their headings.
    seed();
    useStore.setState({
      quests: [
        { questId: "q-1", title: "Relay fix", status: "in_progress" },
        { questId: "q-2", title: "Relay layout", status: "done" },
      ],
    } as never);
    known.order = { writtenAt: 1, entries: [{ key: "q-2", note: "Layout landed; try it on the phone" }] };
    const { result } = renderHook(() => useLeaderOverview("leader"));
    const topics = [
      { id: "t1", name: "Relay", questIds: ["q-1", "q-2"], activityAt: 1 },
      { id: "t2", name: "Evals", questIds: ["q-3", "q-9"], activityAt: 1 },
      { id: "t3", name: "Quiet", questIds: [], activityAt: 1 },
    ] as never;
    render(<LeaderOverview data={result.current} topics={topics} onOpenQuest={() => {}} onOpenTopic={() => {}} />);
    const rows = screen.getAllByTestId("overview-for-you-row");
    expect(rows).toHaveLength(result.current.needYou + result.current.fresh);
    // Questions alone are under "Needs you"; unread answers are new (Jiayi: amber means questions).
    expect(result.current.needYou).toBe(2);
    expect(within(screen.getByTestId("overview-for-you")).getAllByTestId("overview-for-you-row")).toHaveLength(2);
    expect(within(screen.getByTestId("overview-new")).getAllByTestId("overview-for-you-row")).toHaveLength(2);
    const own = rows.find((row) => row.textContent?.includes("Question about q-1"))!;
    expect(own.textContent).toContain("Relay fix");
    const layout = rows.find((row) => row.textContent?.includes("Relay layout"))!;
    expect(layout.textContent).toContain("1 new");
    expect(within(layout).getByTestId("overview-note").textContent).toBe("Layout landed; try it on the phone");

    // Folded until opened, and remembered on this device.
    expect(screen.queryByTestId("overview-running-row")).toBeNull();
    fireEvent.click(within(screen.getByTestId("overview-running")).getByTestId("overview-fold"));
    expect(screen.getAllByTestId("overview-running-row")[0]!.textContent).toContain("Eval sweep");
    // Only topics with nothing above are listed among the other topics.
    fireEvent.click(within(screen.getByTestId("overview-topics")).getByTestId("overview-fold"));
    expect(screen.getAllByTestId("overview-topic-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Quiet"),
    ]);
    cleanup();
    render(<LeaderOverview data={result.current} topics={topics} onOpenQuest={() => {}} onOpenTopic={() => {}} />);
    expect(screen.getAllByTestId("overview-running-row")).toHaveLength(2);
  });

  it("puts a thread's unread answers on one row", () => {
    attention.queue = [unread("u-1", "q-2", null), unread("u-2", "q-2", null), unread("u-3", "q-3", null)];
    const { result } = renderHook(() => useLeaderOverview("leader"));
    expect(result.current).toMatchObject({ needYou: 0, fresh: 2 });
    render(<LeaderOverview data={result.current} onOpenQuest={() => {}} />);
    expect(screen.queryByTestId("overview-for-you")).toBeNull();
    expect(screen.getAllByTestId("overview-for-you-row")).toHaveLength(2);
  });
});
