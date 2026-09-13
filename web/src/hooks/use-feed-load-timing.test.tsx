// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import type { BrowserLoadReportMessage } from "../../shared/browser-load-diagnostics.js";
import { useStore } from "../store.js";
import { browserLoadDiagnostics } from "../utils/browser-load-diagnostics.js";
import { useFeedLoadTiming } from "./use-feed-load-timing.js";

const original = useStore.getState();
let reports: BrowserLoadReportMessage[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  reports = [];
  browserLoadDiagnostics.connect("feed-session", (message) => {
    reports.push(message);
    return true;
  });
  browserLoadDiagnostics.identify("feed-session", "feed-socket");
});
afterEach(() => {
  browserLoadDiagnostics.close("feed-session");
  useStore.setState(original, true);
  vi.useRealTimers();
});

it("records the committed selection and actual loading branch, never another cached thread's window", () => {
  // Producer-shaped bounds are present for two views. The observer must use the
  // rendered view even when another cached window already exists in the store.
  const window = (threadKey: string, windowHash: string) => ({
    ...buildThreadWindowSync({
      messageHistory: [],
      threadKey,
      fromItem: -1,
      itemCount: 30,
      sectionItemCount: 10,
      visibleItemCount: 3,
    }).window,
    window_hash: windowHash,
  });
  useStore.setState({
    threadWindows: new Map([
      [
        "feed-session",
        new Map([
          ["q-12", window("q-12", "aaaa")],
          ["q-13", window("q-13", "bbbb")],
        ]),
      ],
    ]),
  });
  const hook = renderHook(({ view, loading }) => useFeedLoadTiming("feed-session", view, loading), {
    initialProps: { view: "q-12", loading: true },
  });
  hook.rerender({ view: "q-12", loading: false });
  hook.rerender({ view: "q-13", loading: false });
  act(() => vi.advanceTimersByTime(200));
  expect(reports.flatMap((message) => message.report.stages).filter((stage) => stage.stage === "feed_commit")).toEqual([
    expect.objectContaining({ view: "q-12", loading: true, windowHash: "aaaa" }),
    expect.objectContaining({ view: "q-12", loading: false, windowHash: "aaaa" }),
    expect.objectContaining({ view: "q-13", loading: false, windowHash: "bbbb" }),
  ]);
  hook.unmount();
});
