// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatusCounts,
} from "../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage, ChatMessage, SessionState } from "../types.js";

const fetchHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("../api/codex-native-subagents.js", () => ({
  fetchCodexNativeSubagentHistory: (...args: unknown[]) => fetchHistoryMock(...args),
}));

vi.mock("./MessageBubble.js", () => ({
  MessageBubble: ({
    message,
    interactionMode,
    backendType,
  }: {
    message: ChatMessage;
    interactionMode?: string;
    backendType?: string;
  }) =>
    message.metadata?.codexReasoningDetail ? (
      <details data-testid="history-message" data-interaction-mode={interactionMode} data-backend-type={backendType}>
        <summary>Official reasoning details</summary>
        <div>{message.content}</div>
      </details>
    ) : (
      <div data-testid="history-message" data-interaction-mode={interactionMode} data-backend-type={backendType}>
        {message.content}
      </div>
    ),
}));

import { useStore } from "../store.js";
import { CodexSubagentInspector } from "./CodexSubagentInspector.js";

const NOW = 1_788_000_000_000;
const ZERO_COUNTS: CodexNativeSubagentStatusCounts = {
  starting: 0,
  working: 0,
  waiting: 0,
  done: 0,
  failed: 0,
  interrupted: 0,
  unknown: 0,
};

// Mirrors the browser-safe server projection: opaque IDs, root-turn ownership,
// nested spawn order, and lifecycle/transcript state are all producer-owned.
function producerSnapshot(overrides: Partial<CodexNativeSubagentSnapshot> = {}): CodexNativeSubagentSnapshot {
  return {
    revision: 12,
    coverage: "complete",
    session: {
      total: 4,
      statusCounts: { ...ZERO_COUNTS, working: 1, done: 1, failed: 1, unknown: 1 },
      activeCount: 1,
      unresolvedCount: 2,
    },
    children: [
      {
        childId: "opaque-active",
        rootTurnId: "turn-alignment",
        agentPath: "/root/schema_probe",
        displayName: "Schema probe",
        nickname: "Scout",
        role: "explorer",
        depth: 0,
        spawnOrder: 1,
        startedAt: NOW - 60_000,
        lastActivityAt: NOW - 5_000,
        status: "working",
        statusObservedAt: NOW - 5_000,
        transcriptAvailability: "available",
        followUpAvailable: true,
      },
      {
        childId: "opaque-done",
        parentChildId: "opaque-active",
        rootTurnId: "turn-alignment",
        agentPath: "/root/schema_probe/privacy_audit",
        displayName: "Privacy audit",
        depth: 1,
        spawnOrder: 2,
        startedAt: NOW - 55_000,
        endedAt: NOW - 20_000,
        lastActivityAt: NOW - 20_000,
        status: "done",
        statusObservedAt: NOW - 20_000,
        transcriptAvailability: "partial",
        followUpAvailable: false,
      },
      {
        childId: "opaque-failed",
        rootTurnId: "turn-work",
        agentPath: "/root/ui_check",
        displayName: "UI check",
        depth: 0,
        spawnOrder: 3,
        startedAt: NOW - 30_000,
        endedAt: NOW - 10_000,
        status: "failed",
        statusObservedAt: NOW - 10_000,
        transcriptAvailability: "unavailable",
      },
      {
        childId: "opaque-unknown",
        rootTurnId: "turn-work",
        agentPath: "/root/replay_check",
        displayName: "Replay check",
        depth: 0,
        spawnOrder: 4,
        lastActivityAt: NOW - 15_000,
        status: "unknown",
        statusObservedAt: NOW - 15_000,
        transcriptAvailability: "partial",
      },
    ],
    turns: {
      "turn-alignment": {
        rootTurnId: "turn-alignment",
        total: 2,
        statusCounts: { ...ZERO_COUNTS, working: 1, done: 1 },
        status: "working",
        coverage: "complete",
      },
      "turn-work": {
        rootTurnId: "turn-work",
        total: 2,
        statusCounts: { ...ZERO_COUNTS, failed: 1, unknown: 1 },
        status: "unknown",
        coverage: "complete",
      },
    },
    ...overrides,
  };
}

function installSnapshot(snapshot: CodexNativeSubagentSnapshot = producerSnapshot()) {
  useStore.setState({
    sessions: new Map([
      [
        "session-1",
        {
          session_id: "session-1",
          backend_type: "codex",
          codex_native_subagents: snapshot,
        } as unknown as SessionState,
      ],
    ]),
    codexSubagentInspector: { sessionId: "session-1" },
    scrollToTurnId: new Map(),
  });
}

function ownedHistoryMessage({
  childId,
  rootTurnId,
  id,
  content,
  timestamp,
  historyIndex,
}: {
  childId: string;
  rootTurnId: string;
  id: string;
  content: string;
  timestamp: number;
  historyIndex: number;
}): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp,
    history_index: historyIndex,
    codexSubagent: { childId, rootTurnId },
  };
}

const childHistoryMessage = ownedHistoryMessage({
  childId: "opaque-active",
  rootTurnId: "turn-alignment",
  id: "child-history-user",
  content: "Bounded child-only history",
  timestamp: NOW - 40_000,
  historyIndex: 77,
});

describe("CodexSubagentInspector", () => {
  beforeEach(() => {
    fetchHistoryMock.mockReset();
    fetchHistoryMock.mockResolvedValue({
      messages: [childHistoryMessage],
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    });
    useStore.setState({
      sessions: new Map(),
      codexSubagentInspector: null,
      scrollToTurnId: new Map(),
      activeTab: "chat",
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  it("groups producer-shaped rows by lifecycle while preserving nesting and spawn order", () => {
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    const dialog = screen.getByRole("dialog", { name: "Codex subagents" });
    expect(within(dialog).getByRole("heading", { name: "Active" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Unresolved" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Schema probe, Working/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /UI check, Failed/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Replay check, Unknown/ })).toBeInTheDocument();
    const nested = within(dialog).getByRole("button", { name: /Privacy audit, Done/ });
    expect(nested).toHaveAttribute("data-child-depth", "1");
    expect(dialog).toHaveClass("w-full", "overflow-x-hidden");
  });

  it("opens a read-only bounded detail, shows breadcrumbs, and pages with opaque IDs", async () => {
    // A Partial summary must remain conservative even if an individual page
    // reports complete coverage; the browser may not upgrade server evidence.
    fetchHistoryMock
      .mockResolvedValueOnce({
        messages: [
          ownedHistoryMessage({
            childId: "opaque-done",
            rootTurnId: "turn-alignment",
            id: "child-history-user",
            content: "Bounded child-only history",
            timestamp: NOW - 40_000,
            historyIndex: 77,
          }),
        ],
        nextCursor: "opaque-page-2",
        availability: "available",
        coverage: "complete",
      })
      .mockResolvedValueOnce({
        messages: [
          ownedHistoryMessage({
            childId: "opaque-done",
            rootTurnId: "turn-alignment",
            id: "child-history-user-2",
            content: "Older child-owned history",
            timestamp: NOW - 50_000,
            historyIndex: 76,
          }),
        ],
        nextCursor: null,
        availability: "available",
        coverage: "complete",
      });
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Privacy audit, Done/ }));

    await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalledTimes(1));
    expect(fetchHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", childId: "opaque-done", limit: 30 }),
    );
    expect(screen.getByLabelText("Subagent nesting path")).toHaveTextContent("Schema probe › Privacy audit");
    expect(screen.getByText(/Transcript partial\./)).toBeInTheDocument();
    const firstMessage = await screen.findByTestId("history-message");
    expect(firstMessage).toHaveTextContent("Bounded child-only history");
    expect(firstMessage).toHaveAttribute("data-interaction-mode", "read-only");
    expect(firstMessage).toHaveAttribute("data-backend-type", "codex");

    fireEvent.click(screen.getByRole("button", { name: "Load older history" }));
    await screen.findByText("Older child-owned history");
    expect(
      within(screen.getByTestId("codex-subagent-history"))
        .getAllByTestId("history-message")
        .map((message) => message.textContent),
    ).toEqual(["Older child-owned history", "Bounded child-only history"]);
    expect(fetchHistoryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ childId: "opaque-done", cursor: "opaque-page-2", limit: 30 }),
    );
  });

  it("reuses a local child page cache while the child activity version is unchanged", async () => {
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    await screen.findByText("Bounded child-only history");
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Back to Codex subagent list" }));
    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    await screen.findByText("Bounded child-only history");
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces live snapshot churn and refreshes the head without discarding paged history", async () => {
    const olderMessage = ownedHistoryMessage({
      childId: "opaque-active",
      rootTurnId: "turn-alignment",
      id: "older-child-history",
      content: "Older retained child history",
      timestamp: NOW - 80_000,
      historyIndex: 70,
    });
    const newestMessage = ownedHistoryMessage({
      childId: "opaque-active",
      rootTurnId: "turn-alignment",
      id: "newest-child-history",
      content: "Newest child history after live activity",
      timestamp: NOW - 1_000,
      historyIndex: 78,
    });
    fetchHistoryMock
      .mockResolvedValueOnce({
        messages: [childHistoryMessage],
        nextCursor: "older-page",
        availability: "available",
        coverage: "partial",
      })
      .mockResolvedValueOnce({
        messages: [olderMessage],
        nextCursor: null,
        availability: "available",
        coverage: "complete",
      })
      .mockResolvedValueOnce({
        messages: [childHistoryMessage, newestMessage],
        nextCursor: "overlapping-head",
        availability: "available",
        coverage: "partial",
      });
    const initial = producerSnapshot();
    installSnapshot(initial);
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    await screen.findByText("Bounded child-only history");
    fireEvent.click(screen.getByRole("button", { name: "Load older history" }));
    await screen.findByText("Older retained child history");

    const currentSession = useStore.getState().sessions.get("session-1")!;
    const updated = producerSnapshot({
      revision: initial.revision + 1,
      children: initial.children.map((child) =>
        child.childId === "opaque-active" ? { ...child, lastActivityAt: NOW, statusObservedAt: NOW } : child,
      ),
    });
    act(() => {
      useStore.setState({
        sessions: new Map([["session-1", { ...currentSession, codex_native_subagents: updated }]]),
      });
    });

    await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Newest child history after live activity")).toBeInTheDocument();
    expect(screen.getByText("Older retained child history")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("codex-subagent-history"))
        .getAllByTestId("history-message")
        .map((message) => message.textContent),
    ).toEqual([
      "Older retained child history",
      "Bounded child-only history",
      "Newest child history after live activity",
    ]);
  });

  it("retries an older-page failure without discarding records already shown", async () => {
    fetchHistoryMock
      .mockResolvedValueOnce({
        messages: [childHistoryMessage],
        nextCursor: "retry-page",
        availability: "available",
        coverage: "complete",
      })
      .mockRejectedValueOnce(new Error("temporary history failure"))
      .mockResolvedValueOnce({
        messages: [
          ownedHistoryMessage({
            childId: "opaque-active",
            rootTurnId: "turn-alignment",
            id: "retried-older-record",
            content: "Recovered older history",
            timestamp: NOW - 80_000,
            historyIndex: 70,
          }),
        ],
        nextCursor: null,
        availability: "available",
        coverage: "complete",
      });
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    await screen.findByText("Bounded child-only history");
    fireEvent.click(screen.getByRole("button", { name: "Load older history" }));
    expect(await screen.findByText(/More history could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Bounded child-only history")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry older history" }));
    expect(await screen.findByText("Recovered older history")).toBeInTheDocument();
    expect(fetchHistoryMock).toHaveBeenCalledTimes(3);
  });

  it("reports local truncation even when an oversized final page has no cursor", async () => {
    const oversizedPage = Array.from({ length: 181 }, (_, index) =>
      ownedHistoryMessage({
        childId: "opaque-active",
        rootTurnId: "turn-alignment",
        id: `bounded-record-${index}`,
        content: `Bounded record ${index}`,
        timestamp: NOW - (181 - index) * 1_000,
        historyIndex: index,
      }),
    );
    fetchHistoryMock.mockResolvedValueOnce({
      messages: oversizedPage,
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    });
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    expect(await screen.findByText(/reached its 180-record safety bound/i)).toBeInTheDocument();
    expect(screen.queryByText("Bounded record 0")).toBeNull();
    expect(screen.getByText("Bounded record 180")).toBeInTheDocument();
  });

  it("caps cached child pages with least-recently-used eviction", async () => {
    const children = Array.from({ length: 13 }, (_, index) => ({
      childId: `cache-child-${index}`,
      rootTurnId: "turn-cache",
      agentPath: `/root/cache_${index}`,
      displayName: `Cache child ${index}`,
      depth: 0,
      spawnOrder: index + 1,
      status: "done" as const,
      statusObservedAt: NOW - index,
      transcriptAvailability: "available" as const,
    }));
    fetchHistoryMock.mockImplementation(async ({ childId }: { childId: string }) => ({
      messages: [
        ownedHistoryMessage({
          childId,
          rootTurnId: "turn-cache",
          id: `history-${childId}`,
          content: `History for ${childId}`,
          timestamp: NOW,
          historyIndex: 1,
        }),
      ],
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    }));
    installSnapshot(
      producerSnapshot({
        session: {
          total: children.length,
          statusCounts: { ...ZERO_COUNTS, done: children.length },
          activeCount: 0,
          unresolvedCount: 0,
        },
        children,
        turns: {
          "turn-cache": {
            rootTurnId: "turn-cache",
            total: children.length,
            statusCounts: { ...ZERO_COUNTS, done: children.length },
            status: "done",
            coverage: "complete",
          },
        },
      }),
    );
    render(<CodexSubagentInspector sessionId="session-1" />);

    for (let index = 0; index < children.length; index++) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`Cache child ${index}, Done`) }));
      await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalledTimes(index + 1));
      fireEvent.click(screen.getByRole("button", { name: "Back to Codex subagent list" }));
    }

    fireEvent.click(screen.getByRole("button", { name: /Cache child 0, Done/ }));
    await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalledTimes(14));
  });

  it("moves focus between list and detail in the responsive single-pane view", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(max-width: 1023px)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    const row = screen.getByRole("button", { name: /Schema probe, Working/ });
    row.focus();
    fireEvent.click(row);
    const back = screen.getByRole("button", { name: "Back to Codex subagent list" });
    await waitFor(() => expect(back).toHaveFocus());

    fireEvent.click(back);
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("renders honest unavailable and partial-zero states without fetching", async () => {
    // Unavailable history is a terminal display state, not a cue to probe the
    // provider, and Partial + zero must never become an authoritative empty.
    installSnapshot();
    useStore.setState({
      codexSubagentInspector: { sessionId: "session-1", scopeTurnId: "turn-work", selectedChildId: "opaque-failed" },
    });
    const view = render(<CodexSubagentInspector sessionId="session-1" />);

    expect(
      within(screen.getByRole("main", { name: "Codex subagent detail" })).getAllByText("Transcript unavailable"),
    ).not.toHaveLength(0);
    expect(screen.getByText(/could not prove a safe child-only history boundary/i)).toBeInTheDocument();
    expect(fetchHistoryMock).not.toHaveBeenCalled();

    act(() =>
      installSnapshot(
        producerSnapshot({
          coverage: "partial",
          session: { total: 0, statusCounts: ZERO_COUNTS, activeCount: 0, unresolvedCount: 0 },
          children: [],
          turns: {},
        }),
      ),
    );
    view.rerender(<CodexSubagentInspector sessionId="session-1" />);
    expect(screen.getByText("No verified subagents in this view")).toBeInTheDocument();
    expect(screen.getByText(/not an authoritative zero/i)).toBeInTheDocument();
  });

  it("supports scoped opening, showing all, and a parent-turn jump from Diff back to Chat", async () => {
    installSnapshot();
    useStore.setState({
      activeTab: "diff",
      codexSubagentInspector: { sessionId: "session-1", scopeTurnId: "turn-work" },
    });
    render(<CodexSubagentInspector sessionId="session-1" />);

    expect(screen.queryByRole("button", { name: /Schema probe/ })).toBeNull();
    expect(screen.getByRole("button", { name: /UI check, Failed/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "session-1" });
    expect(screen.getByRole("button", { name: /Schema probe, Working/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Jump to parent turn" }));
    expect(useStore.getState().activeTab).toBe("chat");
    expect(useStore.getState().codexSubagentInspector).toBeNull();
    expect(useStore.getState().scrollToTurnId.get("session-1")).toBe("turn-alignment");
  });

  it("supports arrow-key row navigation and restores trigger focus after Escape", async () => {
    installSnapshot();
    // Re-close so the visible trigger is the element captured when opening.
    useStore.getState().closeCodexSubagentInspector();

    function Harness() {
      return (
        <>
          <button type="button" onClick={() => useStore.getState().openCodexSubagentInspector("session-1")}>
            Open native inspector
          </button>
          <CodexSubagentInspector sessionId="session-1" />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open native inspector" });
    trigger.focus();
    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "Close Codex subagents inspector" });
    await waitFor(() => expect(close).toHaveFocus());

    const first = screen.getByRole("button", { name: /Schema probe, Working/ });
    const second = screen.getByRole("button", { name: /UI check, Failed/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    // Row order is stable globally across the three sections: Active then Unresolved.
    expect(second).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Codex subagents" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps official reasoning summaries inside the dialog Tab loop", async () => {
    fetchHistoryMock.mockResolvedValueOnce({
      messages: [
        {
          type: "codex_reasoning_detail",
          id: "child-reasoning-summary",
          text: "Verified official summary",
          status: "complete",
          timestamp: NOW,
          parent_tool_use_id: null,
          codexSubagent: { childId: "opaque-active", rootTurnId: "turn-alignment" },
        },
      ],
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    });
    installSnapshot();
    render(<CodexSubagentInspector sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Schema probe, Working/ }));
    const summary = await screen.findByText("Official reasoning details");
    const back = screen.getByRole("button", { name: "Back to Codex subagent list" });

    back.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(summary).toHaveFocus();

    summary.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(back).toHaveFocus();
  });

  it("stays closed for another session and shows snapshot-unavailable state when explicitly opened", () => {
    installSnapshot();
    const view = render(<CodexSubagentInspector sessionId="different-session" />);
    expect(screen.queryByRole("dialog", { name: "Codex subagents" })).toBeNull();

    act(() => useStore.setState({ codexSubagentInspector: { sessionId: "different-session" } }));
    view.rerender(<CodexSubagentInspector sessionId="different-session" />);
    expect(screen.getByText("Native child activity unavailable")).toBeInTheDocument();
    expect(screen.getByText(/has not provided a browser-safe Codex subagent snapshot/i)).toBeInTheDocument();
  });
});
