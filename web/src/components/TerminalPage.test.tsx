// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

interface MockStoreState {
  terminalCwd: string | null;
  terminalSessionId: string | null;
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
  TerminalView: ({ cwd }: { cwd: string }) => <div data-testid="terminal-view">{cwd}</div>,
}));

vi.mock("./FolderPicker.js", () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <div data-testid="folder-picker">
      <button onClick={() => onSelect("/tmp/terminal-project")}>Pick folder</button>
    </div>
  ),
}));

let mockHosts: Array<{ id: string; name: string; online: boolean }> = [];
vi.mock("../remote-hosts.js", () => ({
  useRemoteHosts: () => ({ hosts: mockHosts, loaded: true }),
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
    expect(screen.getByText("No terminal started yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Folder" })).toBeInTheDocument();
  });

  it("renders terminal view when a folder is selected", () => {
    mockState = createMockState({ terminalCwd: "/tmp/existing" });
    render(<TerminalPage />);
    expect(screen.getByTestId("terminal-view")).toHaveTextContent("/tmp/existing");
    expect(screen.getByRole("button", { name: "Change Folder" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Choose Folder" }));
    fireEvent.click(screen.getByText("Pick folder"));

    expect(mockState.openTerminal).toHaveBeenCalledWith("/tmp/terminal-project", null);
    expect(window.location.hash).toBe("#/terminal");
  });

  // A remote session's terminal runs on its host, which this machine's folder
  // picker cannot browse, so the page names the host and asks for a path there.
  it("names the host of a remote session and takes a host path instead of the local picker", () => {
    mockHosts = [{ id: "host-1", name: "build-box", online: false }];
    mockState = createMockState({
      currentSessionId: "s1",
      sdkSessions: [{ sessionId: "s1", cwd: "/srv/project", hostId: "host-1" }],
    });
    render(<TerminalPage />);

    expect(screen.getByTestId("terminal-host")).toHaveTextContent("Runs on build-box, which is offline");
    fireEvent.click(screen.getByRole("button", { name: "Change Folder" }));
    expect(screen.queryByTestId("folder-picker")).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Folder on build-box" });
    expect(input).toHaveValue("/srv/project");
    fireEvent.change(input, { target: { value: "/srv/other" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(mockState.openTerminal).toHaveBeenCalledWith("/srv/other", "s1");
  });
});
