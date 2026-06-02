import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillPath = fileURLToPath(new URL("../../.claude/skills/worktree-rules/SKILL.md", import.meta.url));

function readWorktreeRulesSkill(): string {
  return readFileSync(skillPath, "utf8");
}

describe("worktree-rules skill", () => {
  it("orders remote-backed branch mismatch stop before mutating pull commands", () => {
    const skill = readWorktreeRulesSkill();
    const branchCheck = "git -C <BASE_REPO> symbolic-ref --short HEAD";
    const mismatchStop = "If the current base-repo branch is not exactly `<BASE_BRANCH>`, stop";
    const pullCommand =
      "git -C <BASE_REPO> fetch origin <BASE_BRANCH> && git -C <BASE_REPO> pull --rebase origin <BASE_BRANCH>";

    // q-1466 regression coverage: agents often copy fenced command blocks
    // literally, so the mutating pull must not appear before the mismatch stop.
    expect(skill.indexOf(branchCheck)).toBeGreaterThanOrEqual(0);
    expect(skill.indexOf(mismatchStop)).toBeGreaterThan(skill.indexOf(branchCheck));
    expect(skill.indexOf(pullCommand)).toBeGreaterThan(skill.indexOf(mismatchStop));
  });
});
