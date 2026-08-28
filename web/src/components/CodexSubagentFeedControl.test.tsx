// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { CodexNativeSubagentSnapshot } from "../../shared/codex-native-subagent-types.js";
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

function snapshot(
  values: {
    coverage?: CodexNativeSubagentSnapshot["coverage"];
    child?: CodexNativeSubagentSnapshot["children"][number];
  } = {},
): CodexNativeSubagentSnapshot {
  const child =
    values.child ??
    ({
      childId: "child-1",
      rootTurnId: "turn-1",
      agentPath: "/root/schema_probe",
      displayName: "schema_probe",
      depth: 1,
      spawnOrder: 1,
      status: "working",
      statusObservedAt: 10,
      transcriptAvailability: "available",
    } satisfies CodexNativeSubagentSnapshot["children"][number]);
  const coverage = values.coverage ?? "partial";
  const statusCounts = {
    starting: child.status === "starting" ? 1 : 0,
    working: child.status === "working" ? 1 : 0,
    waiting: child.status === "waiting" ? 1 : 0,
    done: child.status === "done" ? 1 : 0,
    failed: child.status === "failed" ? 1 : 0,
    interrupted: child.status === "interrupted" ? 1 : 0,
    unknown: child.status === "unknown" ? 1 : 0,
  };
  return {
    revision: 3,
    coverage,
    session: {
      total: 1,
      statusCounts,
      activeCount: statusCounts.starting + statusCounts.working + statusCounts.waiting,
      unresolvedCount: statusCounts.failed + statusCounts.interrupted + statusCounts.unknown,
    },
    turns: {
      [child.rootTurnId]: {
        rootTurnId: child.rootTurnId,
        total: 1,
        statusCounts,
        status: child.status,
        coverage,
      },
    },
    children: [child],
  };
}

function emptySnapshot(coverage: CodexNativeSubagentSnapshot["coverage"]): CodexNativeSubagentSnapshot {
  return {
    revision: 1,
    coverage,
    session: {
      total: 0,
      statusCounts: { starting: 0, working: 0, waiting: 0, done: 0, failed: 0, interrupted: 0, unknown: 0 },
      activeCount: 0,
      unresolvedCount: 0,
    },
    turns: {},
    children: [],
  };
}

describe("CodexSubagentFeedControl", () => {
  afterEach(() => {
    useStore.setState({ sessions: new Map(), codexSubagentInspector: null });
  });

  it("shows genuine child data in an intrinsic top-rail control", () => {
    installSession({ codex_native_subagents: snapshot() });

    render(<CodexSubagentFeedControl sessionId="session-1" />);

    const anchor = screen.getByTestId("codex-subagent-feed-control-row");
    const button = screen.getByTestId("feed-codex-subagents");
    expect(anchor).toHaveClass("pointer-events-auto", "ml-auto", "shrink-0");
    expect(anchor).not.toHaveClass("absolute", "flex-1", "w-full");
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveAccessibleName(/Codex subagents: 1\+\. 1 active\. partial coverage\. Open inspector/i);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "session-1" });
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(useStore.getState().codexSubagentInspector).toBeNull();
  });

  it("keeps a genuine unknown child discoverable under partial coverage", () => {
    installSession({
      codex_native_subagents: snapshot({
        child: {
          ...snapshot().children[0],
          status: "unknown",
          transcriptAvailability: "partial",
        },
      }),
    });

    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.getByTestId("feed-codex-subagents")).toHaveAccessibleName(
      /Codex subagents: 1\+\. 1 unresolved\. partial coverage/i,
    );
  });

  it("does not render missing child data for a Codex leader session", () => {
    installSession({ isOrchestrator: true });
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
  });

  it.each([
    ["complete zero", emptySnapshot("complete")],
    ["partial zero", emptySnapshot("partial")],
    [
      "positive aggregate without a public child",
      {
        ...emptySnapshot("partial"),
        session: { ...emptySnapshot("partial").session, total: 1, unresolvedCount: 1 },
      },
    ],
  ])("does not render for %s", (_label, nativeSnapshot) => {
    installSession({ codex_native_subagents: nativeSnapshot });
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
    expect(screen.queryByTestId("codex-subagent-feed-control-row")).toBeNull();
  });

  it("does not render for a non-Codex session", () => {
    installSession({ backend_type: "claude", codex_native_subagents: snapshot() });
    render(<CodexSubagentFeedControl sessionId="session-1" />);

    expect(screen.queryByTestId("feed-codex-subagents")).toBeNull();
  });
});
