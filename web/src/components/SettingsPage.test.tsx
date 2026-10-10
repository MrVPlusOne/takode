// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";

vi.mock("../api.js", async () => (await import("./settings-page-test-harness.js")).apiModuleMock());
vi.mock("../store.js", async () => (await import("./settings-page-test-harness.js")).storeModuleMock());

// These panels are tested in their own files; keep SettingsPage tests focused
// on page-level wiring and interactions to avoid cross-test contention.
vi.mock("./NamerDebugPanel.js", () => ({
  NamerDebugPanel: () => <div>Session Namer Debug</div>,
}));
vi.mock("./TranscriptionDebugPanel.js", () => ({
  TranscriptionDebugPanel: () => null,
}));

import { SettingsPage } from "./SettingsPage.js";
import {
  beginBuildIdentityObservation,
  getBuildCompatibilitySnapshot,
  observeServerBuildIdentity,
} from "../build-compatibility.js";
import {
  MockApiError,
  mockApi,
  mockCheckReadinessStatus,
  mockState,
  resetSettingsPageMocks,
  setMockState,
  settingsSection,
  typeLineHeight,
  waitForSettingsPage,
} from "./settings-page-test-harness.js";

beforeEach(resetSettingsPageMocks);

function settingsWithGptTranscribeLanguageHints(sttLanguageHints: string[] = ["en"]) {
  return {
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    namerConfig: { backend: "claude" as const },
    autoNamerEnabled: true,
    editorConfig: { editor: "none" as const },
    transcriptionConfig: {
      apiKey: "***",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
      sttModel: "gpt-transcribe",
      sttLanguageHints,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Click Restart Server and accept the in-page confirmation. */
function requestRestartFromSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));
  fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
}

function settingsWithChatLineHeight(chatMessageLineHeight: number) {
  return {
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    chatMessageLineHeight,
    editorConfig: { editor: "none" as const },
  };
}

describe("SettingsPage", () => {
  it("loads settings on mount", async () => {
    render(<SettingsPage />);

    expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    // Wait for loading to complete — section headings are visible
    await waitForSettingsPage();
  });

  it("auto-reloads the initiating tab after its exact prepared replacement becomes ready", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "backend-after-restart",
    });
    mockCheckReadinessStatus.mockResolvedValue({
      ok: true,
      buildId: "backend-after-restart",
      servedFrontendBuildId: "backend-after-restart",
    });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();

      requestRestartFromSettings();
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(mockApi.restartServer).toHaveBeenCalledOnce();
      expect(mockCheckReadinessStatus).toHaveBeenCalled();
      expect(mockState.setServerRestartPhase).toHaveBeenNthCalledWith(1, "preparing");
      expect(mockState.setServerRestartPhase).toHaveBeenNthCalledWith(2, "restarting");
      // The overlay stays up while the tab reloads into the new build.
      expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith("reloading");
      expect(screen.getByRole("button", { name: "Restart Server" })).toBeEnabled();
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();
      expect(getBuildCompatibilitySnapshot()).toMatchObject({
        backendBuildId: "backend-after-restart",
        servedFrontendBuildId: "backend-after-restart",
        status: "reload-required",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits through the old ready pair before reloading the exact replacement", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    observeServerBuildIdentity("development", "development", beginBuildIdentityObservation());
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus
      .mockResolvedValueOnce({
        ok: true,
        buildId: "development",
        servedFrontendBuildId: "development",
      })
      .mockResolvedValueOnce({
        ok: true,
        buildId: "build-target",
        servedFrontendBuildId: "build-target",
      });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mockCheckReadinessStatus).toHaveBeenCalledTimes(1);
      expect(onReloadAfterRestart).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Restarting..." })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits through a captured pre-existing reload-required pair before the exact replacement", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    observeServerBuildIdentity("build-current", "build-current", beginBuildIdentityObservation());
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus
      .mockResolvedValueOnce({
        ok: true,
        buildId: "build-current",
        servedFrontendBuildId: "build-current",
      })
      .mockResolvedValueOnce({
        ok: true,
        buildId: "build-target",
        servedFrontendBuildId: "build-target",
      });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onReloadAfterRestart).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reload when a different coherent restart supersedes the initiating attempt", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus.mockResolvedValue({
      ok: true,
      buildId: "build-other",
      servedFrontendBuildId: "build-other",
    });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(onReloadAfterRestart).not.toHaveBeenCalled();
      expect(getBuildCompatibilitySnapshot()).toMatchObject({
        backendBuildId: "build-other",
        servedFrontendBuildId: "build-other",
        status: "reload-required",
      });
      expect(screen.getByRole("button", { name: "Restart Server" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the restart-required diagnosis instead of forcing a reload", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus.mockResolvedValue({
      ok: true,
      buildId: "build-target",
      servedFrontendBuildId: "build-stale",
    });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(onReloadAfterRestart).not.toHaveBeenCalled();
      expect(getBuildCompatibilitySnapshot()).toMatchObject({
        backendBuildId: "build-target",
        servedFrontendBuildId: "build-stale",
        status: "restart-required",
        reason: "server-pair-mismatch",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not guess at auto-reload when the successful restart response was lost", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    mockApi.restartServer.mockRejectedValue(new TypeError("Failed to fetch"));
    mockCheckReadinessStatus.mockResolvedValue({
      ok: true,
      buildId: "build-after-transport-loss",
      servedFrontendBuildId: "build-after-transport-loss",
    });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(onReloadAfterRestart).not.toHaveBeenCalled();
      expect(getBuildCompatibilitySnapshot()).toMatchObject({
        backendBuildId: "build-after-transport-loss",
        servedFrontendBuildId: "build-after-transport-loss",
        status: "reload-required",
      });
      // Without the server's reply the page must not claim the restart happened.
      expect(screen.queryByText(/^Server restarted at /)).not.toBeInTheDocument();
      expect(screen.getByText(/restart reply was lost/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes restart intent before overlapping readiness probes can reload twice", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    const firstProbe = deferred<{
      ok: boolean;
      buildId: string;
      servedFrontendBuildId: string;
    }>();
    const secondProbe = deferred<{
      ok: boolean;
      buildId: string;
      servedFrontendBuildId: string;
    }>();
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus
      .mockImplementationOnce(() => firstProbe.promise)
      .mockImplementationOnce(() => secondProbe.promise);

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(mockCheckReadinessStatus).toHaveBeenCalledTimes(2);

      await act(async () => {
        secondProbe.resolve({
          ok: true,
          buildId: "build-target",
          servedFrontendBuildId: "build-target",
        });
        await Promise.resolve();
      });
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();

      await act(async () => {
        firstProbe.resolve({
          ok: true,
          buildId: "build-target",
          servedFrontendBuildId: "build-target",
        });
        await Promise.resolve();
      });
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports each restart phase and confirms when a restart without a reload finishes", async () => {
    // Development restarts return no replacement build ID, so the tab does not reload;
    // the user still needs to see the server come back.
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    mockApi.restartServer.mockResolvedValue({ ok: true, restartRequested: true, replacementBuildId: null });

    try {
      render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      requestRestartFromSettings();
      expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith("preparing");

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith("restarting");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith(null);
      expect(onReloadAfterRestart).not.toHaveBeenCalled();
      expect(screen.getByText(/^Server restarted at /)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server checkout's state and says what the restart did to it", async () => {
    // The restart fast-forwards a behind checkout first; the page reports the move, then re-reads the status.
    vi.useFakeTimers();
    const behind = {
      state: "behind",
      runningCommit: "a".repeat(40),
      head: "a".repeat(40),
      branch: "main",
      upstream: "origin/main",
      upstreamHead: "b".repeat(40),
      behind: 1,
      ahead: 0,
      localChanges: false,
      fetchError: null,
      checkedAt: 1,
    };
    const current = { ...behind, state: "current", head: "b".repeat(40), behind: 0 };
    mockApi.getServerCheckout.mockResolvedValue({ status: behind, restartMode: "on", blocker: null });
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: null,
      checkoutUpdate: { action: "updated", from: "a".repeat(40), error: null, status: current },
    });

    try {
      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockApi.getServerCheckout).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("server-checkout-status")).toHaveTextContent("Restart Server fast-forwards");

      mockApi.getServerCheckout.mockResolvedValue({ status: current, restartMode: "on", blocker: null });
      requestRestartFromSettings();
      expect(mockApi.getServerCheckout).toHaveBeenCalledWith(true);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(
        screen.getByText(
          /^Server restarted at .* The checkout \(main\) was first fast-forwarded from aaaaaaaa to bbbbbbbb\.$/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("server-checkout-status")).toHaveTextContent("Up to date with origin/main");
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms the finished restart after the initiating tab reloads", async () => {
    // The reload replaces the page, so the completion note is carried in sessionStorage
    // and shown once by the freshly loaded Settings page.
    vi.useFakeTimers();
    sessionStorage.clear();
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "backend-after-reload-note",
      checkoutUpdate: {
        action: "updated",
        from: "c".repeat(40),
        error: null,
        status: {
          state: "current",
          runningCommit: null,
          head: "a".repeat(40),
          branch: "main",
          upstream: "origin/main",
          upstreamHead: "a".repeat(40),
          behind: 0,
          ahead: 0,
          localChanges: false,
          fetchError: null,
          checkedAt: 1,
        },
      },
    });
    mockCheckReadinessStatus.mockResolvedValue({
      ok: true,
      buildId: "backend-after-reload-note",
      servedFrontendBuildId: "backend-after-reload-note",
    });

    try {
      const onReloadAfterRestart = vi.fn();
      const { unmount } = render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      requestRestartFromSettings();
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onReloadAfterRestart).toHaveBeenCalledOnce();
      unmount();

      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });
      // The note about the fast-forward survives the reload with the completion message.
      expect(
        screen.getByText(
          /This page loaded the new build\. The checkout \(main\) was first fast-forwarded from cccccccc to aaaaaaaa\./,
        ),
      ).toBeInTheDocument();
      expect(sessionStorage.getItem("cc-server-restart-completed-at")).toBeNull();
    } finally {
      sessionStorage.clear();
      vi.useRealTimers();
    }
  });

  it("cancels a pending initiating-tab reload when Settings unmounts", async () => {
    vi.useFakeTimers();
    const onReloadAfterRestart = vi.fn();
    const pendingProbe = deferred<{
      ok: boolean;
      buildId: string;
      servedFrontendBuildId: string;
    }>();
    observeServerBuildIdentity("development", "development", beginBuildIdentityObservation());
    mockApi.restartServer.mockResolvedValue({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-target",
    });
    mockCheckReadinessStatus.mockImplementationOnce(() => pendingProbe.promise);

    try {
      const { unmount } = render(<SettingsPage onReloadAfterRestart={onReloadAfterRestart} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Login")).toBeInTheDocument();
      requestRestartFromSettings();

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mockCheckReadinessStatus).toHaveBeenCalledOnce();

      unmount();
      expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith(null);

      await act(async () => {
        pendingProbe.resolve({
          ok: true,
          buildId: "build-target",
          servedFrontendBuildId: "build-target",
        });
        await Promise.resolve();
      });
      expect(onReloadAfterRestart).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a server-returned frontend build failure without polling the healthy old pair", async () => {
    // Vite errors often contain capital “Failed”; typed API failures must not be mistaken for the expected disconnect.
    mockApi.restartServer.mockRejectedValue(
      new MockApiError("Failed to resolve import while preparing the frontend", 500, {
        error: "Failed to resolve import while preparing the frontend",
      }),
    );

    render(<SettingsPage />);
    await waitForSettingsPage();
    requestRestartFromSettings();

    expect(await screen.findByText("Failed to resolve import while preparing the frontend")).toBeInTheDocument();
    expect(mockCheckReadinessStatus).not.toHaveBeenCalled();
    expect(mockState.setServerRestartPhase).toHaveBeenLastCalledWith(null);
  });

  it("shows why the checkout stopped a restart and re-reads the checkout afterwards", async () => {
    // The server refuses to restart onto a checkout it cannot update; the running page stays usable.
    const blocked =
      'Restart blocked: The server checkout (main) has uncommitted changes to tracked files. Commit or discard them. The server keeps running; restart again once that is fixed, or turn off "Update the checkout before restarting" in Settings > Restart to restart onto the checkout as it is.';
    mockApi.restartServer.mockRejectedValue(new MockApiError(blocked, 409, { error: blocked }));

    render(<SettingsPage />);
    await waitForSettingsPage();
    mockApi.getServerCheckout.mockClear();
    requestRestartFromSettings();

    expect(await screen.findByText(blocked)).toBeInTheDocument();
    expect(mockCheckReadinessStatus).not.toHaveBeenCalled();
    // One read when the user clicks Restart Server (with a fetch), one after the refusal (cached by the restart).
    await waitFor(() => expect(mockApi.getServerCheckout.mock.calls).toEqual([[true], [false]]));
  });

  it("turns updating the checkout before restarts off and shows what a restart now does", async () => {
    const status = {
      state: "behind",
      runningCommit: "a".repeat(40),
      head: "a".repeat(40),
      branch: "main",
      upstream: "origin/main",
      upstreamHead: "b".repeat(40),
      behind: 1,
      ahead: 0,
      localChanges: true,
      fetchError: null,
      checkedAt: 1,
    };
    mockApi.getServerCheckout.mockResolvedValue({
      status,
      restartMode: "on",
      blocker: "The server checkout (main) has uncommitted changes to tracked files. Commit or discard them.",
    });

    render(<SettingsPage />);
    await waitForSettingsPage();
    const toggle = await screen.findByRole("switch", { name: "Update the checkout before restarting" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    mockApi.getServerCheckout.mockResolvedValue({ status, restartMode: "off", blocker: null });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Update the checkout before restarting" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(mockApi.updateSettings).toHaveBeenCalledWith({ restartUpdatesCheckout: false });
    expect(screen.getByTestId("server-checkout-status")).toHaveTextContent(
      "updating before restarts is turned off, so Restart Server loads the checkout as it is",
    );
  });

  it("surfaces rich restart-prep details when Restart Server auto-prep fails", async () => {
    const restartPrepResult = {
      ok: false,
      operationId: "prep-restart",
      mode: "restart",
      restartRequested: false,
      timedOut: true,
      retryAttempts: [],
      interrupted: [
        {
          sessionId: "worker-1",
          label: "Worker session",
          reasons: ["running"],
        },
      ],
      skipped: [],
      failures: [],
      fallbacks: [],
      protectedLeaders: [{ sessionId: "leader-1", label: "Leader session" }],
      unresolvedBlockers: [
        {
          sessionId: "approval-1",
          label: "Approval session",
          reasons: ["1 pending permission"],
        },
      ],
      herdDelivery: {
        suppressed: 0,
        held: 0,
        trackingActive: true,
        countsFinal: false,
        detail:
          "Restart-prep herd delivery tracking is active. Counts are current as of this response and may increase as worker events settle.",
      },
    };
    mockApi.restartServer.mockRejectedValue(
      new MockApiError(
        "Cannot restart while 1 session(s) are still blocking restart readiness: Approval session",
        409,
        {
          error: "Cannot restart while 1 session(s) are still blocking restart readiness: Approval session",
          result: restartPrepResult,
        },
      ),
    );

    render(<SettingsPage />);
    await waitForSettingsPage();

    requestRestartFromSettings();

    expect(await screen.findByText("Restart Prep Result")).toBeInTheDocument();
    expect(screen.getByText("Worker session")).toBeInTheDocument();
    expect(screen.getByText("Approval session")).toBeInTheDocument();
    expect(screen.getByText("Leader session")).toBeInTheDocument();
    expect(screen.getByText(/Current suppressed prep events: 0/)).toBeInTheDocument();
  });

  it("shows shortcuts disabled by default in a compact state", async () => {
    render(<SettingsPage />);

    await waitForSettingsPage();
    const shortcutsSection = settingsSection("Keyboard Shortcuts");
    expect(
      within(shortcutsSection as HTMLElement).getByRole("switch", {
        name: "Use keyboard shortcuts",
      }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(shortcutsSection as HTMLElement).getByText("Enable shortcuts to edit presets and bindings."),
    ).toBeInTheDocument();
    expect(within(shortcutsSection as HTMLElement).queryByLabelText("Preset")).not.toBeInTheDocument();
    expect(within(shortcutsSection as HTMLElement).queryByText("Universal Search")).not.toBeInTheDocument();
  });

  it("offers the send key scheme even while shortcuts are disabled", async () => {
    // Send keys always apply, so the choice must not hide behind the shortcuts toggle.
    render(<SettingsPage />);

    await waitForSettingsPage();
    const select = within(settingsSection("Keyboard") as HTMLElement).getByLabelText("Send Key");
    expect(select).toHaveValue("enter");
    fireEvent.change(select, { target: { value: "mod-enter" } });
    expect(mockState.setSendKeyScheme).toHaveBeenCalledWith("mod-enter");
  });

  it("shows shortcut preset controls when shortcuts are enabled", async () => {
    setMockState({
      shortcutSettings: {
        enabled: true,
        preset: "standard",
        overrides: {},
      },
    });

    render(<SettingsPage />);

    await waitForSettingsPage();
    expect(screen.getByLabelText("Preset")).toHaveValue("standard");
    expect(screen.getByText("Universal Search")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+F")).toBeInTheDocument();
  });

  it("records and clears a custom shortcut override", async () => {
    setMockState({
      shortcutSettings: {
        enabled: true,
        preset: "standard",
        overrides: { search_session: "Ctrl+K" },
      },
    });

    render(<SettingsPage />);

    await waitForSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "Record new shortcut" }));
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });

    expect(mockState.setShortcutOverride).toHaveBeenCalledWith("search_session", "Ctrl+L");

    const resetButton = screen
      .getAllByRole("button", { name: "Use preset default" })
      .find((button) => !button.hasAttribute("disabled"));
    fireEvent.click(resetButton as HTMLButtonElement);
    expect(mockState.setShortcutOverride).toHaveBeenCalledWith("search_session", undefined);
  });

  it("records double-tap shortcut overrides", async () => {
    setMockState({
      shortcutSettings: {
        enabled: true,
        preset: "standard",
        overrides: {},
      },
    });

    render(<SettingsPage />);

    await waitForSettingsPage();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getAllByRole("button", { name: "Record shortcut" })[0]!);
      fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
      fireEvent.keyUp(window, { key: "Shift" });
      vi.advanceTimersByTime(200);
      fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
      fireEvent.keyUp(window, { key: "Shift" });

      expect(mockState.setShortcutOverride).toHaveBeenCalledWith("search_session", "DoubleTap:Shift");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows disabling an individual shortcut with Off", async () => {
    setMockState({
      shortcutSettings: {
        enabled: true,
        preset: "standard",
        overrides: {},
      },
    });

    render(<SettingsPage />);

    await waitForSettingsPage();
    const offButtons = screen.getAllByRole("button", { name: "Off" });
    fireEvent.click(offButtons[0]);

    expect(mockState.setShortcutOverride).toHaveBeenCalledWith("search_session", null);
  });

  it("does not start settings-page background work while inactive", () => {
    vi.useFakeTimers();
    try {
      render(<SettingsPage isActive={false} />);

      // Regression coverage for q-352: the hidden settings/logs-adjacent UI
      // must not fetch settings or start page-level polling while closed.
      vi.advanceTimersByTime(20_000);

      expect(mockApi.getSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads persisted custom transcription vocabulary from settings", async () => {
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      namerConfig: { backend: "claude" },
      autoNamerEnabled: true,
      editorConfig: { editor: "none" },
      transcriptionConfig: {
        apiKey: "***",
        baseUrl: "https://api.openai.com/v1",
        enhancementEnabled: true,
        enhancementModel: "gpt-5-mini",
        customVocabulary: "Takode, WsBridge, Questmaster",
      },
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Custom Vocabulary")).toHaveValue("Takode, WsBridge, Questmaster");
    });
  });

  it("loads and saves a custom voice transcription model", async () => {
    // A saved non-built-in STT model should reopen the selector in Custom Model mode.
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      namerConfig: { backend: "claude" },
      autoNamerEnabled: true,
      editorConfig: { editor: "none" },
      transcriptionConfig: {
        apiKey: "***",
        baseUrl: "https://api.openai.com/v1",
        enhancementEnabled: true,
        enhancementModel: "gpt-5-mini",
        sttModel: "whisper-large-v3",
      },
    });

    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Input");
    await waitFor(() => {
      expect(within(voiceSection).getByLabelText("STT Model")).toHaveValue("__custom__");
      expect(within(voiceSection).getByLabelText("Custom STT Model")).toHaveValue("whisper-large-v3");
    });

    fireEvent.change(within(voiceSection).getByLabelText("Custom STT Model"), {
      target: { value: " custom-whisper-v2 " },
    });
    fireEvent.click(within(voiceSection).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptionConfig: expect.objectContaining({
            sttModel: "custom-whisper-v2",
          }),
        }),
      );
    });
  });

  it("keeps selected language chips visible while the searchable picker stays closed until keyboard activation", async () => {
    const user = userEvent.setup();
    mockApi.getSettings.mockResolvedValue(settingsWithGptTranscribeLanguageHints());

    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Input");
    expect(within(voiceSection).getByText("Expected Languages")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(voiceSection).getByRole("button", {
          name: "Remove English (en)",
        }),
      ).toBeInTheDocument();
    });

    const trigger = within(voiceSection).getByRole("button", {
      name: "Add expected language",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(
      within(voiceSection).queryByRole("combobox", {
        name: "Search expected languages",
      }),
    ).toBeNull();
    expect(
      within(voiceSection).queryByRole("listbox", {
        name: "Expected language options",
      }),
    ).toBeNull();

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeInTheDocument();
    const languageSearch = within(voiceSection).getByRole("combobox", {
      name: "Search expected languages",
    });
    expect(languageSearch).toHaveFocus();
    expect(languageSearch).toHaveAttribute(
      "aria-controls",
      within(voiceSection).getByRole("listbox", {
        name: "Expected language options",
      }).id,
    );

    await user.type(languageSearch, "Chinese");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(
      within(voiceSection).queryByRole("combobox", {
        name: "Search expected languages",
      }),
    ).toBeNull();
    expect(within(voiceSection).getByRole("button", { name: "Remove English (en)" })).toBeInTheDocument();
    expect(
      within(voiceSection).getByRole("button", {
        name: "Remove Chinese (Simplified, China) (zh-cn)",
      }),
    ).toBeInTheDocument();

    await user.click(within(voiceSection).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptionConfig: expect.objectContaining({
            sttModel: "gpt-transcribe",
            sttLanguageHints: ["en", "zh-cn"],
          }),
        }),
      );
    });

    const removeChinese = within(voiceSection).getByRole("button", {
      name: "Remove Chinese (Simplified, China) (zh-cn)",
    });
    removeChinese.focus();
    await user.keyboard("{Enter}");
    expect(within(voiceSection).queryByRole("button", { name: /Remove Chinese/ })).toBeNull();

    fireEvent.change(within(voiceSection).getByLabelText("STT Model"), {
      target: { value: "gpt-4o-transcribe" },
    });
    expect(within(voiceSection).queryByText("Expected Languages")).not.toBeInTheDocument();
  });

  it("closes the language picker on Escape or outside interaction without losing selected chips", async () => {
    const user = userEvent.setup();
    mockApi.getSettings.mockResolvedValue(settingsWithGptTranscribeLanguageHints(["en", "zh-cn"]));

    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Input");
    const trigger = await within(voiceSection).findByRole("button", {
      name: "Add expected language",
    });
    await waitFor(() => {
      expect(
        within(voiceSection).getByRole("button", {
          name: "Remove Chinese (Simplified, China) (zh-cn)",
        }),
      ).toBeInTheDocument();
    });

    trigger.focus();
    await user.keyboard(" ");
    expect(
      within(voiceSection).getByRole("combobox", {
        name: "Search expected languages",
      }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(
      within(voiceSection).queryByRole("listbox", {
        name: "Expected language options",
      }),
    ).toBeNull();
    expect(within(voiceSection).getByRole("button", { name: "Remove English (en)" })).toBeInTheDocument();

    await user.click(trigger);
    expect(
      within(voiceSection).getByRole("combobox", {
        name: "Search expected languages",
      }),
    ).toHaveFocus();
    const enhancementModel = within(voiceSection).getByLabelText("Enhancement Model");
    await user.click(enhancementModel);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(enhancementModel).toHaveFocus();
    expect(
      within(voiceSection).queryByRole("combobox", {
        name: "Search expected languages",
      }),
    ).toBeNull();
    expect(
      within(voiceSection).getByRole("button", {
        name: "Remove Chinese (Simplified, China) (zh-cn)",
      }),
    ).toBeInTheDocument();
  });

  it("requires a model name before saving Custom Model transcription settings", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Input");
    await waitFor(() => {
      expect(within(voiceSection).getByLabelText("STT Model")).toBeInTheDocument();
    });

    fireEvent.change(within(voiceSection).getByLabelText("STT Model"), {
      target: { value: "__custom__" },
    });
    fireEvent.click(within(voiceSection).getByRole("button", { name: "Save" }));

    expect(await within(voiceSection).findByText("Custom STT model is required.")).toBeInTheDocument();
    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });

  it("loads and saves pushover event filters", async () => {
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: true,
      pushoverEnabled: true,
      pushoverEventFilters: {
        needsInput: true,
        review: false,
        notifyMe: true,
        error: true,
      },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      namerConfig: { backend: "claude" },
      autoNamerEnabled: true,
      transcriptionConfig: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        enhancementEnabled: true,
        enhancementModel: "gpt-5-mini",
      },
      editorConfig: { editor: "none" },
    });
    mockApi.updateSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: true,
      pushoverEnabled: true,
      pushoverEventFilters: {
        needsInput: true,
        review: true,
        notifyMe: true,
        error: true,
      },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      namerConfig: { backend: "claude" },
      autoNamerEnabled: true,
      transcriptionConfig: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        enhancementEnabled: true,
        enhancementModel: "gpt-5-mini",
      },
      editorConfig: { editor: "none" },
    });

    render(<SettingsPage />);

    await waitForSettingsPage();
    // Event types are shared by Web Push and Pushover, so they live in their own
    // subsection and save as soon as a box is ticked, without the Pushover Save button.
    const rules = settingsSection("Phone Alert Rules");

    const reviewToggle = await within(rules).findByRole("checkbox", {
      name: /^Ready for review/,
    });
    await waitFor(() => expect(reviewToggle).not.toBeChecked());

    fireEvent.click(reviewToggle);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        pushoverEventFilters: {
          needsInput: true,
          review: true,
          notifyMe: true,
          error: true,
        },
      });
    });
    expect(reviewToggle).toBeChecked();
  });

  it("shows error if initial load fails", async () => {
    mockApi.getSettings.mockRejectedValueOnce(new Error("load failed"));

    render(<SettingsPage />);

    expect(await screen.findByText("load failed")).toBeInTheDocument();
  });

  it.each([true, false])("loads and independently saves Notify Me=%s", async (notifyMe) => {
    // Exercise the visible control and server-confirmed save while review stays off.
    const base = await mockApi.getSettings();
    const filters = {
      needsInput: false,
      review: false,
      notifyMe,
      error: true,
    };
    mockApi.getSettings.mockResolvedValue({
      ...base,
      pushoverEventFilters: filters,
    });
    mockApi.updateSettings.mockResolvedValue({
      ...base,
      pushoverEventFilters: { ...filters, notifyMe: !notifyMe },
    });
    render(<SettingsPage />);
    await waitForSettingsPage();
    const section = within(settingsSection("Phone Alert Rules"));
    const toggle = section.getByRole("checkbox", { name: /^Notify Me/ });
    // Review defaults to on before settings load, so its loaded "off" state shows the filters arrived.
    await waitFor(() => expect(section.getByRole("checkbox", { name: /^Ready for review/ })).not.toBeChecked());
    expect(toggle).toHaveProperty("checked", notifyMe);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        pushoverEventFilters: { ...filters, notifyMe: !notifyMe },
      });
    });
    expect(toggle).toHaveProperty("checked", !notifyMe);
    expect(section.getByRole("checkbox", { name: /^Ready for review/ })).not.toBeChecked();
  });

  it("navigates back when Back button is clicked", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.click(screen.getByText("Back"));
    expect(window.location.hash).toBe("");
  });

  it("hides Back button in embedded mode", async () => {
    render(<SettingsPage embedded />);
    await waitForSettingsPage();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("toggles sound notifications from settings", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.click(screen.getByText(/^Sound$/));
    expect(mockState.toggleNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("picks a theme directly from the visible options", async () => {
    // Every theme is shown at once, so choosing one never requires cycling through the others.
    setMockState({ colorTheme: "light", darkMode: false });
    render(<SettingsPage />);
    await waitForSettingsPage();

    const themes = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(themes).getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(themes).getByRole("radio", { name: "VS Code" }));
    expect(mockState.setColorTheme).toHaveBeenCalledWith("vscode-dark");
  });

  it("updates chat message line height through server settings", async () => {
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.5));
    mockApi.updateSettings.mockResolvedValue(settingsWithChatLineHeight(1.36));

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat Message Line Height");
    await waitFor(() => expect(input).toHaveValue("1.50"));
    // The value stays a typed field (plus -/+ steps), never a slider.
    expect(input).not.toHaveAttribute("min");
    expect(input).not.toHaveAttribute("max");
    expect(screen.queryByRole("slider", { name: /chat message line height/i })).toBeNull();
    expect(mockState.setChatMessageLineHeight).toHaveBeenCalledWith(1.5);

    typeLineHeight(input, "1.36");

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        chatMessageLineHeight: 1.36,
      });
    });
    expect(mockState.setChatMessageLineHeight).toHaveBeenCalledWith(1.36);
  });

  it("keeps the newest chat line height when save responses complete out of order", async () => {
    const firstSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const secondSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const correctiveSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.45));
    mockApi.updateSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
      .mockImplementationOnce(() => correctiveSave.promise);

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat Message Line Height");
    await waitFor(() => expect(input).toHaveValue("1.45"));
    typeLineHeight(input, "1.50");
    typeLineHeight(input, "1.60");

    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(1, {
      chatMessageLineHeight: 1.5,
    });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(2, {
      chatMessageLineHeight: 1.6,
    });

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue("1.60");

    await act(async () => {
      firstSave.resolve(settingsWithChatLineHeight(1.5));
      await firstSave.promise;
    });
    expect(input).toHaveValue("1.60");
    expect(mockState.setChatMessageLineHeight).toHaveBeenLastCalledWith(1.6);
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(3, {
      chatMessageLineHeight: 1.6,
    });

    await act(async () => {
      correctiveSave.resolve(settingsWithChatLineHeight(1.6));
      await correctiveSave.promise;
    });
    expect(input).toHaveValue("1.60");
  });

  it("does not rollback a newer chat line height when an older save fails", async () => {
    const firstSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const secondSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.45));
    mockApi.updateSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat Message Line Height");
    await waitFor(() => expect(input).toHaveValue("1.45"));
    typeLineHeight(input, "1.50");
    typeLineHeight(input, "1.60");

    await act(async () => {
      firstSave.reject(new Error("older save failed"));
      await firstSave.promise.catch(() => undefined);
    });
    expect(input).toHaveValue("1.60");
    expect(screen.queryByText("older save failed")).not.toBeInTheDocument();
    expect(mockState.setChatMessageLineHeight).toHaveBeenLastCalledWith(1.6);

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue("1.60");
  });

  it("rolls back to the stale success value when its corrective save fails", async () => {
    const firstSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const secondSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const correctiveSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.45));
    mockApi.updateSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
      .mockImplementationOnce(() => correctiveSave.promise);

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat Message Line Height");
    await waitFor(() => expect(input).toHaveValue("1.45"));
    typeLineHeight(input, "1.50");
    typeLineHeight(input, "1.60");

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue("1.60");

    await act(async () => {
      firstSave.resolve(settingsWithChatLineHeight(1.5));
      await firstSave.promise;
    });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(3, {
      chatMessageLineHeight: 1.6,
    });
    expect(input).toHaveValue("1.60");

    await act(async () => {
      correctiveSave.reject(new Error("corrective save failed"));
      await correctiveSave.promise.catch(() => undefined);
    });
    expect(input).toHaveValue("1.50");
    expect(mockState.setChatMessageLineHeight).toHaveBeenLastCalledWith(1.5);
    expect(screen.getByText("corrective save failed")).toBeInTheDocument();
  });

  it("navigates to environments page from settings", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.click(screen.getByText("Manage Environments"));
    expect(window.location.hash).toBe("#/environments");
  });

  it("navigates to logs page from settings", async () => {
    // The log viewer should be grouped under Server & Diagnostics rather than exposed as a standalone Logs section.
    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.queryByText(/^Logs$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Log Viewer"));
    expect(window.location.hash).toBe("#/logs");
  });

  it("updates editor preference from settings dropdown", async () => {
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "vscode-local" },
    });
    mockApi.updateSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "cursor" },
    });

    render(<SettingsPage />);
    const select = await screen.findByLabelText("Editor");
    fireEvent.change(select, { target: { value: "cursor" } });

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        editorConfig: { editor: "cursor" },
      });
    });
  });

  it("updates heavy repo mode from the System settings section", async () => {
    mockApi.updateSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: true,
      editorConfig: { editor: "none" },
    });

    render(<SettingsPage />);
    const toggle = await screen.findByRole("switch", {
      name: "Heavy Repo Mode",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        heavyRepoModeEnabled: true,
      });
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("ignores stale Sessions collapse state while polling sleep inhibitor status", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cc-settings-collapsed", JSON.stringify(["sessions"]));
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      sleepInhibitorEnabled: true,
      sleepInhibitorDurationMinutes: 5,
      editorConfig: { editor: "none" },
    });

    try {
      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Notifications")).toBeInTheDocument();

      expect(mockApi.getCaffeinateStatus).toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });

      expect(mockApi.getCaffeinateStatus).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses sleep inhibitor polling while the tab is hidden and resumes on visibility", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      sleepInhibitorEnabled: true,
      sleepInhibitorDurationMinutes: 5,
      editorConfig: { editor: "none" },
    });

    try {
      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Notifications")).toBeInTheDocument();

      expect(mockApi.getCaffeinateStatus).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(mockApi.getCaffeinateStatus).not.toHaveBeenCalled();

      visibilityState = "visible";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockApi.getCaffeinateStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(mockApi.getCaffeinateStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses the sleep inhibitor countdown while the tab is hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      sleepInhibitorEnabled: true,
      sleepInhibitorDurationMinutes: 5,
      editorConfig: { editor: "none" },
    });
    mockApi.getCaffeinateStatus.mockResolvedValue({
      active: true,
      engagedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    try {
      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText("Awake for 0s · expires in 1m 0s")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText("Awake for 1s · expires in 59s")).toBeInTheDocument();

      visibilityState = "hidden";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText("Awake for 1s · expires in 59s")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests desktop permission before enabling desktop alerts", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });

    try {
      render(<SettingsPage />);
      await waitForSettingsPage();
      fireEvent.click(screen.getByText(/^Desktop Alerts$/));

      await waitFor(() => {
        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(mockState.setNotificationDesktop).toHaveBeenCalledWith(true);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not show OpenRouter section", async () => {
    // OpenRouter has been removed in favor of Haiku-based session naming
    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.queryByText("OpenRouter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRouter API Key")).not.toBeInTheDocument();
  });

  it("shows namer debug panel", async () => {
    render(<SettingsPage />);
    // NamerDebugPanel renders the "Session Namer Debug" heading
    expect(await screen.findByText("Session Namer Debug")).toBeInTheDocument();
  });
});

describe("server-authoritative session defaults updates", () => {
  it("refreshes the visible defaults when another browser saves settings", async () => {
    // The websocket handler emits this event after the server broadcasts a successful settings write.
    render(<SettingsPage />);
    await waitForSettingsPage();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("takode:session-defaults-updated", {
          detail: {
            ...DEFAULT_SESSION_DEFAULTS,
            codex: {
              ...DEFAULT_SESSION_DEFAULTS.codex,
              model: "remote-worker-model",
            },
            leaderUsesWorkerDefaults: false,
            leader: {
              codex: {
                ...DEFAULT_SESSION_DEFAULTS.leader.codex,
                model: "remote-leader-model",
              },
              claude: DEFAULT_SESSION_DEFAULTS.leader.claude,
            },
          },
        }),
      );
    });

    expect(await screen.findByLabelText("Worker defaults Codex model")).toHaveValue("remote-worker-model");
    expect(screen.getByLabelText("Leader defaults Codex model")).toHaveValue("remote-leader-model");
    expect(screen.getByRole("checkbox", { name: "Use same as worker defaults" })).not.toBeChecked();
  });
});
