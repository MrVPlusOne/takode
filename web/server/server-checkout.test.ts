import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerCheckout, readServerCheckoutStatus } from "./server-checkout.js";

/**
 * The server checkout tests use real Git repositories under a temporary root:
 * an "origin" repository standing in for the remote branch that landings push
 * to, and a clone of it standing in for the server's own checkout.
 */
describe("server checkout", () => {
  let root: string;
  let origin: string;
  let checkout: string;

  function git(dir: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
  }

  function commit(dir: string, file: string, content: string): string {
    writeFileSync(join(dir, file), content);
    git(dir, "add", file);
    git(dir, "commit", "--quiet", "-m", `change ${file}`);
    return git(dir, "rev-parse", "HEAD");
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "server-checkout-"));
    origin = join(root, "origin");
    checkout = join(root, "checkout");
    git(root, "init", "--quiet", "-b", "main", origin);
    git(origin, "config", "user.email", "test@example.com");
    git(origin, "config", "user.name", "Test");
    commit(origin, "a.txt", "one\n");
    git(root, "clone", "--quiet", origin, checkout);
    git(checkout, "config", "user.email", "test@example.com");
    git(checkout, "config", "user.name", "Test");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A stand-in for the frozen install that records when it ran and can be made to fail. */
  function fakeInstall(failure?: string) {
    const install = vi.fn(async () => {
      if (failure) throw new Error(failure);
    });
    return install;
  }

  function serverCheckoutAt(runningCommit: string | null, install = fakeInstall()) {
    return createServerCheckout({ dir: checkout, runningCommit, installDependencies: install });
  }

  it("fast-forwards a clean checkout that is only behind, then installs, so a restart loads the landed commits", async () => {
    const running = git(checkout, "rev-parse", "HEAD");
    const landed = commit(origin, "b.txt", "two\n");
    const install = vi.fn(async () => {
      // The install runs against the fast-forwarded checkout, so a landed dependency change is installed.
      expect(git(checkout, "rev-parse", "HEAD")).toBe(landed);
    });
    const serverCheckout = serverCheckoutAt(running, install);

    // Before the restart, Settings sees the branch moved on (the fetch is part of the status read).
    const before = await serverCheckout.status();
    expect(before).toMatchObject({
      state: "behind",
      behind: 1,
      ahead: 0,
      localChanges: false,
      upstream: "origin/main",
    });
    expect(before.upstreamHead).toBe(landed);

    const update = await serverCheckout.updateBeforeRestart();
    expect(update).toMatchObject({ action: "updated", from: running, error: null });
    expect(update.status).toMatchObject({ state: "current", head: landed, runningCommit: running, behind: 0 });
    expect(install).toHaveBeenCalledTimes(1);
    expect(git(checkout, "rev-parse", "HEAD")).toBe(landed);
    expect(git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("still installs when the checkout is already current, e.g. after a manual pull without an install", async () => {
    const install = fakeInstall();
    const update = await serverCheckoutAt(null, install).updateBeforeRestart();
    expect(update).toMatchObject({ action: "unchanged", from: null, error: null, status: { state: "current" } });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("blocks on uncommitted changes and leaves the checkout untouched", async () => {
    const head = git(checkout, "rev-parse", "HEAD");
    commit(origin, "b.txt", "two\n");
    writeFileSync(join(checkout, "a.txt"), "local edit\n");
    const install = fakeInstall();

    const update = await serverCheckoutAt(head, install).updateBeforeRestart();
    expect(update).toMatchObject({ action: "blocked", from: null });
    expect(update.error).toContain("uncommitted changes");
    expect(update.status).toMatchObject({ state: "behind", behind: 1, localChanges: true });
    expect(install).not.toHaveBeenCalled();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
    expect(git(checkout, "status", "--porcelain")).toContain("a.txt");
  });

  it("blocks on uncommitted changes even when the checkout is current", async () => {
    // The restart would otherwise load edits that are on no branch.
    writeFileSync(join(checkout, "a.txt"), "local edit\n");
    const update = await serverCheckoutAt(null).updateBeforeRestart();
    expect(update.action).toBe("blocked");
    expect(update.status.state).toBe("current");
  });

  it("does not count untracked files as local changes", async () => {
    commit(origin, "b.txt", "two\n");
    writeFileSync(join(checkout, "notes.txt"), "scratch\n");

    const update = await serverCheckoutAt(null).updateBeforeRestart();
    expect(update.action).toBe("updated");
  });

  it("blocks when the fast-forward itself fails, e.g. an untracked file in the way", async () => {
    const head = git(checkout, "rev-parse", "HEAD");
    commit(origin, "b.txt", "two\n");
    writeFileSync(join(checkout, "b.txt"), "untracked copy\n");
    const install = fakeInstall();

    const update = await serverCheckoutAt(head, install).updateBeforeRestart();
    expect(update.action).toBe("blocked");
    expect(update.error).toContain("Could not fast-forward the server checkout (main) to origin/main");
    expect(install).not.toHaveBeenCalled();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
  });

  it("blocks when the install fails, saying the checkout was already fast-forwarded", async () => {
    const running = git(checkout, "rev-parse", "HEAD");
    const landed = commit(origin, "b.txt", "two\n");

    const update = await serverCheckoutAt(
      running,
      fakeInstall("lockfile had changes, but lockfile is frozen"),
    ).updateBeforeRestart();
    expect(update).toMatchObject({ action: "blocked", from: running, status: { head: landed } });
    expect(update.error).toBe(
      `Installing dependencies failed after fast-forwarding the server checkout to ${landed.slice(0, 8)}: lockfile had changes, but lockfile is frozen`,
    );
  });

  it("never rewrites local commits: a diverged checkout blocks and stays as it is", async () => {
    commit(origin, "b.txt", "two\n");
    const local = commit(checkout, "c.txt", "local\n");

    const update = await serverCheckoutAt(local).updateBeforeRestart();
    expect(update.action).toBe("blocked");
    expect(update.error).toBe(
      "The server checkout (main) has 1 local commit not on origin/main and lacks 1 commit from it. Merge or rebase it.",
    );
    expect(update.status).toMatchObject({ state: "diverged", ahead: 1, behind: 1 });
    expect(git(checkout, "rev-parse", "HEAD")).toBe(local);
  });

  it("blocks a checkout that is only ahead of its branch", async () => {
    const local = commit(checkout, "c.txt", "local\n");
    const update = await serverCheckoutAt(local).updateBeforeRestart();
    expect(update).toMatchObject({ action: "blocked", status: { state: "ahead", ahead: 1 } });
    expect(update.error).toContain("1 local commit not on origin/main");
  });

  it("reports a checkout that is only ahead of its branch", async () => {
    commit(checkout, "c.txt", "local\n");
    const status = await readServerCheckoutStatus(checkout, { runningCommit: null, fetch: true });
    expect(status).toMatchObject({ state: "ahead", ahead: 1, behind: 0 });
  });

  it("blocks detached checkouts and branches without an upstream, leaving them alone", async () => {
    commit(origin, "b.txt", "two\n");
    const head = git(checkout, "rev-parse", "HEAD");
    const install = fakeInstall();

    git(checkout, "checkout", "--quiet", "-b", "local-only");
    const noUpstream = await serverCheckoutAt(head, install).updateBeforeRestart();
    expect(noUpstream).toMatchObject({ action: "blocked", status: { state: "no-upstream" } });
    expect(noUpstream.error).toContain("(local-only) tracks no remote branch");

    git(checkout, "checkout", "--quiet", "--detach", head);
    const detached = await serverCheckoutAt(head, install).updateBeforeRestart();
    expect(detached).toMatchObject({ action: "blocked", status: { state: "detached", branch: null } });
    expect(detached.error).toContain("is not on a branch");
    expect(install).not.toHaveBeenCalled();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
  });

  it("reports not-git when there is no commit to run from, and a restart then goes ahead untouched", async () => {
    const plain = join(root, "plain");
    git(root, "init", "--quiet", plain);
    // A repository without commits has no HEAD to report either.
    expect((await readServerCheckoutStatus(plain, { runningCommit: null, fetch: true })).state).toBe("not-git");

    // A package install has no checkout to follow: no install, no block.
    const install = fakeInstall();
    const update = await createServerCheckout({
      dir: plain,
      runningCommit: null,
      installDependencies: install,
    }).updateBeforeRestart();
    expect(update).toMatchObject({ action: "unchanged", error: null, status: { state: "not-git" } });
    expect(install).not.toHaveBeenCalled();
  });

  it("blocks on a failed fetch rather than restarting onto possibly older code", async () => {
    const head = git(checkout, "rev-parse", "HEAD");
    commit(origin, "b.txt", "two\n");
    git(checkout, "fetch", "--quiet");
    git(checkout, "remote", "set-url", "origin", join(root, "missing"));

    const update = await serverCheckoutAt(null).updateBeforeRestart();
    expect(update.action).toBe("blocked");
    expect(update.error).toMatch(/^Could not fetch origin\/main \(.+\), so the checkout may be behind it\./);
    // The status still compares with the last fetched state.
    expect(update.status).toMatchObject({ state: "behind", behind: 1 });
    expect(update.status.fetchError).toBeTruthy();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
  });

  it("caches a fetched status briefly unless asked to refresh", async () => {
    let clock = 1_000;
    const serverCheckout = createServerCheckout({
      dir: checkout,
      runningCommit: null,
      installDependencies: fakeInstall(),
      now: () => clock,
    });
    expect((await serverCheckout.status()).state).toBe("current");

    commit(origin, "b.txt", "two\n");
    clock += 1_000;
    expect((await serverCheckout.status()).state).toBe("current");
    expect((await serverCheckout.status({ refresh: true })).state).toBe("behind");

    commit(origin, "c.txt", "three\n");
    clock += 61_000;
    expect((await serverCheckout.status()).behind).toBe(2);
  });
});
