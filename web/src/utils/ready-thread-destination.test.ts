// @vitest-environment jsdom
/**
 * A view showing a thread that merged into another conversation switches to it only once that
 * conversation's messages are here, so the switch never shows a loading page. Jiayi (Oct 31): a
 * side chat went blank while its messages were moving into a quest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
import { useStore } from "../store.js";
import { useReadyThreadDestination } from "./ready-thread-destination.js";

const landWindow = (threadKey: string, windowHash?: string) =>
  act(() =>
    useStore.getState().setThreadWindow("l1", threadKey, {
      thread_key: threadKey,
      from_item: 0,
      item_count: 30,
      total_items: 30,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 0,
      section_item_count: 10,
      visible_item_count: 3,
      ...(windowHash ? { window_hash: windowHash } : {}),
    }),
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sendToSession.mockClear();
  useStore.setState({ threadWindows: new Map(), threadWindowMessages: new Map() } as never);
});

describe("useReadyThreadDestination", () => {
  it("asks for the destination's window and returns it once the window lands", () => {
    const { result } = renderHook(() => useReadyThreadDestination("l1", "q-9"));
    expect(result.current).toBeNull();
    // Fetched ahead, so it doesn't become the view the server keeps live.
    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(sendToSession).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({
        type: "thread_window_request",
        thread_key: "q-9",
        from_item: -1,
        activate_view: false,
      }),
    );
    landWindow("q-9");
    expect(result.current).toBe("q-9");
  });

  it("returns a destination whose window the browser already holds without asking again", () => {
    landWindow("q-9", "hash-1");
    const { result } = renderHook(() => useReadyThreadDestination("l1", "q-9"));
    expect(result.current).toBe("q-9");
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("switches anyway when the window doesn't come, so a lost answer can't hold the old thread", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReadyThreadDestination("l1", "q-9"));
    act(() => vi.advanceTimersByTime(3_999));
    expect(result.current).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("q-9");
  });

  it("returns null for a thread that merged nowhere", () => {
    const { result } = renderHook(() => useReadyThreadDestination("l1", undefined));
    expect(result.current).toBeNull();
    expect(sendToSession).not.toHaveBeenCalled();
  });
});
