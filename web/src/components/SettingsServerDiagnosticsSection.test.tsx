// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";

const mockInterruptRestartBlockers = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    interruptRestartBlockers: (...args: unknown[]) => mockInterruptRestartBlockers(...args),
  },
}));

vi.mock("./CollapsibleSection.js", () => ({
  CollapsibleSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

import { SettingsServerDiagnosticsSection } from "./SettingsServerDiagnosticsSection.js";

describe("SettingsServerDiagnosticsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("interrupts restart blockers and renders the inline result summary", async () => {
    mockInterruptRestartBlockers.mockResolvedValue({
      ok: false,
      operationId: "prep-1",
      mode: "standalone",
      restartRequested: false,
      timedOut: false,
      interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
      skipped: [
        {
          sessionId: "leader-1",
          label: "Leader session",
          reasons: ["1 pending permission"],
          detail: "Session was no longer loaded when interrupts were dispatched.",
        },
      ],
      failures: [
        {
          sessionId: "reviewer-1",
          label: "Reviewer session",
          reasons: ["running"],
          detail: "Interrupt routing unavailable",
        },
      ],
      protectedLeaders: [{ sessionId: "leader-1", label: "Leader session" }],
      unresolvedBlockers: [
        {
          sessionId: "approval-1",
          label: "Approval session",
          reasons: ["1 pending permission"],
          detail: "Pending permission blockers remain unresolved until the backend reports cancellation or resolution.",
        },
      ],
      herdDelivery: { suppressed: 2, held: 1, trackingActive: false, countsFinal: true },
    });

    render(
      <SettingsServerDiagnosticsSection
        logFile="/tmp/takode.log"
        restartSupported
        restartError=""
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Interrupt Restart Blockers" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Prepare restart by interrupting active restart blockers? This stops active work, protects idle leaders from prep-related herd wakeups, and reports blockers that remain unresolved.",
    );
    await waitFor(() => expect(mockInterruptRestartBlockers).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Interrupt Result")).toBeInTheDocument();
    expect(screen.getByText("Worker session")).toBeInTheDocument();
    expect(screen.getAllByText("Leader session")).toHaveLength(2);
    expect(screen.getByText("Approval session")).toBeInTheDocument();
    expect(screen.getByText("Reviewer session")).toBeInTheDocument();
    expect(screen.getByText("Session was no longer loaded when interrupts were dispatched.")).toBeInTheDocument();
    expect(screen.getByText("Interrupt routing unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Suppressed prep events: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Held unrelated events: 1/)).toBeInTheDocument();
  });

  it("renders restart prep details supplied by the Restart Server failure path", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        restartSupported
        restartError="Cannot restart while 1 session(s) are still blocking restart readiness: Approval session"
        restartPrepResult={{
          ok: false,
          operationId: "prep-restart",
          mode: "restart",
          restartRequested: false,
          timedOut: true,
          interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
          skipped: [],
          failures: [],
          protectedLeaders: [{ sessionId: "leader-1", label: "Leader session" }],
          unresolvedBlockers: [
            {
              sessionId: "approval-1",
              label: "Approval session",
              reasons: ["1 pending permission"],
              detail:
                "Pending permission blockers remain unresolved until the backend reports cancellation or resolution.",
            },
          ],
          herdDelivery: {
            suppressed: 1,
            held: 0,
            trackingActive: true,
            countsFinal: false,
            detail:
              "Restart-prep herd delivery tracking is active. Counts are current as of this response and may increase as worker events settle.",
          },
        }}
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByText("Restart Prep Result")).toBeInTheDocument();
    expect(screen.getByText("Worker session")).toBeInTheDocument();
    expect(screen.getByText("Approval session")).toBeInTheDocument();
    expect(screen.getByText("Leader session")).toBeInTheDocument();
    expect(screen.getByText(/Blocker wait timed out/)).toBeInTheDocument();
    expect(screen.getByText(/Current suppressed prep events: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Current held unrelated events: 0/)).toBeInTheDocument();
  });

  it("does not present active standalone herd delivery tracking counts as final", async () => {
    mockInterruptRestartBlockers.mockResolvedValue({
      ok: false,
      operationId: "prep-standalone",
      mode: "standalone",
      restartRequested: false,
      timedOut: false,
      interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
      skipped: [],
      failures: [],
      protectedLeaders: [{ sessionId: "leader-1", label: "Leader session" }],
      unresolvedBlockers: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
      herdDelivery: {
        suppressed: 0,
        held: 0,
        trackingActive: true,
        countsFinal: false,
        detail:
          "Restart-prep herd delivery tracking is active. Counts are current as of this response and may increase as worker events settle.",
      },
    });

    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        restartSupported
        restartError=""
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Interrupt Restart Blockers" }));
    await waitFor(() => expect(mockInterruptRestartBlockers).toHaveBeenCalledTimes(1));

    expect(screen.getByText(/tracking is active/)).toBeInTheDocument();
    expect(screen.getByText(/Current suppressed prep events: 0/)).toBeInTheDocument();
    expect(screen.queryByText("Suppressed prep events: 0. Held unrelated events: 0.")).not.toBeInTheDocument();
  });

  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        restartSupported
        restartError=""
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Interrupt Restart Blockers" }));

    expect(mockInterruptRestartBlockers).not.toHaveBeenCalled();
    expect(screen.queryByText("Interrupt Result")).not.toBeInTheDocument();
  });
});
