// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_ACTIVITY_REPORT_INTERVAL_MS, installUserActivityReporter } from "./user-activity.js";

/**
 * Follow-up reminders must not fire while the user is using Takode, but an open
 * window nobody touches is not use. So only real taps and key presses report
 * activity, at most once a minute.
 */
describe("installUserActivityReporter", () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    vi.useRealTimers();
  });

  function userInput(type: "pointerdown" | "keydown") {
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
  }

  it("reports taps and key presses at most once a minute", () => {
    vi.useFakeTimers();
    const report = vi.fn().mockResolvedValue({ ok: true });
    uninstall = installUserActivityReporter(document, report);

    userInput("pointerdown");
    userInput("keydown");
    expect(report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(USER_ACTIVITY_REPORT_INTERVAL_MS);
    userInput("keydown");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("ignores a window that only becomes visible or focused", () => {
    const report = vi.fn().mockResolvedValue({ ok: true });
    uninstall = installUserActivityReporter(document, report);

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));

    expect(report).not.toHaveBeenCalled();
  });
});
