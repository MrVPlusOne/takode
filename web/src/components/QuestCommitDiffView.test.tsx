// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { QuestCodeCommitDiffPanel, useQuestCodeCommitShas } from "./QuestCommitDiffView.js";

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

function CommitCount({ questId }: { questId: string }) {
  const { commitShas, loading } = useQuestCodeCommitShas(questId);
  return <span data-testid="commit-count">{loading ? "loading" : commitShas.length}</span>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

  it("keeps a live exact projection ahead of stale list and in-flight detail responses", async () => {
    const pendingDetail = deferred<ReturnType<typeof questFixture>>();
    useStore.setState({
      quests: [questFixture({ version: 5, updatedAt: 40, commitShas: undefined }) as never],
    });
    mockGetQuest.mockReturnValueOnce(pendingDetail.promise);

    render(<CommitCount questId="q-42" />);
    expect(screen.getByTestId("commit-count")).toHaveTextContent("loading");
    await waitFor(() => expect(mockGetQuest).toHaveBeenCalledWith("q-42"));

    act(() => {
      useStore.getState().upsertQuestTitlePreview({
        questId: "q-42",
        title: "Recorded commits",
        version: 5,
        updatedAt: 50,
        commitShas: ["abc1234def5678", "def5678abc1234"],
      });
    });
    expect(screen.getByTestId("commit-count")).toHaveTextContent("2");

    await act(async () => {
      pendingDetail.resolve(questFixture({ version: 5, updatedAt: 45, commitShas: [] }));
      await pendingDetail.promise;
    });
    act(() => {
      useStore.getState().setQuests([questFixture({ version: 5, updatedAt: 42, commitShas: [] }) as never]);
    });

    expect(screen.getByTestId("commit-count")).toHaveTextContent("2");
    expect(useStore.getState().questTitlePreviews.get("q-42")?.commitShas).toEqual([
      "abc1234def5678",
      "def5678abc1234",
    ]);
  });

  it("starts the selected commit diff before lazy metadata and skips duplicate active metadata", async () => {
    const shas = ["aaa1111", "bbb2222", "ccc3333", "ddd4444"];
    useStore.setState({
      questDetails: new Map([["q-42", questFixture({ commitShas: shas }) as never]]),
    });
    const pending = new Map<string, ReturnType<typeof deferred<Record<string, unknown>>>>();
    const calls: Array<{ sha: string; includeDiff: boolean }> = [];
    mockGetQuestCommit.mockImplementation((_questId: string, sha: string, options?: { includeDiff?: boolean }) => {
      const includeDiff = options?.includeDiff !== false;
      const key = sha + ":" + (includeDiff ? "diff" : "metadata");
      const request = deferred<Record<string, unknown>>();
      pending.set(key, request);
      calls.push({ sha, includeDiff });
      return request.promise;
    });

    render(<QuestCodeCommitDiffPanel questId="q-42" />);

    await waitFor(() => expect(calls.length).toBe(3));
    expect(calls[0]).toEqual({ sha: shas[0], includeDiff: true });
    expect(calls.slice(1)).toEqual([
      { sha: shas[1], includeDiff: false },
      { sha: shas[2], includeDiff: false },
    ]);
    expect(calls).not.toContainEqual({ sha: shas[0], includeDiff: false });
    expect(calls).not.toContainEqual({ sha: shas[3], includeDiff: false });

    await act(async () => {
      pending.get(shas[0] + ":diff")?.resolve({
        sha: shas[0],
        shortSha: shas[0],
        message: "Selected commit",
        timestamp: 3,
        available: true,
        additions: 1,
        deletions: 0,
        diff: "@@ -1 +1 @@\n-old\n+selected\n",
      });
    });

    expect(await screen.findByTestId("diff-viewer")).toHaveTextContent("+selected");
    expect(calls).not.toContainEqual({ sha: shas[0], includeDiff: false });

    await act(async () => {
      pending.get(shas[1] + ":metadata")?.resolve({
        sha: shas[1],
        shortSha: shas[1],
        message: "Second metadata",
        timestamp: 1,
        available: true,
      });
    });

    await waitFor(() => expect(calls).toContainEqual({ sha: shas[3], includeDiff: false }));
  });

  it("ignores a stale selected diff failure after switching commits", async () => {
    const shas = ["aaa1111", "bbb2222", "ccc3333"];
    useStore.setState({
      questDetails: new Map([["q-42", questFixture({ commitShas: shas }) as never]]),
    });
    const pending = new Map<string, ReturnType<typeof deferred<Record<string, unknown>>>>();
    const calls: Array<{ sha: string; includeDiff: boolean }> = [];
    mockGetQuestCommit.mockImplementation((_questId: string, sha: string, options?: { includeDiff?: boolean }) => {
      const includeDiff = options?.includeDiff !== false;
      const key = sha + ":" + (includeDiff ? "diff" : "metadata");
      const request = deferred<Record<string, unknown>>();
      pending.set(key, request);
      calls.push({ sha, includeDiff });
      return request.promise;
    });

    render(<QuestCodeCommitDiffPanel questId="q-42" />);

    await waitFor(() => expect(calls[0]).toEqual({ sha: shas[0], includeDiff: true }));

    fireEvent.click(screen.getByTitle(shas[1]));
    await waitFor(() => expect(calls).toContainEqual({ sha: shas[1], includeDiff: true }));

    await act(async () => {
      pending.get(shas[0] + ":diff")?.reject(new Error("Commit A exploded"));
      pending.get(shas[1] + ":diff")?.resolve({
        sha: shas[1],
        shortSha: shas[1],
        message: "Second selected commit",
        timestamp: 4,
        available: true,
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+second\n",
      });
    });

    expect(await screen.findByTestId("diff-viewer")).toHaveTextContent("+second");
    expect(screen.queryByText("Commit A exploded")).not.toBeInTheDocument();
  });
});
