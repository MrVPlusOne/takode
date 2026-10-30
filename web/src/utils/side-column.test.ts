// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import {
  closeSideItem,
  HOME_ITEM,
  handleOpenInSideClick,
  isOpenInSideClick,
  openConversationInSide,
  openInSideClickLabel,
  openQuestInSide,
  openSessionInSide,
  openInSide,
  openSideItem,
  replaceSideItem,
  sideChatOrigin,
  useSideColumnStore,
} from "./side-column.js";
import { useTopicPanel } from "./topic-panel.js";
import { markLeaderThreadDisplayed } from "./thread-viewport.js";

const column = (leaderId: string) => useSideColumnStore.getState().columns[leaderId];
const keys = (leaderId: string) =>
  column(leaderId)?.items.map((item) => (item.kind === "conversation" ? item.threadKey : item.kind));

afterEach(() => {
  useSideColumnStore.setState({ columns: {} });
  useTopicPanel.setState({ panels: {}, sheets: [], focus: null });
  localStorage.clear();
});

/**
 * A leader's side column (Logseq's right sidebar): what the user put beside the conversation,
 * newest first, one item open, remembered per leader in this browser.
 */
describe("side column items", () => {
  it("puts things at the top and opens them, bringing back what is already there", () => {
    openInSide("l1", { kind: "conversation", threadKey: "q-1" });
    const second = openInSide("l1", { kind: "conversation", threadKey: "topic:aaaa0001" });
    expect(keys("l1")).toEqual(["topic:aaaa0001", "q-1"]);
    expect(column("l1")!.open).toBe(second);
    // The same conversation again (any case) moves up and opens rather than being added twice.
    const again = openInSide("l1", { kind: "conversation", threadKey: "Q-1" });
    expect(keys("l1")).toEqual(["Q-1", "topic:aaaa0001"]);
    expect(column("l1")!.open).toBe(again);
    // Opening something shows the column, collapsed on desktop or closed on a phone.
    expect(useTopicPanel.getState().panels.l1).toBe(true);
    expect(useTopicPanel.getState().sheets).toContain("l1");
    // Remembered for the next visit.
    expect(JSON.parse(localStorage.getItem("cc-side-columns")!).l1.items).toHaveLength(2);
  });

  it("opens the next item when the open one is removed, and the topic page when none is left", () => {
    const first = openInSide("l1", { kind: "conversation", threadKey: "q-1" });
    const second = openInSide("l1", { kind: "topic", topicId: "t1" });
    closeSideItem("l1", second);
    expect(column("l1")!.open).toBe(first);
    openSideItem("l1", HOME_ITEM);
    closeSideItem("l1", first);
    expect(column("l1")).toEqual({ items: [], open: HOME_ITEM });
  });

  it("keeps one new side chat, turning it into its thread once started", () => {
    const chat = openInSide("l1", { kind: "new-chat", startedFrom: "q-1" });
    expect(openInSide("l1", { kind: "new-chat", startedFrom: null })).toBe(chat);
    replaceSideItem("l1", chat, { kind: "conversation", threadKey: "topic:aaaa0002" });
    expect(column("l1")!.items).toEqual([{ id: chat, kind: "conversation", threadKey: "topic:aaaa0002" }]);
    expect(column("l1")!.open).toBe(chat);
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

  it("opens a leader's conversation in its column only while that leader is on screen", () => {
    // Elsewhere the column isn't visible, so the click does what it would without the modifier.
    expect(openConversationInSide("l1", "q-1")).toBe(false);
    expect(column("l1")).toBeUndefined();
    const shown = markLeaderThreadDisplayed("l1", "main");
    try {
      expect(openConversationInSide("l1", "Q-1")).toBe(true);
      expect(keys("l1")).toEqual(["q-1"]);
    } finally {
      shown();
    }
  });

  it("starts a side chat from the quest or topic on screen, and from nothing in Main or All", () => {
    const cases: Array<[string, string | null]> = [
      ["q-7", "q-7"],
      ["topic:aaaa0001", "topic:aaaa0001"],
      ["main", null],
      ["all", null],
    ];
    for (const [onScreen, origin] of cases) {
      const shown = markLeaderThreadDisplayed("l1", onScreen);
      expect(sideChatOrigin("l1")).toBe(origin);
      shown();
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

  it("opens a quest's details or a session's conversation in the side column of the leader on screen", () => {
    expect(openQuestInSide("Q-5")).toBe(false);
    useStore.setState({ currentSessionId: "l1" });
    const shown = markLeaderThreadDisplayed("l1", "main");
    try {
      expect(openQuestInSide("Q-5")).toBe(true);
      expect(openSessionInSide("worker-9")).toBe(true);
      // The leader on screen itself opens as its Main thread.
      expect(openSessionInSide("l1")).toBe(true);
      expect(column("l1")!.items.map((item) => item.kind)).toEqual(["conversation", "session", "quest"]);
      expect(column("l1")!.items[2]).toEqual(expect.objectContaining({ questId: "q-5" }));
    } finally {
      shown();
      useStore.setState({ currentSessionId: null });
    }
  });
});
