import { screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";
import { resetBuildCompatibilityForTest } from "../build-compatibility.js";

/**
 * Shared mocks and helpers for the SettingsPage test files. Each file registers
 * the module mocks through these factories so the mocked API and store state
 * are the same objects the tests inspect:
 *
 *   vi.mock("../api.js", async () => (await import("./settings-page-test-harness.js")).apiModuleMock());
 *   vi.mock("../store.js", async () => (await import("./settings-page-test-harness.js")).storeModuleMock());
 *
 * and calls resetSettingsPageMocks() in beforeEach.
 */

export interface MockStoreState {
  colorTheme: string;
  darkMode: boolean;
  notificationSound: boolean;
  notificationDesktop: boolean;
  showUsageBars: boolean;
  compactToolActivity: boolean;
  chatMessageLineHeight: number;
  sendKeyScheme: "enter" | "mod-enter";
  shortcutSettings: {
    enabled: boolean;
    preset: "standard" | "vscode-light" | "vim-light";
    overrides: Record<string, string | null>;
  };
  zoomLevel: number;
  currentSessionId: string | null;
  sdkSessions: Array<{
    sessionId: string;
    createdAt: number;
    archived?: boolean;
    cronJobId?: string;
  }>;
  setColorTheme: ReturnType<typeof vi.fn>;
  toggleDarkMode: ReturnType<typeof vi.fn>;
  toggleNotificationSound: ReturnType<typeof vi.fn>;
  setNotificationDesktop: ReturnType<typeof vi.fn>;
  toggleShowUsageBars: ReturnType<typeof vi.fn>;
  toggleCompactToolActivity: ReturnType<typeof vi.fn>;
  setChatMessageLineHeight: ReturnType<typeof vi.fn>;
  setSendKeyScheme: ReturnType<typeof vi.fn>;
  setShortcutsEnabled: ReturnType<typeof vi.fn>;
  setShortcutPreset: ReturnType<typeof vi.fn>;
  setShortcutOverride: ReturnType<typeof vi.fn>;
  resetShortcutOverrides: ReturnType<typeof vi.fn>;
  setZoomLevel: ReturnType<typeof vi.fn>;
  serverReachable: boolean;
  setServerReachable: ReturnType<typeof vi.fn>;
  setServerRestarting: ReturnType<typeof vi.fn>;
}

function createMockState(overrides: Partial<MockStoreState> = {}): MockStoreState {
  return {
    colorTheme: "light",
    darkMode: false,
    notificationSound: true,
    notificationDesktop: false,
    showUsageBars: false,
    compactToolActivity: true,
    chatMessageLineHeight: 1.45,
    sendKeyScheme: "enter",
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
    setSendKeyScheme: vi.fn(),
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

/** The mocked store state; read through this live binding so setMockState() replacements are visible. */
export let mockState: MockStoreState = createMockState();

/** Replace the mocked store state for one test. */
export function setMockState(overrides: Partial<MockStoreState> = {}) {
  mockState = createMockState(overrides);
}

export const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getBackendModels: vi.fn(),
  restartServer: vi.fn(),
  getNamerLogs: vi.fn(),
  getNamerLogEntry: vi.fn(),
  testPushover: vi.fn(),
  getWebPushInfo: vi.fn().mockResolvedValue({
    available: true,
    publicKey: "test-key",
    subscriptionCount: 0,
  }),
  getCaffeinateStatus: vi.fn(),
  getAutoApprovalConfigs: vi.fn().mockResolvedValue([]),
  getAutoApprovalConfig: vi.fn(),
  createAutoApprovalConfig: vi.fn(),
  updateAutoApprovalConfig: vi.fn(),
  deleteAutoApprovalConfig: vi.fn(),
  getAutoApprovalLogs: vi.fn().mockResolvedValue([]),
  getAutoApprovalLogEntry: vi.fn(),
};
export const mockCheckReadinessStatus = vi.fn().mockResolvedValue({
  ok: true,
  buildId: "development",
  servedFrontendBuildId: "development",
});

export class MockApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiModuleMock() {
  return {
    api: mockApi,
    ApiError: MockApiError,
    checkReadinessStatus: (...args: unknown[]) => mockCheckReadinessStatus(...args),
    isInterruptRestartBlockersResponse: (value: unknown) => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as { mode?: unknown; herdDelivery?: unknown };
      return (candidate.mode === "standalone" || candidate.mode === "restart") && !!candidate.herdDelivery;
    },
  };
}

export function storeModuleMock() {
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
}

function settingsResponse() {
  return {
    serverName: "",
    serverId: "test-id",
    serverSlug: "prod",
    pushoverConfigured: false,
    pushoverEnabled: true,
    pushoverEventFilters: {
      needsInput: true,
      review: true,
      notifyMe: true,
      error: true,
    },
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
  };
}

/** Reset every shared mock to the default loaded-settings state. Call from beforeEach. */
export function resetSettingsPageMocks() {
  vi.clearAllMocks();
  mockApi.restartServer.mockReset();
  mockCheckReadinessStatus.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  setMockState();
  window.location.hash = "#/settings";
  // Clear scroll state between tests.
  localStorage.removeItem("cc-settings-collapsed");
  localStorage.removeItem("cc-settings-scroll");
  mockApi.getSettings.mockResolvedValue(settingsResponse());
  mockApi.getBackendModels.mockResolvedValue([]);
  mockApi.restartServer.mockResolvedValue({
    ok: true,
    restartRequested: true,
    replacementBuildId: null,
  });
  mockCheckReadinessStatus.mockResolvedValue({
    ok: true,
    buildId: "development",
    servedFrontendBuildId: "development",
  });
  resetBuildCompatibilityForTest();
  mockApi.updateSettings.mockResolvedValue(settingsResponse());
  mockApi.getNamerLogs.mockResolvedValue([]);
  mockApi.getCaffeinateStatus.mockResolvedValue({
    active: false,
    engagedAt: null,
    expiresAt: null,
  });
}

export async function waitForSettingsPage() {
  await screen.findAllByText("Notifications");
}

/** Typed line-height values apply on blur, so partial text such as "1." is never saved. */
export function typeLineHeight(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

export function settingsSection(title: string): HTMLElement {
  const heading = screen.getAllByText(title).find((node) => node.closest("[data-settings-section-id]"));
  if (!heading) throw new Error(`Missing settings section: ${title}`);
  const section = heading.closest("section, form");
  if (!section) throw new Error(`Missing section wrapper: ${title}`);
  return section as HTMLElement;
}
