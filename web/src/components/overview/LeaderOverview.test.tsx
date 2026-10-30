// @vitest-environment jsdom
/**
 * A leader's overview: what needs the user (from the attention queue) and what runs (from its work
 * board), counted per topic, in the order its Scribe gave and with the Scribe's short notes, while
 * Takode's own data decides what is listed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, within } from "@testing-library/react";
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
          // Queued rows are not running.
          { questId: "q-4", title: "Later", status: "QUEUED", updatedAt: 30 },
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
  it("shows what needs the user, what runs with its worker, and the topics with their counts", () => {
    seed();
    const { result } = renderHook(() => useLeaderOverview("leader"));
    const topics = [
      { id: "t1", name: "Relay", questIds: ["q-1", "q-2"], activityAt: 1 },
      { id: "t2", name: "Evals", questIds: ["q-3", "q-9"], activityAt: 1 },
    ] as never;
    render(<LeaderOverview data={result.current} topics={topics} onOpenQuest={() => {}} onOpenTopic={() => {}} />);
    expect(screen.getByTestId("overview-for-you").textContent).toContain("Question about q-1");
    const rows = screen.getAllByTestId("overview-running-row");
    expect(rows[0]!.textContent).toContain("Eval sweep");
    expect(within(rows[0]!).getByTestId("overview-worker").dataset.status).toBe("running");
    expect(screen.getAllByTestId("topic-counts").map((line) => line.textContent)).toEqual([
      "1 needs you1 new1 running",
      "1 needs you1 new1 running",
    ]);
  });
});
