import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerCheckout, readServerCheckoutStatus, rememberServerBuild } from "./server-checkout.js";

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

  it("fast-forwards a clean checkout that is only behind, so a restart loads the landed commits", async () => {
    const running = git(checkout, "rev-parse", "HEAD");
    const landed = commit(origin, "b.txt", "two\n");
    const serverCheckout = createServerCheckout({ dir: checkout, runningCommit: running });

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
    expect(git(checkout, "rev-parse", "HEAD")).toBe(landed);
    expect(git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("leaves a behind checkout with uncommitted changes untouched and reports it", async () => {
    const head = git(checkout, "rev-parse", "HEAD");
    commit(origin, "b.txt", "two\n");
    writeFileSync(join(checkout, "a.txt"), "local edit\n");

    const update = await createServerCheckout({ dir: checkout, runningCommit: head }).updateBeforeRestart();
    expect(update).toMatchObject({ action: "unchanged", from: null });
    expect(update.status).toMatchObject({ state: "behind", behind: 1, localChanges: true });
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
    expect(git(checkout, "status", "--porcelain")).toContain("a.txt");
  });

  it("does not count untracked files as local changes", async () => {
    commit(origin, "b.txt", "two\n");
    writeFileSync(join(checkout, "notes.txt"), "scratch\n");

    const update = await createServerCheckout({ dir: checkout, runningCommit: null }).updateBeforeRestart();
    expect(update.action).toBe("updated");
  });

  it("never rewrites local commits: a diverged checkout stays as it is", async () => {
    commit(origin, "b.txt", "two\n");
    const local = commit(checkout, "c.txt", "local\n");

    const update = await createServerCheckout({ dir: checkout, runningCommit: local }).updateBeforeRestart();
    expect(update.action).toBe("unchanged");
    expect(update.status).toMatchObject({ state: "diverged", ahead: 1, behind: 1 });
    expect(git(checkout, "rev-parse", "HEAD")).toBe(local);
  });

  it("reports a checkout that is only ahead of its branch", async () => {
    commit(checkout, "c.txt", "local\n");
    const status = await readServerCheckoutStatus(checkout, { runningCommit: null, fetch: true });
    expect(status).toMatchObject({ state: "ahead", ahead: 1, behind: 0 });
  });

  it("leaves detached checkouts and branches without an upstream alone", async () => {
    commit(origin, "b.txt", "two\n");
    const head = git(checkout, "rev-parse", "HEAD");

    git(checkout, "checkout", "--quiet", "-b", "local-only");
    expect(
      (await createServerCheckout({ dir: checkout, runningCommit: head }).updateBeforeRestart()).status.state,
    ).toBe("no-upstream");

    git(checkout, "checkout", "--quiet", "--detach", head);
    const update = await createServerCheckout({ dir: checkout, runningCommit: head }).updateBeforeRestart();
    expect(update).toMatchObject({ action: "unchanged", status: { state: "detached", branch: null } });
    expect(git(checkout, "rev-parse", "HEAD")).toBe(head);
  });

  it("reports not-git when there is no commit to run from", async () => {
    const plain = join(root, "plain");
    git(root, "init", "--quiet", plain);
    // A repository without commits has no HEAD to report either.
    expect((await readServerCheckoutStatus(plain, { runningCommit: null, fetch: true })).state).toBe("not-git");
  });

  it("reports a failed fetch and compares with the last fetched state", async () => {
    commit(origin, "b.txt", "two\n");
    git(checkout, "fetch", "--quiet");
    git(checkout, "remote", "set-url", "origin", join(root, "missing"));

    const update = await createServerCheckout({ dir: checkout, runningCommit: null }).updateBeforeRestart();
    // The last fetched state already shows the checkout behind, so the fast-forward still happens.
    expect(update.action).toBe("updated");
    expect(update.status.fetchError).toBeTruthy();
    expect(update.status.state).toBe("current");
  });

  it("caches a fetched status briefly unless asked to refresh", async () => {
    let clock = 1_000;
    const serverCheckout = createServerCheckout({ dir: checkout, runningCommit: null, now: () => clock });
    expect((await serverCheckout.status()).state).toBe("current");

    commit(origin, "b.txt", "two\n");
    clock += 1_000;
    expect((await serverCheckout.status()).state).toBe("current");
    expect((await serverCheckout.status({ refresh: true })).state).toBe("behind");

    commit(origin, "c.txt", "three\n");
    clock += 61_000;
    expect((await serverCheckout.status()).behind).toBe(2);
  });

  it("lists the commits a restart would load, newest first, and those the current build added", async () => {
    // The server runs `running`; two landings since then reached the branch.
    const previous = git(checkout, "rev-parse", "HEAD");
    const running = commit(origin, "b.txt", "two\n");
    git(checkout, "pull", "--quiet", "--ff-only");
    const firstLanding = commit(origin, "c.txt", "three\n");
    const secondLanding = commit(origin, "d.txt", "four\n");
    const serverCheckout = createServerCheckout({
      dir: checkout,
      runningCommit: running,
      previousBuild: { commit: previous, replacedAt: 5 },
    });

    const changes = await serverCheckout.changes(await serverCheckout.status());
    expect(changes.incoming.total).toBe(2);
    expect(changes.incoming.changes.map((change) => [change.sha, change.subject])).toEqual([
      [secondLanding, "change d.txt"],
      [firstLanding, "change c.txt"],
    ]);
    expect(changes.incoming.changes[0].committedAt).toBeGreaterThan(0);
    expect(changes.currentBuild).toMatchObject({ commit: previous, replacedAt: 5, total: 1 });
    expect(changes.currentBuild?.changes.map((change) => change.sha)).toEqual([running]);

    // Once fast-forwarded, a restart loads the checkout itself, so the same commits stay listed.
    await serverCheckout.updateBeforeRestart();
    const afterUpdate = await serverCheckout.changes(await serverCheckout.status());
    expect(afterUpdate.incoming.changes.map((change) => change.sha)).toEqual([secondLanding, firstLanding]);
  });

  it("lists no incoming commits when a restart would load the running commit", async () => {
    commit(origin, "b.txt", "two\n");
    commit(checkout, "c.txt", "local\n");
    const head = git(checkout, "rev-parse", "HEAD");
    // A diverged checkout is not fast-forwarded, so a restart loads what already runs.
    const serverCheckout = createServerCheckout({ dir: checkout, runningCommit: head });
    const changes = await serverCheckout.changes(await serverCheckout.status());
    expect(changes).toEqual({ incoming: { changes: [], total: 0 }, currentBuild: null });
  });

  it("remembers the build the server ran before, across restarts onto the same commit", async () => {
    const file = join(root, "server-build.json");
    // The first start has nothing to compare with.
    expect(await rememberServerBuild(file, "a".repeat(40), 1)).toBeNull();
    expect(await rememberServerBuild(file, "a".repeat(40), 2)).toBeNull();
    // A restart onto new code records the old build as the previous one.
    expect(await rememberServerBuild(file, "b".repeat(40), 3)).toEqual({ commit: "a".repeat(40), replacedAt: 3 });
    // Restarting again onto the same code keeps showing what that build brought in.
    expect(await rememberServerBuild(file, "b".repeat(40), 4)).toEqual({ commit: "a".repeat(40), replacedAt: 3 });
    // An unknown running commit leaves the record alone.
    expect(await rememberServerBuild(file, null, 5)).toEqual({ commit: "a".repeat(40), replacedAt: 3 });
    expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject({ commit: "b".repeat(40) });
  });
});
