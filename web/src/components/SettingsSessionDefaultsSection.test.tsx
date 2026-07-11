// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        : [{ value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", description: "" }],
    );
    mockUpdateSettings.mockImplementation(async (patch) => ({ sessionDefaults: patch.sessionDefaults }));
  });

  it("loads backend-specific defaults and persists edits", async () => {
    render(<SettingsSessionDefaultsSection sessionDefaults={loadedDefaults} />);

    expect(await screen.findByRole("heading", { name: "Session Defaults" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Default Codex speed")).toHaveValue("priority"));
    expect(screen.getByLabelText("Default Claude reasoning effort")).toHaveValue("max");
    expect(screen.getByLabelText("Default Codex usable context capacity")).toHaveAttribute(
      "placeholder",
      "No override",
    );
    expect(screen.getByLabelText("Default Codex usable context percent")).toHaveValue(95);
    expect(screen.getByLabelText("Default Claude max context length")).toHaveAttribute("placeholder", "No override");
    expect(screen.getByText(/Desired usable Codex capacity in tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/Empty leaves the selected model\/backend default unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/Targets 240 K tokens usable capacity/i)).toBeInTheDocument();
    expect(screen.getByText(/requests about 267 K tokens raw context at 90%/i)).toBeInTheDocument();
    expect(screen.getByText(/Optional Claude context window in tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/currently supported value: 1,000,000/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Default Codex reasoning effort"), { target: { value: "medium" } });
    fireEvent.change(screen.getByLabelText("Default Codex usable context percent"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Defaults" }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        sessionDefaults: expect.objectContaining({
          codex: expect.objectContaining({
            effectiveContextWindowPercent: 80,
            reasoningEffort: "medium",
            serviceTier: "priority",
          }),
          claude: expect.objectContaining({ reasoningEffort: "max", maxContextLength: 1000000 }),
        }),
      });
    });
  });

  it("warns instead of blocking when configured Codex context exceeds model metadata", async () => {
    render(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, maxContextLength: 500000 },
        }}
      />,
    );

    expect(await screen.findByText(/Selected model metadata reports 300 K tokens raw max/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Defaults" })).toBeEnabled();
  });

  it("shows catalog Codex models and reasoning levels", async () => {
    render(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, model: "gpt-5.6-sol", reasoningEffort: "ultra" },
        }}
      />,
    );

    expect(await screen.findByRole("option", { name: "GPT-5.6-Sol" })).toBeInTheDocument();
    expect(screen.getByLabelText("Default Codex model")).toHaveValue("gpt-5.6-sol");
    expect(screen.getByRole("option", { name: "Ultra" })).toBeInTheDocument();
    expect(screen.getByLabelText("Default Codex reasoning effort")).toHaveValue("ultra");
  });

  it("preserves unknown saved Codex model and reasoning strings in the selects", async () => {
    render(
      <SettingsSessionDefaultsSection
        sessionDefaults={{
          ...loadedDefaults,
          codex: { ...loadedDefaults.codex, model: "gpt-future", reasoningEffort: "future_effort" },
        }}
      />,
    );

    expect(await screen.findByRole("option", { name: "gpt-future" })).toBeInTheDocument();
    expect(screen.getByLabelText("Default Codex model")).toHaveValue("gpt-future");
    expect(screen.getByRole("option", { name: "Future Effort" })).toHaveValue("future_effort");
    expect(screen.getByLabelText("Default Codex reasoning effort")).toHaveValue("future_effort");
  });
});
