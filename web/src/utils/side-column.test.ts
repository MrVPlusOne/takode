// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  handleOpenInSideClick,
  isOpenInSideClick,
  lastThreadShownOf,
  mergeLeaderColumns,
  newSideChat,
  notePaneClick,
  noteSideItemUsed,
  openConversationInSide,
  openInSideClickLabel,
  openQuestInSide,
  openSessionInSide,
  openInSide,
  replaceSideItem,
  setSideOneAtATime,
  showMainView,
  sideFoldId,
  unfoldSideItem,
  useSideColumnStore,
  wantsSideClick,
} from "./side-column.js";
import { useTopicPanel } from "./topic-panel.js";
import { navigateToSessionMessageId } from "./routing.js";
import { sideConversationFeedKey } from "../components/secondary-feed.js";
import { isRememberedFolded, resetRememberedFoldsForTest, setRememberedFolded } from "./remembered-folds.js";
import { markLeaderThreadDisplayed } from "./thread-viewport.js";

const items = () => useSideColumnStore.getState().items;
const keys = () => items().map((item) => (item.kind === "conversation" ? item.threadKey : item.kind));

afterEach(() => {
  useSideColumnStore.setState({
    items: [],
    focus: undefined,
    focusAt: undefined,
    used: undefined,
    chatHeight: undefined,
    oneAtATime: undefined,
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

describe("chats one at a time", () => {
  it("keeps one chat open, like a tab group stacked as an accordion; other sections stay as they are", () => {
    // Jiayi (Nov 2): only the side chats are mutually exclusive; Topics, pages and a Home open and
    // fold on their own as before.
    const open = () =>
      [...items().map((item) => item.id), HOME_ITEM].filter((id) => !isRememberedFolded(sideFoldId(id)));
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const page = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    expect(open()).toEqual([b, page, a, HOME_ITEM]);
    // Turning it on keeps the chat opened last; the page and Topics stay open.
    setSideOneAtATime(true);
    expect(open()).toEqual([b, page, HOME_ITEM]);
    unfoldSideItem(a);
    expect(open()).toEqual([page, a, HOME_ITEM]);
    // A new thread and another session's conversation are chats too; a Home is not.
    const chat = openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    expect(open()).toEqual([chat, page, HOME_ITEM]);
    const home = openInSide({ kind: "home", leaderId: "l2" });
    expect(open()).toEqual([home, chat, page, HOME_ITEM]);
    const session = openInSide({ kind: "session", sessionId: "worker-1" });
    expect(open()).toEqual([session, home, page, HOME_ITEM]);
    // Off, chats open side by side again.
    setSideOneAtATime(false);
    unfoldSideItem(a);
    expect(open()).toEqual([session, home, page, a, HOME_ITEM]);
    expect(useSideColumnStore.getState().oneAtATime).toBe(false);
  });
});

describe("closing chats one at a time", () => {
  // Jiayi (Nov 3): with chats one at a time, removing the open chat opens another; removing a
  // folded one leaves the open chat; and the open chat can be folded, so none may be open.
  const openChats = () =>
    items()
      .filter((item) => !isRememberedFolded(sideFoldId(item.id)))
      .map((item) => item.id);

  it("opens the chat used most recently when the open chat is removed", () => {
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    const c = openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
    setSideOneAtATime(true);
    // Used order: c, then a (opened again), then b.
    unfoldSideItem(a);
    unfoldSideItem(c);
    expect(openChats()).toEqual([c]);
    closeSideItem(c);
    expect(openChats()).toEqual([a]);
    expect(isRememberedFolded(sideFoldId(b))).toBe(true);
  });

  it("opens a neighbour when no other chat was used, and nothing once none is left", () => {
    const page = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    const chat = openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    const other = openInSide({ kind: "new-chat", leaderId: "l2", startedFrom: null });
    setSideOneAtATime(true);
    expect(openChats()).toEqual([other, page]);
    // New threads aren't in the used order: the neighbour below opens.
    closeSideItem(other);
    expect(openChats()).toEqual([chat, page]);
    closeSideItem(chat);
    expect(openChats()).toEqual([page]);
  });

  it("leaves the open chat when a folded one is removed, and doesn't open one when the mode is off", () => {
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    setSideOneAtATime(true);
    expect(openChats()).toEqual([b]);
    closeSideItem(a);
    expect(openChats()).toEqual([b]);
    const c = openInSide({ kind: "conversation", threadKey: "q-3", leaderId: "l1" });
    setSideOneAtATime(false);
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

describe("at most three open conversations", () => {
  it("folds the least recently opened or used conversation when a fourth opens", () => {
    // Jiayi (Nov 1): each open conversation keeps its feed and live messages; three at most.
    const open = () =>
      items()
        .filter((item) => !isRememberedFolded(sideFoldId(item.id)))
        .map((item) => item.id);
    const a = openInSide({ kind: "conversation", threadKey: "q-1", leaderId: "l1" });
    const b = openInSide({ kind: "conversation", threadKey: "q-2", leaderId: "l1" });
    const c = openInSide({ kind: "session", sessionId: "worker-1" });
    // Pages and quest details don't count.
    const page = openInSide({ kind: "topic", topicId: "t1", leaderId: "l1" });
    const details = openInSide({ kind: "quest", questId: "q-9" });
    expect(open()).toEqual(expect.arrayContaining([a, b, c, page, details]));
    // Using the oldest makes it the last to fold.
    noteSideItemUsed(a);
    const d = openInSide({ kind: "conversation", threadKey: "q-4", leaderId: "l2" });
    expect(isRememberedFolded(sideFoldId(b))).toBe(true);
    expect(open()).toEqual(expect.arrayContaining([a, c, d, page, details]));
    // Unfolding a folded one folds the next oldest.
    unfoldSideItem(b);
    expect(isRememberedFolded(sideFoldId(c))).toBe(true);
    expect(
      open()
        .filter((id) => [a, b, c, d].includes(id))
        .sort(),
    ).toEqual([a, b, d].sort());
  });

  it("counts a new thread once it becomes its conversation", () => {
    const convs = ["q-1", "q-2", "q-3"].map((threadKey) =>
      openInSide({ kind: "conversation", threadKey, leaderId: "l1" }),
    );
    const chat = openInSide({ kind: "new-chat", leaderId: "l1", startedFrom: null });
    expect(convs.every((id) => !isRememberedFolded(sideFoldId(id)))).toBe(true);
    replaceSideItem(chat, { kind: "conversation", threadKey: "topic:aaaa0001", leaderId: "l1" });
    expect(isRememberedFolded(sideFoldId(convs[0]!))).toBe(true);
    expect(isRememberedFolded(sideFoldId(chat))).toBe(false);
  });

  it("starts a column saved with more open within the limit, keeping the most recently used", async () => {
    // A column from before the limit has five open and no use order beyond the last one used.
    const saved = ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "conversation", threadKey: id, leaderId: "l1" }));
    localStorage.setItem("cc-side-column", JSON.stringify({ items: saved, used: ["e"] }));
    vi.resetModules();
    const fresh = await import("./side-column.js");
    const folds = await import("./remembered-folds.js");
    const open = saved.map((item) => item.id).filter((id) => !folds.isRememberedFolded(fresh.sideFoldId(id)));
    // The used one stays; the others never used keep the column's order.
    expect(open).toEqual(["a", "b", "e"]);
  });
});

describe("one column from the leaders' columns", () => {
  it("keeps everything each leader's column held, named with its leader, with its folds and heights", () => {
    // Before Nov 1 each leader had a column of its own; the first load merges them (Jiayi: what the
    // user put on the side stays when switching leaders).
    setRememberedFolded("side:l2:b", true);
    localStorage.setItem(
      "cc-stacked-panes",
      JSON.stringify({
        "side:l1": { weights: {}, heights: { a: 300 } },
        "side:l2": { weights: {}, heights: { b: 200 } },
      }),
    );
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
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!).side.heights).toEqual({ a: 300, b: 200 });
    expect(JSON.parse(localStorage.getItem("cc-side-column")!).items).toHaveLength(4);
  });
});

describe("opening in the side", () => {
  it("takes a click with the chosen key alone as asking for the side column, Shift by default", () => {
    const click = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
    expect(isOpenInSideClick({ ...click, shiftKey: true })).toBe(true);
    expect(isOpenInSideClick(click)).toBe(false);
    expect(isOpenInSideClick({ ...click, shiftKey: true, metaKey: true })).toBe(false);
    expect(isOpenInSideClick(undefined)).toBe(false);
    expect(openInSideClickLabel()).toBe("Shift-click");
    // Chosen in Settings > Keyboard. Cmd/Ctrl-click opens a window of its own instead.
    expect(isOpenInSideClick({ ...click, altKey: true }, "alt")).toBe(true);
    expect(isOpenInSideClick({ ...click, shiftKey: true }, "alt")).toBe(false);
    expect(isOpenInSideClick({ ...click, ctrlKey: true })).toBe(false);
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
});
