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
              serviceTiers: [{ id: "priority", name: "Fast" }],
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

    fireEvent.change(screen.getByLabelText("Default Codex reasoning effort"), { target: { value: "medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Defaults" }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        sessionDefaults: expect.objectContaining({
          codex: expect.objectContaining({ reasoningEffort: "medium", serviceTier: "priority" }),
          claude: expect.objectContaining({ reasoningEffort: "max", maxContextLength: 1000000 }),
        }),
      });
    });
  });
});
