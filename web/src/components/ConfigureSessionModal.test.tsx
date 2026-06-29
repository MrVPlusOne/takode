// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ConfigureSessionModal } from "./ConfigureSessionModal.js";

const mockGetBackendModels = vi.hoisted(() => vi.fn());
const mockUpdateSessionConfig = vi.hoisted(() => vi.fn());
const mockRelaunchSession = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getBackendModels: (...args: unknown[]) => mockGetBackendModels(...args),
    updateSessionConfig: (...args: unknown[]) => mockUpdateSessionConfig(...args),
    relaunchSession: (...args: unknown[]) => mockRelaunchSession(...args),
  },
}));

interface MockStoreState {
  sessions: Map<string, Record<string, unknown>>;
  sdkSessions: Array<Record<string, unknown>>;
  cliConnected: Map<string, boolean>;
  updateSession: ReturnType<typeof vi.fn>;
  updateSdkSession: ReturnType<typeof vi.fn>;
}

let storeState: MockStoreState;

vi.mock("../store.js", () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(storeState),
}));

function resetStore(overrides: Partial<MockStoreState> = {}) {
  storeState = {
    sessions: new Map([
      [
        "s1",
        {
          session_id: "s1",
          backend_type: "codex",
          model: "gpt-5.4",
          permissionMode: "codex-default",
          codex_service_tier: null,
        },
      ],
    ]),
    sdkSessions: [
      {
        sessionId: "s1",
        sessionNum: 1533,
        backendType: "codex",
        model: "gpt-5.4",
        permissionMode: "codex-default",
        codexServiceTier: null,
      },
    ],
    cliConnected: new Map([["s1", true]]),
    updateSession: vi.fn(),
    updateSdkSession: vi.fn(),
    ...overrides,
  };
}

describe("ConfigureSessionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockGetBackendModels.mockImplementation(async (backend: string) =>
      backend === "codex"
        ? [
            {
              value: "gpt-5.4",
              label: "GPT-5.4",
              serviceTiers: [{ id: "priority", name: "Fast", description: "Fast tier" }],
            },
          ]
        : [{ value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" }],
    );
    mockUpdateSessionConfig.mockResolvedValue({
      ok: true,
      sessionId: "s1",
      backendConnected: true,
      restartRequired: false,
      changedFields: ["codexServiceTier"],
      immediateFields: ["codexServiceTier"],
      restartRequiredFields: [],
      session: { codexServiceTier: "priority" },
      sessionState: { codex_service_tier: "priority" },
    });
    mockRelaunchSession.mockResolvedValue({});
  });

  it("portals the overlay to the document body so entry-point containers cannot constrain it", async () => {
    const { container } = render(
      <div data-testid="sidebar-contained-entry">
        <ConfigureSessionModal sessionId="s1" onClose={() => {}} />
      </div>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Configure Session" });
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(dialog.parentElement).toBe(document.body);
  });

  it("applies next-turn-only Codex speed changes without relaunching", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={onClose} />);

    await user.selectOptions(await screen.findByLabelText("Session Codex speed"), "priority");
    expect(screen.getByRole("button", { name: "Apply Changes" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Apply Changes" }));

    await waitFor(() => {
      expect(mockUpdateSessionConfig).toHaveBeenCalledWith("s1", { codexServiceTier: "priority" });
    });
    expect(mockRelaunchSession).not.toHaveBeenCalled();
    expect(storeState.updateSdkSession).toHaveBeenCalledWith("s1", { codexServiceTier: "priority" });
    expect(storeState.updateSession).toHaveBeenCalledWith("s1", { codex_service_tier: "priority" });
    expect(onClose).toHaveBeenCalled();
  });

  it("prefers authoritative live session_update state over stale sdk metadata", async () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            backend_type: "codex",
            model: "gpt-5.4",
            permissionMode: "codex-full-access",
            codex_internet_access: false,
            codex_reasoning_effort: "high",
            codex_service_tier: "priority",
            codex_max_context_length: null,
          },
        ],
      ]),
      sdkSessions: [
        {
          sessionId: "s1",
          sessionNum: 1533,
          backendType: "codex",
          model: "gpt-5.4",
          permissionMode: "codex-default",
          codexInternetAccess: true,
          codexReasoningEffort: "low",
          codexServiceTier: null,
          codexMaxContextLength: 600000,
        },
      ],
    });

    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    expect(await screen.findByLabelText("Session permission mode")).toHaveValue("codex-full-access");
    expect(screen.getByLabelText("Session Codex internet access")).not.toBeChecked();
    expect(screen.getByLabelText("Session Codex reasoning effort")).toHaveValue("high");
    expect(screen.getByLabelText("Session Codex speed")).toHaveValue("priority");
    expect(screen.getByLabelText("Session Codex max context length")).toHaveValue(null);
  });

  it("saves a speed value that matches stale sdk metadata but differs from live state", async () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            backend_type: "codex",
            model: "gpt-5.4",
            permissionMode: "codex-default",
            codex_service_tier: null,
          },
        ],
      ]),
      sdkSessions: [
        {
          sessionId: "s1",
          sessionNum: 1533,
          backendType: "codex",
          model: "gpt-5.4",
          permissionMode: "codex-default",
          codexServiceTier: "priority",
        },
      ],
      cliConnected: new Map([["s1", false]]),
    });
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    expect(await screen.findByLabelText("Session Codex speed")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("Session Codex speed"), "priority");
    await user.click(screen.getByRole("button", { name: "Save for Next Resume" }));

    await waitFor(() => {
      expect(mockUpdateSessionConfig).toHaveBeenCalledWith("s1", { codexServiceTier: "priority" });
    });
    expect(storeState.updateSession).toHaveBeenCalledWith("s1", { codex_service_tier: "priority" });
  });

  it("uses restart primary action and relaunches after saving restart-required changes", async () => {
    mockUpdateSessionConfig.mockResolvedValueOnce({
      ok: true,
      sessionId: "s1",
      backendConnected: true,
      restartRequired: true,
      changedFields: ["codexReasoningEffort"],
      immediateFields: [],
      restartRequiredFields: ["codexReasoningEffort"],
      session: { codexReasoningEffort: "high" },
      sessionState: { codex_reasoning_effort: "high" },
    });
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    await user.selectOptions(await screen.findByLabelText("Session Codex reasoning effort"), "high");
    expect(screen.getByRole("button", { name: "Restart to Apply Changes" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Restart to Apply Changes" }));

    await waitFor(() => {
      expect(mockUpdateSessionConfig).toHaveBeenCalledWith("s1", { codexReasoningEffort: "high" });
    });
    expect(mockRelaunchSession).toHaveBeenCalledWith("s1");
  });

  it("uses server backendConnected response instead of stale local connectivity for relaunch", async () => {
    mockUpdateSessionConfig.mockResolvedValueOnce({
      ok: true,
      sessionId: "s1",
      backendConnected: false,
      restartRequired: true,
      changedFields: ["codexReasoningEffort"],
      immediateFields: [],
      restartRequiredFields: ["codexReasoningEffort"],
      session: { codexReasoningEffort: "high" },
      sessionState: { codex_reasoning_effort: "high" },
    });
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    await user.selectOptions(await screen.findByLabelText("Session Codex reasoning effort"), "high");
    expect(screen.getByRole("button", { name: "Restart to Apply Changes" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Restart to Apply Changes" }));

    await waitFor(() => expect(mockUpdateSessionConfig).toHaveBeenCalled());
    expect(mockRelaunchSession).not.toHaveBeenCalled();
  });

  it("saves restart-required changes for disconnected sessions without relaunching", async () => {
    resetStore({ cliConnected: new Map([["s1", false]]) });
    mockUpdateSessionConfig.mockResolvedValueOnce({
      ok: true,
      sessionId: "s1",
      backendConnected: false,
      restartRequired: true,
      changedFields: ["codexReasoningEffort"],
      immediateFields: [],
      restartRequiredFields: ["codexReasoningEffort"],
      session: { codexReasoningEffort: "high" },
      sessionState: { codex_reasoning_effort: "high" },
    });
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    await user.selectOptions(await screen.findByLabelText("Session Codex reasoning effort"), "high");
    expect(screen.getByRole("button", { name: "Save for Next Resume" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save for Next Resume" }));

    await waitFor(() => expect(mockUpdateSessionConfig).toHaveBeenCalled());
    expect(mockRelaunchSession).not.toHaveBeenCalled();
  });

  it("labels disconnected next-turn-only Codex speed changes as save-for-resume", async () => {
    resetStore({ cliConnected: new Map([["s1", false]]) });
    mockUpdateSessionConfig.mockResolvedValueOnce({
      ok: true,
      sessionId: "s1",
      backendConnected: false,
      restartRequired: false,
      changedFields: ["codexServiceTier"],
      immediateFields: ["codexServiceTier"],
      restartRequiredFields: [],
      session: { codexServiceTier: "priority" },
      sessionState: { codex_service_tier: "priority" },
    });
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={() => {}} />);

    await user.selectOptions(await screen.findByLabelText("Session Codex speed"), "priority");
    expect(screen.getByRole("button", { name: "Save for Next Resume" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save for Next Resume" }));

    await waitFor(() => expect(mockUpdateSessionConfig).toHaveBeenCalledWith("s1", { codexServiceTier: "priority" }));
    expect(mockRelaunchSession).not.toHaveBeenCalled();
  });

  it("does not save when cancelled", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfigureSessionModal sessionId="s1" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockUpdateSessionConfig).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
