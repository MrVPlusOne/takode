// @vitest-environment jsdom
/**
 * One focused chat among the main view and side panes (chat-focus.ts). A side pane counts as
 * focused only while it is on screen; otherwise the main view is.
 */
import { StrictMode, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { chatFocusHandlers, focusChat, focusedChat, MAIN_CHAT, useChatFocusStore, useSideChat } from "./chat-focus.js";

afterEach(() => {
  cleanup();
  useChatFocusStore.setState({ focused: MAIN_CHAT, sideChats: [] });
});

/** A side pane: a title bar and a feed that scrolls (jsdom has no layout, so sizes are set). */
function renderPane() {
  useChatFocusStore.setState({ focused: MAIN_CHAT, sideChats: ["side:a"] });
  render(
    createElement(
      "div",
      { "data-testid": "pane", ...chatFocusHandlers("side:a") },
      createElement("div", { "data-testid": "title" }, "q-1"),
      createElement(
        "div",
        { "data-testid": "feed", style: { overflowY: "auto" } },
        createElement("p", { "data-testid": "message" }, "An answer"),
      ),
    ),
  );
  const feed = screen.getByTestId("feed");
  Object.defineProperty(feed, "scrollHeight", { value: 2000 });
  Object.defineProperty(feed, "clientHeight", { value: 500 });
}

describe("chat focus", () => {
  it("leaves the main view focused when a focused side pane leaves the screen", () => {
    const { rerender } = renderHook(({ onScreen }) => useSideChat("side:l1:a", onScreen), {
      initialProps: { onScreen: true },
    });
    act(() => focusChat("side:l1:a"));
    expect(focusedChat()).toBe("side:l1:a");
    rerender({ onScreen: false });
    expect(focusedChat()).toBe(MAIN_CHAT);
  });

  it("keeps a just-opened pane focused when its registration runs again", () => {
    // Opening a conversation beside the main view focuses it before its pane's registration has
    // settled; a registration that re-runs (StrictMode here, a re-render in the browser) used to
    // count as the pane leaving and hand focus back to the main view.
    act(() => focusChat("side:l1:a"));
    renderHook(() => useSideChat("side:l1:a", true), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    });
    expect(focusedChat()).toBe("side:l1:a");
  });

  // Jiayi (Nov 1), a trial of the other rule: scrolling a chat focuses it, as clicking does, since
  // users may not know the panes have a focus at all.
  it("focuses a chat when the user scrolls it, by wheel or touch", () => {
    renderPane();
    fireEvent.wheel(screen.getByTestId("message"), { deltaY: 40 });
    expect(focusedChat()).toBe("side:a");
    act(() => focusChat(MAIN_CHAT));
    fireEvent.touchMove(screen.getByTestId("message"));
    expect(focusedChat()).toBe("side:a");
  });

  it("focuses a chat on a press of its scrollbar", () => {
    renderPane();
    fireEvent.pointerDown(screen.getByTestId("feed"));
    expect(focusedChat()).toBe("side:a");
  });

  it("leaves focus alone for a wheel that scrolls something outside the chat", () => {
    // Over a side pane's title bar the wheel scrolls the side column, not the chat.
    renderPane();
    fireEvent.wheel(screen.getByTestId("title"), { deltaY: 40 });
    expect(focusedChat()).toBe(MAIN_CHAT);
  });

  it("leaves focus alone when the app scrolls a chat itself", () => {
    // Following new messages, jumps and restoring a place scroll without user input.
    renderPane();
    fireEvent.scroll(screen.getByTestId("feed"));
    expect(focusedChat()).toBe(MAIN_CHAT);
  });
});
