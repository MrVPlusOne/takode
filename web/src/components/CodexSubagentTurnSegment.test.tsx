// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatusCounts,
} from "../../shared/codex-native-subagent-types.js";
import type { SessionState } from "../types.js";
import { useStore } from "../store.js";
import { CodexSubagentTurnSegment } from "./CodexSubagentTurnSegment.js";

const ZERO_COUNTS: CodexNativeSubagentStatusCounts = {
  starting: 0,
  working: 0,
  waiting: 0,
  done: 0,
  failed: 0,
  interrupted: 0,
  unknown: 0,
};

function setNativeSnapshot(snapshot: CodexNativeSubagentSnapshot) {
  useStore.setState({
    sessions: new Map([
      [
        "session-1",
        {
          session_id: "session-1",
          backend_type: "codex",
          // The legacy/generic count must never drive the native segment.
          subagentCount: 99,
          codex_native_subagents: snapshot,
        } as unknown as SessionState,
      ],
    ]),
    codexSubagentInspector: null,
  });
}

describe("CodexSubagentTurnSegment", () => {
  beforeEach(() => {
    useStore.setState({ sessions: new Map(), codexSubagentInspector: null });
  });

  it("opens a turn-scoped inspector from the native aggregate without conflating the generic count", () => {
    setNativeSnapshot({
      revision: 4,
      coverage: "complete",
      session: { total: 5, statusCounts: { ...ZERO_COUNTS, working: 1, done: 4 }, activeCount: 1, unresolvedCount: 0 },
      children: [],
      turns: {
        "turn-work": {
          rootTurnId: "turn-work",
          total: 3,
          statusCounts: { ...ZERO_COUNTS, working: 1, done: 2 },
          status: "working",
          coverage: "complete",
        },
      },
    });

    render(<CodexSubagentTurnSegment sessionId="session-1" turnId="turn-work" />);

    const button = screen.getByRole("button", { name: /3 Codex subagents.*Working.*Coverage complete/i });
    expect(button).toHaveTextContent("3 Codex subagents");
    expect(button).not.toHaveTextContent("99");
    fireEvent.click(button);
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "session-1", scopeTurnId: "turn-work" });
  });

  it("marks a partial lower-bound count and never presents it as authoritative", () => {
    setNativeSnapshot({
      revision: 5,
      coverage: "partial",
      session: { total: 2, statusCounts: { ...ZERO_COUNTS, unknown: 2 }, activeCount: 0, unresolvedCount: 2 },
      children: [],
      turns: {
        "turn-partial": {
          rootTurnId: "turn-partial",
          total: 2,
          statusCounts: { ...ZERO_COUNTS, unknown: 2 },
          status: "unknown",
          coverage: "partial",
        },
        "turn-no-verified-count": {
          rootTurnId: "turn-no-verified-count",
          total: 0,
          statusCounts: ZERO_COUNTS,
          status: "unknown",
          coverage: "partial",
        },
      },
    });

    const view = render(<CodexSubagentTurnSegment sessionId="session-1" turnId="turn-partial" />);
    expect(screen.getByText("2+ Codex subagents")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();

    view.rerender(<CodexSubagentTurnSegment sessionId="session-1" turnId="turn-no-verified-count" />);
    expect(screen.getByText("Codex subagents")).toBeInTheDocument();
    expect(screen.queryByText(/^0/)).toBeNull();
  });

  it("does not render for a missing or authoritatively empty turn", () => {
    setNativeSnapshot({
      revision: 1,
      coverage: "complete",
      session: { total: 0, statusCounts: ZERO_COUNTS, activeCount: 0, unresolvedCount: 0 },
      children: [],
      turns: {
        empty: {
          rootTurnId: "empty",
          total: 0,
          statusCounts: ZERO_COUNTS,
          status: "done",
          coverage: "complete",
        },
      },
    });

    const empty = render(<CodexSubagentTurnSegment sessionId="session-1" turnId="empty" />);
    expect(empty.container).toBeEmptyDOMElement();
    empty.rerender(<CodexSubagentTurnSegment sessionId="session-1" turnId="missing" />);
    expect(empty.container).toBeEmptyDOMElement();
  });
});
