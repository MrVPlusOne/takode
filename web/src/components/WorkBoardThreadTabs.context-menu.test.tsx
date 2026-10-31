// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { ThreadTabRail, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { useStore } from "../store.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";

// Thread menu tests: on a thread listed under its status group, long-press on touch and
// right-click on desktop open one menu: Notify Me (quest threads, once the server's state is
// known), then Remind me later and Copy link.

let sessionCounter = 0;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chip(threadKey: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    questId: threadKey,
    title: `Title ${threadKey}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: true,
    updatedAt: 0,
    ...overrides,
  };
}

/** Publishes the server-owned Notify Me projection the menu reads its state from. */
function publishMonitoring(sessionId: string, threads: Record<string, { pendingResultId: string | null }>) {
  const pendingCount = Object.values(threads).filter((thread) => thread.pendingResultId).length;
  useStore.getState().applySyncedProjectionSnapshot({
    type: "synced_projection_snapshot",
    projection: THREAD_MONITORING_PROJECTION,
    key: sessionId,
    generation: `tab-menu-${sessionId}`,
    revision: 1,
    value: {
      revision: 1,
      alertVersion: 1,
      trackedCount: Object.keys(threads).length,
      pendingCount,
      threads,
    },
  });
}

function renderRail({
  tabs,
  monitoring,
}: {
  tabs: PrimaryThreadChip[];
  monitoring?: Record<string, { pendingResultId: string | null }>;
}) {
  const sessionId = `tab-menu-session-${++sessionCounter}`;
  if (monitoring) publishMonitoring(sessionId, monitoring);
  const onSelectThread = vi.fn();
  render(
    <ThreadTabRail
      tabs={tabs}
      sessionId={sessionId}
      currentThreadKey="main"
      onSelectThread={onSelectThread}
      board={{ helpers: null, open: false, dots: [], onToggle: () => {} }}
    />,
  );
  // The threads are in progress: right-click on their group opens its list, even for one thread.
  const tab = (threadKey: string) => {
    if (!screen.queryByTestId("thread-tab-group-list"))
      fireEvent.contextMenu(screen.getByTestId("thread-tab-group-chip"), { clientX: 5, clientY: 5 });
    return screen.getAllByTestId("thread-tab-list-row").find((element) => element.dataset.threadKey === threadKey)!;
  };
  return { sessionId, onSelectThread, tab };
}

function menuLabels(): string[] {
  return screen.queryAllByRole("button").flatMap((button) => (button.closest(".fixed") ? [button.textContent!] : []));
}

describe("thread tab context menu", () => {
  it("opens on right-click with Notify Me, which reaches its handler", () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { sessionId, tab } = renderRail({
      tabs: [chip("q-7")],
      monitoring: {},
    });

    const contextMenu = createEvent.contextMenu(tab("q-7"));
    fireEvent(tab("q-7"), contextMenu);
    // The browser's own menu must not appear on top of ours.
    expect(contextMenu.defaultPrevented).toBe(true);
    // Threads don't close (every one stays in its group), so there is no Close tab.
    expect(menuLabels()).toEqual(["Notify Me", "Remind me later", "Copy link"]);

    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/${sessionId}/thread-monitoring/q-7`,
      expect.objectContaining({ body: JSON.stringify({ action: "track" }) }),
    );
    expect(menuLabels()).toEqual([]);
  });

  it("mirrors the banner's Notify Me state: stop tracking, or acknowledge a waiting result", () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { tab } = renderRail({
      tabs: [chip("q-7"), chip("q-8")],
      monitoring: {
        "q-7": { pendingResultId: null },
        "q-8": { pendingResultId: "4" },
      },
    });

    // The tab bar also looks up its tabs' Library topics (a GET); only the updates have a body.
    const updates = () => fetch.mock.calls.filter((call) => call[1]?.body).map((call) => JSON.parse(call[1].body));
    fireEvent.contextMenu(tab("q-7"));
    fireEvent.click(screen.getByRole("button", { name: "Turn off Notify Me" }));
    expect(updates()[0]).toEqual({
      action: "untrack",
    });

    fireEvent.contextMenu(tab("q-8"));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge result" }));
    expect(updates()[1]).toEqual({
      action: "acknowledge",
      resultId: "4",
    });
  });

  it("opens on touch long-press and stays open when the finger lifts, without selecting the tab", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    const { onSelectThread, tab } = renderRail({
      tabs: [chip("q-7")],
      monitoring: {},
    });
    const closeButton = within(tab("q-7")).getByTestId("thread-tab-list-row-select");

    // The row presses in while the long-press is pending.
    fireEvent.touchStart(closeButton, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    expect(tab("q-7").style.scale).toBe("0.94");
    act(() => vi.advanceTimersByTime(499));
    expect(menuLabels()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(menuLabels()).toEqual(["Notify Me", "Remind me later", "Copy link"]);
    expect(tab("q-7").style.scale).toBe("");
    // Haptic tick where the platform supports it (Android); iOS has no API.
    expect(vibrate).toHaveBeenCalledWith(10);

    // Lifting the finger cancels touchend, but iOS can still emulate
    // mousedown/mouseup/click. The mousedown must not reach the menu's
    // outside-press dismissal, and the click must not select the tab.
    const touchEnd = createEvent.touchEnd(closeButton);
    fireEvent(closeButton, touchEnd);
    expect(touchEnd.defaultPrevented).toBe(true);
    fireEvent.mouseDown(closeButton);
    fireEvent.mouseUp(closeButton);
    fireEvent.click(closeButton);
    // A late or repeated emulated sequence is swallowed too.
    fireEvent.mouseDown(closeButton);
    fireEvent.click(closeButton);
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(menuLabels()).toEqual(["Notify Me", "Remind me later", "Copy link"]);

    // A real tap elsewhere still dismisses the menu, and the next ordinary
    // tap on the tab works.
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.touchStart(document.body, {
      touches: [{ clientX: 300, clientY: 300 }],
    });
    expect(menuLabels()).toEqual([]);
    const select = within(tab("q-7")).getByTestId("thread-tab-list-row-select");
    fireEvent.touchStart(select, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(select);
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    expect(onSelectThread).toHaveBeenCalledWith("q-7");
  });

  it("opens the same menu for right-click and long-press; only the pointer type sizes its rows", () => {
    // Finger-sized rows come from the shared menu's pointer-coarse styles, so
    // desktop right-click stays compact and touch screens always get big rows.
    const { tab } = renderRail({ tabs: [chip("q-7")], monitoring: {} });
    fireEvent.contextMenu(tab("q-7"));
    expect(screen.getByRole("button", { name: "Notify Me" }).className).toContain("pointer-coarse:py-3");
  });

  it("does not open when the finger moves, so scrolling or dragging is unaffected", () => {
    vi.useFakeTimers();
    const { tab } = renderRail({ tabs: [chip("q-7")], monitoring: {} });

    fireEvent.touchStart(tab("q-7"), {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.touchMove(tab("q-7"), {
      touches: [{ clientX: 10, clientY: 30 }],
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(menuLabels()).toEqual([]);
  });

  it("omits Notify Me until the server monitoring state has loaded", () => {
    const { tab } = renderRail({ tabs: [chip("q-7")] });
    fireEvent.contextMenu(tab("q-7"));
    expect(menuLabels()).toEqual(["Remind me later", "Copy link"]);
  });
});
