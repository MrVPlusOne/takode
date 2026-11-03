// @vitest-environment jsdom
/**
 * The side column: what the user put there (side chats, other conversations, topic pages), newest
 * first, then the topic page it follows. Each section folds on its own and the column scrolls when
 * the open ones don't fit, like Logseq's sidebar. It tells the server which conversations it shows
 * and starts side chats from what's on screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../../../shared/leader-thread-tabs-projection.js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const held = vi.hoisted(() => ({ count: new Map<string, number>(), holds: 0 }));
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../ws.js", () => ({
  sendToSession,
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
  NewSideChat: ({ item }: { item: { startedFrom: string | null; leaderId: string } }) => (
    <div data-testid="mock-new-chat" data-leader={item.leaderId}>
      {item.startedFrom ?? "none"}
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
// What a click in a Home does, set by the test.
const homeClick = vi.hoisted(() => ({ current: () => {} }));
vi.mock("./SideHome.js", () => ({
  SideHome: ({ leaderId }: { leaderId: string }) => (
    <button type="button" data-testid="mock-home" onClick={() => homeClick.current()}>
      {leaderId}
    </button>
  ),
}));
vi.mock("./thread-names.js", () => ({
  ThreadOriginName: ({ threadKey }: { threadKey: string }) => <>{`name of ${threadKey}`}</>,
}));
const threads = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/leader-topics.js")>()),
  useLeaderThreads: () => threads.list,
}));
import { closeSideItem, openInSide, replaceSideItem, useSideColumnStore } from "../../utils/side-column.js";
import { rememberThreads } from "../../utils/leader-topics.js";
import { useLibraryNav } from "../../utils/library-nav.js";
import { markLeaderThreadDisplayed } from "../../utils/thread-viewport.js";
import { showMainView } from "../../utils/side-column.js";
import { useTopicPanel } from "../../utils/topic-panel.js";
import { useStore } from "../../store.js";
import { isRememberedFolded } from "../../utils/remembered-folds.js";
import { SideColumn } from "./SideColumn.js";
import { focusedChat, MAIN_CHAT, sideChatId, useChatFocusStore } from "../../utils/chat-focus.js";

afterEach(() => {
  cleanup();
  sendToSession.mockClear();
  useStore.setState({ threadWindows: new Map(), threadWindowMessages: new Map() } as never);
  useSideColumnStore.setState({
    items: [],
    focus: undefined,
    focusAt: undefined,
    used: undefined,
    chatHeight: undefined,
    oneAtATime: undefined,
  });
  useChatFocusStore.setState({ focused: MAIN_CHAT, sideChats: [] });
  useTopicPanel.setState({ open: true, sheet: false, focus: null });
  localStorage.clear();
  threads.list = [];
  rememberThreads("l1", []);
  topicList.mockReset();
  topicList.mockImplementation(noTopicList);
});

topicList.mockImplementation(noTopicList);

const rows = () => screen.queryAllByTestId("side-item-row");
/** The id of the item at a row of the column (Topics last, with no item). */
const rowsId = (index: number) => useSideColumnStore.getState().items[index]!.id;
/** The server's answer to a request for a conversation's newest window, as it lands in the store. */
const landThreadWindow = (sessionId: string, threadKey: string) =>
  act(() =>
    useStore.getState().setThreadWindow(sessionId, threadKey, {
      thread_key: threadKey,
      from_item: 0,
      item_count: 0,
      total_items: 0,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 0,
      section_item_count: 10,
      visible_item_count: 3,
    }),
  );
const openBodies = () =>
  screen.getAllByTestId("side-item-body").filter((body) => body.closest("[style*='display: none']") === null);

describe("SideColumn", () => {
  it("keeps what was put there when the main view switches leader; Topics follow the main view", () => {
    // Jiayi (Nov 1): one column across leaders. A chat put on the side to follow its next update
    // stays when the main view switches to another leader or to a worker's session.
    const view = render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    });
    view.rerender(<SideColumn leaderId="l2" threadKey="main" variant="docked" />);
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("q-1"), "Topics"]);
    expect(within(openBodies()[0]!).getByTestId("mock-conversation").dataset.leader).toBe("l1");
    // A worker's session with no leader: no Topics, the chat still there.
    view.rerender(<SideColumn leaderId={null} threadKey="main" variant="docked" />);
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("q-1")]);
  });

  it("shows a side chat that became a quest's thread as that quest", () => {
    // Jiayi (Oct 31): once the chat's whole request is a quest's work, the chat and the quest are
    // one conversation; the column shows the quest instead of the chat.
    openInSide({ kind: "conversation", threadKey: "topic:aaaa0001", leaderId: "l1" });
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
    // Jiayi (Oct 31): the pane went to a loading page as the chat turned into the quest. It keeps
    // showing the chat while the quest's messages are fetched, then turns into the quest in place.
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "topic:aaaa0001" }),
    ]);
    expect(sendToSession).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ type: "thread_window_request", thread_key: "q-9", activate_view: false }),
    );
    landThreadWindow("l1", "q-9");
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "q-9" }),
    ]);
  });

  it("turns a merged thread into its conversation in place, and drops another pane already showing it", () => {
    // A thread the Scribe joined onto an earlier one stays where the user had it in the column;
    // the earlier thread's own pane goes, so the conversation shows once, where the user was reading.
    openInSide({ kind: "conversation", threadKey: "topic:aaaa0002", leaderId: "l1" });
    openInSide({ kind: "topic", topicId: "t9", leaderId: "l1" });
    openInSide({ kind: "conversation", threadKey: "topic:aaaa0003", leaderId: "l1" });
    const chat = useSideColumnStore.getState().items[0]!.id;
    rememberThreads("l1", [
      { id: "aaaa0002-0000", key: "topic:aaaa0002", name: "Earlier", leaderId: "l1", createdAt: 1, activityAt: 1 },
      {
        id: "aaaa0003-0000",
        key: "topic:aaaa0003",
        name: "Later",
        leaderId: "l1",
        createdAt: 2,
        activityAt: 2,
        joinedInto: "topic:aaaa0002",
      },
    ]);
    landThreadWindow("l1", "topic:aaaa0002");
    render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ id: chat, kind: "conversation", threadKey: "topic:aaaa0002" }),
      expect.objectContaining({ kind: "topic", topicId: "t9" }),
    ]);
  });

  it("shows the topic page it follows, folding on its own and remembered", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    expect(rows().map((row) => row.textContent)).toEqual(["Topics"]);
    expect(screen.getByTestId("mock-topic-page").textContent).toBe("followed");
    const openSections = () =>
      screen
        .getAllByTestId("side-section")
        .flatMap((section) => (section.dataset.open === "true" ? [section.dataset.section] : []));
    expect(openSections()).toEqual(["home"]);
    fireEvent.click(within(rows()[0]!).getByRole("button", { expanded: true }));
    expect(openSections()).toEqual([]);
    expect(isRememberedFolded("side:home")).toBe(true);
  });

  it("stacks items newest first with the topic page last, each folding on its own", () => {
    // Jiayi (Oct 31): like Logseq, any number can be open; the column scrolls when they don't fit.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      openInSide({ kind: "topic", topicId: "t9", leaderId: "l1" });
    });
    // The topic page it follows is last.
    expect(rows().map((row) => row.textContent)).toEqual(["Topic", "q-2 name of q-2", "Topics"]);
    expect(rows().map((row) => row.dataset.open)).toEqual(["true", "true", "true"]);
    expect(within(openBodies()[0]!).getByTestId("mock-topic-page").textContent).toBe("t9");
    expect(within(openBodies()[1]!).getByTestId("mock-conversation").textContent).toBe("q-2");
    expect(screen.getByTestId("side-scroll").className).toContain("overflow-y-auto");

    // Folding one leaves the others open; opening it again from elsewhere unfolds it.
    fireEvent.click(within(rows()[1]!).getByRole("button", { expanded: true }));
    expect(rows().map((row) => row.dataset.open)).toEqual(["true", "false", "true"]);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    expect(rows().map((row) => row.dataset.open)).toEqual(["true", "true", "true"]);
  });

  it("sets an open section's height from its bottom edge, remembered, and back with a double-click", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    const id = useSideColumnStore.getState().items[0]!.id;
    const section = screen.getAllByTestId("side-section")[0]!;
    const body = within(section).getByTestId("side-section-body");
    body.getBoundingClientRect = () => ({ height: 300 }) as DOMRect;
    const edge = within(section).getByRole("separator");
    fireEvent.keyDown(edge, { key: "ArrowDown" });
    expect(body.style.height).toBe("324px");
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!).side.heights).toEqual({ [id]: 324 });
    fireEvent.doubleClick(edge);
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!).side.heights).toEqual({});
  });

  it("starts a new thread as tall as the side conversation last resized", () => {
    // Jiayi (Nov 1): new threads always started at one height, taller or shorter than they like.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    const resized = screen.getAllByTestId("side-section")[0]!;
    const body = within(resized).getByTestId("side-section-body");
    body.getBoundingClientRect = () => ({ height: 300 }) as DOMRect;
    fireEvent.keyDown(within(resized).getByRole("separator"), { key: "ArrowDown" });
    expect(useSideColumnStore.getState().chatHeight).toBe(324);
    // A page resized afterwards doesn't count: it is not a conversation.
    act(() => {
      openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    });
    const page = screen.getAllByTestId("side-section")[0]!;
    within(page).getByTestId("side-section-body").getBoundingClientRect = () => ({ height: 100 }) as DOMRect;
    fireEvent.keyDown(within(page).getByRole("separator"), { key: "ArrowDown" });
    expect(useSideColumnStore.getState().chatHeight).toBe(324);
    act(() => {
      openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    });
    const fresh = screen.getAllByTestId("side-section")[0]!;
    expect(within(fresh).getByTestId("side-section-body").style.height).toBe("324px");
  });

  it("removes an item with its ×, and moves a conversation to the main view", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Open in the main view" }));
    // It leaves the column: the main view shows it now.
    expect(useSideColumnStore.getState().items).toEqual([]);
    expect(window.location.hash).toContain("thread=q-2");
    act(() => {
      openInSide({ kind: "topic", topicId: "t9", leaderId: "l1" });
    });
    fireEvent.click(within(rows()[0]!).getByTestId("side-item-close"));
    expect(useSideColumnStore.getState().items).toEqual([]);
  });

  it("shows a leader's Home, keeps its leader connected, and moves it to the main view", () => {
    // Jiayi (Nov 1): a leader's Home moves between the main view and the column, like a chat.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "home", leaderId: "l2" });
    });
    expect(within(openBodies()[0]!).getByTestId("mock-home").textContent).toBe("l2");
    expect(rows()[0]!.textContent).toContain("Home");
    expect(held.count.get("l2")).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open in the main view" }));
    expect(useSideColumnStore.getState().items).toEqual([]);
    expect(window.location.hash).toContain("/session/l2");
    expect(window.location.hash).toContain("thread=main");
    expect(held.count.get("l2")).toBe(0);
  });

  it("opens what is clicked in a Home elsewhere, not in the Home's pane", () => {
    // A Home beside the main view is a switcher: unlike other panes, its clicks don't replace it.
    // Its rows open in the main view; the open-in-side click on one adds the conversation.
    homeClick.current = () => openInSide({ kind: "conversation", threadKey: "q-5", leaderId: "l1" });
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "home", leaderId: "l1" });
    });
    fireEvent.click(screen.getByTestId("mock-home"));
    expect(useSideColumnStore.getState().items.map((item) => item.kind)).toEqual(["conversation", "home"]);
  });

  it("shows an artifact at its version, and moves it to the Library from its row", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "artifact", artifactId: "0f1e2d3c", version: 2, title: "Memory peak report" });
    });
    expect(rows()[0]!.textContent).toBe("Memory peak report");
    expect(within(openBodies()[0]!).getByTestId("mock-artifact").textContent).toBe("0f1e2d3c v2");
    fireEvent.click(screen.getByRole("button", { name: "Open in the Library" }));
    expect(useLibraryNav.getState()).toEqual(expect.objectContaining({ artifactId: "0f1e2d3c", version: 2 }));
    expect(useSideColumnStore.getState().items).toEqual([]);
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
      openInSide({ kind: "session", sessionId: "worker-9" });
      openInSide({ kind: "quest", questId: "q-7" });
    });
    expect(within(openBodies()[0]!).getByTestId("mock-quest").textContent).toBe("q-7");
    expect(rows()[1]!.textContent).toContain("#9 Probe");
    expect(within(openBodies()[1]!).getByTestId("mock-session").textContent).toBe("worker-9");
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "Open in the main view" }));
    expect(window.location.hash).toContain("session/worker-9");
    useStore.setState({ sdkSessions: [] } as never);
  });

  it("keeps at most three conversations open, and a folded one unmounted, unsubscribed and disconnected", () => {
    // Jiayi (Nov 1): every open conversation costs a mounted feed, live messages and its leader's
    // connection. A fourth folds the oldest, which then costs nothing until it is opened again.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" });
    });
    const mounted = () => screen.queryAllByTestId("mock-conversation").map((element) => element.textContent);
    expect(mounted().sort()).toEqual(["q-2", "q-3", "topic:bbbb0001"]);
    expect(held.count.get("l2")).toBe(1);
    // Folding l2's conversation unmounts it (dropping its live messages) and its leader's connection.
    const holdsBefore = held.holds;
    const l2Row = rows().find((row) => row.textContent?.includes("topic:bbbb0001"))!;
    fireEvent.click(within(l2Row).getByRole("button", { expanded: true }));
    expect(mounted().sort()).toEqual(["q-2", "q-3"]);
    expect(held.count.get("l2")).toBe(0);
    // l1 keeps the hold it had: taking it again would have reconnected it.
    expect(held.holds).toBe(holdsBefore);
    expect(held.count.get("l1")).toBe(1);
  });

  it("starts a side chat from the quest on screen", () => {
    const shown = markLeaderThreadDisplayed("l1", "q-7");
    const mainView = showMainView("l1", "q-7");
    try {
      render(<SideColumn leaderId="l1" threadKey="q-7" variant="docked" />);
      fireEvent.click(screen.getByTestId("side-new-chat"));
      expect(within(openBodies()[0]!).getByTestId("mock-new-chat").textContent).toBe("q-7");
      expect(rows()[0]!.textContent).toContain("New thread");
    } finally {
      shown();
      mainView();
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
    const mainView = showMainView("l1", "q-7");
    try {
      render(<SideColumn leaderId="l1" threadKey="q-7" variant="docked" />);
      // The chooser's button names whose thread plain New thread starts (Jiayi, Nov 1: a lone
      // triangle didn't), here this page's leader.
      expect(screen.getByTestId("side-new-chat-leader").getAttribute("aria-label")).toBe(
        "New thread with #1 Daily: choose another leader",
      );
      fireEvent.click(screen.getByTestId("side-new-chat-leader"));
      const choices = await screen.findAllByTestId("side-new-chat-leader-row");
      // This page's leader first; leaders with topics off, archived leaders and workers are not offered.
      expect(choices.map((row) => row.textContent)).toEqual(["#1 Dailythis page", "#2 Takode"]);
      fireEvent.click(choices[1]!);
      expect(screen.queryByTestId("side-new-chat-leaders")).toBeNull();
      const chat = within(openBodies()[0]!).getByTestId("mock-new-chat");
      expect(chat.dataset.leader).toBe("l2");
      expect(chat.textContent).toBe("q-7");
      expect(rows()[0]!.textContent).toContain("New thread with Takode");
      // A new chat with this page's leader is a separate item, as before.
      fireEvent.click(screen.getByTestId("side-new-chat"));
      expect(within(openBodies()[0]!).getByTestId("mock-new-chat").dataset.leader).toBe("l1");
      expect(useSideColumnStore.getState().items).toEqual([
        expect.objectContaining({ kind: "new-chat", startedFrom: "q-7", leaderId: "l1" }),
        expect.objectContaining({ kind: "new-chat", startedFrom: "q-7", leaderId: "l2", startedIn: "l1" }),
      ]);
      // The chat with l2 keeps l2's connection open, through the same hold once it starts: dropping
      // it in between lost the live messages of the chat's first turn.
      expect(held.count.get("l2")).toBe(1);
      const holds = held.holds;
      const chatId = useSideColumnStore.getState().items[1]!.id;
      act(() => replaceSideItem(chatId, { kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" }));
      expect(held.holds).toBe(holds);
      expect(held.count.get("l2")).toBe(1);
    } finally {
      shown();
      mainView();
      useStore.setState({ sdkSessions: [] } as never);
    }
  });

  it("puts the leader's portrait beside a conversation's status dot, not on other items", () => {
    // Jiayi (Nov 1): a side pane's title bar names whose conversation it is with the leader's
    // portrait, as Threads view rows do; the status dot and quest link stay.
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "l1",
          sessionNum: 1,
          name: "DevBox takode",
          isOrchestrator: true,
          state: "connected",
          cwd: "/",
          createdAt: 1,
          leaderProfilePortrait: {
            id: "tako1-01",
            poolId: "tako",
            label: "Tako 1.1",
            smallUrl: "/leader-profile-portraits/tako/tako1-01.v2.96.webp",
            largeUrl: "/leader-profile-portraits/tako/tako1-01.v2.320.webp",
            smallSize: 96,
            largeSize: 320,
            smallBytes: 2912,
            largeBytes: 19216,
          },
        },
      ],
    } as never);
    try {
      render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
      act(() => {
        openInSide({ kind: "conversation", threadKey: "q-5", leaderId: "l1" });
      });
      const row = rows()[0]!;
      expect(within(row).getByTestId("side-item-dot")).toBeTruthy();
      expect(within(row).getByTestId("side-item-leader").getAttribute("title")).toBe("With #1 DevBox takode");
      // The Topics section is not a conversation: no portrait.
      expect(within(rows().at(-1)!).queryByTestId("side-item-leader")).toBeNull();
    } finally {
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
          leaderProfilePortrait: {
            id: "tako1-01",
            poolId: "tako",
            label: "Tako 1.1",
            smallUrl: "/leader-profile-portraits/tako/tako1-01.v2.96.webp",
            largeUrl: "/leader-profile-portraits/tako/tako1-01.v2.320.webp",
            smallSize: 96,
            largeSize: 320,
            smallBytes: 2912,
            largeBytes: 19216,
          },
        },
      ],
    } as never);
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" });
    });
    expect(within(openBodies()[0]!).getByTestId("mock-conversation").dataset.leader).toBe("l2");
    expect(within(rows()[0]!).getByTestId("side-item-leader").getAttribute("title")).toBe("With #2 Takode");
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
      landThreadWindow("l2", "q-11");
    });
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "q-11", leaderId: "l2" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Open in the main view" }));
    expect(window.location.hash).toContain("session/l2");
    expect(window.location.hash).toContain("thread=q-11");
    rememberThreads("l2", []);
    useStore.setState({ sdkSessions: [] } as never);
  });

  it("shows what waits on the user in each conversation: amber for a question, blue for unread", () => {
    // Jiayi (Oct 31): a quest at a User Checkpoint showed a green dot, as if its worker were still
    // working. Its row shows the question instead; an unfinished quest with nothing waiting is grey.
    const note = (id: string, threadKey: string, category: "needs-input" | "review") => ({
      id,
      category,
      summary: "",
      timestamp: 1,
      threadKey,
      questId: threadKey,
      done: false,
    });
    useStore.setState({
      sessionNotifications: new Map([["l1", [note("n-1", "q-1", "needs-input"), note("n-2", "q-2", "review")]]]),
    } as never);
    try {
      render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
      act(() => {
        openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
        openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
        openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
      });
      const groups = rows()
        .slice(0, 3)
        .map((row) => within(row).getByTestId("side-item-dot").dataset.group);
      expect(groups).toEqual(["needs-input", "new-results", "idle"]);
      // The amber bell that marks questions elsewhere, not a text label (Jiayi, Oct 31).
      expect(within(rows()[0]!).getByTestId("side-item-questions").getAttribute("aria-label")).toBe(
        "A question for you",
      );
      expect(within(rows()[0]!).getByTestId("side-item-questions").className).toContain("text-cc-attention");
      expect(within(rows()[0]!).getByTestId("side-item-questions").querySelector("svg")).not.toBeNull();
      expect(within(rows()[1]!).queryByTestId("side-item-questions")).toBeNull();
      expect(within(rows()[2]!).getByTestId("side-item-dot").className).not.toContain("success");
    } finally {
      useStore.setState({ sessionNotifications: new Map() } as never);
    }
  });

  it("shows a running conversation's dot green, as its status group does", () => {
    // Jiayi (Oct 31): the side copy of a thread working in the main view showed the idle grey dot.
    // The leader writing in the thread counts as running, as in the status row.
    useStore.setState({
      activeTurnRoutes: new Map([["l1", { threadKey: "q-7" }]]),
      sessionStatus: new Map([["l1", "running"]]),
    } as never);
    try {
      render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
      act(() => {
        openInSide({ kind: "conversation", threadKey: "q-8", leaderId: "l1" });
        openInSide({ kind: "conversation", threadKey: "q-7", leaderId: "l1" });
      });
      const groups = rows()
        .slice(0, 2)
        .map((row) => within(row).getByTestId("side-item-dot").dataset.group);
      expect(groups).toEqual(["in-progress", "idle"]);
    } finally {
      useStore.setState({ activeTurnRoutes: new Map(), sessionStatus: new Map() } as never);
    }
  });

  it("colors a quest's dot only by its status group, never by its Questmaster status, and links its number", () => {
    // Jiayi (Oct 31): a finished quest's row showed a purple dot, Questmaster's "done" color. Status
    // dots use the four group colors only; a done quest, or one in Memory, with nothing waiting is Idle.
    useStore.setState({
      quests: [
        { questId: "q-5", title: "Finished", status: "done", version: 1 },
        { questId: "q-6", title: "In Memory", status: "in_progress", version: 1 },
      ],
    } as never);
    try {
      render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
      act(() => {
        openInSide({ kind: "quest", questId: "q-6" });
        openInSide({ kind: "conversation", threadKey: "q-5", leaderId: "l1" });
      });
      for (const row of rows().slice(0, 2)) {
        const dot = within(row).getByTestId("side-item-dot");
        expect(dot.dataset.group).toBe("idle");
        expect(dot.className).toContain("bg-cc-muted/60");
        expect(dot.className).not.toContain("status-done");
      }
      // The quest number is a quest link (hover preview, click opens it) and doesn't fold the row.
      const link = within(rows()[0]!).getByRole("link", { name: "q-5" });
      expect(link.getAttribute("href")).toContain("q-5");
      fireEvent.click(link);
      expect(rows()[0]!.dataset.open).toBe("true");
      expect(within(rows()[1]!).getByRole("link", { name: "q-6" })).toBeTruthy();
    } finally {
      useStore.setState({ quests: [] } as never);
    }
  });

  it("marks a side quest on its title bar as the main view's strip does, open or folded", () => {
    // Jiayi (Nov 2): a side quest's chat lost its side-quest mark when put in the side column.
    const tab = {
      threadKey: "q-5",
      questId: "q-5",
      title: "Next eval versions",
      boardStatus: null,
      journey: null,
      sourceLeaderSessionId: "l1",
      sourceRowCreatedAt: null,
      workerSessionId: null,
      workerSessionNum: null,
      ownership: null,
      active: false,
      queued: false,
      proposed: false,
      neverStartedScheduled: false,
      completed: false,
      canClose: false,
      attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 1, changedAt: 1 },
      updatedAt: 1,
      groupChangedAt: 1,
      sideQuestOf: "q-4",
    };
    useStore.getState().applySyncedProjectionSnapshot({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "l1",
      generation: "side-quest",
      revision: 1,
      value: {
        currentQuestStateVersion: 1,
        tabState: { version: 1 },
        tabs: [tab, { ...tab, threadKey: "q-6", questId: "q-6", sideQuestOf: undefined }],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
        threadStatuses: {},
        activePhaseSummary: [],
      } as never,
    });
    render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-6", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-5", leaderId: "l1" });
    });
    const rowOf = (questId: string) => rows().find((row) => row.textContent?.includes(questId))!;
    expect(within(rowOf("q-5")).getByTestId("side-quest-icon").getAttribute("aria-label")).toBe("Side quest of q-4");
    expect(within(rowOf("q-6")).queryByTestId("side-quest-icon")).toBeNull();
    // Folded, it keeps the mark.
    fireEvent.click(within(rowOf("q-5")).getByRole("button", { expanded: true }));
    expect(within(rowOf("q-5")).getByTestId("side-quest-icon")).toBeTruthy();
  });

  it("shows chats one at a time when switched on: one click opens a chat, at one shared height", () => {
    // Jiayi (Nov 2): the side chats act as a tab group stacked as an accordion and share one height,
    // so more chats don't make each shorter; pages, Topics and the column's scrolling are as before.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
      openInSide({ kind: "topic", topicId: "t9", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    const toggle = screen.getByTestId("side-one-at-a-time");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const open = () => rows().map((row) => row.dataset.open);
    // q-2, the page, q-3, Topics: the page and Topics stay open.
    expect(open()).toEqual(["true", "true", "false", "true"]);
    fireEvent.click(within(rows()[2]!).getByRole("button", { expanded: false }));
    expect(open()).toEqual(["false", "true", "true", "true"]);
    // Resizing the open chat sets the height every chat shares; edges and the scroll strip stay.
    const chatSection = () =>
      screen.getAllByTestId("side-section").find((section) => section.dataset.section === rowsId(2))!;
    const body = within(chatSection()).getByTestId("side-section-body");
    expect(within(body).getByTestId("side-scroll-strip")).toBeTruthy();
    body.getBoundingClientRect = () => ({ height: 300 }) as DOMRect;
    fireEvent.keyDown(within(chatSection()).getByRole("separator"), { key: "ArrowDown" });
    expect(useSideColumnStore.getState().chatHeight).toBe(324);
    fireEvent.click(within(rows()[0]!).getByRole("button", { expanded: false }));
    const q2 = screen.getAllByTestId("side-section").find((section) => section.dataset.section === rowsId(0))!;
    expect(within(q2).getByTestId("side-section-body").style.height).toBe("324px");
    // The open chat folds with a click on its title bar: none need be open (Jiayi, Nov 3).
    fireEvent.click(within(rows()[0]!).getByRole("button", { expanded: true }));
    expect(open()).toEqual(["false", "true", "false", "true"]);
    // Off, chats open side by side again.
    fireEvent.click(toggle);
    fireEvent.click(within(rows()[0]!).getByRole("button", { expanded: false }));
    fireEvent.click(within(rows()[2]!).getByRole("button", { expanded: false }));
    expect(open()).toEqual(["true", "true", "true", "true"]);
  });

  it("scrolls the whole column from the strip beside each section's content, on desktop only", () => {
    // Jiayi (Oct 31): the column scrolls and so does each conversation in it, and a wheel over a
    // conversation moves only that conversation. The strip moves the column, whatever is beside it.
    // It sits only beside a section's content; header rows keep the full width (later the same day).
    const view = render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    const body = screen.getAllByTestId("side-section-body")[0]!;
    expect(within(body).getByTestId("side-scroll-strip")).toBeTruthy();
    expect(screen.getAllByTestId("side-scroll-strip")).toHaveLength(screen.getAllByTestId("side-section-body").length);
    const scroller = screen.getByTestId("side-scroll");
    const scrollBy = vi.fn();
    Object.defineProperty(scroller, "scrollBy", { value: scrollBy });
    Object.defineProperty(scroller, "clientHeight", { value: 400 });
    const strip = within(body).getByTestId("side-scroll-strip");
    fireEvent.wheel(strip, { deltaY: 120 });
    fireEvent.wheel(strip, { deltaY: 3, deltaMode: 1 });
    fireEvent.wheel(strip, { deltaY: -1, deltaMode: 2 });
    expect(scrollBy.mock.calls.map(([options]) => options.top)).toEqual([120, 48, -400]);
    view.unmount();
    useTopicPanel.setState({ sheet: true });
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="sheet" />);
    expect(screen.queryByTestId("side-scroll-strip")).toBeNull();
  });

  it("makes a side pane the focused chat when opened or clicked, and gives focus back to the main view when it folds", () => {
    // Jiayi (Oct 31): one focused chat at a time, like OS windows. Opening a conversation beside
    // the main view focuses it; a click anywhere in a pane focuses it; scrolling does not. The
    // focused pane is marked; a pane that leaves the screen hands focus back to the main view.
    render(<SideColumn leaderId="l1" threadKey="main" variant="docked" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
    });
    const [newer, older] = useSideColumnStore.getState().items;
    expect(focusedChat()).toBe(sideChatId(newer!.id));
    const chats = () =>
      screen.getAllByTestId("side-section").map((section) => section.querySelector("[data-chat-focused]"));
    expect(chats().map((chat) => chat?.getAttribute("data-chat-focused"))).toEqual(["true", "false", undefined]);

    fireEvent.wheel(within(openBodies()[1]!).getByTestId("mock-conversation"));
    expect(focusedChat()).toBe(sideChatId(newer!.id));
    fireEvent.pointerDown(within(openBodies()[1]!).getByTestId("mock-conversation"));
    expect(focusedChat()).toBe(sideChatId(older!.id));

    fireEvent.click(within(rows()[1]!).getByRole("button", { expanded: true }));
    expect(focusedChat()).toBe(MAIN_CHAT);
  });

  it("keeps the main view focused on a phone, where the sheet is the one view on screen", () => {
    useTopicPanel.setState({ sheet: true });
    render(<SideColumn leaderId="l1" threadKey="main" variant="sheet" />);
    act(() => {
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    });
    fireEvent.pointerDown(within(openBodies()[0]!).getByTestId("mock-conversation"));
    expect(useChatFocusStore.getState()).toMatchObject({ focused: MAIN_CHAT, sideChats: [] });
  });

  it("collapses on desktop and closes on a phone", () => {
    const view = render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse the side column" }));
    expect(useTopicPanel.getState().open).toBe(false);
    view.unmount();
    useTopicPanel.setState({ sheet: true });
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="sheet" />);
    fireEvent.click(screen.getByRole("button", { name: "Close the side column" }));
    expect(useTopicPanel.getState().sheet).toBe(false);
  });
});
