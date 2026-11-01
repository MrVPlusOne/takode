// @vitest-environment jsdom
/**
 * One focused chat among the main view and side panes (chat-focus.ts). A side pane counts as
 * focused only while it is on screen; otherwise the main view is.
 */
import { StrictMode, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { focusChat, focusedChat, MAIN_CHAT, useChatFocusStore, useSideChat } from "./chat-focus.js";

afterEach(() => useChatFocusStore.setState({ focused: MAIN_CHAT, sideChats: [] }));

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
});
