// @vitest-environment jsdom
/**
 * The session settings label wired to a real session: `useSessionSettings` reads the store, loads
 * the model catalogs and sends setting changes to the server. These cases moved here from the
 * composer when the model, effort and access pickers moved from its control row to the title.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionState } from "../../server/session-types.js";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";

const mockSendToSession = vi.fn().mockReturnValue(true);
const mockGetBackendModels = vi.fn();
const mockGetSettings = vi.fn();
let storeState: Record<string, unknown> = {};

vi.mock("../ws.js", () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args),
}));

vi.mock("../api.js", () => ({
  api: {
    getBackendModels: (...args: unknown[]) => mockGetBackendModels(...args),
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
  },
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(storeState),
}));

import { SessionSettingsMenu, useSessionSettings } from "./SessionSettingsMenu.js";

function setupStore({
  session = {},
  isConnected = true,
  browserConnectionStatus = isConnected ? "connected" : "disconnected",
}: {
  session?: Partial<SessionState>;
  isConnected?: boolean;
  browserConnectionStatus?: "connected" | "disconnected" | "connecting";
} = {}) {
  storeState = {
    sessions: new Map([["s1", { session_id: "s1", model: "claude-sonnet-4-5-20250929", ...session }]]),
    cliConnected: new Map([["s1", isConnected]]),
    connectionStatus: new Map([["s1", browserConnectionStatus]]),
    askPermission: new Map(),
    sdkSessions: [],
  };
}

// The title's one-line summary and the settings menu at the top of Session Info.
function SessionLabel() {
  const settings = useSessionSettings("s1");
  return (
    <>
      <span data-testid="title-summary" title={settings.title}>
        {settings.summary}
      </span>
      <SessionSettingsMenu settings={settings} />
    </>
  );
}

const label = () => screen.getByTestId("title-summary");
const menu = () => screen.getByTestId("session-settings-menu");
const confirmPanel = () => screen.getByTestId("session-settings-access-confirm");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBackendModels.mockResolvedValue([]);
  mockGetSettings.mockResolvedValue({ claudeDefaultModel: "" });
  setupStore();
});

describe("session access level", () => {
  it("labels a Claude session with its native permission mode", () => {
    setupStore({ session: { permissionMode: "acceptEdits" } });
    render(<SessionLabel />);
    expect(label().textContent).toContain("Accept edits");
  });

  it("sends a confirmed Claude change as the selected native mode", async () => {
    setupStore({ session: { permissionMode: "acceptEdits" } });
    render(<SessionLabel />);

    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Access/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: /^Plan/ }));

    expect(confirmPanel().textContent).toContain("Change access to Plan?");
    expect(mockSendToSession).not.toHaveBeenCalledWith("s1", expect.objectContaining({ type: "set_permission_mode" }));

    await userEvent.click(within(confirmPanel()).getByRole("button", { name: "Restart" }));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_permission_mode", mode: "plan" });
  });

  it("sends a confirmed Codex change as the selected native profile", async () => {
    setupStore({ session: { backend_type: "codex", model: "gpt-5.4", permissionMode: "codex-default" } });
    render(<SessionLabel />);

    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Access/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: /^Auto-review/ }));

    expect(confirmPanel().textContent).toContain("Change access to Auto-review?");
    expect(mockSendToSession).not.toHaveBeenCalledWith("s1", expect.objectContaining({ type: "set_permission_mode" }));

    await userEvent.click(within(confirmPanel()).getByRole("button", { name: "Restart" }));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_permission_mode", mode: "codex-auto-review" });
  });

  it("ignores the old Codex uiMode axis when labeling access", () => {
    setupStore({
      session: { backend_type: "codex", model: "gpt-5.4", permissionMode: "codex-auto-review", uiMode: "plan" },
    });
    render(<SessionLabel />);
    expect(label().textContent).toContain("Auto-review");
    expect(label().textContent).not.toContain("Plan");
  });

  it("stays editable while the backend is stopped but Takode is reachable", async () => {
    // The change is saved for the next launch, so the confirmation says so and offers Apply.
    setupStore({
      isConnected: false,
      browserConnectionStatus: "connected",
      session: { permissionMode: "acceptEdits" },
    });
    render(<SessionLabel />);

    expect(
      within(menu())
        .getByRole("menuitem", { name: /Access/ })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(label().getAttribute("title")).toContain("(changes apply on resume)");
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Access/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: /^Full access/ }));

    expect(confirmPanel().textContent).toContain(
      "This will apply when the session resumes. Your conversation will be preserved.",
    );
    await userEvent.click(within(confirmPanel()).getByRole("button", { name: "Apply" }));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_permission_mode", mode: "bypassPermissions" });
  });

  it("is disabled while Takode is not reachable", () => {
    setupStore({
      isConnected: false,
      browserConnectionStatus: "disconnected",
      session: { permissionMode: "acceptEdits" },
    });
    render(<SessionLabel />);
    for (const item of within(menu()).getAllByRole("menuitem")) expect(item.hasAttribute("disabled")).toBe(true);
    expect(menu().textContent).toContain("Reconnect to Takode to change settings.");
  });
});

describe("session model and effort", () => {
  it("keeps Codex launch settings editable while the backend is stopped", async () => {
    setupStore({
      isConnected: false,
      browserConnectionStatus: "connected",
      session: { backend_type: "codex", model: "gpt-5.3-codex", permissionMode: "codex-default" },
    });
    render(<SessionLabel />);

    expect(label().textContent).toContain("5.3 Codex");
    expect(
      within(menu())
        .getByRole("menuitem", { name: /Effort/ })
        .hasAttribute("disabled"),
    ).toBe(false);
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Effort/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: "High" }));

    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_reasoning_effort", effort: "high" });
  });

  it("sends Codex effort changes, including Extra high", async () => {
    setupStore({ session: { backend_type: "codex", model: "gpt-5.4", permissionMode: "codex-default" } });
    render(<SessionLabel />);

    expect(label().getAttribute("title")).toMatch(/^Model: gpt-5.4;/);
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Effort/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: "Extra high" }));

    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_reasoning_effort", effort: "xhigh" });
  });

  it("shows a friendly model-and-effort label", () => {
    setupStore({
      session: {
        backend_type: "codex",
        model: "gpt-5.4",
        codex_reasoning_effort: "high",
        permissionMode: "codex-default",
      },
    });
    render(<SessionLabel />);
    expect(label().textContent).toContain("5.4 High");
  });

  it("lists the Claude CLI's catalog without a conflicting settings-file default", async () => {
    // Regression: a Copilot-routed session running claude-opus-5.5 listed
    // "Default (claude-opus-4-6[1m])" from ~/.claude/settings.json plus stale
    // 4.6-era entries. The CLI-reported catalog already carries the default its
    // own launcher settings resolve to, so the settings-file guess must not appear.
    mockGetBackendModels.mockResolvedValue([
      { value: "claude-opus-5.5", label: "Opus 5.5 (default)", description: "", isDefault: true },
      { value: "claude-haiku-4.5", label: "Haiku 4.5", description: "" },
    ]);
    mockGetSettings.mockResolvedValue({ claudeDefaultModel: "claude-opus-4-6[1m]" });
    setupStore({ session: { model: "claude-opus-5.5", permissionMode: "acceptEdits" } });
    render(<SessionLabel />);

    await waitFor(() => expect(mockGetBackendModels).toHaveBeenCalledWith("claude"));
    await waitFor(() => expect(within(menu()).getByText("Opus 5.5 (default)")).toBeTruthy());
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Model/ }));
    expect(within(menu()).queryByText(/4-6|4\.6/)).toBeNull();

    await userEvent.click(within(menu()).getByText("Haiku 4.5"));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_model", model: "claude-haiku-4.5" });
  });

  it("shows the session's Claude effort and sends effort changes to the server", async () => {
    // The server owns Claude effort state; the label only displays it and
    // requests changes, which the server applies to the running process.
    setupStore({
      session: { model: "claude-opus-5.5", permissionMode: "acceptEdits", claude_reasoning_effort: "high" },
    });
    render(<SessionLabel />);

    expect(label().textContent).toContain("opus-5.5 High");
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Effort/ }));
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: "Max" }));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_claude_reasoning_effort", effort: "max" });
  });

  it("keeps the running Claude model in the list when the catalog omits it", async () => {
    // Without a CLI catalog the static fallback cannot know every model, but
    // the session's own model must still be shown and marked current.
    setupStore({ session: { model: "claude-opus-5.5", permissionMode: "acceptEdits" } });
    render(<SessionLabel />);

    // The row shows the short name; only the list falls back to the raw ID.
    expect(within(menu()).getByRole("menuitem", { name: /Model/ }).textContent).toContain("opus-5.5");
    expect(within(menu()).getByRole("menuitem", { name: /Model/ }).textContent).not.toContain("claude-opus-5.5");
    await userEvent.click(within(menu()).getByRole("menuitem", { name: /Model/ }));
    const current = within(menu()).getByText("claude-opus-5.5");
    expect(current.closest("button")?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("session Codex speed and defaults", () => {
  it("offers a speed choice only for models with a fast service tier", async () => {
    mockGetBackendModels.mockResolvedValue([
      {
        value: "gpt-5.4",
        label: "GPT-5.4",
        description: "Frontier model",
        serviceTiers: [{ id: "priority", name: "Fast", description: "1.5x speed, increased usage" }],
      },
    ]);
    setupStore({ session: { backend_type: "codex", model: "gpt-5.4", permissionMode: "codex-default" } });
    render(<SessionLabel />);

    await waitFor(() => expect(mockGetBackendModels).toHaveBeenCalledWith("codex"));
    await userEvent.click(await within(menu()).findByRole("menuitem", { name: /Speed/ }));
    expect(within(menu()).getByRole("menuitemradio", { name: /^Standard/ })).toBeTruthy();
    await userEvent.click(within(menu()).getByRole("menuitemradio", { name: /^Fast/ }));

    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_service_tier", serviceTier: "priority" });
  });

  it("resets Codex model settings from fresh role-aware server defaults", async () => {
    // Reset must not hardcode frontend values: it reloads the server-owned
    // defaults, resolves the current session role, and uses existing setting messages.
    mockGetSettings.mockResolvedValue({
      claudeDefaultModel: "",
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        codex: { ...DEFAULT_SESSION_DEFAULTS.codex, model: "gpt-worker", reasoningEffort: "low", serviceTier: null },
        leaderUsesWorkerDefaults: false,
        leader: {
          ...DEFAULT_SESSION_DEFAULTS.leader,
          codex: {
            ...DEFAULT_SESSION_DEFAULTS.leader.codex,
            model: "gpt-leader",
            reasoningEffort: "ultra",
            serviceTier: "priority",
          },
        },
      },
    });
    setupStore({
      session: {
        backend_type: "codex",
        isOrchestrator: true,
        model: "gpt-5.4",
        codex_reasoning_effort: "high",
        codex_service_tier: null,
        permissionMode: "codex-default",
      },
    });
    render(<SessionLabel />);

    await userEvent.click(within(menu()).getByRole("button", { name: "Reset to default" }));

    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_model", model: "gpt-leader" }),
    );
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_reasoning_effort", effort: "ultra" });
    expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_service_tier", serviceTier: "priority" });
  });

  it("clears an unsupported Codex service tier after model metadata loads", async () => {
    mockGetBackendModels.mockResolvedValue([
      { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "No speed tier" },
    ]);
    setupStore({
      session: {
        backend_type: "codex",
        model: "gpt-5.3-codex",
        permissionMode: "codex-default",
        codex_service_tier: "priority",
      },
    });
    render(<SessionLabel />);

    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith("s1", { type: "set_codex_service_tier", serviceTier: null }),
    );
  });
});
