// @vitest-environment jsdom
/**
 * The side column: what the user put there (side chats, other conversations, topic pages), newest
 * first, then the topic page it follows. Each section folds on its own and the column scrolls when
 * the open ones don't fit, like Logseq's sidebar. It tells the server which conversations it shows
 * and starts side chats from what's on screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const setSideViewsOf = vi.hoisted(() => vi.fn());
vi.mock("../../utils/side-views.js", () => ({ setSideViewsOf, getSideViews: () => [] }));
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
const threads = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/leader-topics.js")>()),
  useLeaderThreads: () => threads.list,
}));
import { closeSideItem, openInSide, replaceSideItem, useSideColumnStore } from "../../utils/side-column.js";
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
  sendToSession.mockClear();
  useStore.setState({ threadWindows: new Map(), threadWindowMessages: new Map() } as never);
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
    // Jiayi (Oct 31): the pane went to a loading page as the chat turned into the quest. It keeps
    // showing the chat while the quest's messages are fetched, then turns into the quest in place.
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "topic:aaaa0001" }),
    ]);
    expect(sendToSession).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ type: "thread_window_request", thread_key: "q-9", activate_view: false }),
    );
    landThreadWindow("l1", "q-9");
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: "q-9" }),
    ]);
  });

  it("turns a merged thread into its conversation in place, and drops another pane already showing it", () => {
    // A thread the Scribe joined onto an earlier one stays where the user had it in the column;
    // the earlier thread's own pane goes, so the conversation shows once, where the user was reading.
    openInSide("l1", { kind: "conversation", threadKey: "topic:aaaa0002" });
    openInSide("l1", { kind: "topic", topicId: "t9" });
    openInSide("l1", { kind: "conversation", threadKey: "topic:aaaa0003" });
    const chat = useSideColumnStore.getState().columns.l1!.items[0]!.id;
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
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
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
    expect(isRememberedFolded("side:l1:home")).toBe(true);
  });

  it("stacks items newest first with the topic page last, each folding on its own", () => {
    // Jiayi (Oct 31): like Logseq, any number can be open; the column scrolls when they don't fit.
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
      openInSide("l1", { kind: "topic", topicId: "t9" });
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
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
    });
    expect(rows().map((row) => row.dataset.open)).toEqual(["true", "true", "true"]);
  });

  it("sets an open section's height from its bottom edge, remembered, and back with a double-click", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
    });
    const id = useSideColumnStore.getState().columns.l1!.items[0]!.id;
    const section = screen.getAllByTestId("side-section")[0]!;
    const body = within(section).getByTestId("side-section-body");
    body.getBoundingClientRect = () => ({ height: 300 }) as DOMRect;
    const edge = within(section).getByRole("separator");
    fireEvent.keyDown(edge, { key: "ArrowDown" });
    expect(body.style.height).toBe("324px");
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!)["side:l1"].heights).toEqual({ [id]: 324 });
    fireEvent.doubleClick(edge);
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!)["side:l1"].heights).toEqual({});
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
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([]);
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
    expect(within(openBodies()[1]!).getByTestId("mock-session").textContent).toBe("worker-9");
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
      expect(rows()[0]!.textContent).toContain("New thread");
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
      expect(rows()[0]!.textContent).toContain("New thread with Takode");
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
      landThreadWindow("l2", "q-11");
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
        openInSide("l1", { kind: "conversation", threadKey: "q-3" });
        openInSide("l1", { kind: "conversation", threadKey: "q-2" });
        openInSide("l1", { kind: "conversation", threadKey: "q-1" });
      });
      const tones = rows()
        .slice(0, 3)
        .map((row) => within(row).getByTestId("side-item-dot").dataset.tone);
      expect(tones).toEqual(["question", "unread", "none"]);
      expect(within(rows()[0]!).getByTestId("side-item-questions").textContent).toBe("question");
      expect(within(rows()[1]!).queryByTestId("side-item-questions")).toBeNull();
      expect(within(rows()[2]!).getByTestId("side-item-dot").className).not.toContain("success");
    } finally {
      useStore.setState({ sessionNotifications: new Map() } as never);
    }
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
