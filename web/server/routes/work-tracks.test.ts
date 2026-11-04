import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkTrackStore } from "../work-track-store.js";
import type { RouteContext } from "./context.js";
import { createWorkTrackRoutes } from "./work-tracks.js";

/**
 * `takode track` routes against a real repository: a leader declares a track on
 * a branch it already has a checkout of (adopted, so nothing is created outside
 * the disposable root), list and show report workers and drift, and only the
 * declaring leader closes it. Workers are sessions whose port target names the track.
 */
let root: string;
let repo: string;
let checkout: string;
let store: WorkTrackStore;
let sessions: Array<Record<string, unknown>>;

function git(cwd: string, ...args: string[]): string {
  const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
  return execFileSync("git", [...identity, "-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

function app(callerId: string, options: { orchestrator?: boolean } = {}) {
  const api = new Hono();
  const ctx = {
    authenticateTakodeCaller: (c: any, auth?: { requireOrchestrator?: boolean }) =>
      auth?.requireOrchestrator && options.orchestrator === false
        ? { response: c.json({ error: "leaders only" }, 403) }
        : { callerId, caller: { sessionId: callerId } },
    launcher: {
      listSessions: () => sessions,
      getSessionNum: (id: string) => ({ "leader-a": 10, "leader-b": 20 })[id],
    },
    wsBridge: { getSession: (id: string) => (id === "worker-1" ? { state: { claimedQuestId: "q-5" } } : undefined) },
    options: { hostExec: { findMachine: async () => ({ id: "local", name: "devbox" }) } },
  } as unknown as RouteContext;
  api.route("/", createWorkTrackRoutes(ctx, store));
  return api;
}

const post = (api: Hono, url: string, body: object = {}) =>
  api.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "work-track-routes-")));
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  repo = join(root, "project");
  execFileSync("git", ["clone", origin, repo], { stdio: "pipe" });
  git(repo, "checkout", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-m", "base");
  git(repo, "push", "-u", "origin", "main");
  checkout = join(root, "evals-checkout");
  git(repo, "worktree", "add", "-b", "evals", checkout);
  // main moves on after the track branch was cut.
  writeFileSync(join(repo, "b.txt"), "b\n");
  git(repo, "add", "b.txt");
  git(repo, "commit", "-m", "later");
  git(repo, "push", "origin", "main");
  store = new WorkTrackStore("test", join(root, "store"));
  sessions = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("work track routes", () => {
  it("declares a track, then lists its workers and how far behind main it is", async () => {
    const leader = app("leader-a");
    const added = await post(leader, "/takode/tracks", { name: "fv", repo: checkout, branch: "evals" });
    expect(added.status).toBe(201);
    const { track } = await added.json();
    // The repository root and default branch come from Git; the existing checkout is adopted.
    expect(track).toMatchObject({
      name: "fv",
      repo: "project",
      branch: "evals",
      follows: "main",
      owner: 10,
      machine: "devbox",
      repoRoot: repo,
      checkoutPath: checkout,
      createdCheckout: false,
      status: { behind: 1 },
    });

    sessions = [
      { sessionId: "worker-1", sessionNum: 31, worktreePortTarget: { branch: "evals", track: "fv" } },
      { sessionId: "worker-2", sessionNum: 32, archived: true, worktreePortTarget: { track: "fv" } },
      { sessionId: "worker-3", sessionNum: 33, worktreePortTarget: { branch: "main" } },
    ];
    const listed = await (await app("worker-1").request("/takode/tracks")).json();
    expect(listed.tracks).toEqual([
      expect.objectContaining({
        name: "fv",
        workers: [{ sessionNum: 31, questId: "q-5" }],
        status: expect.any(Object),
      }),
    ]);
    // Paths stay out of the compact list.
    expect(listed.tracks[0].checkoutPath).toBeUndefined();
    const filtered = await (
      await leader.request(`/takode/tracks?status=0&repoRoot=${encodeURIComponent(repo)}`)
    ).json();
    expect(filtered.tracks.map((entry: { name: string }) => entry.name)).toEqual(["fv"]);
    expect(filtered.tracks[0].status).toBeUndefined();
  });

  it("refuses a duplicate name, a branch that already has a track, and non-leaders", async () => {
    const leader = app("leader-a");
    expect((await post(leader, "/takode/tracks", { name: "fv", repo, branch: "evals" })).status).toBe(201);
    expect((await post(leader, "/takode/tracks", { name: "FV", repo, branch: "other" })).status).toBe(409);
    expect((await post(leader, "/takode/tracks", { name: "fv2", repo, branch: "evals" })).status).toBe(409);
    expect((await post(leader, "/takode/tracks", { name: "bad name", repo, branch: "x" })).status).toBe(400);
    expect(
      (await post(app("w", { orchestrator: false }), "/takode/tracks", { name: "w", repo, branch: "x" })).status,
    ).toBe(403);
  });

  it("pulls the checkout for a spawn, and lets only the declaring leader close the track", async () => {
    await post(app("leader-a"), "/takode/tracks", { name: "fv", repo, branch: "evals" });
    // The branch is not on origin yet, so there is nothing to pull and no warning.
    expect(await (await post(app("leader-b"), "/takode/tracks/fv/pull")).json()).toEqual({});

    expect((await post(app("leader-b"), "/takode/tracks/fv/close")).status).toBe(403);
    const closed = await post(app("leader-a"), "/takode/tracks/fv/close");
    expect(closed.status).toBe(200);
    // An adopted checkout is someone else's: it stays, and so does the branch.
    expect((await closed.json()).keptCheckout).toBe("it was an existing checkout");
    expect(git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("evals");
    expect((await app("leader-a").request("/takode/tracks/fv")).status).toBe(404);
    const withClosed = await (await app("leader-a").request("/takode/tracks?closed=1")).json();
    expect(withClosed.tracks).toEqual([expect.objectContaining({ name: "fv", closedAt: expect.any(Number) })]);
    // The name is free again once closed.
    expect((await post(app("leader-a"), "/takode/tracks", { name: "fv", repo, branch: "evals" })).status).toBe(201);
  });
});
