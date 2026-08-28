// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionState } from "../types.js";
import { useStore } from "../store.js";
import type { CodexTerminalEntry } from "./MessageFeedLiveActivity.js";
import { MessageFeedTopControls } from "./MessageFeedTopControls.js";

const terminal: CodexTerminalEntry = {
  toolUseId: "terminal-1",
  input: { command: "bun test" },
  timestamp: 10,
  preview: "bun test",
  result: null,
  progress: { elapsedSeconds: 2 },
};

function installSession(withChild: boolean) {
  useStore.setState({
    sessions: new Map([
      [
        "session-1",
        {
          session_id: "session-1",
          backend_type: "codex",
          ...(withChild
            ? {
                codex_native_subagents: {
                  revision: 1,
                  coverage: "partial",
                  session: {
                    total: 1,
                    statusCounts: {
                      starting: 0,
                      working: 1,
                      waiting: 0,
                      done: 0,
                      failed: 0,
                      interrupted: 0,
                      unknown: 0,
                    },
                    activeCount: 1,
                    unresolvedCount: 0,
                  },
                  turns: {},
                  children: [
                    {
                      childId: "child-1",
                      rootTurnId: "turn-1",
                      agentPath: "/root/probe",
                      displayName: "probe",
                      depth: 1,
                      spawnOrder: 1,
                      status: "working",
                      statusObservedAt: 10,
                      transcriptAvailability: "available",
                    },
                  ],
                },
              }
            : {}),
        } as SessionState,
      ],
    ]),
    codexSubagentInspector: null,
  });
}

describe("MessageFeedTopControls", () => {
  afterEach(() => {
    useStore.setState({ sessions: new Map(), codexSubagentInspector: null });
  });

  it("shares one collision-free absolute rail between live activity and the session chip", () => {
    installSession(true);
    const onSelect = vi.fn();

    render(
      <div className="relative h-64 w-[430px]">
        <MessageFeedTopControls
          sessionId="session-1"
          terminals={[terminal]}
          subagents={[]}
          selectedToolUseId={null}
          onSelect={onSelect}
          onSelectSubagent={vi.fn()}
          onDismissSubagent={vi.fn()}
        />
      </div>,
    );

    const controls = screen.getByTestId("message-feed-top-controls");
    const liveRail = within(controls).getByTestId("live-activity-rail");
    const childAnchor = within(controls).getByTestId("codex-subagent-feed-control-row");
    expect(controls).toHaveClass("absolute", "inset-x-2", "flex", "gap-2", "pointer-events-none");
    expect(liveRail).toHaveClass("pointer-events-auto", "min-w-0", "flex-1");
    expect(liveRail).not.toHaveClass("absolute");
    expect(childAnchor).toHaveClass("pointer-events-auto", "ml-auto", "shrink-0");

    fireEvent.click(within(controls).getByTestId("codex-live-terminal-chip"));
    expect(onSelect).toHaveBeenCalledWith("terminal-1");
    fireEvent.click(within(controls).getByTestId("feed-codex-subagents"));
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "session-1" });
  });

  it("renders only the live rail when no genuine child data exists", () => {
    installSession(false);
    render(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[terminal]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
      />,
    );

    expect(screen.getByTestId("live-activity-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
  });

  it("suppresses the session chip for search preview while preserving live activity", () => {
    installSession(true);
    const view = render(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
        showCodexSubagents={false}
      />,
    );
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[terminal]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
        showCodexSubagents={false}
      />,
    );
    expect(screen.getByTestId("live-activity-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
  });

  it("renders no overlay when neither live activity nor genuine child data exists", () => {
    installSession(false);
    const view = render(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
      />,
    );

    expect(view.container).toBeEmptyDOMElement();
  });
});
