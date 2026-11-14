// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  handleOpenInSideClick,
  isOtherColumnClick,
  lastThreadShownOf,
  mergeLeaderColumns,
  newSideChat,
  notePaneClick,
  openConversationInSide,
  otherColumnClickLabel,
  openQuestInSide,
  openSessionInSide,
  openSessionMessageInSide,
  openInSide,
  openTopicsInSide,
  replaceSideItem,
  selectSideTab,
  showMainView,
  sideFoldId,
  unfoldSideItem,
  useSideColumnStore,
  wantsSideClick,
} from "./side-column.js";
import { useTopicPanel } from "./topic-panel.js";
import { navigateToSessionMessageId } from "./routing.js";
import { sideConversationFeedKey, sideSessionFeedKey } from "../components/secondary-feed.js";
import { isRememberedFolded, resetRememberedFoldsForTest, setRememberedFolded } from "./remembered-folds.js";
import { markLeaderThreadDisplayed } from "./thread-viewport.js";

const items = () => useSideColumnStore.getState().items;
const keys = () => items().map((item) => (item.kind === "conversation" ? item.threadKey : item.kind));

afterEach(() => {
  useSideColumnStore.setState({
    items: [],
    focus: undefined,
    focusAt: undefined,
    tab: undefined,
  });
  useTopicPanel.setState({ open: true, sheet: false, focus: null });
  useStore.setState({ currentSessionId: null, sdkSessions: [] } as never);
  localStorage.clear();
  resetRememberedFoldsForTest();
});

/**
 * The side column (Logseq's right sidebar): what the user put beside the conversation, newest
 * first, each folding on its own, remembered in this browser. One column for every leader (Jiayi,
 * Nov 1): each conversation in it names its leader.
 */
describe("side column items", () => {
  it("puts things at the top and opens them, bringing back what is already there", () => {
    openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const second = openInSide({ kind: "conversation", threadKey: "topic:aaaa0001", leaderId: "l1" });
    expect(keys()).toEqual(["topic:aaaa0001", "q-1"]);
    expect(useSideColumnStore.getState().focus).toBe(second);
    // The same conversation again (any case) moves up and opens rather than being added twice.
    // It unfolds if the user had folded it; the column scrolls to it (its focus).
    const first = items()[1]!.id;
    setRememberedFolded(sideFoldId(first), true);
    const again = openInSide({ kind: "conversation", threadKey: "Q-1", leaderId: "l1" });
    expect(again).toBe(first);
    expect(keys()).toEqual(["Q-1", "topic:aaaa0001"]);
    expect(useSideColumnStore.getState().focus).toBe(again);
    expect(isRememberedFolded(sideFoldId(again))).toBe(false);
    // Opening something shows the column, collapsed on desktop or closed on a phone.
    expect(useTopicPanel.getState().open).toBe(true);
    expect(useTopicPanel.getState().sheet).toBe(true);
    // Remembered for the next visit.
    expect(JSON.parse(localStorage.getItem("cc-side-column")!).items).toHaveLength(2);
  });

  it("keeps the same thread of two leaders as two items", () => {
    const one = openInSide({ kind: "conversation", threadKey: "main", leaderId: "l1" });
    const two = openInSide({ kind: "conversation", threadKey: "main", leaderId: "l2" });
    expect(two).not.toBe(one);
    expect(items().map((item) => item.id)).toEqual([two, one]);
  });

  it("removes items freely, leaving the others as they were", () => {
    const first = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const second = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    closeSideItem(second);
    expect(items().map((item) => item.id)).toEqual([first]);
    closeSideItem(first);
    expect(items()).toEqual([]);
    expect(HOME_ITEM).toBe("home");
  });

  it("keeps one new thread per leader, turning it into its conversation once started", () => {
    const chat = openInSide({ kind: "new-chat", startedFrom: "q-1", leaderId: "l1" });
    expect(openInSide({ kind: "new-chat", startedFrom: null, leaderId: "l1" })).toBe(chat);
    expect(openInSide({ kind: "new-chat", startedFrom: null, leaderId: "l2" })).not.toBe(chat);
    replaceSideItem(chat, { kind: "conversation", threadKey: "topic:aaaa0002", leaderId: "l1" });
    expect(items().find((item) => item.id === chat)).toEqual({
      id: chat,
      kind: "conversation",
      threadKey: "topic:aaaa0002",
      leaderId: "l1",
    });
  });
});

describe("one item at a time in each tab", () => {
  it("opens one item of a tab at a time, shows its tab, and leaves the other tabs as they are", () => {
    // Jiayi (Nov 2): side chats open one at a time. Since the column's tabs (Nov 14) every tab
    // works so, its open item filling it, and opening something shows its tab. The topic page is
    // its own tab and always open.
    const open = () =>
      [...items().map((item) => item.id), HOME_ITEM].filter((id) => !isRememberedFolded(sideFoldId(id)));
    const tab = () => useSideColumnStore.getState().tab;
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    expect(tab()).toBe("chats");
    const page = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    expect(tab()).toBe("pages");
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    // Opening b folded a; the page and the topic page stay open on their tabs.
    expect(open()).toEqual([b, page, HOME_ITEM]);
    unfoldSideItem(a);
    expect(open()).toEqual([page, a, HOME_ITEM]);
    // A new thread and another session's conversation are chats too.
    const chat = openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    expect(open()).toEqual([chat, page, HOME_ITEM]);
    // A Home is a page: it folds the pinned topic page, not the chat.
    const home = openInSide({ kind: "home", leaderId: "l2" });
    expect(open()).toEqual([home, chat, HOME_ITEM]);
    const session = openInSide({ kind: "session", sessionId: "worker-1" });
    expect(open()).toEqual([session, home, HOME_ITEM]);
    expect(tab()).toBe("chats");
    unfoldSideItem(page);
    expect(open()).toEqual([session, page, HOME_ITEM]);
    // The topic page shows on its own tab.
    openTopicsInSide();
    expect(tab()).toBe("topic");
    selectSideTab("pages");
    expect(tab()).toBe("pages");
  });

  it("brings back the tab that was on screen after a reload", async () => {
    // The tab is saved with the column (local UI state), so a reload shows the same tab.
    openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    selectSideTab("topic");
    vi.resetModules();
    const fresh = await import("./side-column.js");
    expect(fresh.useSideColumnStore.getState().tab).toBe("topic");
    expect(fresh.useSideColumnStore.getState().items).toHaveLength(1);
  });

  it("starts a column saved with several items of a tab open with one open in each", async () => {
    // A column saved while chats could open side by side (before Nov 11), or pages (before the tabs),
    // with retired settings, which go: the switch, the chats' use order and their shared height.
    const saved = [
      { id: "a", kind: "conversation", threadKey: "q-1", leaderId: "l1" },
      { id: "p", kind: "topic", topicId: "t1", leaderId: "l1" },
      { id: "h", kind: "home", leaderId: "l2" },
      { id: "b", kind: "session", sessionId: "worker-1" },
      { id: "c", kind: "new-chat", leaderId: "l1", startedFrom: null },
    ];
    const load = async (state: object) => {
      localStorage.clear();
      localStorage.setItem("cc-side-column", JSON.stringify(state));
      vi.resetModules();
      const fresh = await import("./side-column.js");
      const folds = await import("./remembered-folds.js");
      const open = saved.map((item) => item.id).filter((id) => !folds.isRememberedFolded(fresh.sideFoldId(id)));
      return { open, state: fresh.useSideColumnStore.getState() };
    };
    const focused = await load({ items: saved, focus: "b", oneAtATime: false, used: ["b"], chatHeight: 300 });
    expect(focused.open).toEqual(["p", "b"]);
    for (const retired of ["oneAtATime", "used", "chatHeight"]) expect(focused.state).not.toHaveProperty(retired);
    expect((await load({ items: saved, focus: "h" })).open).toEqual(["a", "h"]);
  });
});

describe("closing chats one at a time", () => {
  // Jiayi (Nov 3): removing the open chat opens another; removing a folded one leaves the open
  // chat; and the open chat can be folded, so none may be open.
  const openChats = () =>
    items()
      .filter((item) => !isRememberedFolded(sideFoldId(item.id)))
      .map((item) => item.id);

  // Jiayi (Nov 10): closing the open chat opens the next one down, so chats read top to bottom,
  // even when another chat was used more recently; the last chat falls back to the one above.
  it("opens the chat below when the open chat is removed, else the one above", () => {
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    const c = openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
    // Listed top to bottom: c, b, a. Used order: c, then a (opened again), then b.
    expect(items().map((item) => item.id)).toEqual([c, b, a]);
    unfoldSideItem(a);
    unfoldSideItem(c);
    expect(openChats()).toEqual([c]);
    closeSideItem(c);
    expect(openChats()).toEqual([b]);
    expect(isRememberedFolded(sideFoldId(a))).toBe(true);
    // The last chat has none below it: the one above opens.
    unfoldSideItem(a);
    closeSideItem(a);
    expect(openChats()).toEqual([b]);
  });

  it("opens a neighbour when no other chat was used, and nothing once none is left", () => {
    const page = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    const chat = openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    const other = openInSide({ kind: "new-chat", leaderId: "l2", startedFrom: null });
    expect(openChats()).toEqual([other, page]);
    // New threads aren't in the used order: the neighbour below opens.
    closeSideItem(other);
    expect(openChats()).toEqual([chat, page]);
    closeSideItem(chat);
    expect(openChats()).toEqual([page]);
  });

  it("opens the next page of the tab when its open page is removed, leaving the chats", () => {
    const first = openInSide({ kind: "quest", questId: "q-1" });
    const chat = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    const second = openInSide({ kind: "quest", questId: "q-3" });
    expect(openChats()).toEqual([second, chat]);
    closeSideItem(second);
    expect(openChats()).toEqual([chat, first]);
  });

  it("leaves the open chat when a folded one is removed, and opens none when the open one was folded", () => {
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    expect(openChats()).toEqual([b]);
    closeSideItem(a);
    expect(openChats()).toEqual([b]);
    const c = openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
    setRememberedFolded(sideFoldId(c), true);
    closeSideItem(c);
    expect(openChats()).toEqual([]);
  });
});

describe("a leader's Home in the side column", () => {
  it("opens a leader's Main as its Home, once per leader, and leaves its log a conversation", () => {
    // Jiayi (Nov 1): a leader's Home moves between the main view and the column, like a chat.
    const home = openInSide({ kind: "conversation", threadKey: "Main", leaderId: "l1" });
    expect(items()).toEqual([{ id: home, kind: "home", leaderId: "l1" }]);
    expect(openInSide({ kind: "home", leaderId: "l1" })).toBe(home);
    openInSide({ kind: "conversation", threadKey: "all", leaderId: "l1" });
    expect(keys()).toEqual(["all", "home"]);
  });

  it("turns a saved Main conversation into its leader's Home", async () => {
    localStorage.setItem(
      "cc-side-column",
      JSON.stringify({ items: [{ id: "a", kind: "conversation", threadKey: "main", leaderId: "l1" }] }),
    );
    vi.resetModules();
    const fresh = await import("./side-column.js");
    expect(fresh.useSideColumnStore.getState().items).toEqual([{ id: "a", kind: "home", leaderId: "l1" }]);
  });

  it("remembers the thread each leader's main view showed last, other than Home and its log", () => {
    // Moving Home to the column sends the main view back there.
    for (const key of ["q-1", "main", "all"]) showMainView("l1", key)();
    expect(lastThreadShownOf("l1")).toBe("q-1");
    expect(lastThreadShownOf("l2")).toBeNull();
  });
});

describe("one column from the leaders' columns", () => {
  it("keeps everything each leader's column held, named with its leader, with its folds", () => {
    // Before Nov 1 each leader had a column of its own; the first load merges them (Jiayi: what the
    // user put on the side stays when switching leaders).
    setRememberedFolded("side:l2:b", true);
    const merged = mergeLeaderColumns(
      JSON.stringify({
        l1: {
          items: [
            { id: "a", kind: "conversation", threadKey: "q-1" },
            { id: "n", kind: "new-chat", startedFrom: "q-1" },
          ],
        },
        l2: {
          items: [
            { id: "b", kind: "conversation", threadKey: "topic:bbbb0001" },
            // l2's chat with l1 about q-1: the same conversation as l1's own, so it is kept once.
            { id: "c", kind: "conversation", threadKey: "q-1", leaderId: "l1" },
            { id: "d", kind: "quest", questId: "q-9" },
          ],
        },
      }),
    );
    expect(merged.items).toEqual([
      { id: "a", kind: "conversation", threadKey: "q-1", leaderId: "l1" },
      { id: "n", kind: "new-chat", startedFrom: "q-1", leaderId: "l1", startedIn: "l1" },
      { id: "b", kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" },
      { id: "d", kind: "quest", questId: "q-9" },
    ]);
    expect(isRememberedFolded(sideFoldId("b"))).toBe(true);
    expect(isRememberedFolded(sideFoldId("a"))).toBe(false);
    expect(JSON.parse(localStorage.getItem("cc-side-column")!).items).toHaveLength(4);
  });
});

describe("opening in the side", () => {
  it("takes a click with the chosen key alone as asking for the side column, Shift by default", () => {
    const click = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
    expect(isOtherColumnClick({ ...click, shiftKey: true })).toBe(true);
    expect(isOtherColumnClick(click)).toBe(false);
    expect(isOtherColumnClick({ ...click, shiftKey: true, metaKey: true })).toBe(false);
    expect(isOtherColumnClick(undefined)).toBe(false);
    expect(otherColumnClickLabel()).toBe("Shift-click");
    // Chosen in Settings > Keyboard. Cmd/Ctrl-click opens a window of its own instead.
    expect(isOtherColumnClick({ ...click, altKey: true }, "alt")).toBe(true);
    expect(isOtherColumnClick({ ...click, shiftKey: true }, "alt")).toBe(false);
    expect(isOtherColumnClick({ ...click, ctrlKey: true })).toBe(false);
  });

  it("opens any leader's conversation while a conversation is on screen", () => {
    // Elsewhere the column isn't visible, so the click does what it would without the modifier.
    expect(openConversationInSide("l1", "q-1")).toBe(false);
    expect(items()).toEqual([]);
    const shown = showMainView("worker-1", null);
    try {
      expect(openConversationInSide("l1", "Q-1")).toBe(true);
      expect(items()).toEqual([expect.objectContaining({ threadKey: "q-1", leaderId: "l1" })]);
    } finally {
      shown();
    }
  });

  it("starts a thread about the quest or topic on screen; another leader's only about a quest", () => {
    const cases: Array<[string, string, string | null]> = [
      ["l1", "q-7", "q-7"],
      ["l1", "topic:aaaa0001", "topic:aaaa0001"],
      ["l1", "main", null],
      ["l1", "all", null],
      ["l2", "q-7", "q-7"],
      ["l2", "topic:aaaa0001", null],
    ];
    for (const [leaderId, onScreen, origin] of cases) {
      const displayed = markLeaderThreadDisplayed("l1", onScreen);
      const shown = showMainView("l1", onScreen);
      expect(newSideChat(leaderId)).toEqual({
        kind: "new-chat",
        leaderId,
        startedFrom: origin,
        ...(origin ? { startedIn: "l1" } : {}),
      });
      shown();
      displayed();
    }
  });

  it("never leaves the open-in-side click to the browser, and falls back to the plain click", () => {
    const click = (shiftKey: boolean) => ({
      shiftKey,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
    });
    const plain = vi.fn();
    // Not the open-in-side click: the caller's to handle.
    const other = click(false);
    expect(handleOpenInSideClick(other, () => true, plain)).toBe(false);
    expect(other.preventDefault).not.toHaveBeenCalled();
    // With nowhere to open it in the side, it does what a plain click does.
    const noSide = click(true);
    expect(handleOpenInSideClick(noSide, () => false, plain)).toBe(true);
    expect(noSide.preventDefault).toHaveBeenCalled();
    expect(plain).toHaveBeenCalledOnce();
  });

  it("jumps a message link clicked in a side pane in that pane when the pane shows the message's thread", () => {
    // Jiayi (Nov 2): side panes and the main view behave the same. A link in a side pane to one of
    // the pane's own messages used to move the main view instead.
    vi.useFakeTimers();
    const hash = window.location.hash;
    try {
      const pane = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      const click = (shiftKey: boolean) => ({ shiftKey, altKey: false, metaKey: false, ctrlKey: false });
      notePaneClick(pane, click(false));
      navigateToSessionMessageId("l1", "m-1", { threadKey: "q-2" });
      expect(useStore.getState().scrollToMessageFeed.get("l1")).toBe(sideConversationFeedKey("l1", "q-2"));
      expect(window.location.hash).toBe(hash);
      // A link to another thread, or the open-in-side click, goes to the main view.
      notePaneClick(pane, click(false));
      navigateToSessionMessageId("l1", "m-2", { threadKey: "q-3" });
      expect(useStore.getState().scrollToMessageFeed.has("l1")).toBe(false);
      notePaneClick(pane, click(true));
      navigateToSessionMessageId("l1", "m-3", { threadKey: "q-2" });
      expect(useStore.getState().scrollToMessageFeed.has("l1")).toBe(false);
    } finally {
      vi.useRealTimers();
      window.location.hash = hash;
    }
  });

  it("opens a link clicked in a side pane in that pane, and the open-in-side click in the main view", () => {
    // Jiayi: a click opens in the view it was made in; the open-in-side click in the other one.
    // A link in a side chat used to open in the main view.
    vi.useFakeTimers();
    try {
      const chat = openInSide({ kind: "conversation", threadKey: "topic:aaaa0001", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      const click = (shiftKey: boolean) => ({ shiftKey, altKey: false, metaKey: false, ctrlKey: false });
      // A plain click on a link in the chat replaces the chat with what it opens.
      notePaneClick(chat, click(false));
      expect(wantsSideClick()).toBe(true);
      const main = vi.fn();
      expect(
        handleOpenInSideClick(
          { ...click(false), preventDefault: vi.fn() },
          () => {
            openInSide({ kind: "conversation", threadKey: "q-9", leaderId: "l1" });
            return true;
          },
          main,
        ),
      ).toBe(true);
      expect(keys()).toEqual(["q-2", "q-9"]);
      expect(useSideColumnStore.getState().focus).toBe(chat);
      expect(main).not.toHaveBeenCalled();
      // The open-in-side click there opens in the main view instead.
      notePaneClick(chat, click(true));
      expect(wantsSideClick()).toBe(false);
      expect(handleOpenInSideClick({ ...click(true), preventDefault: vi.fn() }, () => true, main)).toBe(true);
      expect(main).toHaveBeenCalledOnce();
      // Once the click is handled, clicks are the main view's again.
      vi.runAllTimers();
      expect(wantsSideClick(click(false))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a quest's details or a session's conversation in the side column", () => {
    expect(openQuestInSide("Q-5")).toBe(false);
    useStore.setState({
      sdkSessions: [
        { sessionId: "l1", isOrchestrator: true, state: "connected", cwd: "/", createdAt: 1 },
        { sessionId: "l2", isOrchestrator: true, state: "connected", cwd: "/", createdAt: 1 },
      ],
    } as never);
    const shown = showMainView("l1", "main");
    try {
      expect(openQuestInSide("Q-5")).toBe(true);
      expect(openSessionInSide("worker-9")).toBe(true);
      // A leader opens as its Home, the one on screen or another (Jiayi, Nov 1: Shift-click a leader).
      expect(openSessionInSide("l1")).toBe(true);
      expect(openSessionInSide("l2")).toBe(true);
      expect(items().map((item) => item.kind)).toEqual(["home", "home", "session", "quest"]);
      expect(items().map((item) => (item.kind === "home" ? item.leaderId : null))).toEqual(["l2", "l1", null, null]);
      expect(items()[3]).toEqual(expect.objectContaining({ questId: "q-5" }));
    } finally {
      shown();
    }
  });

  it("opens a linked message in its thread in the side column, scrolled to it", async () => {
    // Jiayi (Nov 10): Shift-clicking a link to a leader's message opened the leader's Home in the
    // side column instead of the message, which a plain click shows in its thread in the main view.
    useStore.setState({
      sdkSessions: [
        { sessionId: "l1", isOrchestrator: true, state: "connected", cwd: "/", createdAt: 1 },
        { sessionId: "w1", herdedBy: "l1", state: "connected", cwd: "/", createdAt: 1 },
      ],
    } as never);
    expect(openSessionMessageInSide("l1", Promise.resolve({ messageId: "m-1", threadKey: "t-3" }))).toBe(false);
    const shown = showMainView("l1", "main");
    const jump = () => [
      useStore.getState().scrollToMessageId.get("l1"),
      useStore.getState().scrollToMessageFeed.get("l1"),
    ];
    try {
      // A message in a thread opens that thread, and its pane jumps to the message.
      expect(openSessionMessageInSide("l1", Promise.resolve({ messageId: "m-1", threadKey: "T-3" }))).toBe(true);
      await vi.waitFor(() => expect(keys()).toEqual(["t-3"]));
      expect(jump()).toEqual(["m-1", sideConversationFeedKey("l1", "t-3")]);
      // A leader's Main message opens in its leader log, as the main view shows it, not its Home.
      openSessionMessageInSide("l1", Promise.resolve({ messageId: "m-2" }));
      await vi.waitFor(() => expect(keys()).toEqual(["all", "t-3"]));
      expect(jump()).toEqual(["m-2", sideConversationFeedKey("l1", "all")]);
      // A worker's message opens in its conversation.
      openSessionMessageInSide("w1", Promise.resolve({ messageId: "m-3" }));
      await vi.waitFor(() => expect(items()[0]).toEqual(expect.objectContaining({ kind: "session", sessionId: "w1" })));
      expect(useStore.getState().scrollToMessageFeed.get("w1")).toBe(sideSessionFeedKey("w1"));
      // A message that can't be found opens its session, as a link to the session does.
      openSessionMessageInSide("l1", Promise.reject(new Error("gone")));
      await vi.waitFor(() => expect(items()[0]).toEqual(expect.objectContaining({ kind: "home", leaderId: "l1" })));
    } finally {
      shown();
    }
  });

  it("opens a linked message clicked in a side pane in that pane once it is found", async () => {
    // The message is found after the click is handled, when the pane click is no longer noted.
    const shown = showMainView("l1", "main");
    useStore.setState({
      sdkSessions: [{ sessionId: "l1", isOrchestrator: true, state: "connected", cwd: "/", createdAt: 1 }],
    } as never);
    try {
      const pane = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
      openInSide({ kind: "conversation", threadKey: "q-4", leaderId: "l1" });
      let found!: (target: { messageId: string; threadKey: string }) => void;
      notePaneClick(pane, { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false });
      expect(openSessionMessageInSide("l1", new Promise((resolve) => (found = resolve)))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      found({ messageId: "m-9", threadKey: "q-7" });
      await vi.waitFor(() => expect(keys()).toEqual(["q-4", "q-7"]));
      expect(items()[1].id).toBe(pane);
      expect(useStore.getState().scrollToMessageFeed.get("l1")).toBe(sideConversationFeedKey("l1", "q-7"));
    } finally {
      shown();
    }
  });
});
