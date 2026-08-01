import { act, fireEvent, within, type RenderResult } from "@testing-library/react";
import type { ChatMessage, ThreadWindowState } from "../types.js";
import { getFrontendPerfEntries } from "../utils/frontend-perf-recorder.js";
import {
  createSyntheticLargeLeaderFeedFixture,
  SYNTHETIC_PRIMARY_THREAD_KEY,
} from "../test-fixtures/large-leader-feed-fixture.js";

interface WarmNavigationStoreOverrides {
  sessions: Map<string, { backend_state: "connected"; backend_error: null; isOrchestrator: true }>;
  sdkSessions: Array<{ sessionId: string; archived: false; isOrchestrator: true }>;
  messages: Map<string, ChatMessage[]>;
  threadWindows: Map<string, Map<string, ThreadWindowState>>;
  quests: Array<{ questId: string; title: string; status: string }>;
}

export function runCachedWarmThreadNavigationRegression(input: {
  resetStore: (overrides: WarmNavigationStoreOverrides) => void;
  renderView: () => RenderResult;
}): void {
  const fixture = createSyntheticLargeLeaderFeedFixture();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const cachedWindow = {
    from_item: 0,
    item_count: 30,
    total_items: 30,
    has_older_items: false,
    has_newer_items: false,
    source_history_length: fixture.selectedWindowSourceHistoryLength,
    section_item_count: 10,
    visible_item_count: 3,
  };
  input.resetStore({
    sessions: new Map([["s1", { backend_state: "connected", backend_error: null, isOrchestrator: true }]]),
    sdkSessions: [{ sessionId: "s1", archived: false, isOrchestrator: true }],
    messages: new Map([["s1", fixture.allMessages]]),
    threadWindows: new Map([
      [
        "s1",
        new Map([
          ["main", { ...cachedWindow, thread_key: "main" }],
          [SYNTHETIC_PRIMARY_THREAD_KEY, { ...cachedWindow, thread_key: SYNTHETIC_PRIMARY_THREAD_KEY }],
        ]),
      ],
    ]),
    quests: [{ questId: SYNTHETIC_PRIMARY_THREAD_KEY, title: "Synthetic primary thread", status: "in_progress" }],
  });

  const flushNextPaint = () => {
    act(() => {
      frames.shift()?.(0);
      frames.shift()?.(0);
    });
  };

  try {
    const view = input.renderView();
    const scope = within(view.container);
    const questButton = scope
      .getAllByTestId("mock-workboard-thread")
      .find((button) => button.getAttribute("data-thread-key") === SYNTHETIC_PRIMARY_THREAD_KEY);
    expect(questButton).toBeDefined();

    fireEvent.click(questButton!);
    flushNextPaint();
    fireEvent.click(scope.getByTestId("mock-workboard-main"));
    flushNextPaint();
    fireEvent.click(questButton!);
    flushNextPaint();

    expect(
      getFrontendPerfEntries()
        .filter((entry) => entry.kind === "thread_navigation")
        .map((entry) => ({ from: entry.fromThreadKey, to: entry.toThreadKey, cached: entry.cachedWindow })),
    ).toEqual([
      { from: "main", to: SYNTHETIC_PRIMARY_THREAD_KEY, cached: true },
      { from: SYNTHETIC_PRIMARY_THREAD_KEY, to: "main", cached: true },
      { from: "main", to: SYNTHETIC_PRIMARY_THREAD_KEY, cached: true },
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
}
