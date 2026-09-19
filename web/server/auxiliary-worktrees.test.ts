import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryWorktreeRegistry } from "./auxiliary-worktree-registry.js";
import { AuxiliaryWorktreeLifecycle } from "./auxiliary-worktrees.js";
import type { WorktreeTracker } from "./worktree-tracker.js";
import { cleanupWorktree, createArchivedWorktreeCleanupQueue } from "./routes/worktree-cleanup.js";
import { registerAuxiliaryWorktreeRoutes } from "./routes/auxiliary-worktree-routes.js";
import { Hono } from "hono";
import type { RouteContext } from "./routes/context.js";
import { registerSessionsArchiveRoutes } from "./routes/sessions-archive-routes.js";
import { registerSessionDeleteRoute } from "./routes/sessions-delete-route.js";

let root: string;
let repo: string;
let registry: AuxiliaryWorktreeRegistry;
let lifecycle: AuxiliaryWorktreeLifecycle;
let owners: Array<{ sessionId: string; cwd: string; archived?: boolean }>;
let mappings: Array<{ sessionId: string; worktreePath: string }>;
let tracker: WorktreeTracker;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

function checkout(name = "auxiliary") {
  const path = join(root, name);
  git(repo, "worktree", "add", "-b", name, path, "main");
  return path;
}

beforeEach(() => {
  // Every Git write and destructive path is contained by this disposable root.
  root = mkdtempSync(join(tmpdir(), "auxiliary-lifecycle-test-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  git(repo, "-c", "init.templateDir=", "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.hooksPath", join(root, "no-hooks"));
  writeFileSync(join(repo, ".gitignore"), "environment/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-m", "Fixture base");
  registry = new AuxiliaryWorktreeRegistry(join(root, "metadata", "auxiliary-worktrees.json"));
  owners = [{ sessionId: "owner", cwd: repo, archived: false }];
  mappings = [];
  tracker = {
    auxiliary: registry,
    load: () => mappings,
    isWorktreeInUse: () => false,
    removeBySession: vi.fn(),
    getBySession: () => null,
  } as unknown as WorktreeTracker;
  lifecycle = new AuxiliaryWorktreeLifecycle(registry, () => owners, tracker);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("auxiliary checkout lifecycle", () => {
  it("persists multiple registrations and removes only clean temporary environments while preserving branches", async () => {
    const temporary = checkout();
    const retained = checkout("publication");
    mkdirSync(join(temporary, "environment"));
    writeFileSync(join(temporary, "environment", "cache"), "disposable dependency environment");
    await lifecycle.register("owner", temporary, "temporary", "main");
    await lifecycle.register("owner", retained, "retained");
    // A fresh instance observes authoritative metadata after restart.
    const restored = new AuxiliaryWorktreeRegistry(registry.path);
    expect(await restored.list("owner")).toHaveLength(2);
    await expect(lifecycle.cleanup("owner")).rejects.toThrow("archived");
    owners[0].archived = true;
    await lifecycle.cleanup("owner");
    expect(existsSync(temporary)).toBe(false);
    expect(existsSync(retained)).toBe(true);
    expect(git(repo, "rev-parse", "refs/heads/auxiliary")).toBe(git(repo, "rev-parse", "main"));
    expect(git(repo, "rev-parse", "refs/heads/publication")).toBe(git(repo, "rev-parse", "main"));
    expect((await restored.list("owner")).map((record) => record.cleanupStatus)).toEqual(["done", undefined]);
  });

  it("retains shared protection after the retaining session leaves the session catalog", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    owners.push({ sessionId: "shared", cwd: repo });
    await lifecycle.register("shared", path, "retained");
    owners = [owners[0]];
    owners[0].archived = true;
    await lifecycle.cleanup("owner");
    expect(existsSync(path)).toBe(true);
    expect((await registry.list("owner"))[0]).toMatchObject({
      cleanupStatus: "blocked",
      cleanupReason: expect.stringContaining("another session"),
    });
  });

  it.each([
    "dirty",
    "ahead",
    "detached-ahead",
    "locked",
    "missing-base",
    "primary",
    "active-alias",
    "changed-identity",
    "changed-branch",
    "corrupt-primary",
  ])("refuses unsafe %s cleanup without deleting the environment", async (reason) => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    if (reason === "dirty") writeFileSync(join(path, "untracked"), "keep");
    if (reason === "ahead" || reason === "detached-ahead") {
      if (reason === "detached-ahead") {
        git(path, "checkout", "--detach");
        await lifecycle.register("owner", path, "temporary", "main");
      }
      writeFileSync(join(path, "work"), "keep");
      git(path, "add", "work");
      git(path, "commit", "-m", "Unmerged work");
    }
    if (reason === "locked") git(repo, "worktree", "lock", path);
    if (reason === "missing-base") git(repo, "update-ref", "-d", "refs/heads/main");
    if (reason === "primary") mappings.push({ sessionId: "foreign-store-session", worktreePath: path });
    if (reason === "active-alias") {
      const alias = join(root, "alias");
      symlinkSync(path, alias);
      owners.push({ sessionId: "active", cwd: alias });
    }
    if (reason === "changed-identity") {
      renameSync(path, `${path}-preserved`);
      git(repo, "worktree", "prune");
      git(repo, "worktree", "add", path, "auxiliary");
    }
    if (reason === "changed-branch") git(path, "checkout", "-b", "another-branch");
    if (reason === "corrupt-primary")
      tracker.load = () => {
        throw new Error("Unreadable ownership metadata");
      };
    owners[0].archived = true;
    await lifecycle.cleanup("owner");
    expect(existsSync(path)).toBe(true);
    expect((await registry.list("owner"))[0]).toMatchObject({
      cleanupStatus: "blocked",
      cleanupReason: expect.any(String),
    });
  });

  it("requires explicit temporary safety metadata and rejects main or nested directories", async () => {
    const path = checkout();
    mkdirSync(join(path, "nested"));
    await expect(lifecycle.register("owner", repo, "retained")).rejects.toThrow("main repository");
    await expect(lifecycle.register("owner", join(path, "nested"), "retained")).rejects.toThrow("root");
    await expect(lifecycle.register("owner", path, "temporary")).rejects.toThrow("--base");
    await expect(lifecycle.register("owner", path, "temporary", "missing")).rejects.toThrow();
    expect(await registry.list()).toEqual([]);
  });

  it("serializes registrations across instances and fails closed on corrupt persisted metadata", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "retained");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = registry.update(async () => {
      entered();
      await gate;
    });
    await started;
    await expect(new AuxiliaryWorktreeRegistry(registry.path).update(async () => {})).rejects.toThrow("busy");
    release();
    await held;
    writeFileSync(registry.path, "{corrupt");
    owners[0].archived = true;
    await expect(lifecycle.cleanup("owner")).rejects.toThrow();
    expect(existsSync(path)).toBe(true);
  });

  it("preserves a registered retained checkout even through primary force cleanup", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "retained");
    const result = await cleanupWorktree(
      {
        sessionId: "other",
        worktreePath: path,
        repoRoot: repo,
        branch: "main",
        actualBranch: "auxiliary",
        createdAt: 1,
      },
      tracker,
      true,
    );
    expect(result).toMatchObject({ cleaned: false, reason: expect.stringContaining("retention") });
    expect(existsSync(path)).toBe(true);
  });

  it("preserves a managed primary branch when the archive helper removes its checkout", async () => {
    // Covers the actual Git effect, beyond the legacy route mock expectations.
    const path = checkout();
    const result = await cleanupWorktree(
      {
        sessionId: "owner",
        worktreePath: path,
        repoRoot: repo,
        branch: "main",
        actualBranch: "auxiliary",
        createdAt: 1,
      },
      tracker,
      true,
    );
    expect(result).toMatchObject({ cleaned: true });
    expect(existsSync(path)).toBe(false);
    expect(git(repo, "rev-parse", "refs/heads/auxiliary")).toBe(git(repo, "rev-parse", "main"));
  });

  it("queues nonblocking archive cleanup for a session whose primary directory is not a worktree", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    owners[0].archived = true;
    const pending = new Map<string, Promise<void>>();
    const launcher = { getSession: () => owners[0], setWorktreeCleanupState: vi.fn() };
    const queue = createArchivedWorktreeCleanupQueue({
      launcher,
      pendingWorktreeCleanups: pending,
      worktreeTracker: tracker,
      auxiliary: lifecycle,
    });
    expect(queue("owner")).toMatchObject({ status: "pending" });
    expect(pending.has("owner")).toBe(true);
    await pending.get("owner");
    expect(existsSync(path)).toBe(false);
    expect(launcher.setWorktreeCleanupState).toHaveBeenLastCalledWith(
      "owner",
      expect.objectContaining({ status: "done" }),
    );
  });

  it("rejects unarchive while cleanup is queued and rechecks retirement before deleting", async () => {
    // Explicit gates exercise the race without sleeps or timing assumptions.
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    owners[0].archived = true;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = registry.update(async () => {
      enter();
      await gate;
    });
    await entered;
    const cleaning = lifecycle.cleanup("owner");
    const app = new Hono();
    const relaunch = vi.fn();
    registerSessionsArchiveRoutes(app, {
      resolveId: (id: string) => id,
      launcher: { getSession: () => owners[0], relaunch },
      isAuxiliaryCleanupPending: (id: string) => lifecycle.isCleaning(id),
    } as any);
    expect((await app.request("/sessions/owner/unarchive", { method: "POST" })).status).toBe(409);
    expect(relaunch).not.toHaveBeenCalled();
    owners[0].archived = false;
    const rejected = expect(cleaning).rejects.toThrow("archived");
    release();
    await holding;
    await rejected;
    expect(existsSync(path)).toBe(true);
  });
});

describe("auxiliary worktree routes", () => {
  it("refuses permanent session deletion before killing when temporary ownership metadata still needs resolution", async () => {
    // A rejected delete must leave both session lifecycle and checkout intact.
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    const kill = vi.fn();
    const app = new Hono();
    registerSessionDeleteRoute(
      app,
      {
        resolveId: (id: string) => id,
        launcher: { kill },
      } as unknown as RouteContext,
      new Map(),
      lifecycle,
    );
    const response = await app.request("/sessions/owner", { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(true);
    expect(owners[0].archived).toBe(false);
  });
  it("lets the leader retry an exact blocked temporary checkout after its work is preserved", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main");
    owners[0].archived = true;
    writeFileSync(join(path, "untracked"), "keep");
    const app = new Hono();
    registerAuxiliaryWorktreeRoutes(
      app,
      {
        resolveId: (id: string) => id,
        authenticateTakodeCaller: () => ({ callerId: "leader", caller: {} }),
      } as unknown as RouteContext,
      lifecycle,
    );
    const retry = () =>
      app.request("/sessions/owner/worktrees/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
    expect((await retry()).status).toBe(409);
    // Fixture-owned work is committed and merged, not discarded to pass the gate.
    git(path, "add", "untracked");
    git(path, "commit", "-m", "Preserve fixture work");
    git(repo, "merge", "--ff-only", "auxiliary");
    expect((await retry()).status).toBe(200);
    expect(existsSync(path)).toBe(false);
    expect(git(repo, "rev-parse", "auxiliary")).toBe(git(repo, "rev-parse", "main"));
  });
  it("authenticates registration ownership and returns only operational session metadata", async () => {
    const path = checkout();
    const app = new Hono();
    const ctx = {
      resolveId: (id: string) => id,
      authenticateTakodeCaller: (c: any, options?: { requireOrchestrator?: boolean }) => {
        if (!c.req.header("fixture-auth")) return { response: c.json({ error: "unauthorized" }, 403) };
        if (options?.requireOrchestrator) return { response: c.json({ error: "leader only" }, 403) };
        return { callerId: "owner", caller: { injectedSystemPrompt: "private".repeat(10000) } };
      },
    } as unknown as RouteContext;
    registerAuxiliaryWorktreeRoutes(app, ctx, lifecycle);
    const request = (id: string, body: object, auth = true) =>
      app.request(`/sessions/${id}/worktrees`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { "fixture-auth": "yes" } : {}) },
        body: JSON.stringify(body),
      });
    expect((await request("owner", { path, retention: "retained" }, false)).status).toBe(403);
    expect((await request("other", { path, retention: "retained" })).status).toBe(403);
    expect((await request("owner", { path })).status).toBe(400);
    expect((await request("owner", { path, retention: "retained" })).status).toBe(200);
    const response = await app.request("/sessions/owner/worktrees", { headers: { "fixture-auth": "yes" } });
    const text = await response.text();
    expect(text).toContain('"retention":"retained"');
    expect(text).not.toContain("gitDir");
    expect(text).not.toContain("identity");
    expect(text).not.toContain("private".repeat(100));
    expect(
      (await app.request("/sessions/owner/worktrees/cleanup", { method: "POST", headers: { "fixture-auth": "yes" } }))
        .status,
    ).toBe(403);
  });
});
