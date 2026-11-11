// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getViewHistory, resetViewHistoryForTest } from "../utils/view-history.js";
import { useThreadViewed } from "./use-thread-viewed.js";

// Jiayi, Nov 10: "focusing on a chat for more than 2 seconds counts as viewing". A viewed thread
// is reported to its leader's session on the server, which moves it up the Threads view.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  resetViewHistoryForTest();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const posted = () =>
  fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string).threadKey]);

it("reports a thread once its chat has stayed focused for two seconds, and again on each new focus", () => {
  const { rerender } = renderHook((props: Parameters<typeof useThreadViewed>[0]) => useThreadViewed(props), {
    initialProps: { leaderId: "leader-1", viewKey: "q-7", focused: true },
  });
  act(() => vi.advanceTimersByTime(1_900));
  expect(fetchMock).not.toHaveBeenCalled(); // a glance on the way elsewhere is not a view
  act(() => vi.advanceTimersByTime(200));
  expect(posted()).toEqual([["/api/sessions/leader-1/thread-viewed", "q-7"]]);

  rerender({ leaderId: "leader-1", viewKey: "q-7", focused: false });
  rerender({ leaderId: "leader-1", viewKey: "q-7", focused: true });
  act(() => vi.advanceTimersByTime(2_100));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  // The main view lists its tabs in Recently viewed itself, as soon as they open.
  expect(getViewHistory()).toEqual([]);
});

it("reports the leader log as Main's thread and nothing for Home or unfocused chats", () => {
  const { rerender } = renderHook((props: Parameters<typeof useThreadViewed>[0]) => useThreadViewed(props), {
    initialProps: { leaderId: "leader-1" as string | null, viewKey: "main", focused: true },
  });
  act(() => vi.advanceTimersByTime(5_000));
  rerender({ leaderId: "leader-1", viewKey: "q-8", focused: false });
  act(() => vi.advanceTimersByTime(5_000));
  rerender({ leaderId: null, viewKey: "q-8", focused: true });
  act(() => vi.advanceTimersByTime(5_000));
  expect(fetchMock).not.toHaveBeenCalled();

  rerender({ leaderId: "leader-1", viewKey: "all", focused: true });
  act(() => vi.advanceTimersByTime(2_100));
  expect(posted()).toEqual([["/api/sessions/leader-1/thread-viewed", "main"]]);
});

it("lists a side-column view in Recently viewed", () => {
  // A thread read only in the side column and closed used to leave no trace in this browser.
  renderHook(() =>
    useThreadViewed({
      leaderId: "leader-2",
      viewKey: "q-3149",
      focused: true,
      side: true,
    }),
  );
  act(() => vi.advanceTimersByTime(2_100));
  expect(getViewHistory()).toEqual([
    {
      sessionId: "leader-2",
      threadKey: "q-3149",
      viewedAt: expect.any(Number),
      side: true,
    },
  ]);
});
