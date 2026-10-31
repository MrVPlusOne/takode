// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../../hooks/useNextAttention.js", () => ({
  useNextAttention: () => ({
    queue: [
      { kind: "needs-input", sessionId: "worker", entry: { questId: "q-1" }, threadKey: "q-1" },
      { kind: "unread", sessionId: "takode", threadKey: "q-1" },
    ],
  }),
}));
vi.mock("../library/topic-questions.js", () => ({ questOf: (entry: { questId?: string }) => entry.questId ?? null }));
vi.mock("../../utils/leader-thread-tabs-resolver.js", () => ({
  resolveLeaderThreadTabsProjection: (_source: unknown, leaderId: string) => ({
    value: { runningQuestIds: leaderId === "msi" ? ["q-3"] : [] },
  }),
}));
const navigate = vi.fn();
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
      otherSessions={(others) => <div data-testid="others">{others.map((other) => other.leader.id).join(",")}</div>}
    />
  );
}

describe("SidebarTopicsMode", () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
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

  it("folds a group from its header", async () => {
    render(<Harness nodes={[node("takode", "DevBox", 500)]} />);
    await waitFor(() => expect(screen.getAllByTestId("topics-mode-row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /Leaders/ }));
    expect(screen.queryByTestId("topics-mode-leader")).toBeNull();
  });
});
