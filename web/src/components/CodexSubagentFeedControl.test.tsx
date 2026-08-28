// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionState } from "../types.js";
import { useStore } from "../store.js";
import { CodexSubagentFeedControl } from "./CodexSubagentFeedControl.js";

function installSession(session: Partial<SessionState>) {
  useStore.setState({
    sessions: new Map([
      [
        "session-1",
        {
          session_id: "session-1",
          backend_type: "codex",
          ...session,
        } as SessionState,
      ],
    ]),
    codexSubagentInspector: null,
  });
}

describe("CodexSubagentFeedControl", () => {
  afterEach(() => {
    useStore.setState({ sessions: new Map(), codexSubagentInspector: null });
  });

  it("keeps authoritative count and active status in an unobtrusive feed-local row", () => {
    installSession({
      codex_native_subagents: {
        revision: 3,
        coverage: "partial",
        session: {
          total: 5,
          statusCounts: { starting: 0, working: 2, waiting: 0, done: 2, failed: 1, interrupted: 0, unknown: 0 },
          activeCount: 2,
          unresolvedCount: 1,
        },
        turns: {},
        children: [],
      },
    });

    render(<CodexSubagentFeedControl sessionId="session-1" />);

    const row = screen.getByTestId("codex-subagent-feed-control-row");
    const button = screen.getByTestId("feed-codex-subagents");
    expect(row).toHaveClass("shrink-0", "justify-end");
    expect(row).not.toHaveClass("absolute", "fixed");
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveAccessibleName(/Codex subagents: 5\+\. 2 active\. partial coverage\. Open inspector/i);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "session-1" });
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(useStore.getState().codexSubagentInspector).toBeNull();
  });

  it("stays discoverable when the server has not supplied a snapshot", () => {
    installSession({});
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.getByTestId("feed-codex-subagents")).toHaveAccessibleName(
      /Codex subagents: \?\. Unavailable\. Snapshot unavailable/i,
    );
  });

  it("shows an authoritative zero only for complete coverage", () => {
    installSession({
      codex_native_subagents: {
        revision: 1,
        coverage: "complete",
        session: {
          total: 0,
          statusCounts: { starting: 0, working: 0, waiting: 0, done: 0, failed: 0, interrupted: 0, unknown: 0 },
          activeCount: 0,
          unresolvedCount: 0,
        },
        turns: {},
        children: [],
      },
    });
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.getByTestId("feed-codex-subagents")).toHaveAccessibleName(
      /Codex subagents: 0\. None\. complete coverage/i,
    );
  });

  it("does not call partial zero an authoritative none", () => {
    installSession({
      codex_native_subagents: {
        revision: 4,
        coverage: "partial",
        session: {
          total: 0,
          statusCounts: {
            starting: 0,
            working: 0,
            waiting: 0,
            done: 0,
            failed: 0,
            interrupted: 0,
            unknown: 0,
          },
          activeCount: 0,
          unresolvedCount: 0,
        },
        turns: {},
        children: [],
      },
    });

    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.getByTestId("feed-codex-subagents")).toHaveAccessibleName(
      /Codex subagents: \?\. Unknown\. partial coverage/i,
    );
  });

  it("does not render for a non-Codex session", () => {
    installSession({ backend_type: "claude" });
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
  });
});
