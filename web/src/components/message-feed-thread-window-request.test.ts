// @vitest-environment jsdom
/**
 * A feed beside the main one (the side column) asks for its thread's windows without making that
 * thread the view the server refreshes, and without taking the main feed's pending-request slot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
import { useStore } from "../store.js";
import { useThreadWindowRequester } from "./message-feed-thread-window-request.js";

afterEach(() => {
  sendToSession.mockClear();
  useStore.getState().setPendingThreadWindowRequest?.("s1", null);
});

function request(secondary: boolean) {
  const setPending = vi.fn();
  const { result } = renderHook(() =>
    useThreadWindowRequester({
      activeThreadWindow: null,
      normalizedThreadKey: "q-2",
      sectionTurnCount: 10,
      sessionId: "s1",
      secondary,
      onWindowRequest: vi.fn(),
      setPendingInitialThreadWindowKey: setPending,
    }),
  );
  return { send: result.current, setPending };
}

describe("thread window requests", () => {
  it("lets the main feed's request make its thread the active view", () => {
    const { send, setPending } = request(false);
    expect(send(-1)).toBe(true);
    expect(sendToSession).toHaveBeenLastCalledWith("s1", expect.objectContaining({ activate_view: true }));
    expect(useStore.getState().pendingThreadWindowRequests?.get("s1")).toBe("q-2");
    expect(setPending).toHaveBeenCalledWith("q-2");
  });

  it("keeps a side feed's request from changing the active view or the main feed's pending request", () => {
    // The main feed already waits for this thread's window; the side feed still asks for its own.
    useStore.getState().setPendingThreadWindowRequest?.("s1", "q-2");
    const { send, setPending } = request(true);
    expect(send(-1)).toBe(true);
    expect(sendToSession).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({ type: "thread_window_request", thread_key: "q-2", activate_view: false }),
    );
    expect(setPending).not.toHaveBeenCalled();
  });
});
