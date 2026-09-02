// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";

const mockCheckQuestVerification = vi.fn();
const mockTransitionQuest = vi.fn();
const mockDeleteQuest = vi.fn();
const mockMarkQuestDone = vi.fn();
const mockAddQuestFeedback = vi.fn();
const mockEditQuestFeedback = vi.fn();
const mockDeleteQuestFeedback = vi.fn();
const mockGetQuestHistory = vi.fn();
const mockGetQuestCommit = vi.fn();
const mockGetQuestMemoryCommit = vi.fn();
const mockGetQuest = vi.fn();
const mockGetQuestValidated = vi.fn();
const mockGetSettings = vi.fn();
const mockMarkNotificationDone = vi.fn();
const mockMarkAllNotificationsDone = vi.fn();
vi.mock("../api.js", () => ({
  api: {
    questImageUrl: (id: string) => "/api/quests/_images/" + id,
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return "/api/fs/image?" + params.toString();
    },
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    openVsCodeRemoteFile: vi.fn(),
    checkQuestVerification: (...args: unknown[]) => mockCheckQuestVerification(...args),
    transitionQuest: (...args: unknown[]) => mockTransitionQuest(...args),
    deleteQuest: (...args: unknown[]) => mockDeleteQuest(...args),
    markQuestDone: (...args: unknown[]) => mockMarkQuestDone(...args),
    addQuestFeedback: (...args: unknown[]) => mockAddQuestFeedback(...args),
    editQuestFeedback: (...args: unknown[]) => mockEditQuestFeedback(...args),
    deleteQuestFeedback: (...args: unknown[]) => mockDeleteQuestFeedback(...args),
    getQuest: (...args: unknown[]) => mockGetQuest(...args),
    getQuestValidated: (...args: unknown[]) => mockGetQuestValidated(...args),
    getQuestHistory: (...args: unknown[]) => mockGetQuestHistory(...args),
    getQuestCommit: (...args: unknown[]) => mockGetQuestCommit(...args),
    getQuestMemoryCommit: (...args: unknown[]) => mockGetQuestMemoryCommit(...args),
    markNotificationDone: (...args: unknown[]) => mockMarkNotificationDone(...args),
    markAllNotificationsDone: (...args: unknown[]) => mockMarkAllNotificationsDone(...args),
  },
}));

const mockNavigateToSession = vi.fn();
const mockNavigateToSessionThread = vi.fn();
vi.mock("../utils/routing.js", () => ({
  navigateToSession: (...args: unknown[]) => mockNavigateToSession(...args),
  navigateToSessionThread: (...args: unknown[]) => mockNavigateToSessionThread(...args),
  routeSessionRefForId: (sessionId: string) => sessionId,
  sessionHash: (sessionId: string | number) => "#/session/" + sessionId,
  sessionThreadHash: (sessionId: string | number, threadKey?: string | null) =>
    threadKey ? "#/session/" + sessionId + "?thread=" + threadKey : "#/session/" + sessionId,
  questOverlayTargetFromHash: () => null,
  withoutQuestIdInHash: (hash: string) => hash.replace(/[?&](quest|feedback)=[^&]+/g, ""),
  withQuestIdInHash: (_hash: string, questId: string) => "#/?quest=" + questId,
  withQuestFeedbackInHash: (_hash: string, questId: string, feedbackIndex: number) =>
    `#/?quest=${questId}&feedback=${feedbackIndex}`,
}));

vi.mock("./quest-assign.js", () => ({
  buildQuestAssignDraft: (questId: string) => "Assign draft for " + questId,
}));
vi.mock("./quest-rework.js", () => ({
  buildQuestReworkDraft: (questId: string) => "Rework draft for " + questId,
}));

import { QuestDetailPanel } from "./QuestDetailPanel.js";
import type { QuestmasterTask } from "../types.js";

function makeVerificationQuest(overrides?: Partial<QuestmasterTask>): QuestmasterTask {
  return {
    id: "q-42-v3",
    questId: "q-42",
    version: 3,
    title: "Fix mobile sidebar overflow",
    status: "done",
    description: "The sidebar overflows on narrow screens.\n\n## Steps\n1. Add wrapper\n2. Test",
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
    sessionId: "session-abc",
    claimedAt: Date.now() - 43200000,
    tags: ["ui", "mobile"],
    verificationItems: [
      { text: "Sidebar no overflow on iPhone SE", checked: true },
      { text: "Scroll works", checked: false },
    ],
    feedback: [
      { author: "human", text: "Check iPad mini too", ts: Date.now() - 7200000, addressed: true },
      {
        author: "agent",
        text: "Confirmed working on iPad mini.",
        ts: Date.now() - 3600000,
        authorSessionId: "session-abc",
      },
    ],
    ...overrides,
  } as QuestmasterTask;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("QuestDetailPanel commit evidence", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockNavigateToSession.mockReset();
    mockNavigateToSessionThread.mockReset();
    mockCheckQuestVerification.mockReset();
    mockTransitionQuest.mockReset();
    mockDeleteQuest.mockReset();
    mockMarkQuestDone.mockReset();
    mockAddQuestFeedback.mockReset();
    mockEditQuestFeedback.mockReset();
    mockDeleteQuestFeedback.mockReset();
    mockGetQuest.mockReset();
    mockGetQuestValidated.mockReset();
    mockGetQuestValidated.mockImplementation(async (...args: unknown[]) => {
      const data = await mockGetQuest(...args);
      return data === undefined ? { status: "not-modified", etag: null } : { status: "fresh", data, etag: null };
    });
    mockGetQuestHistory.mockReset();
    mockGetQuestCommit.mockReset();
    mockGetQuestCommit.mockResolvedValue({ sha: "unknown", available: false, reason: "commit_not_available" });
    mockGetQuestMemoryCommit.mockReset();
    mockGetQuestMemoryCommit.mockResolvedValue({ sha: "unknown", available: false, reason: "commit_not_available" });
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "none" } });
    mockMarkNotificationDone.mockReset();
    mockMarkAllNotificationsDone.mockReset();
    document.body.style.overflow = "";
  });

  it("renders commit chips and navigates between commit diffs in the modal", async () => {
    const firstSha = "abc1234def567890";
    const secondSha = "deadbeeffeedcafe";
    const quest = makeVerificationQuest({ commitShas: [firstSha, secondSha] } as Partial<QuestmasterTask>);
    useStore.setState({ quests: [quest], questOverlayId: "q-42" });
    mockGetQuestCommit.mockImplementation((_id: string, sha: string, options?: { includeDiff?: boolean }) => {
      const base = {
        sha,
        shortSha: sha.slice(0, 7),
        message: sha === firstSha ? "First ported commit" : "Second ported commit",
        timestamp: sha === firstSha ? 1000 : 2000,
        available: true,
      };
      if (options?.includeDiff === false) return Promise.resolve(base);
      return Promise.resolve({
        ...base,
        additions: sha === firstSha ? 12 : 3,
        deletions: sha === firstSha ? 4 : 1,
        splitStats:
          sha === firstSha
            ? {
                code: { additions: 8, deletions: 2 },
                tests: { additions: 4, deletions: 2 },
              }
            : {
                code: { additions: 3, deletions: 1 },
                tests: { additions: 0, deletions: 0 },
              },
        diff:
          sha === firstSha
            ? `diff --git a/file.test.ts b/file.test.ts\n--- a/file.test.ts\n+++ b/file.test.ts\n@@ -1 +1 @@\n-old test\n+new test\ndiff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old code\n+new code\n`
            : `diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-before\n+after\n`,
      });
    });

    render(<QuestDetailPanel />);

    const commitsToggle = screen.getByRole("button", { name: "Expand commits, 2 commits" });
    expect(commitsToggle).toHaveTextContent("Commits");
    expect(commitsToggle).toHaveTextContent("2 commits");
    expect(screen.queryByText("First ported commit")).toBeNull();
    expect(screen.queryByText("Second ported commit")).toBeNull();
    fireEvent.click(commitsToggle);

    expect(await screen.findByText("First ported commit")).toBeTruthy();
    expect(screen.getAllByText("Second ported commit").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByLabelText(`Open code commit ${firstSha.slice(0, 7)}`));

    await waitFor(() => {
      expect(mockGetQuestCommit).toHaveBeenCalledWith("q-42", firstSha);
    });
    expect(screen.getByTestId("quest-commit-modal")).toBeTruthy();
    expect(screen.getAllByText("First ported commit").length).toBeGreaterThanOrEqual(1);
    const firstAggregate = screen.getByLabelText("Overall changes: 12 additions, 4 deletions");
    expect(firstAggregate).toHaveTextContent("+12 additions");
    expect(firstAggregate).toHaveTextContent("-4 deletions");
    expect(firstAggregate).not.toHaveTextContent("Overall");
    expect(screen.getByLabelText("Code changes: 8 additions, 2 deletions")).toBeTruthy();
    expect(screen.getByLabelText("Tests changes: 4 additions, 2 deletions")).toBeTruthy();
    expect(screen.getByTestId("quest-commit-diff-stats")).not.toHaveTextContent("Overall");
    expect(screen.getAllByRole("button", { name: "Collapse file" })).toHaveLength(2);
    const modal = screen.getByTestId("quest-commit-modal");
    expect([...modal.querySelectorAll<HTMLElement>(".diff-file-header")].map((header) => header.title)).toEqual([
      "file.ts",
      "file.test.ts",
    ]);
    const diffScroll = modal.querySelector(".quest-commit-diff-scroll");
    const diffContent = modal.querySelector(".quest-commit-diff-content");
    expect(diffScroll).toHaveClass("pt-0", "px-4", "pb-4");
    expect(diffContent).not.toHaveClass("pt-4");
    expect(diffContent?.firstElementChild).toHaveClass("diff-viewer");

    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => {
      expect(mockGetQuestCommit).toHaveBeenCalledWith("q-42", secondSha);
    });
    expect(screen.getAllByText("Second ported commit").length).toBeGreaterThanOrEqual(1);
    const secondAggregate = screen.getByLabelText("Overall changes: 3 additions, 1 deletions");
    expect(secondAggregate).toHaveTextContent("+3 additions");
    expect(secondAggregate).toHaveTextContent("-1 deletions");
    expect(await screen.findByLabelText("Code changes: 3 additions, 1 deletions")).toBeTruthy();
    expect(screen.queryByLabelText(/^Tests changes:/)).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse file" })[0]);
    expect(screen.queryByText("before")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand file" })).toBeTruthy();
  });

  it("keeps the commit modal footprint stable while the next commit diff is loading", async () => {
    const firstSha = "abc1234def567890";
    const secondSha = "deadbeeffeedcafe";
    const secondCommit = createDeferred<{
      sha: string;
      shortSha: string;
      message: string;
      timestamp: number;
      available: boolean;
      additions: number;
      deletions: number;
      diff: string;
    }>();
    const quest = makeVerificationQuest({ commitShas: [firstSha, secondSha] } as Partial<QuestmasterTask>);
    useStore.setState({ quests: [quest], questOverlayId: "q-42" });
    mockGetQuestCommit.mockImplementation((_id: string, sha: string, options?: { includeDiff?: boolean }) => {
      const base = {
        sha,
        shortSha: sha.slice(0, 7),
        message: sha === firstSha ? "First ported commit" : "Second ported commit",
        timestamp: sha === firstSha ? 1000 : 2000,
        available: true,
      };
      if (options?.includeDiff === false) return Promise.resolve(base);
      if (sha === secondSha) return secondCommit.promise;
      return Promise.resolve({
        ...base,
        additions: 12,
        deletions: 4,
        diff: `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n`,
      });
    });

    render(<QuestDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Expand commits, 2 commits" }));
    expect(await screen.findByText("First ported commit")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`Open code commit ${firstSha.slice(0, 7)}`));

    await waitFor(() => {
      expect(mockGetQuestCommit).toHaveBeenCalledWith("q-42", firstSha);
    });
    const modal = screen.getByTestId("quest-commit-modal");
    const diffScroll = modal.querySelector(".quest-commit-diff-scroll");
    expect(modal).toHaveClass("h-[90dvh]", "max-h-[calc(100dvh-2rem)]", "min-h-0");
    expect(diffScroll).toHaveClass("min-h-0", "flex-1", "overflow-auto");

    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => {
      expect(mockGetQuestCommit).toHaveBeenCalledWith("q-42", secondSha);
    });
    expect(screen.getByText("Loading commit diff...")).toBeTruthy();
    expect(screen.getByTestId("quest-commit-modal")).toHaveClass("h-[90dvh]", "max-h-[calc(100dvh-2rem)]", "min-h-0");
    expect(diffScroll).toHaveClass("min-h-0", "flex-1", "overflow-auto");

    await act(async () => {
      secondCommit.resolve({
        sha: secondSha,
        shortSha: secondSha.slice(0, 7),
        message: "Second ported commit",
        timestamp: 2000,
        available: true,
        additions: 3,
        deletions: 1,
        diff: `diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-before\n+after\n`,
      });
    });
    expect(await screen.findByText("+3 additions")).toBeTruthy();
  });

  it("shows a graceful unavailable state when a stored commit cannot be loaded", async () => {
    const sha = "abc1234def567890";
    const quest = makeVerificationQuest({ commitShas: [sha] } as Partial<QuestmasterTask>);
    useStore.setState({ quests: [quest], questOverlayId: "q-42" });
    mockGetQuestCommit.mockResolvedValueOnce({
      sha,
      available: false,
      reason: "commit_not_available",
    });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Expand commits, 1 commit" }));
    fireEvent.click(screen.getByLabelText(`Open code commit ${sha.slice(0, 7)}`));

    await waitFor(() => {
      expect(mockGetQuestCommit).toHaveBeenCalledWith("q-42", sha, { includeDiff: false });
    });
    expect(screen.getByText("Commit not available")).toBeTruthy();
    expect(screen.getByText("This commit is no longer available in local git history.")).toBeTruthy();
  });

  it("renders separate readable memory commit evidence and opens memory diffs", async () => {
    const codeSha = "1111111abcdef00";
    const memorySha = "2222222abcdef00";
    const quest = makeVerificationQuest({
      commitShas: [codeSha],
      memoryCommitShas: [memorySha],
    } as Partial<QuestmasterTask>);
    useStore.setState({ quests: [quest], questOverlayId: "q-42" });
    mockGetQuestCommit.mockResolvedValue({
      sha: codeSha,
      shortSha: codeSha.slice(0, 7),
      message: "Port quest detail UI",
      timestamp: 2000,
      available: true,
    });
    mockGetQuestMemoryCommit.mockImplementation((_id: string, sha: string, options?: { includeDiff?: boolean }) => {
      const base = {
        sha,
        shortSha: sha.slice(0, 7),
        message: "Record memory handoff",
        timestamp: 1000,
        available: true,
      };
      if (options?.includeDiff === false) return Promise.resolve(base);
      return Promise.resolve({
        ...base,
        diff: `diff --git a/current/state.md b/current/state.md\n--- a/current/state.md\n+++ b/current/state.md\n@@ -1 +1 @@\n-old\n+new\n`,
        sourceFiles: [{ path: "current/state.md", oldText: "old\n", newText: "new\n" }],
      });
    });

    render(<QuestDetailPanel />);

    const commitsToggle = screen.getByRole("button", { name: "Expand commits, 2 commits" });
    expect(screen.queryByText("Commit evidence")).toBeNull();
    expect(commitsToggle).toHaveTextContent("Commits");
    expect(commitsToggle).toHaveTextContent("2 commits");
    expect(screen.queryByText("Record memory handoff")).toBeNull();
    expect(screen.queryByText("Port quest detail UI")).toBeNull();
    expect(screen.queryByLabelText(`Open memory commit ${memorySha.slice(0, 7)}`)).toBeNull();
    fireEvent.click(commitsToggle);

    expect(await screen.findByText("Record memory handoff")).toBeTruthy();
    expect(screen.getByText("Port quest detail UI")).toBeTruthy();
    const evidenceButtons = screen.getAllByRole("button", { name: /Open (memory|code) commit/ });
    expect(evidenceButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Record memory handoff"),
      expect.stringContaining("Port quest detail UI"),
    ]);

    fireEvent.click(screen.getByLabelText(`Open memory commit ${memorySha.slice(0, 7)}`));

    await waitFor(() => {
      expect(mockGetQuestMemoryCommit).toHaveBeenCalledWith("q-42", memorySha);
    });
    expect(screen.getByTestId("quest-commit-modal")).toBeTruthy();
    expect(screen.getByText("Memory Commit")).toBeTruthy();
    expect(screen.getAllByText("Record memory handoff").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Collapse file" })).toBeTruthy();
  });
});
