// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
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

  it("confirms Restart Server inside the page instead of a native dialog", () => {
    // Native confirm() is silently suppressed in some browser contexts (for example
    // cross-origin or sandboxed frames), which made the button do nothing at all.
    const nativeConfirm = vi.spyOn(window, "confirm");
    const onRestartServer = vi.fn();
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restarting={false}
        onRestartServer={onRestartServer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));
    expect(screen.getByText(/Restart the server now\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRestartServer).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restart now" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(onRestartServer).toHaveBeenCalledOnce();
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("shows the restart confirmation note only once the restart has finished", () => {
    const props = {
      logFile: "",
      ...serverSlugProps,
      restartSupported: true,
      restartError: "",
      restartSuccess: "Server restarted at 8:01 PM.",
      onRestartServer: vi.fn(),
    };
    const { rerender } = render(<SettingsServerDiagnosticsSection {...props} restarting />);
    expect(screen.queryByText("Server restarted at 8:01 PM.")).not.toBeInTheDocument();

    rerender(<SettingsServerDiagnosticsSection {...props} restarting={false} />);
    expect(screen.getByText("Server restarted at 8:01 PM.")).toBeInTheDocument();
  });

  // Hosts move to the new build after the server is back, so once this tab's
  // restart finished the Restart section lists each machine's progress from
  // GET /api/hosts: this machine's node first, then every registered host.
  it("lists each machine's progress onto the new build after the restart", async () => {
    const host = (overrides: Record<string, unknown>) => ({
      createdAt: 0,
      online: true,
      lastSeenAt: 1,
      processes: 1,
      build: "a".repeat(40),
      buildMismatch: true,
      autoUpdate: true,
      updating: false,
      updateError: null,
      updateWaitingFor: null,
      settings: { claudeBinary: "", codexBinary: "" },
      commandOverrides: {},
      ...overrides,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          build: "b".repeat(40),
          local: {
            id: "local",
            name: "laptop",
            settings: { claudeBinary: "", codexBinary: "" },
            node: host({ build: "b".repeat(40), buildMismatch: false }),
          },
          hosts: [
            host({ id: "h1", name: "devbox", updating: true }),
            host({ id: "h2", name: "gpu", updateWaitingFor: "the landing run there finishes" }),
            host({ id: "h3", name: "old", autoUpdate: false }),
          ],
        }),
      ),
    );
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported
        restartError=""
        restartSuccess="Server restarted at 8:01 PM."
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("restart-host-progress")).toBeInTheDocument());
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringContaining("laptop (this machine) On the new build"),
      expect.stringContaining("devbox Updating; its sessions continue once it is back"),
      expect.stringContaining("gpu Updates once the landing run there finishes"),
      expect.stringContaining("old On another build; update takode there by hand"),
    ]);
    vi.unstubAllGlobals();
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

  it("disables the child restart path when the resident supervisor lacks current handoff support", () => {
    render(
      <SettingsServerDiagnosticsSection
        logFile=""
        {...serverSlugProps}
        restartSupported={false}
        restartError=""
        restarting={false}
        onRestartServer={vi.fn()}
      />,
    );

    expect(screen.getByText("Restart not available.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart Server" })).toBeDisabled();
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
          timedOut: false,
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
    expect(screen.queryByText(/Blocker wait timed out/)).not.toBeInTheDocument();
  });

  it("opens the changelog view from Server and Diagnostics", () => {
    window.location.hash = "#/settings";
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

    fireEvent.click(screen.getByRole("button", { name: "Open changelog" }));

    expect(window.location.hash).toBe("#/changelog");
  });
});
