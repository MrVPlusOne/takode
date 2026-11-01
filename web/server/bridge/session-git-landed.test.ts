import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutCommitsLanded } from "./session-git-state.js";

/**
 * After the landing queue lands a worker's change, the landed commits are rebased copies (batched
 * with other changes, maybe squashed) with other IDs. `checkoutCommitsLanded` tells such a checkout
 * apart from one whose changes are not on the target yet, in a real repository.
 */

let repo: string;
const git = (command: string) => execSync(`git ${command}`, { cwd: repo, stdio: "pipe" }).toString().trim();
const commit = (file: string, content: string, message: string) => {
  writeFileSync(join(repo, file), content);
  git(`add ${file}`);
  git(`commit -q -m "${message}"`);
};
const state = () => ({ cwd: repo, diff_base_branch: "target" });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "landed-commits-"));
  git("init -q -b target");
  git("config user.email test@example.com");
  git("config user.name Test");
  commit("a.txt", "one\ntwo\nthree\n", "base");
  git("checkout -q -b worker");
  commit("a.txt", "one\nTWO\nthree\n", "worker change");
  commit("b.txt", "new file\n", "worker second change");
  git("checkout -q target");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("checkoutCommitsLanded", () => {
  it("recognizes the worker's commits rebased onto the target among other changes", () => {
    // Another change lands first; the queue then puts the worker's commits on top as new commits.
    commit("c.txt", "someone else\n", "other change");
    git("cherry-pick worker~1 worker");
    commit("d.txt", "after\n", "later change");
    git("checkout -q worker");

    return expect(checkoutCommitsLanded(state())).resolves.toBe(true);
  });

  it("recognizes them squashed into one commit", () => {
    git("merge -q --squash worker");
    git('commit -q -m "squashed"');
    git("checkout -q worker");

    return expect(checkoutCommitsLanded(state())).resolves.toBe(true);
  });

  it("refuses a checkout with a commit whose change is not on the target", async () => {
    git("cherry-pick worker~1");
    git("checkout -q worker");
    // Only the first commit landed.
    await expect(checkoutCommitsLanded(state())).resolves.toBe(false);
    // Nor any of them.
    git("checkout -q target");
    git("reset -q --hard HEAD~1");
    git("checkout -q worker");
    await expect(checkoutCommitsLanded(state())).resolves.toBe(false);
  });

  it("says no when it cannot tell", async () => {
    await expect(checkoutCommitsLanded({ cwd: repo, diff_base_branch: "no-such-branch" })).resolves.toBe(false);
    await expect(checkoutCommitsLanded({ cwd: repo })).resolves.toBe(false);
  });
});
