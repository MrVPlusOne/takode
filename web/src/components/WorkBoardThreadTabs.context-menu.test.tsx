// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { ThreadTabRail, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { useStore } from "../store.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";

// Tab menu tests: long-press on touch and right-click on desktop open one menu
// whose actions (Close tab, Notify Me) depend on what applies to the tab.

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
  const onCloseThreadTab = vi.fn();
  render(
    <ThreadTabRail
      tabs={tabs}
      reorderableThreadKeys={[]}
      sessionId={sessionId}
      currentThreadKey="main"
      onSelectThread={onSelectThread}
      onCloseThreadTab={onCloseThreadTab}
    />,
  );
  const tab = (threadKey: string) =>
    screen.getAllByTestId("thread-tab").find((element) => element.dataset.threadKey === threadKey)!;
  return { sessionId, onSelectThread, onCloseThreadTab, tab };
}

function menuLabels(): string[] {
  return screen.queryAllByRole("button").flatMap((button) => (button.closest(".fixed") ? [button.textContent!] : []));
}

describe("thread tab context menu", () => {
  it("opens on right-click with Close tab and Notify Me, and each action reaches its handler", () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { sessionId, onCloseThreadTab, tab } = renderRail({
      tabs: [chip("q-7")],
      monitoring: {},
    });

    const contextMenu = createEvent.contextMenu(tab("q-7"));
    fireEvent(tab("q-7"), contextMenu);
    // The browser's own menu must not appear on top of ours.
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(menuLabels()).toEqual(["Close tab", "Notify Me"]);

    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/${sessionId}/thread-monitoring/q-7`,
      expect.objectContaining({ body: JSON.stringify({ action: "track" }) }),
    );
    expect(menuLabels()).toEqual([]);

    fireEvent.contextMenu(tab("q-7"));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-7");
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

    fireEvent.contextMenu(tab("q-7"));
    fireEvent.click(screen.getByRole("button", { name: "Turn off Notify Me" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: "untrack",
    });

    fireEvent.contextMenu(tab("q-8"));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge result" }));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      action: "acknowledge",
      resultId: "4",
    });
  });

  it("opens on touch long-press and stays open when the finger lifts, without selecting or closing the tab", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    const { onSelectThread, onCloseThreadTab, tab } = renderRail({
      tabs: [chip("q-7")],
      monitoring: {},
    });
    const closeButton = within(tab("q-7")).getByTestId("thread-tab-close");

    // The tab presses in while the long-press is pending.
    fireEvent.touchStart(closeButton, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    expect(tab("q-7").dataset.pressing).toBe("true");
    act(() => vi.advanceTimersByTime(499));
    expect(menuLabels()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(menuLabels()).toEqual(["Close tab", "Notify Me"]);
    expect(tab("q-7").dataset.pressing).toBe("false");
    // Haptic tick where the platform supports it (Android); iOS has no API.
    expect(vibrate).toHaveBeenCalledWith(10);
    // Long-press menus get finger-sized rows.
    expect(screen.getByRole("button", { name: "Close tab" }).className).toContain("!py-3");

    // Lifting the finger cancels touchend, but iOS can still emulate
    // mousedown/mouseup/click. The mousedown must not reach the menu's
    // outside-press dismissal, and the click must not close the tab.
    const touchEnd = createEvent.touchEnd(closeButton);
    fireEvent(closeButton, touchEnd);
    expect(touchEnd.defaultPrevented).toBe(true);
    fireEvent.mouseDown(closeButton);
    fireEvent.mouseUp(closeButton);
    fireEvent.click(closeButton);
    // A late or repeated emulated sequence is swallowed too.
    fireEvent.mouseDown(closeButton);
    fireEvent.click(closeButton);
    expect(onCloseThreadTab).not.toHaveBeenCalled();
    expect(menuLabels()).toEqual(["Close tab", "Notify Me"]);

    // A real tap elsewhere still dismisses the menu, and the next ordinary
    // tap on the tab works.
    fireEvent.touchStart(document.body, {
      touches: [{ clientX: 300, clientY: 300 }],
    });
    expect(menuLabels()).toEqual([]);
    const select = within(tab("q-7")).getByTestId("thread-tab-select");
    fireEvent.touchStart(select, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(select);
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    expect(onSelectThread).toHaveBeenCalledWith("q-7");
  });

  it("keeps right-click menus at the desktop size", () => {
    const { tab } = renderRail({ tabs: [chip("q-7")], monitoring: {} });
    fireEvent.contextMenu(tab("q-7"));
    expect(screen.getByRole("button", { name: "Close tab" }).className).not.toContain("!py-3");
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

  it("shows only applicable actions and leaves tabs with none, such as Main, to the browser", () => {
    const { tab } = renderRail({
      tabs: [chip("q-7", { canClose: false }), chip("q-8")],
      monitoring: {},
    });

    fireEvent.contextMenu(tab("q-7"));
    expect(menuLabels()).toEqual(["Notify Me"]);
    fireEvent.mouseDown(document.body);

    const mainContextMenu = createEvent.contextMenu(screen.getByTestId("thread-main-tab"));
    fireEvent(screen.getByTestId("thread-main-tab"), mainContextMenu);
    expect(mainContextMenu.defaultPrevented).toBe(false);
    expect(menuLabels()).toEqual([]);
  });

  it("omits Notify Me until the server monitoring state has loaded", () => {
    const { tab } = renderRail({
      tabs: [chip("q-7"), chip("q-8", { canClose: false })],
    });

    fireEvent.contextMenu(tab("q-7"));
    expect(menuLabels()).toEqual(["Close tab"]);
    fireEvent.mouseDown(document.body);

    // A tab with no applicable action gets no custom menu at all.
    const contextMenu = createEvent.contextMenu(tab("q-8"));
    fireEvent(tab("q-8"), contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
    expect(menuLabels()).toEqual([]);
  });
});
