// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";

vi.mock("./CollapsibleSection.js", () => ({
  CollapsibleSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

import { SettingsServerDiagnosticsSection } from "./SettingsServerDiagnosticsSection.js";

const serverSlugProps = {
  serverSlug: "prod",
  setServerSlug: vi.fn(),
  serverSlugSaving: false,
  serverSlugError: "",
  onSaveServerSlug: vi.fn(),
};

describe("SettingsServerDiagnosticsSection", () => {
  it("renders restart prep details supplied by the Restart Server failure path", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError="Cannot restart while 1 session(s) are still blocking restart readiness: Approval session"
        restartPrepResult={{
          ok: false,
          operationId: "prep-restart",
          mode: "restart",
          restartRequested: false,
          timedOut: true,
          retryAttempts: [],
          interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
          skipped: [],
          failures: [],
          fallbacks: [],
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

  it("does not render a separate standalone interrupt-all button", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Restart Server" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Interrupt Restart Blockers" })).not.toBeInTheDocument();
  });

  it("does not present active restart-prep herd delivery tracking counts as final", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restartPrepResult={{
          ok: false,
          operationId: "prep-restart",
          mode: "restart",
          restartRequested: false,
          timedOut: false,
          retryAttempts: [],
          interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
          skipped: [],
          failures: [],
          fallbacks: [],
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
        }}
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByText(/tracking is active/)).toBeInTheDocument();
    expect(screen.getByText(/Current suppressed prep events: 0/)).toBeInTheDocument();
    expect(screen.queryByText("Suppressed prep events: 0. Held unrelated events: 0.")).not.toBeInTheDocument();
  });

  it("renders final restart-prep herd delivery counts when tracking has settled", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restartPrepResult={{
          ok: false,
          operationId: "prep-restart",
          mode: "restart",
          restartRequested: false,
          timedOut: false,
          retryAttempts: [],
          interrupted: [{ sessionId: "worker-1", label: "Worker session", reasons: ["running"] }],
          skipped: [],
          failures: [],
          fallbacks: [],
          protectedLeaders: [{ sessionId: "leader-1", label: "Leader session" }],
          unresolvedBlockers: [],
          herdDelivery: { suppressed: 2, held: 1, trackingActive: false, countsFinal: true },
        }}
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByText(/Suppressed prep events: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Held unrelated events: 1/)).toBeInTheDocument();
  });

  it("renders retry and Codex fallback diagnostics", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restartPrepResult={{
          ok: true,
          operationId: "prep-restart",
          mode: "restart",
          restartRequested: true,
          timedOut: true,
          retryAttempts: [
            {
              attempt: 1,
              interrupted: [{ sessionId: "codex-1", label: "Codex stuck", reasons: ["running"] }],
              skipped: [],
              failures: [],
              remainingBlockers: [{ sessionId: "codex-1", label: "Codex stuck", reasons: ["running"] }],
              timedOut: true,
            },
            {
              attempt: 2,
              interrupted: [{ sessionId: "codex-1", label: "Codex stuck", reasons: ["running"] }],
              skipped: [],
              failures: [],
              remainingBlockers: [],
              timedOut: false,
            },
          ],
          interrupted: [{ sessionId: "codex-1", label: "Codex stuck", reasons: ["running"] }],
          skipped: [],
          failures: [],
          fallbacks: [
            {
              sessionId: "codex-1",
              label: "Codex stuck",
              reasons: ["running"],
              detail:
                "Codex recovery was requested after bounded restart-prep interrupts did not clear the running blocker.",
              diagnostics: { backendState: "connected", pendingCodexTurns: 1 },
            },
          ],
          protectedLeaders: [],
          unresolvedBlockers: [],
          herdDelivery: { suppressed: 0, held: 0, trackingActive: false, countsFinal: true },
        }}
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByText(/Retry attempts: 2/)).toBeInTheDocument();
    expect(screen.getAllByText("Codex stuck")).toHaveLength(2);
    expect(screen.getByText(/Codex recovery was requested/)).toBeInTheDocument();
    expect(screen.getByText(/backendState=connected/)).toBeInTheDocument();
  });
});
