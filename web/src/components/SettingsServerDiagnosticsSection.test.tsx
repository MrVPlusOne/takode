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
      "Interrupt all restart-blocking sessions? This will stop active work and clear pending permission blockers so the server can be restarted safely.",
    );
    await waitFor(() => expect(mockInterruptRestartBlockers).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Interrupt Result")).toBeInTheDocument();
    expect(screen.getByText("Worker session")).toBeInTheDocument();
    expect(screen.getByText("Leader session")).toBeInTheDocument();
    expect(screen.getByText("Reviewer session")).toBeInTheDocument();
    expect(screen.getByText("Session was no longer loaded when interrupts were dispatched.")).toBeInTheDocument();
    expect(screen.getByText("Interrupt routing unavailable")).toBeInTheDocument();
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
