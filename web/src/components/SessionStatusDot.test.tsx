// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { deriveSessionStatus, SessionStatusDot, type SessionStatusDotProps } from "./SessionStatusDot.js";

/**
 * Tests for the SessionStatusDot component and its deriveSessionStatus helper.
 *
 * The status priority (highest to lowest) is:
 *   1. archived       -> gray dot, no glow
 *   2. permission      -> amber dot, breathing glow
 *   3. disconnected    -> plug icon, no glow
 *   4. running         -> green dot, breathing glow
 *   5. compacting      -> green dot, breathing glow
 *   6. idle            -> gray dot, no glow
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
    const result = deriveSessionStatus(
      makeProps({
        archived: true,
        permCount: 3,
        status: "running",
      }),
    );
    expect(result).toBe("archived");
  });

  it("returns 'permission' when there are pending permissions on a non-archived session", () => {
    const result = deriveSessionStatus(makeProps({ permCount: 2 }));
    expect(result).toBe("permission");
  });

  it("returns 'disconnected' when sdkState is 'exited'", () => {
    // CLI process has exited — session should show as disconnected.
    const result = deriveSessionStatus(
      makeProps({
        sdkState: "exited",
        isConnected: false,
      }),
    );
    expect(result).toBe("disconnected");
  });

  it("returns 'disconnected' when not connected and sdkState is null", () => {
    // WebSocket disconnected and no SDK process info — disconnected state.
    const result = deriveSessionStatus(
      makeProps({
        isConnected: false,
        sdkState: null,
      }),
    );
    expect(result).toBe("disconnected");
  });

  it("does NOT return 'disconnected' when not connected but still starting", () => {
    // During initial startup, isConnected may be false briefly.
    // We should NOT show disconnected while sdkState is "starting".
    const result = deriveSessionStatus(
      makeProps({
        isConnected: false,
        sdkState: "starting",
      }),
    );
    expect(result).not.toBe("disconnected");
    expect(result).toBe("idle");
  });

  it("returns 'idle' when CLI is connected (REST fallback provides accurate isConnected)", () => {
    // With the REST API enriching sessions with cliConnected, non-active sessions
    // now get an accurate isConnected value. When the CLI is alive, isConnected=true.
    const result = deriveSessionStatus(
      makeProps({
        isConnected: true,
        sdkState: "connected",
      }),
    );
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

  // Unread/attention tests
  it("returns 'completed_unread' when idle with hasUnread=true", () => {
    // Agent finished and user hasn't checked yet — blue dot.
    const result = deriveSessionStatus(makeProps({ hasUnread: true }));
    expect(result).toBe("completed_unread");
  });

  it("returns 'running' over 'completed_unread' when still running", () => {
    // Even if marked unread, running status takes priority.
    const result = deriveSessionStatus(makeProps({ status: "running", hasUnread: true }));
    expect(result).toBe("running");
  });

  it("returns 'permission' over 'completed_unread'", () => {
    const result = deriveSessionStatus(makeProps({ permCount: 1, hasUnread: true }));
    expect(result).toBe("permission");
  });

  it("returns 'disconnected' over 'completed_unread'", () => {
    const result = deriveSessionStatus(makeProps({ isConnected: false, sdkState: "exited", hasUnread: true }));
    expect(result).toBe("disconnected");
  });

  it("returns 'idle' when hasUnread is false or undefined", () => {
    expect(deriveSessionStatus(makeProps({ hasUnread: false }))).toBe("idle");
    expect(deriveSessionStatus(makeProps())).toBe("idle");
  });

  // Idle-killed sessions show as "idle" (gray) instead of "disconnected" (red)
  it("returns 'idle' for disconnected sessions killed by idle manager", () => {
    // Sessions killed by the idle manager should not show the alarming red dot.
    const result = deriveSessionStatus(
      makeProps({
        isConnected: false,
        sdkState: "exited",
        idleKilled: true,
      }),
    );
    expect(result).toBe("idle");
  });

  it("returns 'disconnected' when not idle-killed (normal disconnect)", () => {
    // Normal disconnects without idle kill should still show red.
    const result = deriveSessionStatus(
      makeProps({
        isConnected: false,
        sdkState: "exited",
        idleKilled: false,
      }),
    );
    expect(result).toBe("disconnected");
  });

  it("returns 'permission' over idle-killed", () => {
    // Permission always takes priority, even for idle-killed sessions.
    const result = deriveSessionStatus(
      makeProps({
        isConnected: false,
        sdkState: "exited",
        idleKilled: true,
        permCount: 1,
      }),
    );
    expect(result).toBe("permission");
  });

  // Priority tests: permission > disconnected > running
  it("prioritizes 'permission' over 'running'", () => {
    // If agent is running but also has a pending permission, permission wins.
    const result = deriveSessionStatus(
      makeProps({
        permCount: 1,
        status: "running",
      }),
    );
    expect(result).toBe("permission");
  });

  it("prioritizes 'permission' over 'disconnected'", () => {
    // Edge case: permissions pending but also disconnected. Permission wins.
    const result = deriveSessionStatus(
      makeProps({
        permCount: 1,
        isConnected: false,
        sdkState: "exited",
      }),
    );
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

  it("applies breathing glow animation for running status", () => {
    // Running status should have the shared glow animation.
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("yarn-glow-breathe 2s ease-in-out infinite");
    expect(dot.style.getPropertyValue("--glow-color")).toBe("rgba(34, 197, 94, 0.6)");
  });

  it("applies breathing glow animation for permission status", () => {
    // Permission status should have the shared glow animation and amber glow color.
    render(<SessionStatusDot {...makeProps({ permCount: 1 })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("yarn-glow-breathe 2s ease-in-out infinite");
    expect(dot.style.getPropertyValue("--glow-color")).toBe("rgba(245, 158, 11, 0.6)");
  });

  it("applies breathing glow animation for compacting status", () => {
    // Compacting uses the same green activity glow as running.
    render(<SessionStatusDot {...makeProps({ status: "compacting" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("yarn-glow-breathe 2s ease-in-out infinite");
    expect(dot.style.getPropertyValue("--glow-color")).toBe("rgba(34, 197, 94, 0.6)");
  });

  it("does NOT apply glow animation for idle status", () => {
    // Idle sessions should have no animation or glow
    render(<SessionStatusDot {...makeProps()} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("");
  });

  it("does NOT apply glow animation for archived status", () => {
    // Archived sessions should have no animation or glow
    render(<SessionStatusDot {...makeProps({ archived: true })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("");
  });

  it("does NOT apply glow animation for disconnected status", () => {
    // Disconnected sessions should have no animation or glow
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.style.animation).toBe("");
  });

  it("does not render a separate pulse ring element", () => {
    // The old pulse ring overlay span has been removed; glow is now on the dot itself
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
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

  it("preserves the unplug icon for disconnected state", () => {
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    const dot = screen.getByTestId("session-status-dot");
    const plugSvg = dot.querySelector("svg")!;
    expect(plugSvg.className.baseVal).toContain("text-cc-muted/60");
  });

  it("renders a simple green rounded dot for running state", () => {
    render(<SessionStatusDot {...makeProps({ status: "running" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.querySelector("svg")).toBeNull();
    const statusDot = dot.querySelector("span")!;
    expect(statusDot).toHaveClass("rounded-full", "bg-emerald-500");
  });

  it("renders a blue rounded dot for completed_unread state with correct title", () => {
    render(<SessionStatusDot {...makeProps({ hasUnread: true })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot).toHaveAttribute("data-status", "completed_unread");
    const statusDot = dot.querySelector("span")!;
    expect(statusDot).toHaveClass("rounded-full", "bg-blue-500");
    expect(dot.style.animation).toBe(""); // no glow
    expect(screen.getByTitle("Completed — needs review")).toBeInTheDocument();
  });

  it("renders a simple gray rounded dot for idle status", () => {
    render(<SessionStatusDot {...makeProps()} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.querySelector("svg")).toBeNull();
    const statusDot = dot.querySelector("span")!;
    expect(statusDot).toHaveClass("rounded-full", "bg-cc-muted/50");
  });

  it("does not render a rounded dot for disconnected status", () => {
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited" })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot.querySelector("svg")).toBeInTheDocument();
    expect(dot.querySelector("span")).toBeNull();
  });

  it("shows idle-killed sessions as idle (gray) with 'Idle' title", () => {
    // Sessions killed by the idle manager should look like normal idle sessions
    // (gray dot, no glow), not like alarming disconnected sessions (red dot).
    render(<SessionStatusDot {...makeProps({ isConnected: false, sdkState: "exited", idleKilled: true })} />);
    const dot = screen.getByTestId("session-status-dot");
    expect(dot).toHaveAttribute("data-status", "idle");
    expect(screen.getByTitle("Idle")).toBeInTheDocument();
    expect(dot.querySelector("svg")).toBeNull();
    const statusDot = dot.querySelector("span")!;
    expect(statusDot).toHaveClass("bg-cc-muted/50");
  });
});
