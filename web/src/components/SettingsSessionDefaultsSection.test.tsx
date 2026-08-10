// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsSessionDefaultsSection } from "./SettingsSessionDefaultsSection.js";
import { DEFAULT_SESSION_DEFAULTS, type SessionDefaultsSettings } from "../../shared/session-defaults.js";

const mockUpdateSettings = vi.hoisted(() => vi.fn());
const mockGetBackendModels = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
    getBackendModels: (...args: unknown[]) => mockGetBackendModels(...args),
  },
}));

const loadedDefaults: SessionDefaultsSettings = {
  ...DEFAULT_SESSION_DEFAULTS,
  codex: {
    ...DEFAULT_SESSION_DEFAULTS.codex,
    model: "gpt-5.4",
    serviceTier: "priority",
    reasoningEffort: "high",
    internetAccess: true,
    maxContextLength: 240000,
    effectiveContextWindowPercent: 95,
  },
  claude: {
    ...DEFAULT_SESSION_DEFAULTS.claude,
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    reasoningEffort: "max",
    maxContextLength: 1000000,
  },
  leader: {
    codex: {
      ...DEFAULT_SESSION_DEFAULTS.leader.codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
      maxContextLength: 600000,
    },
    claude: {
      ...DEFAULT_SESSION_DEFAULTS.leader.claude,
      model: "claude-opus-4-6",
      permissionMode: "bypassPermissions",
    },
  },
  leaderUsesWorkerDefaults: true,
};

describe("SettingsSessionDefaultsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBackendModels.mockImplementation(async (backend: string) =>
      backend === "codex"
        ? [
            {
              value: "gpt-5.4",
              label: "GPT-5.4",
              description: "",
              maxContextWindow: 300000,
              effectiveContextWindowPercent: 90,
              serviceTiers: [{ id: "priority", name: "Fast" }],
            },
            {
              value: "gpt-5.6-sol",
              label: "GPT-5.6-Sol",
              description: "",
              supportedReasoningLevels: [
                { effort: "low", description: "Fast responses" },
                { effort: "ultra", description: "Maximum reasoning with delegation" },
              ],
            },
          ]
        : [
            { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", description: "" },
            { value: "claude-opus-4-6", label: "Claude Opus 4.6", description: "" },
          ],
    );
    mockUpdateSettings.mockImplementation(async (patch) => ({ sessionDefaults: patch.sessionDefaults }));
  });

  it("presents worker and leader defaults while keeping the context estimate global", async () => {
    render(<SettingsSessionDefaultsSection sessionDefaults={loadedDefaults} />);

    expect(await screen.findByRole("heading", { name: "Session Defaults" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worker Defaults" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leader Defaults" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Global Context Estimate" })).toBeInTheDocument();
    expect(screen.getAllByText("Usable context estimate")).toHaveLength(1);
    expect(screen.getByLabelText("Codex usable context estimate percent")).toHaveValue(95);
    expect(screen.getByLabelText("Worker defaults Codex model")).toHaveValue("gpt-5.4");
    expect(screen.getByLabelText("Leader defaults Codex model")).toBeDisabled();
    expect(screen.getByLabelText("Leader defaults Codex model")).toHaveValue("gpt-5.4");
  });

  it("retains independent leader values while shared defaults are re-enabled", async () => {
    render(<SettingsSessionDefaultsSection sessionDefaults={loadedDefaults} />);
    const shareToggle = screen.getByRole("checkbox", { name: "Use same as worker defaults" });

    fireEvent.click(shareToggle);
    await waitFor(() => expect(screen.getByLabelText("Leader defaults Codex model")).toHaveValue("gpt-5.6-sol"));
    expect(screen.getByLabelText("Leader defaults Codex model")).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Leader defaults Codex reasoning effort"), { target: { value: "low" } });
    fireEvent.click(shareToggle);
    expect(screen.getByLabelText("Leader defaults Codex model")).toHaveValue("gpt-5.4");
    fireEvent.click(screen.getByRole("button", { name: "Save Defaults" }));
    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        sessionDefaults: expect.objectContaining({
          leaderUsesWorkerDefaults: true,
          leader: expect.objectContaining({ codex: expect.objectContaining({ reasoningEffort: "low" }) }),
        }),
      }),
    );
    fireEvent.click(shareToggle);

    expect(screen.getByLabelText("Leader defaults Codex model")).toHaveValue("gpt-5.6-sol");
    expect(screen.getByLabelText("Leader defaults Codex reasoning effort")).toHaveValue("low");
  });

  it("persists both profiles, the sharing flag, and a single global context estimate", async () => {
    render(<SettingsSessionDefaultsSection sessionDefaults={loadedDefaults} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Use same as worker defaults" }));
    fireEvent.change(screen.getByLabelText("Leader defaults Claude permission mode"), {
      target: { value: "plan" },
    });
    fireEvent.change(screen.getByLabelText("Codex usable context estimate percent"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Defaults" }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        sessionDefaults: expect.objectContaining({
          leaderUsesWorkerDefaults: false,
          codex: expect.objectContaining({ effectiveContextWindowPercent: 80, model: "gpt-5.4" }),
          leader: expect.objectContaining({
            codex: expect.not.objectContaining({ effectiveContextWindowPercent: expect.anything() }),
            claude: expect.objectContaining({ permissionMode: "plan" }),
          }),
        }),
      });
    });
  });

  it("does not overwrite unsaved local edits when a server refresh arrives", async () => {
    // SettingsPage polls for cross-browser consistency; an in-progress local form must not be destructively replaced.
    const { rerender } = render(<SettingsSessionDefaultsSection sessionDefaults={loadedDefaults} />);
    fireEvent.change(await screen.findByLabelText("Worker defaults Codex model"), {
      target: { value: "gpt-5.6-sol" },
    });

    rerender(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, model: "remote-model" },
        }}
      />,
    );

    expect(screen.getByLabelText("Worker defaults Codex model")).toHaveValue("gpt-5.6-sol");
  });

  it("warns instead of blocking when a role-specific Codex context exceeds model metadata", async () => {
    render(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, maxContextLength: 500000 },
        }}
      />,
    );

    const workerControls = document.getElementById("worker-default-controls");
    expect(workerControls).not.toBeNull();
    expect(
      await within(workerControls!).findByText(/Selected model metadata reports 300 K tokens raw max/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Defaults" })).toBeEnabled();
  });

  it("preserves unknown saved worker Codex model and reasoning strings", async () => {
    render(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, model: "gpt-future", reasoningEffort: "future_effort" },
        }}
      />,
    );

    const workerModel = await screen.findByLabelText("Worker defaults Codex model");
    expect(within(workerModel).getByRole("option", { name: "gpt-future" })).toBeInTheDocument();
    expect(workerModel).toHaveValue("gpt-future");
    expect(
      within(screen.getByLabelText("Worker defaults Codex reasoning effort")).getByRole("option", {
        name: "Future Effort",
      }),
    ).toHaveValue("future_effort");
  });
});
