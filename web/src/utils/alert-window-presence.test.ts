// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test loads a fresh module, standing in for a separate browser window with its own id.
async function openWindow() {
  vi.resetModules();
  return import("./alert-window-presence.js");
}

describe("alert window presence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: Date.parse("2026-10-17T00:00:00Z") });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lets only the most recently used open window play alerts", async () => {
    const records = (usedAt: Record<string, number>) =>
      localStorage.setItem(
        "cc-alert-windows",
        JSON.stringify(
          Object.fromEntries(Object.entries(usedAt).map(([id, at]) => [id, { usedAt: at, aliveAt: Date.now() }])),
        ),
      );
    const alertWindow = await openWindow();
    const stop = alertWindow.startAlertWindowPresence();
    const ownId = Object.keys(JSON.parse(localStorage.getItem("cc-alert-windows")!))[0]!;
    const ownUsedAt = JSON.parse(localStorage.getItem("cc-alert-windows")!)[ownId].usedAt as number;

    records({ [ownId]: ownUsedAt, other: ownUsedAt + 1 });
    expect(alertWindow.isMostRecentlyUsedAlertWindow()).toBe(false);

    records({ [ownId]: ownUsedAt + 2, other: ownUsedAt + 1 });
    expect(alertWindow.isMostRecentlyUsedAlertWindow()).toBe(true);
    stop();
  });

  it("ignores a newer window whose heartbeat stopped, so a crashed window cannot silence alerts", async () => {
    const alertWindow = await openWindow();
    const stop = alertWindow.startAlertWindowPresence();
    const now = Date.now();
    const stored = JSON.parse(localStorage.getItem("cc-alert-windows")!);
    stored.closed = { usedAt: now + 1000, aliveAt: now - 4 * 60_000 };
    localStorage.setItem("cc-alert-windows", JSON.stringify(stored));

    expect(alertWindow.isMostRecentlyUsedAlertWindow(now)).toBe(true);
    stop();
  });

  it("removes its record when the window closes", async () => {
    const alertWindow = await openWindow();
    const stop = alertWindow.startAlertWindowPresence();
    expect(Object.keys(JSON.parse(localStorage.getItem("cc-alert-windows")!))).toHaveLength(1);

    stop();
    expect(JSON.parse(localStorage.getItem("cc-alert-windows")!)).toEqual({});
  });

  it("plays alerts when storage is unreadable", async () => {
    const alertWindow = await openWindow();
    localStorage.setItem("cc-alert-windows", "{not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(alertWindow.isMostRecentlyUsedAlertWindow()).toBe(true);
  });
});
