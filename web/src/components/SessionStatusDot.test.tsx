// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { deriveSessionStatus, SessionStatusDot, type SessionStatusDotProps } from "./SessionStatusDot.js";

/**
 * Tests for the SessionStatusDot component and its deriveSessionStatus helper.
 *
 * The status priority (highest to lowest) is:
 *   1. archived       -> gray dot, no pulse
 *   2. permission      -> amber dot, pulsing
 *   3. disconnected    -> red dot, no pulse
 *   4. running         -> green dot, pulsing
 *   5. compacting      -> amber dot, pulsing
 *   6. idle            -> dim green dot, no pulse
 */

function makeProps(overrides: Partial<SessionStatusDotProps> = {}): SessionStatusDotProps {
  return {
    archived: false,
    permCount: 0,
    isConnected: true,
    sdkState: "connected",
    status: "idle",
    ...overrides,
  };
}

describe("deriveSessionStatus", () => {
  it("returns 'archived' when session is archived, regardless of other state", () => {
    // Even if there are pending permissions and the session is running,
    // an archived session should always show as archived.
    const result = deriveSessionStatus(makeProps({
      archived: true,
      permCount: 3,
      status: "running",
    }));
    expect(result).toBe("archived");
  });

  it("returns 'permission' when there are pending permissions on a non-archived session", () => {
    const result = deriveSessionStatus(makeProps({ permCount: 2 }));
    expect(result).toBe("permission");
  });

  it("returns 'disconnected' when sdkState is 'exited'", () => {
    // CLI process has exited — session should show as disconnected.
    const result = deriveSessionStatus(makeProps({
      sdkState: "exited",
      isConnected: false,
    }));
    expect(result).toBe("disconnected");
  });

  it("returns 'disconnected' when not connected and not starting", () => {
    // WebSocket disconnected, CLI not starting up — disconnected state.
    const result = deriveSessionStatus(makeProps({
      isConnected: false,
      sdkState: "connected",
    }));
    expect(result).toBe("disconnected");
  });

  it("does NOT return 'disconnected' when not connected but still starting", () => {
    // During initial startup, isConnected may be false briefly.
    // We should NOT show disconnected while sdkState is "starting".
    const result = deriveSessionStatus(makeProps({
      isConnected: false,
      sdkState: "starting",
    }));
    expect(result).not.toBe("disconnected");
    // It should fall through to idle since status is "idle"
    expect(result).toBe("idle");
  });

  it("returns 'running' when status is 'running' and connected", () => {
    const result = deriveSessionStatus(makeProps({ status: "running" }));
    expect(result).toBe("running");
  });

  it("returns 'compacting' when status is 'compacting' and connected", () => {
    const result = deriveSessionStatus(makeProps({ status: "compacting" }));
    expect(result).toBe("compacting");
  });

  it("returns 'idle' for a normal connected session with no activity", () => {
    const result = deriveSessionStatus(makeProps());
    expect(result).toBe("idle");
  });

  it("returns 'idle' when status is null (initial state) and connected", () => {
    const result = deriveSessionStatus(makeProps({ status: null }));
    expect(result).toBe("idle");
  });

  // Priority tests: permission > disconnected > running
  it("prioritizes 'permission' over 'running'", () => {
    // If agent is running but also has a pending permission, permission wins.
    const result = deriveSessionStatus(makeProps({
      permCount: 1,
      status: "running",
    }));
    expect(result).toBe("permission");
  });

  it("prioritizes 'permission' over 'disconnected'", () => {
    // Edge case: permissions pending but also disconnected. Permission wins.
    const result = deriveSessionStatus(makeProps({
      permCount: 1,
      isConnected: false,
      sdkState: "exited",
    }));
    expect(result).toBe("permission");
  });
});

describe("SessionStatusDot component", () => {
  it("renders a dot with data-status attribute matching derived status", () => {
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("data-status", "running");
  });

  it("renders pulse element for running status", () => {
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    expect(screen.getByTestId("session-status-pulse")).toBeInTheDocument();
  });

  it("renders pulse element for permission status", () => {
    render(<SessionStatusDot {...makeProps({ permCount: 1 })} />);
    expect(screen.getByTestId("session-status-pulse")).toBeInTheDocument();
  });

  it("renders pulse element for compacting status", () => {
    render(<SessionStatusDot {...makeProps({ status: "compacting" })} />);
    expect(screen.getByTestId("session-status-pulse")).toBeInTheDocument();
  });

  it("does NOT render pulse for idle status", () => {
    render(<SessionStatusDot {...makeProps()} />);
    expect(screen.queryByTestId("session-status-pulse")).not.toBeInTheDocument();
  });

  it("does NOT render pulse for archived status", () => {
    render(<SessionStatusDot {...makeProps({ archived: true })} />);
    expect(screen.queryByTestId("session-status-pulse")).not.toBeInTheDocument();
  });

  it("does NOT render pulse for disconnected status", () => {
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    expect(screen.queryByTestId("session-status-pulse")).not.toBeInTheDocument();
  });

  it("shows correct title for each status", () => {
    const { rerender } = render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    expect(screen.getByTitle("Running")).toBeInTheDocument();

    rerender(<SessionStatusDot {...makeProps({ permCount: 1 })} />);
    expect(screen.getByTitle("Waiting for permission")).toBeInTheDocument();

    rerender(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    expect(screen.getByTitle("Disconnected")).toBeInTheDocument();

    rerender(<SessionStatusDot {...makeProps({ archived: true })} />);
    expect(screen.getByTitle("Archived")).toBeInTheDocument();

    rerender(<SessionStatusDot {...makeProps()} />);
    expect(screen.getByTitle("Idle")).toBeInTheDocument();

    rerender(<SessionStatusDot {...makeProps({ status: "compacting" })} />);
    expect(screen.getByTitle("Compacting context")).toBeInTheDocument();
  });

  it("applies the correct CSS color class for disconnected state (red)", () => {
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.className).toContain("bg-cc-error");
  });

  it("applies the correct CSS color class for running state (green)", () => {
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.className).toContain("bg-cc-success");
    // Should be solid green, not the dim variant
    expect(dot.className).not.toContain("bg-cc-success/60");
  });
});
