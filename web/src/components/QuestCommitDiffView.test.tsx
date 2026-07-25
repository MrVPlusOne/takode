// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuest = vi.fn();
const mockGetQuestCommit = vi.fn();
const mockGetQuestMemoryCommit = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    getQuest: (...args: unknown[]) => mockGetQuest(...args),
    getQuestCommit: (...args: unknown[]) => mockGetQuestCommit(...args),
    getQuestMemoryCommit: (...args: unknown[]) => mockGetQuestMemoryCommit(...args),
  },
}));

vi.mock("./DiffViewer.js", () => ({
  DiffViewer: ({ unifiedDiff }: { unifiedDiff?: string }) => <pre data-testid="diff-viewer">{unifiedDiff}</pre>,
}));

import { useStore } from "../store.js";
import { QuestCodeCommitDiffPanel } from "./QuestCommitDiffView.js";

function questFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-42-v1",
    questId: "q-42",
    version: 1,
    title: "Recorded commits",
    status: "done",
    description: "Quest detail fixture.",
    createdAt: 1,
    statusChangedAt: 2,
    ...overrides,
  };
}

describe("QuestCodeCommitDiffPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.getState().reset();
    mockGetQuestMemoryCommit.mockResolvedValue({ sha: "memory", available: false, reason: "commit_not_available" });
  });

  it("loads full quest detail when preview data omits recorded commit SHAs", async () => {
    useStore.setState({
      quests: [questFixture({ commitShas: undefined }) as never],
    });
    mockGetQuest.mockResolvedValue(questFixture({ commitShas: ["abc1234def5678", "def5678abc1234"] }));
    mockGetQuestCommit.mockImplementation((_questId: string, sha: string, options?: { includeDiff?: boolean }) => {
      const base = {
        sha,
        shortSha: sha.slice(0, 7),
        message: sha.startsWith("abc") ? "First recorded commit" : "Second recorded commit",
        timestamp: 1_700_000_000_000,
        available: true,
      };
      if (options?.includeDiff === false) return Promise.resolve(base);
      return Promise.resolve({ ...base, additions: 1, deletions: 0, diff: "@@ -1 +1 @@\n-old\n+new\n" });
    });

    render(<QuestCodeCommitDiffPanel questId="q-42" />);

    expect(screen.getByText("Loading recorded commits...")).toBeInTheDocument();
    await waitFor(() => expect(mockGetQuest).toHaveBeenCalledWith("q-42"));
    expect(await screen.findByText("First recorded commit")).toBeInTheDocument();
    expect(screen.getByTestId("quest-commit-diff-view")).toBeInTheDocument();
    expect(screen.queryByText("No recorded commits yet")).not.toBeInTheDocument();
  });

  it("shows the no-recorded-commits state after full detail confirms no code commits", async () => {
    useStore.setState({
      quests: [questFixture({ commitShas: undefined }) as never],
    });
    mockGetQuest.mockResolvedValue(questFixture({ commitShas: [] }));

    render(<QuestCodeCommitDiffPanel questId="q-42" />);

    await waitFor(() => expect(mockGetQuest).toHaveBeenCalledWith("q-42"));
    expect(await screen.findByText("No recorded commits yet")).toBeInTheDocument();
    expect(mockGetQuestCommit).not.toHaveBeenCalled();
  });
});
