import { describe, expect, it, vi } from "vitest";
import { prepareWorktreeForSessionCreate } from "./session-worktree-create.js";
import * as gitUtils from "../git-utils.js";

vi.mock("../git-utils.js", () => ({
  getRepoInfoAsync: vi.fn(async () => ({
    repoRoot: "/repo",
    currentBranch: "integration",
    defaultBranch: "integration",
  })),
  ensureWorktreeAsync: vi.fn(),
}));

describe("worker branch creation authority", () => {
  it.each([
    false,
    true,
  ])("uses server creation receipts and keeps leader branches out of disposable ownership (leader=%s)", async (isOrchestrator) => {
    // Caller-supplied metadata is not deletion authority, even with a plausible name.
    const createdBranch = { name: "integration-wt-1234", initialTip: "a".repeat(40) };
    vi.mocked(gitUtils.ensureWorktreeAsync).mockResolvedValue({
      worktreePath: "/isolated",
      branch: "integration",
      actualBranch: createdBranch.name,
      isNew: false,
      createdBranch,
    });
    const result = await prepareWorktreeForSessionCreate({
      body: { useWorktree: true, disposableBranch: { name: "user-branch", initialTip: "b".repeat(40) } },
      cwd: "/repo",
      isOrchestrator,
      emit: vi.fn(async () => {}),
      throwPreparationError: (message) => {
        throw new Error(message);
      },
    });
    expect(result?.worktreeInfo.disposableBranch).toEqual(isOrchestrator ? undefined : createdBranch);
    expect(gitUtils.ensureWorktreeAsync).toHaveBeenCalledWith(
      "/repo",
      "integration",
      expect.objectContaining({ forceNew: true }),
    );
  });

  it("does not infer ownership from a generated-looking branch without a receipt", async () => {
    vi.mocked(gitUtils.ensureWorktreeAsync).mockResolvedValue({
      worktreePath: "/isolated",
      branch: "integration",
      actualBranch: "integration-wt-1234",
      isNew: false,
    });
    const result = await prepareWorktreeForSessionCreate({
      body: { useWorktree: true },
      cwd: "/repo",
      isOrchestrator: false,
      emit: vi.fn(async () => {}),
      throwPreparationError: (message) => {
        throw new Error(message);
      },
    });
    expect(result?.worktreeInfo.disposableBranch).toBeUndefined();
  });
});
