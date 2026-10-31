// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
const checkHealthStatus = vi.hoisted(() => vi.fn());
vi.mock("../api/server-status.js", () => ({ checkHealthStatus }));
import {
  beginBuildIdentityObservation,
  observeServerBuildIdentity,
  resetBuildCompatibilityForTest,
} from "../build-compatibility.js";
import { AppErrorBoundary } from "./AppErrorBoundary.js";

function Crasher(): ReactElement {
  throw new Error("render failed");
}

describe("AppErrorBoundary", () => {
  // The crash page asks the server whether a newer Takode is ready; by default it isn't reachable.
  beforeEach(() => {
    checkHealthStatus.mockResolvedValue({ ok: false, buildId: null, servedFrontendBuildId: null });
  });

  it("shows fallback UI on render error", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("A runtime error occurred")).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  it("shows the error message in technical details", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    // Technical details should be in a collapsed <details> element
    const details = screen.getByText("Technical details");
    expect(details).toBeTruthy();

    // Expand the details
    fireEvent.click(details);

    // The original error message should be visible inside the <pre> tag
    const errorPre = container.querySelector("pre.text-\\[11px\\]");
    expect(errorPre?.textContent).toContain("render failed");
    consoleErrorSpy.mockRestore();
  });

  it("offers both Reload and Retry buttons", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  it("shows a friendly message for React error #185 (max update depth)", () => {
    // Simulate the minified React error #185 message
    function MaxDepthCrasher(): ReactElement {
      throw new Error("Minified React error #185; visit https://react.dev/errors/185");
    }

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <MaxDepthCrasher />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByText("A UI component entered an infinite update loop (Maximum update depth exceeded)."),
    ).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  describe("after a server update", () => {
    // A tab left open across Restart Server keeps running the previous frontend against the new
    // server until reloaded. On Oct 25 the old topic list read a field the new server no longer
    // sent and the tab crashed ("Cannot read properties of undefined (reading 'length')"). The crash
    // page holds no work, so when a newer frontend is ready it reloads into it by itself.
    const reload = vi.fn();
    const originalLocation = window.location;

    beforeEach(() => {
      vi.useFakeTimers();
      Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
      checkHealthStatus.mockResolvedValue({ ok: false, buildId: null, servedFrontendBuildId: null });
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
      resetBuildCompatibilityForTest();
      sessionStorage.clear();
      reload.mockReset();
      checkHealthStatus.mockReset();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function serverServes(buildId: string) {
      observeServerBuildIdentity(buildId, buildId, beginBuildIdentityObservation());
    }

    it("reloads into the newer frontend the server already announced", () => {
      serverServes("build-new");
      render(
        <AppErrorBoundary>
          <Crasher />
        </AppErrorBoundary>,
      );
      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("app-update-reloading").textContent).toContain("Takode was updated");
    });

    it("keeps asking the server after a crash, and reloads once the new version is ready", async () => {
      // The crash can come before the app's own check noticed the update, and the server may
      // still be starting: the page asks again until it answers with a newer build.
      render(
        <AppErrorBoundary>
          <Crasher />
        </AppErrorBoundary>,
      );
      await act(async () => {});
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText("A runtime error occurred")).toBeTruthy();

      checkHealthStatus.mockResolvedValue({ ok: true, buildId: "build-new", servedFrontendBuildId: "build-new" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("shows the error instead of reloading again into the same build", () => {
      // If the update itself is broken, the reloaded page must not reload forever.
      sessionStorage.setItem("takode-crash-update-reload", "build-new");
      serverServes("build-new");
      render(
        <AppErrorBoundary>
          <Crasher />
        </AppErrorBoundary>,
      );
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText("A runtime error occurred")).toBeTruthy();
    });
  });

  describe("resetting this browser's saved state", () => {
    // A full localStorage quota once crashed the app on every load: the bad state lived in the
    // browser, so Reload landed on the same crash. The crash page offers a reset that clears what
    // the browser saved for Takode and reloads, so the user can recover without an agent.
    const reload = vi.fn();
    const originalLocation = window.location;

    beforeEach(() => {
      Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
      localStorage.clear();
      reload.mockReset();
    });

    it("clears localStorage and reloads", () => {
      localStorage.setItem("server-1:cc-current-session", "s1");
      localStorage.setItem("cc-zoom-level", "1.2");
      render(
        <AppErrorBoundary>
          <Crasher />
        </AppErrorBoundary>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Reset this browser's saved state" }));

      expect(localStorage.length).toBe(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("still reloads when the browser refuses to clear storage", () => {
      // Storage can be blocked outright; the reset must not throw from the crash page itself.
      vi.spyOn(Storage.prototype, "clear").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      render(
        <AppErrorBoundary>
          <Crasher />
        </AppErrorBoundary>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Reset this browser's saved state" }));

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
