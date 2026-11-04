import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureWorktreeAsync } from "./git-utils.js";
import { verifyReplacementWorkEvidence } from "./work-evidence-replacement.js";
import { prepareTrackCheckout, pullTrackCheckout, readTrackStatus, removeTrackCheckout } from "./work-tracks.js";

/**
 * The Git side of tracks, against a real repository with a bare `origin`, all
 * under a disposable root, track checkouts included.
 */
let root: string;
let origin: string;
let repo: string;
let tracksRoot: string;

function git(cwd: string, ...args: string[]): string {
  const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
  return execFileSync("git", [...identity, "-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

function commit(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), `${file}\n`);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", file);
  return git(cwd, "rev-parse", "HEAD");
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "work-tracks-")));
  tracksRoot = join(root, "tracks");
  origin = join(root, "origin.git");
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  repo = join(root, "project");
  execFileSync("git", ["clone", origin, repo], { stdio: "pipe" });
  git(repo, "checkout", "-b", "main");
  commit(repo, "base.txt");
  git(repo, "push", "-u", "origin", "main");
  // An integration branch someone already pushed.
  git(repo, "branch", "evals");
  git(repo, "push", "origin", "evals");
  git(repo, "branch", "-D", "evals");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("track checkouts", () => {
  it("makes a checkout of a branch that exists only on origin, tracking it", async () => {
    const result = await prepareTrackCheckout({
      repoRoot: repo,
      name: "fv",
      branch: "evals",
      follows: "main",
      tracksRoot,
    });
    expect(result).toEqual({ checkoutPath: join(tracksRoot, "project", "fv"), createdCheckout: true });
    expect(git(result.checkoutPath, "symbolic-ref", "--short", "HEAD")).toBe("evals");
    expect(git(result.checkoutPath, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/evals");
  });

  it("adopts a checkout already on the branch instead of making a second one", async () => {
    git(repo, "worktree", "add", join(root, "mine"), "-b", "local-line");
    const result = await prepareTrackCheckout({
      repoRoot: repo,
      name: "line",
      branch: "local-line",
      follows: "main",
      tracksRoot,
    });
    expect(result).toEqual({ checkoutPath: join(root, "mine"), createdCheckout: false });
  });

  it("starts a missing branch from the followed branch only when asked", async () => {
    await expect(
      prepareTrackCheckout({ repoRoot: repo, name: "new", branch: "new-line", follows: "main", tracksRoot }),
    ).rejects.toThrow("add --create");
    const result = await prepareTrackCheckout({
      repoRoot: repo,
      name: "new",
      branch: "new-line",
      follows: "main",
      create: true,
      tracksRoot,
    });
    expect(git(result.checkoutPath, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"));
  });

  it("counts commits on the followed branch the track lacks, after fetching", async () => {
    const { checkoutPath } = await prepareTrackCheckout({
      repoRoot: repo,
      name: "fv",
      branch: "evals",
      follows: "main",
      tracksRoot,
    });
    commit(repo, "one.txt");
    commit(repo, "two.txt");
    git(repo, "push", "origin", "main");
    const status = await readTrackStatus({ checkoutPath, branch: "evals", follows: "main" });
    expect(status.behind).toBe(2);
    expect(status.lastCommitAt).toBeGreaterThan(0);
    expect(status.fetchError).toBeUndefined();
  });

  it("fast-forwards the checkout to what landed, and only warns when it cannot", async () => {
    const { checkoutPath } = await prepareTrackCheckout({
      repoRoot: repo,
      name: "fv",
      branch: "evals",
      follows: "main",
      tracksRoot,
    });
    // Another machine lands on the track branch.
    const other = join(root, "other");
    execFileSync("git", ["clone", "-b", "evals", origin, other], { stdio: "pipe" });
    const landed = commit(other, "landed.txt");
    git(other, "push", "origin", "evals");
    expect(await pullTrackCheckout({ checkoutPath, branch: "evals" })).toEqual({});
    expect(git(checkoutPath, "rev-parse", "HEAD")).toBe(landed);

    // A local commit the remote lacks: the worker starts from the checkout as it is.
    commit(checkoutPath, "local.txt");
    commit(other, "more.txt");
    git(other, "push", "origin", "evals");
    expect((await pullTrackCheckout({ checkoutPath, branch: "evals" })).warning).toContain("could not fast-forward");
  });

  it("removes a clean checkout and keeps the branch", async () => {
    const { checkoutPath } = await prepareTrackCheckout({
      repoRoot: repo,
      name: "fv",
      branch: "evals",
      follows: "main",
      tracksRoot,
    });
    writeFileSync(join(checkoutPath, "scratch.txt"), "work\n");
    await expect(removeTrackCheckout({ repoRoot: repo, checkoutPath })).rejects.toThrow();
    rmSync(join(checkoutPath, "scratch.txt"));
    await removeTrackCheckout({ repoRoot: repo, checkoutPath });
    expect(existsSync(checkoutPath)).toBe(false);
    expect(git(repo, "rev-parse", "--verify", "refs/heads/evals")).toBeTruthy();
  });

  // The whole path a track worker takes, with the real helpers spawn and delivery use:
  // a worktree based on the track checkout, a port into that checkout with a push, and
  // the ordinary Work-evidence check against the track port target.
  it("lets a worker start from the track, land into it and have its commit verified", async () => {
    const { checkoutPath } = await prepareTrackCheckout({
      repoRoot: repo,
      name: "fv",
      branch: "evals",
      follows: "main",
      tracksRoot,
    });
    const worker = await ensureWorktreeAsync(repo, "evals", { forceNew: true, worktreeRoot: join(root, "worktrees") });
    expect(worker.actualBranch).toMatch(/^evals-wt-/);
    const workerSha = commit(worker.worktreePath, "change.txt");

    // /port-changes, remote-backed with the track checkout as the base repo checkout.
    git(checkoutPath, "cherry-pick", workerSha);
    const targetSha = git(checkoutPath, "rev-parse", "HEAD");
    git(checkoutPath, "push", "origin", `${targetSha}:refs/heads/evals`);
    expect(git(repo, "ls-remote", "origin", "refs/heads/evals").split(/\s/)[0]).toBe(targetSha);

    const verified = await verifyReplacementWorkEvidence(
      {
        isWorktree: true,
        worktreePortTarget: { repoRoot: repo, branch: "evals", worktreePath: checkoutPath },
      },
      [targetSha],
    );
    expect(verified).toMatchObject({ checkoutPath, branch: "evals", commitShas: [targetSha] });
  });
});
