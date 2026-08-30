// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";

interface MockStoreState {
  colorTheme: string;
  darkMode: boolean;
  notificationSound: boolean;
  notificationDesktop: boolean;
  showUsageBars: boolean;
  compactToolActivity: boolean;
  chatMessageLineHeight: number;
  shortcutSettings: {
    enabled: boolean;
    preset: "standard" | "vscode-light" | "vim-light";
    overrides: Record<string, string | null>;
  };
  zoomLevel: number;
  currentSessionId: string | null;
  sdkSessions: Array<{ sessionId: string; createdAt: number; archived?: boolean; cronJobId?: string }>;
  setColorTheme: ReturnType<typeof vi.fn>;
  toggleDarkMode: ReturnType<typeof vi.fn>;
  toggleNotificationSound: ReturnType<typeof vi.fn>;
  setNotificationDesktop: ReturnType<typeof vi.fn>;
  toggleShowUsageBars: ReturnType<typeof vi.fn>;
  toggleCompactToolActivity: ReturnType<typeof vi.fn>;
  setChatMessageLineHeight: ReturnType<typeof vi.fn>;
  setShortcutsEnabled: ReturnType<typeof vi.fn>;
  setShortcutPreset: ReturnType<typeof vi.fn>;
  setShortcutOverride: ReturnType<typeof vi.fn>;
  resetShortcutOverrides: ReturnType<typeof vi.fn>;
  setZoomLevel: ReturnType<typeof vi.fn>;
  serverReachable: boolean;
  setServerReachable: ReturnType<typeof vi.fn>;
  setServerRestarting: ReturnType<typeof vi.fn>;
}

let mockState: MockStoreState;

function createMockState(overrides: Partial<MockStoreState> = {}): MockStoreState {
  return {
    colorTheme: "light",
    darkMode: false,
    notificationSound: true,
    notificationDesktop: false,
    showUsageBars: false,
    compactToolActivity: true,
    chatMessageLineHeight: 1.45,
    shortcutSettings: {
      enabled: false,
      preset: "standard",
      overrides: {},
    },
    zoomLevel: 1.0,
    currentSessionId: null,
    sdkSessions: [],
    setColorTheme: vi.fn(),
    toggleDarkMode: vi.fn(),
    toggleNotificationSound: vi.fn(),
    setNotificationDesktop: vi.fn(),
    toggleShowUsageBars: vi.fn(),
    toggleCompactToolActivity: vi.fn(),
    setChatMessageLineHeight: vi.fn(),
    setShortcutsEnabled: vi.fn(),
    setShortcutPreset: vi.fn(),
    setShortcutOverride: vi.fn(),
    resetShortcutOverrides: vi.fn(),
    setZoomLevel: vi.fn(),
    serverReachable: true,
    setServerReachable: vi.fn(),
    setServerRestarting: vi.fn(),
    ...overrides,
  };
}

const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getBackendModels: vi.fn(),
  restartServer: vi.fn(),
  getNamerLogs: vi.fn(),
  getNamerLogEntry: vi.fn(),
  testPushover: vi.fn(),
  getCaffeinateStatus: vi.fn(),
  getAutoApprovalConfigs: vi.fn().mockResolvedValue([]),
  getAutoApprovalConfig: vi.fn(),
  createAutoApprovalConfig: vi.fn(),
  updateAutoApprovalConfig: vi.fn(),
  deleteAutoApprovalConfig: vi.fn(),
  getAutoApprovalLogs: vi.fn().mockResolvedValue([]),
  getAutoApprovalLogEntry: vi.fn(),
};
const mockCheckReadinessStatus = vi.fn().mockResolvedValue({ ok: true, buildId: "development" });

const mockApiErrorClass = vi.hoisted(
  () =>
    class ApiError extends Error {
      constructor(
        message: string,
        public readonly status: number,
        public readonly body: unknown,
      ) {
        super(message);
        this.name = "ApiError";
      }
    },
);

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    getBackendModels: (...args: unknown[]) => mockApi.getBackendModels(...args),
    restartServer: (...args: unknown[]) => mockApi.restartServer(...args),
    getNamerLogs: (...args: unknown[]) => mockApi.getNamerLogs(...args),
    getNamerLogEntry: (...args: unknown[]) => mockApi.getNamerLogEntry(...args),
    testPushover: (...args: unknown[]) => mockApi.testPushover(...args),
    getCaffeinateStatus: (...args: unknown[]) => mockApi.getCaffeinateStatus(...args),
    getAutoApprovalConfigs: (...args: unknown[]) => mockApi.getAutoApprovalConfigs(...args),
    getAutoApprovalConfig: (...args: unknown[]) => mockApi.getAutoApprovalConfig(...args),
    createAutoApprovalConfig: (...args: unknown[]) => mockApi.createAutoApprovalConfig(...args),
    updateAutoApprovalConfig: (...args: unknown[]) => mockApi.updateAutoApprovalConfig(...args),
    deleteAutoApprovalConfig: (...args: unknown[]) => mockApi.deleteAutoApprovalConfig(...args),
    getAutoApprovalLogs: (...args: unknown[]) => mockApi.getAutoApprovalLogs(...args),
    getAutoApprovalLogEntry: (...args: unknown[]) => mockApi.getAutoApprovalLogEntry(...args),
  },
  ApiError: mockApiErrorClass,
  checkReadinessStatus: (...args: unknown[]) => mockCheckReadinessStatus(...args),
  isInterruptRestartBlockersResponse: (value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { mode?: unknown; herdDelivery?: unknown };
    return (candidate.mode === "standalone" || candidate.mode === "restart") && !!candidate.herdDelivery;
  },
}));

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return {
    useStore: useStoreFn,
    COLOR_THEMES: [
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
      { id: "vscode-dark", label: "VS Code" },
    ],
  };
});

// These panels are tested in their own files; keep SettingsPage tests focused
// on page-level wiring and interactions to avoid cross-test contention.
vi.mock("./NamerDebugPanel.js", () => ({
  NamerDebugPanel: () => <div>Session Namer Debug</div>,
}));
vi.mock("./AutoApprovalDebugPanel.js", () => ({
  AutoApprovalDebugPanel: () => null,
}));
vi.mock("./TranscriptionDebugPanel.js", () => ({
  TranscriptionDebugPanel: () => null,
}));
vi.mock("./FolderPicker.js", () => ({
  FolderPicker: () => null,
}));

import { SettingsPage } from "./SettingsPage.js";
import { getBuildCompatibilitySnapshot, resetBuildCompatibilityForTest } from "../build-compatibility.js";

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mockState = createMockState();
  window.location.hash = "#/settings";
  // Clear scroll state between tests.
  localStorage.removeItem("cc-settings-collapsed");
  localStorage.removeItem("cc-settings-scroll");
  mockApi.getSettings.mockResolvedValue({
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverEventFilters: { needsInput: true, review: true, error: true },
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    restartSupported: true,
    namerConfig: { backend: "claude" },
    claudeBinary: "",
    codexBinary: "",
    codexLeaderContextWindowOverrideTokens: 1_000_000,
    codexNonLeaderAutoCompactThresholdPercent: 90,
    codexLeaderRecycleThresholdTokens: 260_000,
    codexLeaderRecycleThresholdTokensByModel: {},
    codexLeaderCompactionMode: "recycle",
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    chatMessageLineHeight: 1.45,
    editorConfig: { editor: "none" },
    sessionDefaults: DEFAULT_SESSION_DEFAULTS,
  });
  mockApi.getBackendModels.mockResolvedValue([]);
  mockApi.restartServer.mockResolvedValue({ ok: true });
  mockCheckReadinessStatus.mockResolvedValue({ ok: true, buildId: "development" });
  resetBuildCompatibilityForTest();
  mockApi.updateSettings.mockResolvedValue({
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverEventFilters: { needsInput: true, review: true, error: true },
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    restartSupported: true,
    namerConfig: { backend: "claude" },
    claudeBinary: "",
    codexBinary: "",
    codexLeaderContextWindowOverrideTokens: 1_000_000,
    codexNonLeaderAutoCompactThresholdPercent: 90,
    codexLeaderRecycleThresholdTokens: 260_000,
    codexLeaderRecycleThresholdTokensByModel: {},
    codexLeaderCompactionMode: "recycle",
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    chatMessageLineHeight: 1.45,
    editorConfig: { editor: "none" },
    sessionDefaults: DEFAULT_SESSION_DEFAULTS,
  });
  mockApi.getNamerLogs.mockResolvedValue([]);
  mockApi.getCaffeinateStatus.mockResolvedValue({ active: false, engagedAt: null, expiresAt: null });
});

async function waitForSettingsPage() {
  await screen.findAllByText("Notifications");
}

function settingsSection(title: string): HTMLElement {
  const heading = screen.getAllByText(title).find((node) => node.closest("[data-settings-section-id]"));
  if (!heading) throw new Error(`Missing settings section: ${title}`);
  const section = heading.closest("section, form");
  if (!section) throw new Error(`Missing section wrapper: ${title}`);
  return section as HTMLElement;
}

function settingsWithGptTranscribeLanguageHints(sttLanguageHints: string[] = ["en"]) {
  return {
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    claudeBinary: "",
    codexBinary: "",
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

function settingsWithChatLineHeight(chatMessageLineHeight: number) {
  return {
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverDelaySeconds: 30,
    pushoverBaseUrl: "",
    claudeBinary: "",
    codexBinary: "",
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

  it("clears the restart overlay without auto-reloading and surfaces a new backend build", async () => {
    vi.useFakeTimers();
    mockCheckReadinessStatus.mockResolvedValue({ ok: true, buildId: "backend-after-restart" });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<SettingsPage />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(settingsSection("Server & Diagnostics")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(mockApi.restartServer).toHaveBeenCalledOnce();
      expect(mockCheckReadinessStatus).toHaveBeenCalled();
      expect(mockState.setServerRestarting).toHaveBeenNthCalledWith(1, true);
      expect(mockState.setServerRestarting).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("button", { name: "Restart Server" })).toBeEnabled();
      expect(getBuildCompatibilitySnapshot()).toMatchObject({
        backendBuildId: "backend-after-restart",
        status: "mismatch",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a server-returned frontend build failure without polling the healthy old pair", async () => {
    // Vite errors often contain capital “Failed”; typed API failures must not be mistaken for the expected disconnect.
    mockApi.restartServer.mockRejectedValue(
      new mockApiErrorClass("Failed to resolve import while preparing the frontend", 500, {
        error: "Failed to resolve import while preparing the frontend",
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SettingsPage />);
    await waitForSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));

    expect(await screen.findByText("Failed to resolve import while preparing the frontend")).toBeInTheDocument();
    expect(mockCheckReadinessStatus).not.toHaveBeenCalled();
    expect(mockState.setServerRestarting).toHaveBeenLastCalledWith(false);
  });

  it("surfaces rich restart-prep details when Restart Server auto-prep fails", async () => {
    const restartPrepResult = {
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
      unresolvedBlockers: [{ sessionId: "approval-1", label: "Approval session", reasons: ["1 pending permission"] }],
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
      new mockApiErrorClass(
        "Cannot restart while 1 session(s) are still blocking restart readiness: Approval session",
        409,
        {
          error: "Cannot restart while 1 session(s) are still blocking restart readiness: Approval session",
          result: restartPrepResult,
        },
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));

    expect(await screen.findByText("Restart Prep Result")).toBeInTheDocument();
    expect(screen.getByText("Worker session")).toBeInTheDocument();
    expect(screen.getByText("Approval session")).toBeInTheDocument();
    expect(screen.getByText("Leader session")).toBeInTheDocument();
    expect(screen.getByText(/Current suppressed prep events: 0/)).toBeInTheDocument();
  });

  it("shows shortcuts disabled by default in a compact state", async () => {
    render(<SettingsPage />);

    await waitForSettingsPage();
    const shortcutsSection = settingsSection("Shortcuts");
    expect(within(shortcutsSection as HTMLElement).getByText("Off")).toBeInTheDocument();
    expect(
      within(shortcutsSection as HTMLElement).getByText("Enable shortcuts to edit presets and bindings."),
    ).toBeInTheDocument();
    expect(within(shortcutsSection as HTMLElement).queryByLabelText("Preset")).not.toBeInTheDocument();
    expect(within(shortcutsSection as HTMLElement).queryByText("Universal Search")).not.toBeInTheDocument();
  });

  it("shows shortcut preset controls when shortcuts are enabled", async () => {
    mockState = createMockState({
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
    mockState = createMockState({
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
    mockState = createMockState({
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
    mockState = createMockState({
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
      expect(mockApi.getAutoApprovalConfigs).not.toHaveBeenCalled();
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
      claudeBinary: "",
      codexBinary: "",
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
      claudeBinary: "",
      codexBinary: "",
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

    const voiceSection = settingsSection("Voice Transcription");
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

    const voiceSection = settingsSection("Voice Transcription");
    expect(within(voiceSection).getByText("Expected Languages")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(voiceSection).getByRole("button", { name: "Remove English (en)" })).toBeInTheDocument();
    });

    const trigger = within(voiceSection).getByRole("button", { name: "Add expected language" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(within(voiceSection).queryByRole("combobox", { name: "Search expected languages" })).toBeNull();
    expect(within(voiceSection).queryByRole("listbox", { name: "Expected language options" })).toBeNull();

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeInTheDocument();
    const languageSearch = within(voiceSection).getByRole("combobox", { name: "Search expected languages" });
    expect(languageSearch).toHaveFocus();
    expect(languageSearch).toHaveAttribute(
      "aria-controls",
      within(voiceSection).getByRole("listbox", { name: "Expected language options" }).id,
    );

    await user.type(languageSearch, "Chinese");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(within(voiceSection).queryByRole("combobox", { name: "Search expected languages" })).toBeNull();
    expect(within(voiceSection).getByRole("button", { name: "Remove English (en)" })).toBeInTheDocument();
    expect(
      within(voiceSection).getByRole("button", { name: "Remove Chinese (Simplified, China) (zh-cn)" }),
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

    fireEvent.change(within(voiceSection).getByLabelText("STT Model"), { target: { value: "gpt-4o-transcribe" } });
    expect(within(voiceSection).queryByText("Expected Languages")).not.toBeInTheDocument();
  });

  it("closes the language picker on Escape or outside interaction without losing selected chips", async () => {
    const user = userEvent.setup();
    mockApi.getSettings.mockResolvedValue(settingsWithGptTranscribeLanguageHints(["en", "zh-cn"]));

    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Transcription");
    const trigger = await within(voiceSection).findByRole("button", { name: "Add expected language" });
    await waitFor(() => {
      expect(
        within(voiceSection).getByRole("button", { name: "Remove Chinese (Simplified, China) (zh-cn)" }),
      ).toBeInTheDocument();
    });

    trigger.focus();
    await user.keyboard(" ");
    expect(within(voiceSection).getByRole("combobox", { name: "Search expected languages" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(within(voiceSection).queryByRole("listbox", { name: "Expected language options" })).toBeNull();
    expect(within(voiceSection).getByRole("button", { name: "Remove English (en)" })).toBeInTheDocument();

    await user.click(trigger);
    expect(within(voiceSection).getByRole("combobox", { name: "Search expected languages" })).toHaveFocus();
    const enhancementModel = within(voiceSection).getByLabelText("Enhancement Model");
    await user.click(enhancementModel);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(enhancementModel).toHaveFocus();
    expect(within(voiceSection).queryByRole("combobox", { name: "Search expected languages" })).toBeNull();
    expect(
      within(voiceSection).getByRole("button", { name: "Remove Chinese (Simplified, China) (zh-cn)" }),
    ).toBeInTheDocument();
  });

  it("requires a model name before saving Custom Model transcription settings", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    const voiceSection = settingsSection("Voice Transcription");
    await waitFor(() => {
      expect(within(voiceSection).getByLabelText("STT Model")).toBeInTheDocument();
    });

    fireEvent.change(within(voiceSection).getByLabelText("STT Model"), { target: { value: "__custom__" } });
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
      pushoverEventFilters: { needsInput: true, review: false, error: true },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      claudeBinary: "",
      codexBinary: "",
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
      pushoverEventFilters: { needsInput: true, review: true, error: true },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      claudeBinary: "",
      codexBinary: "",
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
    const pushoverForm = settingsSection("Push Notifications (Pushover)");

    await waitFor(() => {
      expect(within(pushoverForm).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);
    });
    const reviewToggle = within(pushoverForm).getAllByRole("checkbox")[1] as HTMLInputElement;
    expect(reviewToggle).not.toBeChecked();

    fireEvent.click(reviewToggle);
    fireEvent.submit(reviewToggle.closest("form")!);

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          pushoverEventFilters: { needsInput: true, review: true, error: true },
        }),
      );
    });
  });

  it("shows error if initial load fails", async () => {
    mockApi.getSettings.mockRejectedValueOnce(new Error("load failed"));

    render(<SettingsPage />);

    expect(await screen.findByText("load failed")).toBeInTheDocument();
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

  it("cycles theme from settings", async () => {
    mockState = createMockState({ colorTheme: "light", darkMode: false });
    render(<SettingsPage />);
    await waitForSettingsPage();

    // Click the Theme button — should cycle to next theme ("dark")
    fireEvent.click(screen.getByText(/^Theme$/));
    expect(mockState.setColorTheme).toHaveBeenCalledWith("dark");
  });

  it("updates chat message line height through server settings", async () => {
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.5));
    mockApi.updateSettings.mockResolvedValue(settingsWithChatLineHeight(1.36));

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat message line height value");
    expect(input).toHaveValue(1.5);
    expect(input).toHaveAttribute("type", "number");
    expect(input).not.toHaveAttribute("min");
    expect(input).not.toHaveAttribute("max");
    expect(screen.queryByRole("slider", { name: /chat message line height/i })).toBeNull();
    expect(mockState.setChatMessageLineHeight).toHaveBeenCalledWith(1.5);

    fireEvent.change(input, { target: { value: "1.36" } });

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ chatMessageLineHeight: 1.36 });
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
    const input = await screen.findByLabelText("Chat message line height value");
    fireEvent.change(input, { target: { value: "1.50" } });
    fireEvent.change(input, { target: { value: "1.60" } });

    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(1, { chatMessageLineHeight: 1.5 });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(2, { chatMessageLineHeight: 1.6 });

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue(1.6);

    await act(async () => {
      firstSave.resolve(settingsWithChatLineHeight(1.5));
      await firstSave.promise;
    });
    expect(input).toHaveValue(1.6);
    expect(mockState.setChatMessageLineHeight).toHaveBeenLastCalledWith(1.6);
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(3, { chatMessageLineHeight: 1.6 });

    await act(async () => {
      correctiveSave.resolve(settingsWithChatLineHeight(1.6));
      await correctiveSave.promise;
    });
    expect(input).toHaveValue(1.6);
  });

  it("does not rollback a newer chat line height when an older save fails", async () => {
    const firstSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    const secondSave = deferred<ReturnType<typeof settingsWithChatLineHeight>>();
    mockApi.getSettings.mockResolvedValue(settingsWithChatLineHeight(1.45));
    mockApi.updateSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    render(<SettingsPage />);
    const input = await screen.findByLabelText("Chat message line height value");
    fireEvent.change(input, { target: { value: "1.50" } });
    fireEvent.change(input, { target: { value: "1.60" } });

    await act(async () => {
      firstSave.reject(new Error("older save failed"));
      await firstSave.promise.catch(() => undefined);
    });
    expect(input).toHaveValue(1.6);
    expect(screen.queryByText("older save failed")).not.toBeInTheDocument();
    expect(mockState.setChatMessageLineHeight).toHaveBeenLastCalledWith(1.6);

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue(1.6);
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
    const input = await screen.findByLabelText("Chat message line height value");
    fireEvent.change(input, { target: { value: "1.50" } });
    fireEvent.change(input, { target: { value: "1.60" } });

    await act(async () => {
      secondSave.resolve(settingsWithChatLineHeight(1.6));
      await secondSave.promise;
    });
    expect(input).toHaveValue(1.6);

    await act(async () => {
      firstSave.resolve(settingsWithChatLineHeight(1.5));
      await firstSave.promise;
    });
    expect(mockApi.updateSettings).toHaveBeenNthCalledWith(3, { chatMessageLineHeight: 1.6 });
    expect(input).toHaveValue(1.6);

    await act(async () => {
      correctiveSave.reject(new Error("corrective save failed"));
      await correctiveSave.promise.catch(() => undefined);
    });
    expect(input).toHaveValue(1.5);
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
      claudeBinary: "",
      codexBinary: "",
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
      claudeBinary: "",
      codexBinary: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "cursor" },
    });

    render(<SettingsPage />);
    const select = await screen.findByLabelText("Editor");
    fireEvent.change(select, { target: { value: "cursor" } });

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ editorConfig: { editor: "cursor" } });
    });
  });

  it("updates heavy repo mode from the Sessions settings section", async () => {
    mockApi.updateSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      claudeBinary: "",
      codexBinary: "",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: true,
      editorConfig: { editor: "none" },
    });

    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Heavy Repo Mode Off/ }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ heavyRepoModeEnabled: true });
    });
    expect(screen.getByRole("button", { name: /Heavy Repo Mode On/ })).toBeInTheDocument();
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
      claudeBinary: "",
      codexBinary: "",
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
      claudeBinary: "",
      codexBinary: "",
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
      claudeBinary: "",
      codexBinary: "",
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

  it("edits auto-approval rules in a modal", async () => {
    mockApi.getAutoApprovalConfigs.mockResolvedValue([
      {
        slug: "companion",
        label: "companion",
        projectPath: "/mnt/home/jiayiwei/companion",
        projectPaths: ["/mnt/home/jiayiwei/companion"],
        criteria: "Allow harmless commands",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    mockApi.updateAutoApprovalConfig.mockResolvedValue({});

    render(<SettingsPage />);
    await screen.findByText("companion");

    fireEvent.click(screen.getByText("Edit"));

    const dialog = screen.getByRole("dialog", { name: "Edit auto-approval rule" });
    expect(dialog).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Rule criteria"), {
      target: { value: "Allow harmless commands and test commands" },
    });
    fireEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(mockApi.updateAutoApprovalConfig).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({
          label: "companion",
          criteria: "Allow harmless commands and test commands",
          projectPaths: ["/mnt/home/jiayiwei/companion"],
        }),
      );
    });
  });

  // ── Search and section navigation tests ───────────────────────────────────

  it("keeps sections expanded when section headers are clicked", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.getByText(/^Sound$/)).toBeInTheDocument();

    fireEvent.click(settingsSection("Notifications").querySelector("h2") as HTMLElement);

    expect(screen.getByText(/^Sound$/)).toBeInTheDocument();
    expect(localStorage.getItem("cc-settings-collapsed")).toBeNull();
  });

  it("ignores stale persisted collapse state and renders sections expanded", async () => {
    localStorage.setItem("cc-settings-collapsed", JSON.stringify(["notifications", "sessions"]));

    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.getByText(/^Sound$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max Keep-Alive/i)).toBeInTheDocument();
  });

  it("filters sections with fuzzy search across labels and aliases", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "vscode" } });

    const cliSection = settingsSection("CLI & Backends");
    expect(cliSection).toBeVisible();
    expect(settingsSection("Shortcuts")).toBeVisible();
    expect(settingsSection("Appearance & Display")).not.toBeVisible();
    expect(within(cliSection).getByLabelText("Editor")).toBeVisible();
    expect(within(cliSection).getByLabelText("Claude Code")).not.toBeVisible();
  });

  it("finds role-aware session defaults from worker and leader search terms", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "leader defaults" },
    });

    const sessionsSection = settingsSection("Sessions");
    expect(sessionsSection).toBeVisible();
    expect(within(sessionsSection).getByRole("heading", { name: "Worker Defaults" })).toBeVisible();
    expect(within(sessionsSection).getByRole("heading", { name: "Leader Defaults" })).toBeVisible();
    expect(settingsSection("Notifications")).not.toBeVisible();
  });

  it("finds chat line-height control from settings search", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "line height" } });

    const appearanceSection = settingsSection("Appearance & Display");
    expect(appearanceSection).toBeVisible();
    expect(within(appearanceSection).getByLabelText("Chat Message Line Height")).toBeVisible();
    expect(settingsSection("Notifications")).not.toBeVisible();
  });

  it("exposes compact tool activity as the searchable quiet-view preference", async () => {
    // The user-facing setting should be discoverable by the informal mode name and wire to the local display action.
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "quiet mode" } });

    const appearanceSection = settingsSection("Appearance & Display");
    const toggle = within(appearanceSection).getByRole("button", { name: /Compact Tool Activity/ });
    expect(toggle).toBeVisible();
    expect(within(toggle).getByText("On")).toBeTruthy();
    fireEvent.click(toggle);
    expect(mockState.toggleCompactToolActivity).toHaveBeenCalledTimes(1);
  });

  it("exposes Codex leader mode without restoring legacy budget controls", async () => {
    mockApi.getSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverEventFilters: { needsInput: true, review: true, error: true },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      claudeBinary: "",
      codexBinary: "",
      codexLeaderContextWindowOverrideTokens: 1_100_000,
      codexNonLeaderAutoCompactThresholdPercent: 85,
      codexLeaderRecycleThresholdTokens: 275_000,
      codexLeaderRecycleThresholdTokensByModel: { "gpt-5.4": 430_000 },
      codexLeaderCompactionMode: "compact",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "none" },
    });
    mockApi.updateSettings.mockResolvedValue({
      serverName: "",
      serverId: "test-id",
      serverSlug: "prod",
      pushoverConfigured: false,
      pushoverEnabled: true,
      pushoverEventFilters: { needsInput: true, review: true, error: true },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      claudeBinary: "",
      codexBinary: "",
      codexLeaderContextWindowOverrideTokens: 1_200_000,
      codexLeaderRecycleThresholdTokens: 280_000,
      codexLeaderRecycleThresholdTokensByModel: { "gpt-5.4": 440_000, "gpt-5.5": 320_000 },
      codexLeaderCompactionMode: "recycle",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "none" },
    });

    render(<SettingsPage />);
    await waitForSettingsPage();

    const cliSection = settingsSection("CLI & Backends");
    expect(within(cliSection).getByText("Codex Leader Context Mode")).toBeInTheDocument();
    expect(within(cliSection).queryByLabelText("Codex Non-Leader Auto-Compact Threshold")).toBeNull();
    expect(within(cliSection).queryByLabelText("Codex Leader Context Window")).toBeNull();
    expect(within(cliSection).queryByLabelText("Codex Leader Recycle Budget")).toBeNull();
    expect(within(cliSection).queryByText("Codex Leader Model Budget Overrides")).toBeNull();

    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });

  it("updates the Codex leader context mode setting", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    const cliSection = settingsSection("CLI & Backends");
    fireEvent.click(within(cliSection).getByRole("button", { name: "Compact" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({ codexLeaderCompactionMode: "compact" });
    });
  });

  it("keeps legacy Codex leader budget controls out of Settings search", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "leader model budget" },
    });

    const cliSection = settingsSection("CLI & Backends");
    // The removed leader budget controls should not remain discoverable
    // through the settings search index after the visible rows are removed.
    expect(cliSection).not.toBeVisible();
    expect(screen.getByText('No settings match "leader model budget".')).toBeInTheDocument();
  });

  it("does not expose the legacy non-leader auto-compact setting in Settings search", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.queryByLabelText("Codex Non-Leader Auto-Compact Threshold")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "non leader auto compact" },
    });

    expect(screen.getByText('No settings match "non leader auto compact".')).toBeInTheDocument();
    expect(settingsSection("CLI & Backends")).not.toBeVisible();
  });

  it("shows an empty state when no settings match", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "definitelynotasetting" },
    });

    expect(screen.getByText('No settings match "definitelynotasetting".')).toBeInTheDocument();
    expect(settingsSection("Notifications")).not.toBeVisible();
  });

  it("jumps to settings sections from the desktop nav and mobile control", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /^Sessions$/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "Jump to settings section" }), {
      target: { value: "server" },
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("renders all section headings", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(settingsSection("Appearance & Display")).toBeInTheDocument();
    expect(settingsSection("Notifications")).toBeInTheDocument();
    expect(settingsSection("CLI & Backends")).toBeInTheDocument();
    expect(settingsSection("Sessions")).toBeInTheDocument();
    expect(settingsSection("Push Notifications (Pushover)")).toBeInTheDocument();
    expect(settingsSection("Auto-Approval (LLM)")).toBeInTheDocument();
    expect(settingsSection("Session Namer")).toBeInTheDocument();
    expect(settingsSection("Voice Transcription")).toBeInTheDocument();
    expect(settingsSection("Server & Diagnostics")).toBeInTheDocument();
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
            codex: { ...DEFAULT_SESSION_DEFAULTS.codex, model: "remote-worker-model" },
            leaderUsesWorkerDefaults: false,
            leader: {
              codex: { ...DEFAULT_SESSION_DEFAULTS.leader.codex, model: "remote-leader-model" },
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
