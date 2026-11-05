import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuestmasterTask } from "../quest-types.js";
import { workerCommitsLanded } from "./quest-completion-checks.js";

/**
 * Final completion refused quests whose work went to an approved published branch instead of the
 * worker's comparison target: a worker started from `main`, and the user later had the change pushed
 * to a personal branch, often as a clean squashed PR branch. The worker's commits stayed "ahead" of
 * `main` forever, so every such quest needed the leader's recovery override. `workerCommitsLanded`
 * now also accepts a checkout whose content is on a published head one of the worker's recorded
 * deliveries was verified on. Checked in a real repository.
 */

let repo: string;
const git = (command: string) => execSync(`git ${command}`, { cwd: repo, stdio: "pipe" }).toString().trim();
const commit = (file: string, content: string, message: string) => {
  writeFileSync(join(repo, file), content);
  git(`add ${file}`);
  git(`commit -q -m "${message}"`);
};
const state = () => ({ cwd: repo, diff_base_branch: "main" });

/** A quest with one recorded delivery to an approved published branch whose head is `sha`. */
function questDeliveredTo(sha: string, actorSessionId = "worker-1"): QuestmasterTask {
  return {
    codeDeliveries: [
      {
        id: "d".repeat(32),
        recordedAt: 0,
        actorSessionId,
        phaseOccurrenceId: "work-1",
        targetHeadSha: sha,
        commits: [],
        target: {
          repoRoot: repo,
          checkoutPath: repo,
          branch: "chenfeng/config_cleanup",
          mode: "published",
          publication: {
            approvalId: "a".repeat(32),
            checkoutPath: repo,
            remote: "origin",
            repositoryUrl: "https://example.invalid/repo.git",
            refs: [{ ref: "refs/heads/chenfeng/config_cleanup", sha }],
            commitShas: [sha],
          },
        },
      },
    ],
  } as unknown as QuestmasterTask;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "published-delivery-"));
  git("init -q -b main");
  git("config user.email test@example.com");
  git("config user.name Test");
  commit("a.txt", "one\n", "base");
  // The worker's checkout: two working commits on top of main.
  git("checkout -q -b worker");
  commit("a.txt", "one\ntwo\n", "wip");
  commit("b.txt", "config\n", "more wip");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** A clean PR branch made afterwards from main, holding the worker's change as one squashed commit. */
function publishCleanBranch(): string {
  git("checkout -q -b chenfeng/config_cleanup main");
  git("merge -q --squash worker");
  git('commit -q -m "Config cleanup"');
  const head = git("rev-parse HEAD");
  git("checkout -q worker");
  return head;
}

describe("workerCommitsLanded with approved published deliveries", () => {
  it("accepts a checkout whose change is on the published clean branch", async () => {
    const head = publishCleanBranch();
    // Not on main: the plain comparison still sees the checkout ahead.
    await expect(workerCommitsLanded(state(), {} as QuestmasterTask, "worker-1")).resolves.toBe(false);
    await expect(workerCommitsLanded(state(), questDeliveredTo(head), "worker-1")).resolves.toBe(true);
  });

  it("still refuses commits the published branch does not hold", async () => {
    const head = publishCleanBranch();
    commit("c.txt", "unpublished\n", "left out of the PR");
    await expect(workerCommitsLanded(state(), questDeliveredTo(head), "worker-1")).resolves.toBe(false);
  });

  it("only counts deliveries the worker itself recorded", async () => {
    const head = publishCleanBranch();
    await expect(workerCommitsLanded(state(), questDeliveredTo(head, "someone-else"), "worker-1")).resolves.toBe(false);
  });

  it("says no for a published head the checkout's repository does not have", async () => {
    const missing = "f".repeat(40);
    await expect(workerCommitsLanded(state(), questDeliveredTo(missing), "worker-1")).resolves.toBe(false);
  });
});
