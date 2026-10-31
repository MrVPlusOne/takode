// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerTap } from "../../test-fixtures/finger-tap.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";

/**
 * The sessions panel's Topics mode, rendered: the topics of the leaders with topics in one list (each
 * row with its leader's picture and counts), the leaders, and the other sessions as cards, in groups
 * that fold. Counts come from the attention list and the running quests each leader's synced tab
 * state carries; opening a row opens that place in its leader.
 */
const topicLists: Record<string, unknown> = {
  takode: {
    topics: [
      {
        id: "aaaaaaaa-1",
        name: "Library",
        questIds: ["q-1"],
        activityAt: 1,
        createdAt: 0,
        interactionAt: 300,
        summary: "",
        latestUpdate: "Oct 30 · Pages refreshed",
      },
      {
        id: "bbbbbbbb-1",
        name: "Chat feed",
        questIds: ["q-2"],
        activityAt: 1,
        createdAt: 0,
        interactionAt: 100,
        summary: "",
      },
    ],
  },
  msi: {
    topics: [
      {
        id: "cccccccc-1",
        name: "T7 run",
        questIds: ["q-3"],
        activityAt: 1,
        createdAt: 0,
        interactionAt: 200,
        summary: "",
      },
    ],
  },
};
vi.mock("../../api/topics.js", () => ({
  topicApi: {
    list: vi.fn(async (_space: string, leader?: string) =>
      leader
        ? topicLists[leader]
        : {
            leaders: [
              { sessionId: "takode", enabled: true },
              { sessionId: "msi", enabled: true },
            ],
          },
    ),
    threads: vi.fn(async () => ({ threads: [] })),
  },
}));
const openItem = vi.fn();
vi.mock("../../hooks/useNextAttention.js", () => ({
  useNextAttention: () => ({
    queue: [
      {
        kind: "needs-input",
        key: "n-1",
        sessionId: "worker",
        entry: { questId: "q-1" },
        threadKey: "q-1",
        label: "Which layout?",
      },
      { kind: "unread", key: "u-1", sessionId: "takode", threadKey: "q-1", label: "q-1", summary: "Pages are live" },
    ],
    open: openItem,
  }),
}));
// Quests are named by their titles in a topic's card.
vi.mock("../../hooks/useAttentionThreadTitles.js", () => ({
  useAttentionThreadTitles: () => ({
    titleFor: (_sessionId: string, key: string) => ({ "q-1": "Library pages", "q-3": "T7 eval sweep" })[key],
    hasThreadTabs: () => true,
  }),
}));
vi.mock("../library/topic-questions.js", () => ({ questOf: (entry: { questId?: string }) => entry.questId ?? null }));
// Stable per leader, as the store's projections are (a store selector must not see a new value each call).
const tabProjections = Object.fromEntries(
  ["takode", "msi"].map((leaderId) => [
    leaderId,
    {
      projectionState: "accepted",
      value: {
        runningQuestIds: leaderId === "msi" ? ["q-3"] : [],
        tabs: [{ threadKey: "q-3", journey: { currentPhaseId: "work" } }],
      },
    },
  ]),
);
vi.mock("../../utils/leader-thread-tabs-resolver.js", () => ({
  resolveLeaderThreadTabsProjection: (_source: unknown, leaderId: string) => tabProjections[leaderId],
}));
const navigate = vi.fn();
const opened = vi.fn();
vi.mock("../../utils/routing.js", () => ({
  navigateToSessionThread: (...args: unknown[]) => navigate(...args),
  threadRouteFromHash: () => ({ hasThreadParam: true, threadKey: "q-1" }),
}));

import { SidebarTopicsMode, useTopicsModeData } from "./SidebarTopicsMode.js";

const node = (id: string, name: string, recentAt: number, isOrchestrator = true) =>
  ({
    leader: { id, name, isOrchestrator, sessionNum: 1, createdAt: 0 },
    workers: [],
    spaceId: "s",
    spaceName: "Space",
    recentAt,
  }) as unknown as RecentSessionNode;

function Harness({ nodes }: { nodes: RecentSessionNode[] }) {
  const data = useTopicsModeData(nodes, true);
  return (
    <SidebarTopicsMode
      data={data}
      currentSessionId="takode"
      onOpen={(leaderId, threadKey) => navigate(leaderId, threadKey)}
      onOpened={opened}
      otherSessions={(others) => <div data-testid="others">{others.map((other) => other.leader.id).join(",")}</div>}
    />
  );
}

describe("SidebarTopicsMode", () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
    opened.mockReset();
    openItem.mockReset();
  });

  it("lists every leader's topics, the leaders and the other sessions", async () => {
    render(
      <Harness nodes={[node("takode", "DevBox", 500), node("msi", "Daily", 400), node("solo", "Solo", 300, false)]} />,
    );
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(3));
    const rows = screen.getAllByTestId("topics-mode-row");
    // Newest interaction first, across leaders; the History line loses its date.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Library"),
      expect.stringContaining("T7 run"),
      expect.stringContaining("Chat feed"),
    ]);
    expect(rows[0]!.textContent).toContain("Pages refreshed");
    expect(rows[0]!.textContent).not.toContain("Oct 30");
    // The place on screen (a quest of Library) is marked.
    expect(rows[0]!.getAttribute("aria-current")).toBe("page");
    // Library: a question from its worker and a new answer. T7 run: one quest running.
    expect(within(rows[0]!).getByTestId("status-count-permission").textContent).toBe("1");
    expect(within(rows[0]!).getByTestId("status-count-unread").textContent).toBe("1");
    expect(within(rows[1]!).getByTestId("status-count-running").textContent).toBe("1");
    // Leaders in the panel's Recent order; the rest stay cards.
    expect(screen.getAllByTestId("topics-mode-leader").map((row) => row.textContent)).toEqual([
      expect.stringContaining("DevBox"),
      expect.stringContaining("Daily"),
    ]);
    expect(screen.getByTestId("others").textContent).toBe("solo");
  });

  it("opens a topic's conversation in its leader, and a leader's Main", async () => {
    render(<Harness nodes={[node("takode", "DevBox", 500), node("msi", "Daily", 400)]} />);
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId("topics-mode-row")[1]!);
    expect(navigate).toHaveBeenCalledWith("msi", "topic:cccccccc");
    fireEvent.click(screen.getAllByTestId("topics-mode-leader")[0]!);
    expect(navigate).toHaveBeenCalledWith("takode", "main");
  });

  it("shows a topic's questions, new results and running quests by quest title on hover, each one click away", async () => {
    render(<Harness nodes={[node("takode", "DevBox", 500), node("msi", "Daily", 400)]} />);
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(3));
    const [library, t7] = screen.getAllByTestId("topics-mode-row");

    fireEvent.pointerOver(library!, { pointerType: "mouse" });
    const card = screen.getByTestId("topic-place-card");
    const items = within(card).getAllByTestId("topic-place-card-item");
    // The question (asked by the quest's worker) and the new answer, each under its quest's title.
    expect(items.map((item) => item.textContent)).toEqual([
      "Library pagesWhich layout?",
      "Library pagesPages are live",
    ]);
    fireEvent.click(items[0]!);
    expect(openItem).toHaveBeenCalledWith(expect.objectContaining({ key: "n-1" }));
    expect(opened).toHaveBeenCalled();
    expect(screen.queryByTestId("topic-place-card")).toBeNull();

    // A running quest opens its thread in its leader.
    fireEvent.pointerOver(t7!, { pointerType: "mouse" });
    const running = within(screen.getByTestId("topic-place-card")).getByTestId("topic-place-card-running");
    expect(running.textContent).toBe("T7 eval sweepWork");
    fireEvent.click(running);
    expect(navigate).toHaveBeenCalledWith("msi", "q-3");
  });

  it("opens the card on touch only by long-press (or right-click), not with a tap's emulated hover", async () => {
    render(<Harness nodes={[node("takode", "DevBox", 500)]} />);
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(2));
    const library = screen.getAllByTestId("topics-mode-row")[0]!;
    // A tap opens the topic, and no card is left over it.
    fingerTap(library);
    expect(navigate).toHaveBeenCalledWith("takode", "topic:aaaaaaaa");
    expect(screen.queryByTestId("topic-place-card")).toBeNull();

    // Pinned: it stays when the mouse leaves the row, and a press outside closes it.
    fireEvent.contextMenu(library);
    expect(screen.getByTestId("topic-place-card")).toBeTruthy();
    fireEvent.pointerOut(library, { pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByTestId("topic-place-card")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("topic-place-card")).toBeNull();
  });

  it("folds a group from its header", async () => {
    render(<Harness nodes={[node("takode", "DevBox", 500)]} />);
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /Leaders/ }));
    expect(screen.queryByTestId("topics-mode-leader")).toBeNull();
  });
});
