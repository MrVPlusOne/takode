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
      herdDelivery: { suppressed: 2, held: 1 },
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
