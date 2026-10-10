// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  terminalCwd: string | null;
  terminalSessionId: string | null;
  terminalHostId: string | null;
  currentSessionId: string | null;
  sessions?: Map<string, { cwd?: string }>;
  sdkSessions?: Array<{ sessionId: string; cwd?: string; hostId?: string }>;
  openTerminal: ReturnType<typeof vi.fn>;
}

let mockState: MockStoreState;

function createMockState(overrides: Partial<MockStoreState> = {}): MockStoreState {
  return {
    terminalCwd: null,
    terminalSessionId: null,
    terminalHostId: null,
    currentSessionId: null,
    sessions: new Map(),
    sdkSessions: [],
    openTerminal: vi.fn(),
    ...overrides,
  };
}

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return { useStore: useStoreFn };
});

vi.mock("./TerminalView.js", () => ({
  TerminalView: ({ cwd, hostId }: { cwd: string; hostId?: string | null }) => (
    <div data-testid="terminal-view" data-host-id={hostId ?? ""}>
      {cwd}
    </div>
  ),
}));

vi.mock("./FolderPicker.js", () => ({
  FolderPicker: ({
    initialPath,
    hostId,
    onSelect,
    onClose,
  }: {
    initialPath: string;
    hostId?: string;
    onSelect: (path: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="folder-picker" data-host-id={hostId ?? ""} data-initial-path={initialPath}>
      <button
        onClick={() => {
          onSelect("/tmp/terminal-project");
          onClose();
        }}
      >
        Pick folder
      </button>
      <button onClick={onClose}>Cancel picker</button>
    </div>
  ),
}));

let mockHosts: Array<{ id: string; name: string; online: boolean }> = [];
vi.mock("../remote-hosts.js", () => ({
  useRemoteHosts: () => ({ hosts: mockHosts, loaded: true, local: { id: "local", name: "server-box" } }),
}));

vi.mock("../utils/recent-dirs.js", () => ({
  hostRecentDirsKey: (hostId: string) => `host:${hostId}`,
  getRecentDirs: (key?: string) => (key === "host:host-2" ? ["/srv/recent-on-host-2"] : []),
}));

import { TerminalPage } from "./TerminalPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = createMockState();
  mockHosts = [];
  window.location.hash = "#/terminal";
});

describe("TerminalPage", () => {
  it("shows empty state when no terminal folder is selected", () => {
    render(<TerminalPage />);
    expect(screen.getByText(/Choose a folder to start a terminal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeInTheDocument();
  });

  // The page's only chrome is the location row: no repeated title or
  // description, and no machine picker when there is only one machine.
  it("renders the terminal under a compact folder row", () => {
    mockState = createMockState({ terminalCwd: "/tmp/existing" });
    render(<TerminalPage />);
    expect(screen.getByTestId("terminal-view")).toHaveTextContent("/tmp/existing");
    expect(screen.getByTestId("terminal-folder")).toHaveTextContent("/tmp/existing");
    expect(screen.getByRole("button", { name: "Change folder" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Machine" })).not.toBeInTheDocument();
  });

  it("falls back to the active session cwd when terminal cwd is unset", () => {
    mockState = createMockState({
      currentSessionId: "s1",
      sessions: new Map([["s1", { cwd: "/tmp/worktree-session" }]]),
    });
    render(<TerminalPage />);
    expect(screen.getByTestId("terminal-view")).toHaveTextContent("/tmp/worktree-session");
  });

  it("opens picker and starts terminal with selected folder", () => {
    render(<TerminalPage />);

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    fireEvent.click(screen.getByText("Pick folder"));

    expect(mockState.openTerminal).toHaveBeenCalledWith("/tmp/terminal-project", null, null);
    expect(window.location.hash).toBe("#/terminal");
  });

  // A remote session's terminal runs on its host: the row names that host, the
  // folder picker browses it, and an offline host is called out.
  it("follows a remote session's host and browses folders there", () => {
    mockHosts = [{ id: "host-1", name: "build-box", online: false }];
    mockState = createMockState({
      currentSessionId: "s1",
      sdkSessions: [{ sessionId: "s1", cwd: "/srv/project", hostId: "host-1" }],
    });
    render(<TerminalPage />);

    expect(screen.getByRole("combobox", { name: "Machine" })).toHaveValue("host-1");
    expect(screen.getByTestId("terminal-view")).toHaveAttribute("data-host-id", "host-1");
    expect(screen.getByTestId("terminal-host-offline")).toHaveTextContent("build-box is offline");

    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    const picker = screen.getByTestId("folder-picker");
    expect(picker).toHaveAttribute("data-host-id", "host-1");
    expect(picker).toHaveAttribute("data-initial-path", "/srv/project");
    fireEvent.click(screen.getByText("Pick folder"));

    expect(mockState.openTerminal).toHaveBeenCalledWith("/tmp/terminal-project", "s1", "host-1");
  });

  // Switching machine asks for a folder on that machine, starting from its most
  // recent folder; the terminal only moves once a folder is chosen.
  it("switches machine through that machine's folder picker", () => {
    mockHosts = [
      { id: "host-1", name: "build-box", online: true },
      { id: "host-2", name: "gpu-box", online: true },
    ];
    mockState = createMockState({ terminalCwd: "/home/me/project", terminalHostId: null });
    render(<TerminalPage />);

    const select = screen.getByRole("combobox", { name: "Machine" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "server-box" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "host-2" } });
    const picker = screen.getByTestId("folder-picker");
    expect(picker).toHaveAttribute("data-host-id", "host-2");
    expect(picker).toHaveAttribute("data-initial-path", "/srv/recent-on-host-2");
    expect(select).toHaveValue("host-2");
    expect(mockState.openTerminal).not.toHaveBeenCalled();

    // Cancelling keeps the terminal where it was.
    fireEvent.click(screen.getByText("Cancel picker"));
    expect(select).toHaveValue("");
    expect(mockState.openTerminal).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "host-2" } });
    fireEvent.click(screen.getByText("Pick folder"));
    expect(mockState.openTerminal).toHaveBeenCalledWith("/tmp/terminal-project", null, "host-2");
  });
});
