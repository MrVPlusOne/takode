// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

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
  mockApi,
  mockState,
  resetSettingsPageMocks,
  settingsSection,
  waitForSettingsPage,
} from "./settings-page-test-harness.js";

beforeEach(resetSettingsPageMocks);

// Page-level coverage for the Settings groups, the section jump controls and
// search filtering. Search ranking itself is unit-tested in settings-search.test.ts.
describe("SettingsPage groups and search", () => {
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

    // "vscode" matches the editor row and the shortcut preset, so both groups stay
    // visible while unrelated rows and groups are filtered out.
    const editorSection = settingsSection("Editor");
    expect(editorSection).toBeVisible();
    expect(settingsSection("Keyboard Shortcuts")).toBeVisible();
    expect(settingsSection("Appearance")).not.toBeVisible();
    expect(within(editorSection).getByLabelText("Editor")).toBeVisible();
    // Claude Code and Codex programs are per-machine settings in Hosts, which "vscode" does not match.
    expect(settingsSection("Hosts")).not.toBeVisible();
  });

  // The Claude Code and Codex programs moved from a global group to each machine in Hosts.
  it("finds the per-machine CLI settings under Hosts", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "codex binary" } });

    expect(settingsSection("Hosts")).toBeVisible();
    expect(settingsSection("Editor")).not.toBeVisible();
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

    const appearanceSection = settingsSection("Appearance");
    expect(appearanceSection).toBeVisible();
    expect(within(appearanceSection).getByLabelText("Chat Message Line Height")).toBeVisible();
    expect(settingsSection("Notifications")).not.toBeVisible();
  });

  it("exposes compact tool activity as the searchable quiet-view preference", async () => {
    // The user-facing setting should be discoverable by the informal mode name and wire to the local display action.
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "quiet mode" } });

    const appearanceSection = settingsSection("Appearance");
    const toggle = within(appearanceSection).getByRole("switch", {
      name: "Compact Tool Activity",
    });
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-checked", "true");
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
      pushoverEventFilters: {
        needsInput: true,
        review: true,
        notifyMe: true,
        error: true,
      },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
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
      pushoverEventFilters: {
        needsInput: true,
        review: true,
        notifyMe: true,
        error: true,
      },
      pushoverDelaySeconds: 30,
      pushoverBaseUrl: "",
      codexLeaderContextWindowOverrideTokens: 1_200_000,
      codexLeaderRecycleThresholdTokens: 280_000,
      codexLeaderRecycleThresholdTokensByModel: {
        "gpt-5.4": 440_000,
        "gpt-5.5": 320_000,
      },
      codexLeaderCompactionMode: "recycle",
      maxKeepAlive: 0,
      heavyRepoModeEnabled: false,
      editorConfig: { editor: "none" },
    });

    render(<SettingsPage />);
    await waitForSettingsPage();

    expect(screen.getByRole("radiogroup", { name: "Codex Leader Context Mode" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Codex Non-Leader Auto-Compact Threshold")).toBeNull();
    expect(screen.queryByLabelText("Codex Leader Context Window")).toBeNull();
    expect(screen.queryByLabelText("Codex Leader Recycle Budget")).toBeNull();
    expect(screen.queryByText("Codex Leader Model Budget Overrides")).toBeNull();

    expect(mockApi.updateSettings).not.toHaveBeenCalled();
  });

  it("updates the Codex leader context mode setting", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    const modes = screen.getByRole("radiogroup", {
      name: "Codex Leader Context Mode",
    });
    fireEvent.click(within(modes).getByRole("radio", { name: "Compact" }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        codexLeaderCompactionMode: "compact",
      });
    });
  });

  it("keeps legacy Codex leader budget controls out of Settings search", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "leader model budget" },
    });

    // The removed leader budget controls should not remain discoverable
    // through the settings search index after the visible rows are removed.
    expect(settingsSection("Sessions")).not.toBeVisible();
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
    expect(settingsSection("Sessions")).not.toBeVisible();
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

  it("highlights the group whose top has scrolled under the search bar", async () => {
    // The highlight is derived from every group's position, so a group that is
    // scrolling out above the marker must not stay selected.
    const { container } = render(<SettingsPage />);
    await waitForSettingsPage();
    const scroller = container.firstElementChild as HTMLElement;
    // Groups above Sessions have scrolled out; later groups are still below the
    // marker. jsdom has no stylesheet, so the marker is just the slack below the top.
    const tops: Record<string, number> = {
      appearance: -2400,
      keyboard: -1500,
      voice: -900,
      notifications: -300,
      sessions: 30,
    };
    for (const section of container.querySelectorAll<HTMLElement>("[data-settings-section-id]")) {
      const top = tops[section.dataset.settingsSectionId ?? ""] ?? 900;
      section.getBoundingClientRect = () => ({ top }) as DOMRect;
    }

    fireEvent.scroll(scroller);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Jump to settings section" })).toHaveValue("sessions"),
    );
  });

  it("renders the groups and their subsections", async () => {
    render(<SettingsPage />);
    await waitForSettingsPage();

    // The section jump menu lists exactly the top-level groups, in page order.
    const jump = screen.getByRole("combobox", {
      name: "Jump to settings section",
    });
    expect(
      within(jump)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Appearance",
      "Keyboard",
      "Voice Input",
      "Notifications",
      "Sessions",
      "Editor",
      "Performance & Power",
      "Hosts",
      "Server & Login",
    ]);
    for (const subsection of [
      "Leader Profile Pictures",
      "Keyboard Shortcuts",
      "This Browser",
      "Phone Alert Rules",
      "Web Push",
      "Pushover",
      "Session Namer",
      "Environments",
      "Export & Import",
      "Login",
      "Server Slug",
      "Restart",
    ]) {
      expect(settingsSection(subsection)).toBeInTheDocument();
    }
  });
});
