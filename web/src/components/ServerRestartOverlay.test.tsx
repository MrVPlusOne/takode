// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ServerRestartOverlay } from "./ServerRestartOverlay.js";

describe("ServerRestartOverlay", () => {
  it("names the current phase and counts elapsed time from the click across phases", () => {
    // The overlay stays mounted while the phase changes, so the clock must not restart
    // when preparation hands over to the restart wait.
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ServerRestartOverlay phase="preparing" />);
      expect(screen.getByRole("heading", { name: "Preparing restart" })).toBeInTheDocument();
      expect(screen.getByText("Prepare")).toHaveAttribute("aria-current", "step");
      expect(screen.getByText("Elapsed 0:00")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(65_000);
      });
      rerender(<ServerRestartOverlay phase="restarting" />);
      expect(screen.getByRole("heading", { name: "Restarting server" })).toBeInTheDocument();
      expect(screen.getByText("✓ Prepare")).not.toHaveAttribute("aria-current");
      expect(screen.getByText("Restart")).toHaveAttribute("aria-current", "step");
      expect(screen.getByText("Elapsed 1:05")).toBeInTheDocument();

      rerender(<ServerRestartOverlay phase="reloading" />);
      expect(screen.getByRole("heading", { name: "Server is back" })).toBeInTheDocument();
      expect(screen.getByText("Reload")).toHaveAttribute("aria-current", "step");
    } finally {
      vi.useRealTimers();
    }
  });
});
