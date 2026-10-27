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

const originalInnerWidth = window.innerWidth;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function installNeedsInput() {
  useStore.setState({
    sessionNotifications: new Map([
      [
        "session-1",
        [{ id: "n-1", category: "needs-input", summary: "Pick one", timestamp: 1, messageId: "m-1", done: false }],
      ],
    ]),
  });
}

describe("MessageFeedTopControls", () => {
  beforeEach(() => {
    // Phone width by default: the attention chip joins this row only on desktop.
    setViewportWidth(430);
  });

  afterEach(() => {
    setViewportWidth(originalInnerWidth);
    useStore.setState({ sessions: new Map(), codexSubagentInspector: null, sessionNotifications: new Map() });
  });

  it("puts the session attention chip at the right end of the row on desktop only", () => {
    // Desktop moves the chip to the feed's top right to cut mouse travel to
    // the top bar's attention controls; phones keep it at the bottom right
    // (FeedStatusPill) within thumb reach, so this row leaves it out there.
    installSession(true);
    installNeedsInput();
    const props = {
      sessionId: "session-1",
      terminals: [terminal],
      subagents: [],
      selectedToolUseId: null,
      onSelect: vi.fn(),
      onSelectSubagent: vi.fn(),
      onDismissSubagent: vi.fn(),
    };
    const view = render(<MessageFeedTopControls {...props} />);
    expect(screen.queryByTestId("session-attention-chip")).toBeNull();

    setViewportWidth(1280);
    view.rerender(<MessageFeedTopControls {...props} />);
    const controls = screen.getByTestId("message-feed-top-controls");
    const chip = within(controls).getByTestId("session-attention-chip");
    const rightGroup = chip.parentElement!;
    expect(rightGroup).toHaveClass("ml-auto", "shrink-0");
    // The Codex child control and the chip share the right group, chip last.
    expect(rightGroup.lastElementChild).toBe(chip);
    expect(within(rightGroup).getByTestId("codex-subagent-feed-control-row")).toBeInTheDocument();
    expect(chip).toHaveTextContent("1/1·Next");
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
    expect(controls).toHaveClass("flex", "gap-2");
    expect(controls.parentElement).toHaveClass("absolute", "inset-x-2", "pointer-events-none");
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

  describe("day pill placement", () => {
    const pill = <span data-testid="day-pill">Sun, Oct 25 · 2 days ago</span>;
    const baseProps = {
      sessionId: "session-1",
      subagents: [],
      selectedToolUseId: null,
      onSelect: vi.fn(),
      onSelectSubagent: vi.fn(),
      onDismissSubagent: vi.fn(),
    };

    it("puts the pill on its own line under a live rail, which can span the whole row", () => {
      // On phones the terminal/subagent rail is full width, so sharing its line would overlap it.
      installSession(false);
      render(<MessageFeedTopControls {...baseProps} terminals={[terminal]} dayPill={pill} />);
      const row = screen.getByTestId("message-feed-top-controls");
      const pillSlot = screen.getByTestId("day-pill").parentElement!;
      expect(pillSlot).not.toHaveClass("absolute");
      expect(row.nextElementSibling).toBe(pillSlot);
    });

    it("starts below a topic conversation's pinned quest strip", () => {
      // The strip covered the Next chip; the controls start below it (its height is the overlay's
      // --feed-pinned-top). Elsewhere they keep their usual offset, below a pinned report bar only.
      installSession(false);
      const { rerender } = render(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} />);
      expect(screen.getByTestId("message-feed-top-overlay").className).toContain(
        "top-[calc(var(--feed-pinned-bar,0px)+0.5rem)]",
      );
      rerender(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} belowPinnedStrip />);
      const overlay = screen.getByTestId("message-feed-top-overlay");
      expect(overlay.className).toContain("top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+1rem)]");
    });

    it("shows the pill alone at the top when there are no controls", () => {
      installSession(false);
      render(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} />);
      expect(screen.queryByTestId("message-feed-top-controls")).toBeNull();
      expect(screen.getByTestId("day-pill").parentElement).not.toHaveClass("absolute");
    });

    it("sits level with the desktop attention chip, on the row instead of its own line", () => {
      // A wide desktop feed has room for the centered pill beside the right-hand chip.
      setViewportWidth(1280);
      installSession(false);
      installNeedsInput();
      render(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} />);
      expect(screen.getByTestId("day-pill").parentElement).toHaveClass("absolute", "inset-0", "items-center");
    });
  });
});
