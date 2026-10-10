// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { DiffTabView } from "./DiffTabView.js";
import type { DiffTargetResolution } from "../utils/diff-target.js";

const mockCommitCounts = new Map<string, number>();

vi.mock("./DiffPanel.js", () => ({
  DiffPanel: ({ sessionId }: { sessionId: string }) => <div data-testid="diff-panel" data-session-id={sessionId} />,
}));
vi.mock("./QuestCommitDiffView.js", () => ({
  useQuestCodeCommitShas: (questId?: string | null) => {
    const count = questId ? (mockCommitCounts.get(questId) ?? 0) : 0;
    return { commitShas: Array.from({ length: count }, (_, index) => `sha-${index}`), loading: false };
  },
  QuestCodeCommitDiffPanel: ({ questId }: { questId: string }) => (
    <div data-testid="quest-code-commit-diff-panel" data-quest-id={questId} />
  ),
}));

function questTarget(workerSessionId: string | null): DiffTargetResolution {
  return {
    kind: "quest",
    questId: "q-42",
    workerSessionId,
    changesOwner: "worker",
    label: "q-42 diff",
    title: "Show q-42 commits and changes",
  };
}

function setWorkerLines(added: number) {
  useStore.getState().setSdkSessions([
    {
      sessionId: "worker",
      sessionNum: 9,
      state: "connected",
      cwd: "/wt/worker",
      createdAt: 1,
      isWorktree: true,
      totalLinesAdded: added,
      totalLinesRemoved: 0,
    },
  ]);
}

describe("DiffTabView", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockCommitCounts.clear();
  });

  it("opens a quest's commits first and switches to the worker's changes", () => {
    mockCommitCounts.set("q-42", 2);
    setWorkerLines(5);
    render(<DiffTabView target={questTarget("worker")} onBack={() => {}} />);

    expect(screen.getByTestId("quest-code-commit-diff-panel")).toHaveAttribute("data-quest-id", "q-42");
    expect(screen.getByTestId("diff-tab-commits")).toHaveTextContent("2 commits");
    expect(screen.getByTestId("diff-tab-changes")).toHaveTextContent("Worker changes+5-0");

    fireEvent.click(screen.getByTestId("diff-tab-changes"));
    expect(screen.getByTestId("diff-panel")).toHaveAttribute("data-session-id", "worker");
    expect(screen.queryByTestId("quest-code-commit-diff-panel")).not.toBeInTheDocument();
  });

  it("opens the worker's changes when the quest has no commits yet", () => {
    setWorkerLines(5);
    render(<DiffTabView target={questTarget("worker")} onBack={() => {}} />);
    expect(screen.getByTestId("diff-panel")).toHaveAttribute("data-session-id", "worker");
    expect(screen.getByTestId("diff-tab-changes")).toHaveAttribute("aria-selected", "true");
  });

  // No silent fallback: without a worker there is no changes section, and never the leader's own diff.
  it("shows only commits when the quest has no worker", () => {
    render(<DiffTabView target={questTarget(null)} onBack={() => {}} />);
    expect(screen.getByTestId("quest-code-commit-diff-panel")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diff-panel")).not.toBeInTheDocument();
  });

  // The top-bar Diff toggle used to be the way back; the diff view now carries its own.
  it("returns to the chat from the back button", () => {
    const onBack = vi.fn();
    render(
      <DiffTabView
        target={{ kind: "session", source: "leader", sessionId: "leader", label: "Leader diff", title: "Show" }}
        onBack={onBack}
      />,
    );
    expect(screen.getByTestId("diff-tab-title")).toHaveTextContent("Leader changes");
    expect(screen.getByTestId("diff-panel")).toHaveAttribute("data-session-id", "leader");
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(onBack).toHaveBeenCalled();
  });
});
