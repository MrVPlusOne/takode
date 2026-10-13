import { describe, expect, it } from "vitest";
import { formatSessionRecoveryNotice } from "./session-recovery-notice.js";

// The notice is assembled from what Takode rebuilt. These tests check which
// parts are included for which facts and role, not the wording of each part.

const KEPT = { oldCwd: "/gone/repo-wt-1", cwd: "/new/repo-wt-1", branch: "repo-wt-1", ownBranchKept: true };
const FRESH = {
  oldCwd: "/gone/repo-wt-1",
  cwd: "/new/main-wt-2",
  branch: "main-wt-2",
  ownBranchKept: false,
  baseBranch: "main",
  previousBranch: "repo-wt-1",
  missingBase: { branch: "laptop-only", repoRoot: "/repo" },
};

describe("formatSessionRecoveryNotice", () => {
  it("names both folders and the kept branch, without context recovery while the conversation is intact", () => {
    const notice = formatSessionRecoveryNotice({ checkout: KEPT }, "standard", "7");
    expect(notice).toContain(KEPT.oldCwd);
    expect(notice).toContain(KEPT.cwd);
    expect(notice).toContain(`Kept: the commits on ${KEPT.branch}`);
    expect(notice).not.toContain("takode scan");
  });

  it("names what a fresh checkout started from and which branch it lost", () => {
    const notice = formatSessionRecoveryNotice({ checkout: FRESH }, "standard", "7");
    expect(notice).toContain(FRESH.branch);
    expect(notice).toContain(FRESH.previousBranch);
    expect(notice).toContain(FRESH.missingBase.branch);
  });

  it("gives a worker the standard recovery steps for a lost conversation", () => {
    const notice = formatSessionRecoveryNotice({ conversationLost: true }, "standard", "7");
    expect(notice).toContain("takode scan 7");
    expect(notice).not.toContain("leader-context-resume");
  });

  it("gives a leader the recycle recovery steps, together with the worktree facts", () => {
    const notice = formatSessionRecoveryNotice({ checkout: KEPT, conversationLost: true }, "leader", "7");
    expect(notice).toContain(KEPT.cwd);
    expect(notice).toContain("takode leader-context-resume 7");
  });
});
