// @vitest-environment jsdom
/**
 * The side column: what the user put there (side chats, other conversations, topic pages), newest
 * first, then the leader's overview, then the topic page it follows. The items and the topic page are
 * a stack (one open, the others as rows); the overview folds on its own. It tells the server which
 * conversations it shows, starts side chats from what's on screen and lists past ones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const setSideViewsOf = vi.hoisted(() => vi.fn());
vi.mock("../../utils/side-views.js", () => ({ setSideViewsOf, getSideViews: () => [] }));
const held = vi.hoisted(() => ({ count: new Map<string, number>(), holds: 0 }));
vi.mock("../../ws.js", () => ({
  holdSessionConnection: (sessionId: string) => {
    held.holds++;
    held.count.set(sessionId, (held.count.get(sessionId) ?? 0) + 1);
    return () => held.count.set(sessionId, held.count.get(sessionId)! - 1);
  },
}));
vi.mock("../library/TopicSidePanel.js", () => ({
  TopicSidePanel: ({ pinnedTopicId }: { pinnedTopicId?: string }) => (
    <div data-testid="mock-topic-page">{pinnedTopicId ?? "followed"}</div>
  ),
  useQuestTopic: () => ({ id: "t1", name: "Relay" }),
}));
vi.mock("./SideConversation.js", () => ({
  SideConversation: ({ threadKey, leaderId }: { threadKey: string; leaderId: string }) => (
    <div data-testid="mock-conversation" data-leader={leaderId}>
      {threadKey}
    </div>
  ),
}));
vi.mock("./NewSideChat.js", () => ({
  NewSideChat: ({ startedFrom, leaderId }: { startedFrom: string | null; leaderId: string }) => (
    <div data-testid="mock-new-chat" data-leader={leaderId}>
      {startedFrom ?? "none"}
    </div>
  ),
}));
// The leaders a side chat can be with: those with topics on (l3's are off).
const noTopicList = () => Promise.reject(new Error("No topic list in this test"));
const topicList = vi.hoisted(() => vi.fn());
vi.mock("../../api/topics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/topics.js")>();
  return { ...actual, topicApi: { ...actual.topicApi, list: topicList } };
});
vi.mock("../library/ArtifactViewer.js", () => ({
  ArtifactViewer: ({ id, version }: { id: string; version?: number }) => (
    <div data-testid="mock-artifact">{`${id} v${version ?? "latest"}`}</div>
  ),
}));
vi.mock("./SideQuest.js", () => ({
  SideQuest: ({ questId }: { questId: string }) => <div data-testid="mock-quest">{questId}</div>,
}));
vi.mock("./SideSession.js", () => ({
  SideSession: ({ sessionId }: { sessionId: string }) => <div data-testid="mock-session">{sessionId}</div>,
}));
vi.mock("./thread-names.js", () => ({
  ThreadOriginName: ({ threadKey }: { threadKey: string }) => <>{`name of ${threadKey}`}</>,
}));
// The overview's own data is tested with LeaderOverview; here the column shows what it is given.
vi.mock("../overview/LeaderOverview.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../overview/LeaderOverview.js")>()),
  useLeaderOverview: () => ({
    leaderId: "leader-1",
    forYou: [],
    running: [
      {
        questId: "q-3",
        title: "Running quest",
        phase: { label: "Work", accent: "green" },
        worker: null,
        phaseSince: null,
        updatedAt: 0,
        topic: null,
      },
    ],
    noteFor: () => undefined,
    countsOf: () => ({ needYou: 0, fresh: 0, running: 0 }),
    open: () => {},
  }),
}));
const threads = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/leader-topics.js")>()),
  useLeaderThreads: () => threads.list,
}));
import { closeSideItem, HOME_ITEM, openInSide, replaceSideItem, useSideColumnStore } from "../../utils/side-column.js";
import { rememberThreads } from "../../utils/leader-topics.js";
import { useLibraryNav } from "../../utils/library-nav.js";
import { markLeaderThreadDisplayed } from "../../utils/thread-viewport.js";
import { useTopicPanel } from "../../utils/topic-panel.js";
import { useStore } from "../../store.js";
import { isRememberedFolded } from "../../utils/remembered-folds.js";
import { SideColumn } from "./SideColumn.js";

afterEach(() => {
  cleanup();
  setSideViewsOf.mockClear();
  useSideColumnStore.setState({ columns: {} });
  useTopicPanel.setState({ panels: {}, sheets: [], focus: null });
  localStorage.clear();
  threads.list = [];
  rememberThreads("l1", []);
  topicList.mockReset();
  topicList.mockImplementation(noTopicList);
});

topicList.mockImplementation(noTopicList);

const rows = () => screen.queryAllByTestId("side-item-row");
const openBodies = () =>
  screen.getAllByTestId("side-item-body").filter((body) => body.closest("[style*='display: none']") === null);

describe("SideColumn", () => {
  it("shows a side chat that became a quest's thread as that quest", () => {
    // Jiayi (Oct 31): once the chat's whole request is a quest's work, the chat and the quest are
    // one conversation; the column shows the quest instead of the chat.
    openInSide("l1", { kind: "conversation", threadKey: "topic:aaaa0001" });
    rememberThreads("l1", [
      {
        id: "aaaa0001-0000",
        key: "topic:aaaa0001",
        name: "Fix the eval stall",
        leaderId: "l1",
        createdAt: 1,
        activityAt: 1,
        quest: "q-9",
      },
    ]);
    render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
    const items = useSideColumnStore.getState().columns.l1!.items;
    expect(items).toEqual([expect.objectContaining({ kind: "conversation", threadKey: "q-9" })]);
  });

  it("shows the overview, then the topic page it follows, each folding on its own and remembered", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    // Jiayi: the leader's overview sits at the top everywhere, the current topic's page under it.
    expect(rows().map((row) => row.textContent)).toEqual(["Topics"]);
    // What runs folds behind its heading until opened.
    const overview = within(screen.getByTestId("side-overview"));
    fireEvent.click(overview.getByTestId("overview-fold"));
    expect(overview.getByTestId("overview-running-row").textContent).toContain("Running quest");
    expect(screen.getByTestId("mock-topic-page").textContent).toBe("followed");
    // Beside the open topic page, the overview takes part of the column; alone, all of it.
    expect(screen.getByTestId("side-overview").className).toContain("max-h-[45%]");
    fireEvent.click(within(rows()[0]!).getByRole("button", { expanded: true }));
    expect(openBodies()).toHaveLength(0);
    expect(screen.getByTestId("side-overview").className).toContain("flex-1");
    fireEvent.click(within(screen.getByTestId("side-overview-row")).getByRole("button", { expanded: true }));
    expect(screen.queryByTestId("side-overview")).toBeNull();
    // Both stay as left: they are remembered per leader.
    expect(useSideColumnStore.getState().columns.l1).toEqual(expect.objectContaining({ open: "" }));
    expect(isRememberedFolded("side-overview:l1")).toBe(true);
  });

  it("stacks items newest first with the topic page last, one open, and opens another by its row", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
      openInSide("l1", { kind: "topic", topicId: "t9" });
    });
    // The topic page it follows is last, under the overview.
    expect(rows().map((row) => row.textContent)).toEqual(["Topic", "q-2 name of q-2", "Topics"]);
    expect(rows().map((row) => row.dataset.open)).toEqual(["true", "false", "false"]);
    expect(openBodies()).toHaveLength(1);
    expect(within(openBodies()[0]!).getByTestId("mock-topic-page").textContent).toBe("t9");

    fireEvent.click(within(rows()[1]!).getByRole("button", { expanded: false }));
    expect(rows()[1]!.dataset.open).toBe("true");
    expect(within(openBodies()[0]!).getByTestId("mock-conversation").textContent).toBe("q-2");
  });

  it("removes an item with its ×, and moves a conversation to the main view", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Open in the main view" }));
    // It leaves the column: the main view shows it now.
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([]);
    expect(window.location.hash).toContain("thread=q-2");
    act(() => {
      openInSide("l1", { kind: "topic", topicId: "t9" });
    });
    fireEvent.click(within(rows()[0]!).getByTestId("side-item-close"));
    expect(useSideColumnStore.getState().columns.l1).toEqual({ items: [], open: HOME_ITEM });
  });

  it("shows an artifact at its version, and moves it to the Library from its row", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "artifact", artifactId: "0f1e2d3c", version: 2, title: "Memory peak report" });
    });
    expect(rows()[0]!.textContent).toBe("Memory peak report");
    expect(within(openBodies()[0]!).getByTestId("mock-artifact").textContent).toBe("0f1e2d3c v2");
    fireEvent.click(screen.getByRole("button", { name: "Open in the Library" }));
    expect(useLibraryNav.getState()).toEqual(expect.objectContaining({ artifactId: "0f1e2d3c", version: 2 }));
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([]);
  });

  it("shows a quest's details and another session's conversation, each moving out to its own view", () => {
    // What a Shift-clicked quest link or session link puts in the column.
    useStore.setState({
      sdkSessions: [
        { sessionId: "worker-9", sessionNum: 9, name: "Probe", state: "connected", cwd: "/", createdAt: 1 },
      ],
    } as never);
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "session", sessionId: "worker-9" });
      openInSide("l1", { kind: "quest", questId: "q-7" });
    });
    expect(within(openBodies()[0]!).getByTestId("mock-quest").textContent).toBe("q-7");
    expect(rows()[1]!.textContent).toContain("#9 Probe");
    fireEvent.click(within(rows()[1]!).getByRole("button", { expanded: false }));
    expect(within(openBodies()[0]!).getByTestId("mock-session").textContent).toBe("worker-9");
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "Open in the main view" }));
    expect(window.location.hash).toContain("session/worker-9");
    useStore.setState({ sdkSessions: [] } as never);
  });

  it("tells the server which conversations it shows, and forgets them when it goes", () => {
    const view = render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    let id = "";
    act(() => {
      id = openInSide("l1", { kind: "conversation", threadKey: "topic:aaaa0001" });
      openInSide("l1", { kind: "topic", topicId: "t9" });
    });
    expect(setSideViewsOf).toHaveBeenLastCalledWith("l1", expect.any(Object), ["topic:aaaa0001"]);
    act(() => closeSideItem("l1", id));
    expect(setSideViewsOf).toHaveBeenLastCalledWith("l1", expect.any(Object), []);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-5" });
    });
    view.unmount();
    expect(setSideViewsOf).toHaveBeenLastCalledWith("l1", expect.any(Object), []);
  });

  it("starts a side chat from the quest on screen", () => {
    const shown = markLeaderThreadDisplayed("l1", "q-7");
    try {
      render(<SideColumn leaderId="l1" threadKey="q-7" variant="docked" />);
      fireEvent.click(screen.getByTestId("side-new-chat"));
      expect(within(openBodies()[0]!).getByTestId("mock-new-chat").textContent).toBe("q-7");
      expect(rows()[0]!.textContent).toContain("New side chat");
    } finally {
      shown();
    }
  });

  it("starts a side chat with another leader, chosen beside New side chat", async () => {
    // Jiayi (Oct 31): reading Daily Leader's page, they wanted a side chat with the Takode leader.
    // The plain button still starts one with this page's leader; the menu beside it picks another.
    topicList.mockResolvedValue({
      leaders: [
        { sessionId: "l1", enabled: true },
        { sessionId: "l2", enabled: true },
        { sessionId: "l3", enabled: false },
      ],
    });
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "l1",
          sessionNum: 1,
          name: "Daily",
          isOrchestrator: true,
          state: "connected",
          cwd: "/",
          createdAt: 1,
        },
        {
          sessionId: "l2",
          sessionNum: 2,
          name: "Takode",
          isOrchestrator: true,
          state: "connected",
          cwd: "/",
          createdAt: 1,
        },
        {
          sessionId: "l3",
          sessionNum: 3,
          name: "Off",
          isOrchestrator: true,
          state: "connected",
          cwd: "/",
          createdAt: 1,
        },
        {
          sessionId: "l4",
          sessionNum: 4,
          name: "Gone",
          isOrchestrator: true,
          archived: true,
          state: "exited",
          cwd: "/",
          createdAt: 1,
        },
        { sessionId: "w5", sessionNum: 5, name: "Worker", state: "connected", cwd: "/", createdAt: 1 },
      ],
    } as never);
    const shown = markLeaderThreadDisplayed("l1", "q-7");
    try {
      render(<SideColumn leaderId="l1" threadKey="q-7" variant="docked" />);
      fireEvent.click(screen.getByTestId("side-new-chat-leader"));
      const choices = await screen.findAllByTestId("side-new-chat-leader-row");
      // This page's leader first; leaders with topics off, archived leaders and workers are not offered.
      expect(choices.map((row) => row.textContent)).toEqual(["#1 Dailythis page", "#2 Takode"]);
      fireEvent.click(choices[1]!);
      expect(screen.queryByTestId("side-new-chat-leaders")).toBeNull();
      const chat = within(openBodies()[0]!).getByTestId("mock-new-chat");
      expect(chat.dataset.leader).toBe("l2");
      expect(chat.textContent).toBe("q-7");
      expect(rows()[0]!.textContent).toContain("New side chat with Takode");
      // A new chat with this page's leader is a separate item, as before.
      fireEvent.click(screen.getByTestId("side-new-chat"));
      expect(within(openBodies()[0]!).getByTestId("mock-new-chat").dataset.leader).toBe("l1");
      expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
        expect.objectContaining({ kind: "new-chat", startedFrom: "q-7" }),
        expect.objectContaining({ kind: "new-chat", startedFrom: "q-7", leaderId: "l2" }),
      ]);
      expect(useSideColumnStore.getState().columns.l1!.items[0]).not.toHaveProperty("leaderId");
      // The chat with l2 keeps l2's connection open, through the same hold once it starts: dropping
      // it in between lost the live messages of the chat's first turn.
      expect(held.count.get("l2")).toBe(1);
      const holds = held.holds;
      const chatId = useSideColumnStore.getState().columns.l1!.items[1]!.id;
      act(() => replaceSideItem("l1", chatId, { kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" }));
      expect(held.holds).toBe(holds);
      expect(held.count.get("l2")).toBe(1);
    } finally {
      shown();
      useStore.setState({ sdkSessions: [] } as never);
    }
  });

  it("shows another leader's side chat as that leader's, over its connection, until it becomes a quest", () => {
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "l2",
          sessionNum: 2,
          name: "Takode",
          isOrchestrator: true,
          state: "connected",
          cwd: "/",
          createdAt: 1,
        },
      ],
    } as never);
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" });
    });
    expect(within(openBodies()[0]!).getByTestId("mock-conversation").dataset.leader).toBe("l2");
    expect(within(rows()[0]!).getByTestId("side-item-leader").getAttribute("title")).toBe("With #2 Takode");
    // The server sends its live messages over l2's connection, as one of l2's side views.
    expect(setSideViewsOf).toHaveBeenCalledWith("l2", expect.any(Object), ["topic:bbbb0001"]);
    expect(setSideViewsOf).toHaveBeenCalledWith("l1", expect.any(Object), []);
    // It reads over l2's connection, which the column keeps open while it holds an l2 item.
    expect(held.count.get("l2")).toBe(1);
    // Moving it out opens it in l2's own view.
    act(() => {
      rememberThreads("l2", [
        {
          id: "bbbb0001",
          key: "topic:bbbb0001",
          name: "Side ask",
          leaderId: "l2",
          createdAt: 1,
          activityAt: 1,
          quest: "q-11",
        },
      ]);
    });
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "q-11", leaderId: "l2" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Open in the main view" }));
    expect(window.location.hash).toContain("session/l2");
    expect(window.location.hash).toContain("thread=q-11");
    rememberThreads("l2", []);
    useStore.setState({ sdkSessions: [] } as never);
  });

  it("lists past side chats under Recent and opens one in the column", () => {
    threads.list = [
      {
        id: "aaaa0001",
        key: "topic:aaaa0001",
        name: "Why threads settle",
        leaderId: "l1",
        createdAt: 1,
        activityAt: 1,
        settledAt: 2,
      },
    ];
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    fireEvent.click(screen.getByTestId("side-recent-chats"));
    fireEvent.click(screen.getByTestId("threads-menu-row"));
    expect(within(openBodies()[0]!).getByTestId("mock-conversation").textContent).toBe("topic:aaaa0001");
    expect(screen.queryByTestId("threads-menu")).toBeNull();
  });

  it("collapses on desktop and closes on a phone", () => {
    const view = render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse the side column" }));
    expect(useTopicPanel.getState().panels.l1).toBe(false);
    view.unmount();
    useTopicPanel.setState({ sheets: ["l1"] });
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="sheet" />);
    fireEvent.click(screen.getByRole("button", { name: "Close the side column" }));
    expect(useTopicPanel.getState().sheets).toEqual([]);
  });
});
