// @vitest-environment jsdom
import type { CSSProperties } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionState } from "../types.js";
import { useStore } from "../store.js";
import type { CodexTerminalEntry } from "./MessageFeedLiveActivity.js";
import { MessageFeedTopControls, ONE_ROW_TOP_ROOM_PX } from "./MessageFeedTopControls.js";

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

  it("never shows the session's Next chip, which sits at the feed's lower right on every screen", () => {
    // Desktop used to show it here (and a leader's chat after its tabs); Jiayi moved it to the
    // feed's lower right on desktop too, as on phones (FeedStatusPill).
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
    expect(screen.queryByTestId("session-attention-chip")).toBeNull();
    expect(screen.getByTestId("codex-subagent-feed-control-row")).toBeInTheDocument();
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

  it("floats a quest thread's chips at the top right and asks the feed for room above its content", () => {
    // Jiayi (Nov 1): the chips at the top left covered the conversation's first line. They now sit
    // at the right, where they cover less, and the feed leaves their height (plus a gap) above its
    // earliest content, so scrolled to the top nothing is under them.
    installSession(false);
    // A chip row taller than one row (two lines of chips), so the measured height wins.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(4);
    const onTopRoomChange = vi.fn();
    const props = {
      sessionId: "session-1",
      terminals: [],
      subagents: [],
      selectedToolUseId: null,
      onSelect: vi.fn(),
      onSelectSubagent: vi.fn(),
      onDismissSubagent: vi.fn(),
      onTopRoomChange,
    };
    const view = render(<MessageFeedTopControls {...props} questChips={<span data-testid="chips">Work</span>} />);
    expect(screen.getByTestId("chips").parentElement).toHaveClass("ml-auto", "justify-end");
    expect(onTopRoomChange).toHaveBeenLastCalledWith(4 + 60 + 8);
    // Without chips the feed still keeps one row of room (Jiayi, Nov 14: one extra line of
    // overscroll), so chips appearing during a turn never move a short conversation down.
    view.rerender(<MessageFeedTopControls {...props} />);
    expect(onTopRoomChange).toHaveBeenLastCalledWith(ONE_ROW_TOP_ROOM_PX);
    vi.restoreAllMocks();
  });

  it("keeps one row of room under chips no taller than a row, such as the live terminal chips", () => {
    // Only a quest thread's chips used to get room: the Codex subagent control and the live chips
    // of a running turn covered the feed's first line at its top.
    installSession(false);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(4);
    const onTopRoomChange = vi.fn();
    render(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[terminal]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
        onTopRoomChange={onTopRoomChange}
      />,
    );
    expect(onTopRoomChange).toHaveBeenLastCalledWith(ONE_ROW_TOP_ROOM_PX);
    vi.restoreAllMocks();
  });

  it("asks for no room below a pinned strip, where the controls start under the strip", () => {
    installSession(false);
    const onTopRoomChange = vi.fn();
    render(
      <MessageFeedTopControls
        sessionId="session-1"
        terminals={[]}
        subagents={[]}
        selectedToolUseId={null}
        onSelect={vi.fn()}
        onSelectSubagent={vi.fn()}
        onDismissSubagent={vi.fn()}
        onTopRoomChange={onTopRoomChange}
        questChips={<span>Work</span>}
        belowPinnedStrip
      />,
    );
    expect(onTopRoomChange).toHaveBeenLastCalledWith(0);
  });

  it("leaves a pinned report bar out of the room it asks for", () => {
    // While a report's collapse bar is pinned the controls move below it (`--feed-pinned-bar`).
    // That is room while reading the report, not at the feed's top: counting it would change the
    // feed's top padding, and with it where the bar pins (Jiayi, Nov 1: a gap above the bar).
    installSession(false);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(4 + 26);
    // The bar's height reaches the overlay as an inherited custom property, which jsdom doesn't
    // compute: the browser's value is stubbed.
    const computed = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      return { ...style, getPropertyValue: (name: string) => (name === "--feed-pinned-bar" ? "26px" : "") } as never;
    });
    const onTopRoomChange = vi.fn();
    render(
      <div style={{ "--feed-pinned-bar": "26px" } as CSSProperties}>
        <MessageFeedTopControls
          sessionId="session-1"
          terminals={[]}
          subagents={[]}
          selectedToolUseId={null}
          onSelect={vi.fn()}
          onSelectSubagent={vi.fn()}
          onDismissSubagent={vi.fn()}
          onTopRoomChange={onTopRoomChange}
          questChips={<span>Work</span>}
        />
      </div>,
    );
    expect(onTopRoomChange).toHaveBeenLastCalledWith(Math.max(ONE_ROW_TOP_ROOM_PX, 4 + 30 + 8));
    vi.restoreAllMocks();
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
        "top-[calc(var(--feed-pinned-bar,0px)+0.25rem)]",
      );
      rerender(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} belowPinnedStrip />);
      const overlay = screen.getByTestId("message-feed-top-overlay");
      expect(overlay.className).toContain("top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+1.5rem)]");
    });

    it("shows the pill alone at the top when there are no controls", () => {
      installSession(false);
      render(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} />);
      expect(screen.queryByTestId("message-feed-top-controls")).toBeNull();
      expect(screen.getByTestId("day-pill").parentElement).not.toHaveClass("absolute");
    });

    it("sits level with the desktop Codex subagent control, on the row instead of its own line", () => {
      // A wide desktop feed has room for the centered pill beside the right-hand control.
      setViewportWidth(1280);
      installSession(true);
      render(<MessageFeedTopControls {...baseProps} terminals={[]} dayPill={pill} />);
      expect(screen.getByTestId("day-pill").parentElement).toHaveClass("absolute", "inset-0", "items-center");
    });
  });
});
