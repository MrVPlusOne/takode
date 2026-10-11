// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockQueuePendingSession = vi.fn();
const mockGetGlobalNewSessionDefaults = vi.fn();
const mockGetGroupNewSessionDefaults = vi.fn();
const mockGetCachedGroupNewSessionDefaults = vi.fn();
const mockSaveGroupNewSessionDefaults = vi.fn();
const mockGetRecentDirs = vi.fn();
const mockScopedSetItem = vi.fn();

const mockApi = {
  getHome: vi.fn(),
  getCodexDefaultModel: vi.fn(),
  listEnvs: vi.fn(),
  getBackends: vi.fn(),
  getSettings: vi.fn(),
  getBackendModels: vi.fn(),
  getRepoInfo: vi.fn(),
  listBranches: vi.fn(),
  gitPull: vi.fn(),
  gitFetch: vi.fn(),
  listCliSessions: vi.fn(),
  getNewSessionDefaults: vi.fn(),
  saveNewSessionDefaults: vi.fn(),
  checkFolders: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    getHome: (...args: unknown[]) => mockApi.getHome(...args),
    getCodexDefaultModel: (...args: unknown[]) => mockApi.getCodexDefaultModel(...args),
    listEnvs: (...args: unknown[]) => mockApi.listEnvs(...args),
    getBackends: (...args: unknown[]) => mockApi.getBackends(...args),
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getBackendModels: (...args: unknown[]) => mockApi.getBackendModels(...args),
    getRepoInfo: (...args: unknown[]) => mockApi.getRepoInfo(...args),
    listBranches: (...args: unknown[]) => mockApi.listBranches(...args),
    gitPull: (...args: unknown[]) => mockApi.gitPull(...args),
    gitFetch: (...args: unknown[]) => mockApi.gitFetch(...args),
    listCliSessions: (...args: unknown[]) => mockApi.listCliSessions(...args),
    getNewSessionDefaults: (...args: unknown[]) => mockApi.getNewSessionDefaults(...args),
    saveNewSessionDefaults: (...args: unknown[]) => mockApi.saveNewSessionDefaults(...args),
    checkFolders: (...args: unknown[]) => mockApi.checkFolders(...args),
  },
}));

let mockRemoteHosts: Array<{ id: string; name: string; online: boolean }> = [];
let mockLocalMachine: { id: string; name: string } | null = null;
vi.mock("../remote-hosts.js", () => ({
  useRemoteHosts: () => ({ hosts: mockRemoteHosts, loaded: true, local: mockLocalMachine }),
}));

vi.mock("../utils/recent-dirs.js", () => ({
  getRecentDirs: (...args: unknown[]) => mockGetRecentDirs(...args),
  hostRecentDirsKey: (hostId: string) => `host:${hostId}`,
}));

vi.mock("../utils/pending-creation.js", () => ({
  queuePendingSession: (...args: unknown[]) => mockQueuePendingSession(...args),
}));

vi.mock("../utils/scoped-storage.js", () => ({
  scopedGetItem: vi.fn(() => ""),
  scopedSetItem: (...args: unknown[]) => mockScopedSetItem(...args),
}));

vi.mock("../utils/new-session-defaults.js", () => ({
  getGlobalNewSessionDefaults: (...args: unknown[]) => mockGetGlobalNewSessionDefaults(...args),
  getGroupNewSessionDefaults: (...args: unknown[]) => mockGetGroupNewSessionDefaults(...args),
  getCachedGroupNewSessionDefaults: (...args: unknown[]) => mockGetCachedGroupNewSessionDefaults(...args),
  saveGroupNewSessionDefaults: (...args: unknown[]) => mockSaveGroupNewSessionDefaults(...args),
  saveLastSessionCreationContext: vi.fn(),
}));

vi.mock("./EnvManager.js", () => ({
  EnvManager: () => null,
}));

let folderPickerProps: { hostId?: string; recentDirsKey?: string; onSelect: (path: string) => void } | null = null;
vi.mock("./FolderPicker.js", () => ({
  FolderPicker: (props: NonNullable<typeof folderPickerProps>) => {
    folderPickerProps = props;
    return null;
  },
}));

vi.mock("./CatIcons.js", () => ({
  YarnBallSpinner: (props: { className?: string }) => <div data-testid="spinner" className={props.className} />,
}));

import { NewSessionModal } from "./NewSessionModal.js";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";

function latestQueuedCreateOpts() {
  const lastCall = mockQueuePendingSession.mock.calls.at(-1);
  if (!lastCall) throw new Error("Expected a queued session");
  return lastCall[0].createOpts as Record<string, unknown>;
}

describe("NewSessionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteHosts = [];
    mockLocalMachine = null;
    folderPickerProps = null;
    // Every folder exists unless a test says otherwise.
    mockApi.checkFolders.mockImplementation(async (paths: string[]) => paths.map(() => true));
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockGetCachedGroupNewSessionDefaults.mockReturnValue(null);
    mockApi.getHome.mockResolvedValue({ home: "/Users/test", cwd: "/tmp/project" });
    mockApi.getCodexDefaultModel.mockResolvedValue({ model: "gpt-5.5" });
    mockApi.listEnvs.mockResolvedValue([]);
    mockApi.getBackends.mockResolvedValue([
      { id: "claude", name: "Claude Code", available: true },
      { id: "codex", name: "Codex", available: true },
    ]);
    mockApi.getSettings.mockResolvedValue({ sessionDefaults: DEFAULT_SESSION_DEFAULTS });
    mockApi.getBackendModels.mockResolvedValue([]);
    mockApi.getRepoInfo.mockRejectedValue(new Error("not a repo"));
    mockApi.listBranches.mockResolvedValue([]);
    mockApi.gitPull.mockResolvedValue({ success: true });
    mockApi.gitFetch.mockResolvedValue({ success: true, output: "" });
    mockApi.getNewSessionDefaults.mockResolvedValue({ key: "tree-group:team-alpha", defaults: null, updatedAt: null });
    mockApi.saveNewSessionDefaults.mockResolvedValue({
      ok: true,
      key: "tree-group:team-alpha",
      defaults: null,
      updatedAt: Date.now(),
    });
    mockGetRecentDirs.mockReturnValue(["/tmp/project"]);
    mockApi.listCliSessions.mockImplementation((backend?: "claude" | "codex") =>
      Promise.resolve({
        sessions:
          backend === "codex"
            ? [
                {
                  id: "codex-session-1",
                  cwd: "/tmp/codex-project",
                  slug: "codex-session",
                  gitBranch: "main",
                  lastModified: 1_775_022_000_000,
                  sizeBytes: 123,
                  backend: "codex",
                },
              ]
            : [],
      }),
    );
  });

  it("lets resume mode switch from Claude to Codex sessions", async () => {
    const user = userEvent.setup();
    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByText("Resume from an existing CLI session"));

    // Regression coverage: the modal opens in the global default backend
    // (Claude here), but resume mode must still let the user switch to Codex.
    await waitFor(() => expect(mockApi.listCliSessions).toHaveBeenCalledWith("claude"));
    expect(screen.getByText("No Claude Code CLI sessions found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Codex" }));

    await waitFor(() => expect(mockApi.listCliSessions).toHaveBeenCalledWith("codex"));
    expect(await screen.findByText("codex-session")).toBeInTheDocument();
    expect(screen.queryByText("No Claude Code CLI sessions found")).not.toBeInTheDocument();
  });

  it("loads and saves defaults using the explicit group defaults key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "/tmp/tree-saved-folder",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });

    render(
      <NewSessionModal
        open={true}
        onClose={onClose}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    expect(mockGetGroupNewSessionDefaults).toHaveBeenCalledWith("tree-group:team-alpha");
    expect(await screen.findByText("tree-saved-folder")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(mockSaveGroupNewSessionDefaults).toHaveBeenCalledWith(
        "tree-group:team-alpha",
        expect.objectContaining({
          backend: "claude",
          mode: "acceptEdits",
          askPermission: true,
          cwd: "/tmp/tree-saved-folder",
        }),
      );
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockQueuePendingSession).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: "claude",
        createOpts: expect.objectContaining({ treeGroupId: "team-alpha" }),
        cwd: "/tmp/tree-saved-folder",
        treeGroupId: "team-alpha",
        recentDirsKey: "tree-group:team-alpha",
      }),
    );
  });

  it("loads tree-group recent dirs through the explicit group key", async () => {
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockGetRecentDirs.mockImplementation((key?: string) =>
      key === "tree-group:team-alpha" ? ["/tmp/team-alpha-repo"] : ["/tmp/global-repo"],
    );

    // The tree group open path should use the group's recent list, not the
    // global recent list, so locations remain isolated after reload/restart.
    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    expect(await screen.findByText("team-alpha-repo")).toBeInTheDocument();
    expect(screen.queryByText("global-repo")).not.toBeInTheDocument();
    expect(mockGetRecentDirs).toHaveBeenCalledWith("tree-group:team-alpha");
  });

  it("hydrates tree-group defaults from the server-backed store", async () => {
    const serverDefaults = {
      backend: "codex" as const,
      model: "gpt-5.5",
      mode: "agent",
      askPermission: false,
      sessionRole: "worker" as const,
      envSlug: "sandbox",
      cwd: "/tmp/server-folder",
      useWorktree: false,
      codexInternetAccess: false,
      codexReasoningEffort: "medium",
      codexPermissionMode: "custom",
    };
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "/tmp/local-folder",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getNewSessionDefaults.mockResolvedValue({
      key: "tree-group:team-alpha",
      defaults: serverDefaults,
      updatedAt: 123,
    });

    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    expect(await screen.findByText("server-folder")).toBeInTheDocument();
    expect(mockSaveGroupNewSessionDefaults).toHaveBeenCalledWith("tree-group:team-alpha", serverDefaults);
  });

  it("migrates cached tree-group defaults to the server when no server value exists", async () => {
    const cachedDefaults = {
      backend: "claude" as const,
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker" as const,
      envSlug: "",
      cwd: "/tmp/cached-folder",
      useWorktree: true,
      codexInternetAccess: false,
      codexReasoningEffort: "",
    };
    mockGetCachedGroupNewSessionDefaults.mockReturnValue(cachedDefaults);
    mockApi.getNewSessionDefaults.mockResolvedValue({
      key: "tree-group:team-alpha",
      defaults: null,
      updatedAt: null,
    });

    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    await waitFor(() => {
      expect(mockApi.saveNewSessionDefaults).toHaveBeenCalledWith("tree-group:team-alpha", cachedDefaults);
    });
  });

  it("does not let the server home fallback overwrite hydrated cwd", async () => {
    let resolveHome: (value: { home: string; cwd: string }) => void = () => {};
    mockApi.getHome.mockReturnValue(
      new Promise((resolve) => {
        resolveHome = resolve;
      }),
    );
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockGetRecentDirs.mockReturnValue([]);
    mockApi.getNewSessionDefaults.mockResolvedValue({
      key: "tree-group:team-alpha",
      defaults: {
        backend: "claude",
        model: "",
        mode: "agent",
        askPermission: true,
        sessionRole: "worker",
        envSlug: "",
        cwd: "/tmp/server-backed",
        useWorktree: true,
        codexInternetAccess: false,
        codexReasoningEffort: "",
      },
      updatedAt: 123,
    });

    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    expect(await screen.findByText("server-backed")).toBeInTheDocument();
    resolveHome({ home: "/Users/test", cwd: "/tmp/process-cwd" });

    await waitFor(() => {
      expect(screen.getByText("server-backed")).toBeInTheDocument();
    });
    expect(screen.queryByText("process-cwd")).not.toBeInTheDocument();
  });

  it("does not write group-scoped selections into global defaults before create", async () => {
    const user = userEvent.setup();

    // Group settings are saved under the group key on create; intermediate UI
    // changes should not overwrite the global New Session defaults.
    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Codex" }));

    expect(mockScopedSetItem).not.toHaveBeenCalledWith("cc-backend", "codex");
  });

  it("shows the Codex config default in the model picker when using Default", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Codex" }));

    expect(await screen.findByText("Default (gpt-5.5)")).toBeInTheDocument();
  });

  it("labels the grouped Codex controls so duplicate Default values have context", async () => {
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    const modal = await screen.findByTestId("new-session-modal-card");
    expect(within(modal).getByText("Engine")).toBeInTheDocument();
    expect(within(modal).getByText("Permission mode")).toBeInTheDocument();
    expect(within(modal).getAllByRole("button", { name: "Default" }).length).toBeGreaterThan(0);

    expect(within(modal).getByText("Codex options")).toBeInTheDocument();
    expect(within(modal).getByText("Network access")).toBeInTheDocument();
    expect(within(modal).getByText("Reasoning effort")).toBeInTheDocument();

    expect(within(modal).getByText("Workspace")).toBeInTheDocument();
    expect(within(modal).getByText("Folder")).toBeInTheDocument();
    expect(within(modal).getByText("Session role")).toBeInTheDocument();

    expect(within(modal).getByText("Runtime")).toBeInTheDocument();
    expect(within(modal).getByText("Environment")).toBeInTheDocument();
    expect(within(modal).getByText("Model")).toBeInTheDocument();
    expect(await within(modal).findByText("Default (gpt-5.5)")).toBeInTheDocument();
  });

  it("uses saved Codex settings defaults on initial open without sending stale local defaults", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        codex: {
          ...DEFAULT_SESSION_DEFAULTS.codex,
          model: "gpt-5.4",
          internetAccess: false,
          reasoningEffort: "low",
        },
      },
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: /GPT-5\.4/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Low" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    const createOpts = latestQueuedCreateOpts();
    expect(createOpts.model).toBeUndefined();
    expect(createOpts.codexInternetAccess).toBeUndefined();
    expect(createOpts.codexReasoningEffort).toBeUndefined();
  });

  it("previews independent leader settings defaults when the role changes without sending them as overrides", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: false,
      codexReasoningEffort: "low",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        codex: { ...DEFAULT_SESSION_DEFAULTS.codex, model: "gpt-5.4", reasoningEffort: "low" },
        leaderUsesWorkerDefaults: false,
        leader: {
          codex: {
            ...DEFAULT_SESSION_DEFAULTS.leader.codex,
            model: "gpt-5.6-sol",
            reasoningEffort: "ultra",
            internetAccess: true,
          },
          claude: DEFAULT_SESSION_DEFAULTS.leader.claude,
        },
      },
    });
    mockApi.getBackendModels.mockResolvedValue([
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.6-sol", label: "GPT-5.6-Sol", supportedReasoningLevels: [{ effort: "ultra" }] },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: /GPT-5\.4/ })).toBeInTheDocument();
    await user.click(screen.getByTitle(/Leader session:/));
    expect(await screen.findByRole("button", { name: /GPT-5\.6-Sol/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ultra" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Internet" })).toHaveClass("text-cc-primary");

    await user.click(screen.getByRole("button", { name: "Create Session" }));
    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(
      expect.objectContaining({
        role: "orchestrator",
        model: undefined,
        codexInternetAccess: undefined,
        codexReasoningEffort: undefined,
      }),
    );
  });

  it("uses saved Codex settings defaults after switching backend instead of legacy local defaults", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        codex: {
          ...DEFAULT_SESSION_DEFAULTS.codex,
          model: "gpt-5.4",
          internetAccess: false,
          reasoningEffort: "low",
        },
      },
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    await waitFor(() => expect(mockApi.getSettings).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "Codex" }));

    expect(await screen.findByRole("button", { name: /GPT-5\.4/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Low" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    const createOpts = latestQueuedCreateOpts();
    expect(createOpts.model).toBeUndefined();
    expect(createOpts.codexInternetAccess).toBeUndefined();
    expect(createOpts.codexReasoningEffort).toBeUndefined();
  });

  it("uses saved Claude permission settings defaults without sending stale local defaults", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        claude: {
          ...DEFAULT_SESSION_DEFAULTS.claude,
          permissionMode: "bypassPermissions",
        },
      },
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: "Full access" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    const createOpts = latestQueuedCreateOpts();
    expect(createOpts.permissionMode).toBeUndefined();
    expect(createOpts.askPermission).toBeUndefined();
  });

  it("preserves an explicit Claude permission override across backend switches", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        claude: {
          ...DEFAULT_SESSION_DEFAULTS.claude,
          permissionMode: "bypassPermissions",
        },
      },
    });

    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Full access" }));
    await user.click(await screen.findByText("Plan"));
    await user.click(await screen.findByRole("button", { name: "Codex" }));
    await user.click(await screen.findByRole("button", { name: "Claude Code" }));

    expect(await screen.findByRole("button", { name: "Plan" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(
      expect.objectContaining({
        permissionMode: "plan",
        askPermission: true,
      }),
    );
  });

  it("keeps explicit Codex UI choices ahead of saved settings defaults", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "default",
    });
    mockApi.getSettings.mockResolvedValue({
      sessionDefaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        codex: {
          ...DEFAULT_SESSION_DEFAULTS.codex,
          model: "gpt-5.4",
          internetAccess: false,
          reasoningEffort: "low",
        },
      },
    });
    mockApi.getBackendModels.mockResolvedValue([
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /GPT-5\.4/ }));
    await user.click(await screen.findByRole("button", { name: /GPT-5\.4 Mini/ }));
    await user.click(screen.getByRole("button", { name: "Internet" }));
    await user.click(screen.getByRole("button", { name: "Low" }));
    await user.click(await screen.findByRole("button", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        codexInternetAccess: true,
        codexReasoningEffort: "high",
      }),
    );
  });

  it("passes the Codex config default as the explicit model when the user selects Default", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });

    render(<NewSessionModal open={true} onClose={onClose} />);

    await user.click(await screen.findByRole("button", { name: /Default \(gpt-5\.5\)/ }));
    await user.click((await screen.findAllByRole("button", { name: /Default \(gpt-5\.5\)/ })).at(-1)!);
    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(mockQueuePendingSession).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "codex",
          createOpts: expect.objectContaining({ model: "gpt-5.5" }),
        }),
      );
    });
  });

  // A session on a remote host names a folder on that host. The dialog starts
  // from the host's latest folder, browses and inspects the repo on the host
  // (offering the same worktree and branch options as locally), keeps recent
  // folders per machine, and keeps the path out of this machine's defaults.
  it("creates a worktree session in a remote host's repo", async () => {
    const user = userEvent.setup();
    mockRemoteHosts = [{ id: "h1", name: "devbox", online: true }];
    mockGetRecentDirs.mockImplementation((key?: string) => (key === "host:h1" ? ["/home/coder/app"] : []));
    mockApi.getRepoInfo.mockImplementation(async (path: string, hostId?: string) => {
      if (hostId !== "h1") throw new Error("not a repo");
      return { repoRoot: path, repoName: "app", currentBranch: "main", defaultBranch: "main", isWorktree: false };
    });
    mockApi.listBranches.mockResolvedValue([
      { name: "main", isCurrent: true, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
      { name: "feature", isCurrent: false, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
    ]);
    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.selectOptions(await screen.findByLabelText("Machine"), "h1");
    expect(await screen.findByText("app")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.listBranches).toHaveBeenCalledWith("/home/coder/app", { hostId: "h1" }));
    expect(mockApi.getRepoInfo).toHaveBeenCalledWith("/home/coder/app", "h1");

    // The folder browser lists the host's folders and its recent folders.
    await user.click(screen.getByText("app"));
    expect(folderPickerProps).toEqual(expect.objectContaining({ hostId: "h1", recentDirsKey: "host:h1" }));

    // Worktree and base branch work as they do for a local repo.
    expect(screen.getByText("Isolation")).toBeInTheDocument();
    await user.click(await screen.findByTestId("new-session-branch-button"));
    expect(mockApi.gitFetch).toHaveBeenCalledWith("/home/coder/app", "h1");
    await user.click(await screen.findByRole("button", { name: /feature/ }));
    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(
      expect.objectContaining({ hostId: "h1", cwd: "/home/coder/app", useWorktree: true, branch: "feature" }),
    );
    expect(mockQueuePendingSession.mock.calls[0][0].recentDirsKey).toBe("host:h1");
    expect(mockApi.saveNewSessionDefaults).not.toHaveBeenCalled();
  });

  it("sends branch and worktree options when creating a worktree-backed leader from a repo", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "leader",
      envSlug: "",
      cwd: "/tmp/project",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockApi.getRepoInfo.mockResolvedValue({
      repoRoot: "/tmp/project",
      repoName: "project",
      currentBranch: "main",
      defaultBranch: "main",
      isWorktree: false,
    });
    mockApi.listBranches.mockResolvedValue([
      { name: "main", isCurrent: true, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByText("project")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.listBranches).toHaveBeenCalledWith("/tmp/project", { hostId: undefined }));

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    const createOpts = mockQueuePendingSession.mock.calls[0][0].createOpts;
    expect(createOpts).toEqual(
      expect.objectContaining({ cwd: "/tmp/project", role: "orchestrator", branch: "main", useWorktree: true }),
    );
    expect(createOpts.createBranch).toBeUndefined();
    expect(JSON.parse(JSON.stringify(createOpts))).not.toHaveProperty("createBranch");
    expect(mockApi.gitPull).not.toHaveBeenCalled();
  });

  it("keeps the branch control mounted and disabled when a leader is not using a worktree", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "leader",
      envSlug: "",
      cwd: "/tmp/project",
      useWorktree: false,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockApi.getRepoInfo.mockResolvedValue({
      repoRoot: "/tmp/project",
      repoName: "project",
      currentBranch: "main",
      defaultBranch: "main",
      isWorktree: false,
    });
    mockApi.listBranches.mockResolvedValue([
      { name: "main", isCurrent: true, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByText("project")).toBeInTheDocument();
    const modal = screen.getByTestId("new-session-modal-card");
    const folderRow = within(modal).getByTestId("new-session-workspace-folder-row");
    const controlsRow = within(modal).getByTestId("new-session-workspace-controls-row");
    expect(within(folderRow).getByText("Folder")).toBeInTheDocument();
    expect(within(folderRow).queryByText("Isolation")).not.toBeInTheDocument();
    expect(within(controlsRow).getByText("Base branch")).toBeInTheDocument();
    expect(within(controlsRow).getByText("Session role")).toBeInTheDocument();
    expect(within(controlsRow).getByText("Isolation")).toBeInTheDocument();

    expect(within(modal).getByText("Base branch")).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Leader" })).toBeInTheDocument();

    const branchButton = within(modal).getByTestId("new-session-branch-button");
    expect(branchButton).toBeDisabled();
    expect(branchButton).toHaveTextContent("main");

    await user.click(within(modal).getByRole("button", { name: "Worktree" }));

    expect(within(modal).getByText("Base branch")).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Leader" })).toBeInTheDocument();
    expect(within(modal).getByTestId("new-session-branch-button")).toBeEnabled();
    expect(within(modal).getByTestId("new-session-branch-button")).toHaveTextContent("main");
  });

  it("sends the selected branch when creating a worktree session", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "/tmp/project",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockApi.getRepoInfo.mockResolvedValue({
      repoRoot: "/tmp/project",
      repoName: "project",
      currentBranch: "main",
      defaultBranch: "main",
      isWorktree: false,
    });
    mockApi.listBranches.mockResolvedValue([
      { name: "main", isCurrent: true, isRemote: false, worktreePath: null, ahead: 0, behind: 0 },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    expect(await screen.findByText("project")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.listBranches).toHaveBeenCalledWith("/tmp/project", { hostId: undefined }));

    await user.click(await screen.findByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(mockQueuePendingSession.mock.calls[0][0].createOpts).toEqual(
      expect.objectContaining({ cwd: "/tmp/project", branch: "main", useWorktree: true }),
    );
  });

  it("keeps a long shared model picker scrollable and can select a lower Codex model", async () => {
    const user = userEvent.setup();
    mockGetGlobalNewSessionDefaults.mockReturnValue({
      backend: "codex",
      model: "",
      mode: "agent",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockApi.getBackendModels.mockResolvedValue([
      { value: "arcanine", label: "arcanine" },
      { value: "flaaffy", label: "flaaffy" },
      { value: "flaaffy-dex", label: "flaaffy-dex" },
      { value: "gpt-5.5", label: "GPT-5.5" },
      { value: "oai-2.1", label: "oai-2.1" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ]);

    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /Default \(gpt-5\.5\)/ }));

    // Regression coverage for q-447: the shared Claude/Codex model menu must
    // scroll internally and avoid modal ancestors that clip absolute children,
    // so options lower than the modal bottom remain reachable.
    const dropdown = screen.getByTestId("new-session-model-dropdown");
    expect(dropdown).toHaveClass("max-h-60", "overflow-y-auto", "overscroll-contain");
    const modalCard = screen.getByTestId("new-session-modal-card");
    const clippingAncestors: Element[] = [];
    for (let node = dropdown.parentElement; node; node = node.parentElement) {
      if (node.classList.contains("overflow-hidden")) {
        clippingAncestors.push(node);
      }
      if (node === modalCard) break;
    }
    expect(clippingAncestors).toHaveLength(0);

    await user.click(await screen.findByRole("button", { name: /GPT-5\.4 Mini/ }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(mockQueuePendingSession).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "codex",
          createOpts: expect.objectContaining({ model: "gpt-5.4-mini" }),
        }),
      );
    });
  });

  // Regression for a session created in a laptop folder on the DevBox: group
  // defaults and recent folders recorded while another machine was the server
  // name folders that are not on the selected machine. The dialog replaces such
  // a remembered folder with one that exists there and shows where it is.
  it("replaces a remembered folder that is not on the selected machine", async () => {
    const user = userEvent.setup();
    mockLocalMachine = { id: "local", name: "devbox" };
    mockRemoteHosts = [{ id: "laptop-host", name: "laptop", online: true }];
    mockGetGroupNewSessionDefaults.mockReturnValue({
      backend: "claude",
      model: "",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "leader",
      envSlug: "",
      cwd: "/Users/me/Code/yolo",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
    });
    mockGetRecentDirs.mockReturnValue(["/Users/me/Code/yolo", "/home/coder/takode"]);
    mockApi.checkFolders.mockImplementation(async (paths: string[]) =>
      paths.map((path) => path.startsWith("/home/coder/")),
    );

    render(
      <NewSessionModal
        open={true}
        onClose={() => {}}
        treeGroupId="team-alpha"
        newSessionDefaultsKey="tree-group:team-alpha"
      />,
    );

    expect(await screen.findByText("takode")).toBeInTheDocument();
    expect(screen.getByTestId("new-session-folder-path")).toHaveTextContent("devbox · /home/coder/takode");
    expect(screen.queryByText("yolo")).not.toBeInTheDocument();
    expect(mockApi.checkFolders).toHaveBeenCalledWith(["/Users/me/Code/yolo"], undefined);

    await waitFor(() => expect(screen.getByRole("button", { name: "Create Session" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Create Session" }));
    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(expect.objectContaining({ cwd: "/home/coder/takode" }));
    expect(latestQueuedCreateOpts()).not.toHaveProperty("hostId");
  });

  // A folder the user picks that is not on the selected machine is caught in
  // the dialog, before any session is created.
  it("blocks creating a session in a chosen folder that does not exist on the machine", async () => {
    const user = userEvent.setup();
    mockLocalMachine = { id: "local", name: "devbox" };
    mockApi.checkFolders.mockImplementation(async (paths: string[]) => paths.map((path) => path === "/tmp/project"));
    render(<NewSessionModal open={true} onClose={() => {}} />);

    await user.click(await screen.findByText("project"));
    await act(async () => folderPickerProps!.onSelect("/Users/me/Code/yolo"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This folder does not exist on devbox. Choose a folder on devbox.",
    );
    expect(screen.getByText("yolo")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create Session" });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(mockQueuePendingSession).not.toHaveBeenCalled();
  });

  // Switching machines never carries a folder over: the new machine starts from
  // its own recent folders, and one that is gone there is not offered. With no
  // folder on the host the session cannot be created until one is chosen there.
  it("starts a newly selected machine from its own folders", async () => {
    const user = userEvent.setup();
    mockRemoteHosts = [{ id: "h1", name: "laptop", online: true }];
    mockGetRecentDirs.mockImplementation((key?: string) => (key === "host:h1" ? ["/Users/me/gone"] : ["/tmp/project"]));
    mockApi.checkFolders.mockImplementation(async (paths: string[], hostId?: string) =>
      paths.map((path) => (hostId === "h1" ? path === "/Users/me/app" : path === "/tmp/project")),
    );
    render(<NewSessionModal open={true} onClose={() => {}} />);
    expect(await screen.findByText("project")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Machine"), "h1");
    expect(await screen.findByText("Select folder")).toBeInTheDocument();
    expect(screen.getByText("Choose a folder on laptop.")).toBeInTheDocument();
    expect(screen.queryByText("project")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Session" })).toBeDisabled();

    await user.click(screen.getByText("Select folder"));
    expect(folderPickerProps).toEqual(expect.objectContaining({ hostId: "h1", recentDirsKey: "host:h1" }));
    await act(async () => folderPickerProps!.onSelect("/Users/me/app"));
    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(screen.getByTestId("new-session-folder-path")).toHaveTextContent("laptop · /Users/me/app");

    await waitFor(() => expect(screen.getByRole("button", { name: "Create Session" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Create Session" }));
    await waitFor(() => expect(mockQueuePendingSession).toHaveBeenCalled());
    expect(latestQueuedCreateOpts()).toEqual(expect.objectContaining({ hostId: "h1", cwd: "/Users/me/app" }));
  });

  // Opened from a session on a remote host (the new-session shortcut), the
  // dialog starts on that host with the session's folder.
  it("opens on the machine of the folder it was given", async () => {
    mockRemoteHosts = [{ id: "h1", name: "laptop", online: true }];
    render(<NewSessionModal open={true} onClose={() => {}} groupCwd="/Users/me/app" groupHostId="h1" />);

    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(screen.getByLabelText("Machine")).toHaveValue("h1");
    await waitFor(() => expect(mockApi.checkFolders).toHaveBeenCalledWith(["/Users/me/app"], "h1"));
    expect(mockApi.getRepoInfo).toHaveBeenCalledWith("/Users/me/app", "h1");
  });
});
