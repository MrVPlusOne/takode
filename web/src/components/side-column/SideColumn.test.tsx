// @vitest-environment jsdom
/**
 * The side column as a stack: the topic page it follows, plus what the user put there (side chats,
 * other conversations, topic pages), newest first; one open, the others as rows. It tells the
 * server which conversations it shows, starts side chats from what's on screen and lists past ones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const setSideViewsOf = vi.hoisted(() => vi.fn());
vi.mock("../../utils/side-views.js", () => ({ setSideViewsOf, getSideViews: () => [] }));
vi.mock("../library/TopicSidePanel.js", () => ({
  TopicSidePanel: ({ pinnedTopicId }: { pinnedTopicId?: string }) => (
    <div data-testid="mock-topic-page">{pinnedTopicId ?? "followed"}</div>
  ),
  useQuestTopic: () => ({ id: "t1", name: "Relay" }),
}));
vi.mock("./SideConversation.js", () => ({
  SideConversation: ({ threadKey }: { threadKey: string }) => <div data-testid="mock-conversation">{threadKey}</div>,
}));
vi.mock("./NewSideChat.js", () => ({
  NewSideChat: ({ startedFrom }: { startedFrom: string | null }) => (
    <div data-testid="mock-new-chat">{startedFrom ?? "none"}</div>
  ),
}));
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
import { closeSideItem, HOME_ITEM, openInSide, useSideColumnStore } from "../../utils/side-column.js";
import { useLibraryNav } from "../../utils/library-nav.js";
import { markLeaderThreadDisplayed } from "../../utils/thread-viewport.js";
import { useTopicPanel } from "../../utils/topic-panel.js";
import { useStore } from "../../store.js";
import { SideColumn } from "./SideColumn.js";

afterEach(() => {
  cleanup();
  setSideViewsOf.mockClear();
  useSideColumnStore.setState({ columns: {} });
  useTopicPanel.setState({ panels: {}, sheets: [], focus: null });
  localStorage.clear();
  threads.list = [];
});

const rows = () => screen.queryAllByTestId("side-item-row");
const openBodies = () =>
  screen.getAllByTestId("side-item-body").filter((body) => body.closest("[style*='display: none']") === null);

describe("SideColumn", () => {
  it("shows only the followed topic page until something is put beside it", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    expect(rows()).toEqual([]);
    expect(screen.getByTestId("mock-topic-page").textContent).toBe("followed");
  });

  it("stacks items newest first with the topic page last, one open, and opens another by its row", () => {
    render(<SideColumn leaderId="l1" threadKey="q-1" variant="docked" />);
    act(() => {
      openInSide("l1", { kind: "conversation", threadKey: "q-2" });
      openInSide("l1", { kind: "topic", topicId: "t9" });
    });
    // The followed topic page is last, under the topic of the quest on screen.
    expect(rows().map((row) => row.textContent)).toEqual(["Topic", "q-2 name of q-2", "Relay"]);
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
