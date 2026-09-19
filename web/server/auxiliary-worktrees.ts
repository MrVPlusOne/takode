import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { AuxiliaryWorktreeRegistration, AuxiliaryWorktreeRegistry } from "./auxiliary-worktree-registry.js";
import type { WorktreeTracker } from "./worktree-tracker.js";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const exec = promisify(execFile);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(
        key,
      )
    )
      delete env[key];
  }
  // Paths/refs are argv, never shell programs; Git failure is a cleanup veto.
  const { stdout } = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", cwd, ...args], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
  return stdout.trim();
}

export async function canonicalWorktreePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}

export function pathsOverlap(a: string, b: string): boolean {
  const contains = (parent: string, child: string) => {
    const rel = relative(resolve(parent), resolve(child));
    return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"));
  };
  return contains(a, b) || contains(b, a);
}

export async function inspectAuxiliaryWorktree(path: string) {
  const worktreePath = await realpath(path);
  const root = await realpath(await git(worktreePath, "rev-parse", "--show-toplevel"));
  if (root !== worktreePath) throw new Error("Register the worktree root, not a subdirectory");
  const gitDir = await realpath(await git(worktreePath, "rev-parse", "--absolute-git-dir"));
  const commonDir = await realpath(await git(worktreePath, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  if (gitDir === commonDir) throw new Error("The main repository cannot be registered as an auxiliary worktree");
  const listing = await git(worktreePath, "worktree", "list", "--porcelain", "-z");
  const first = listing.split("\0")[0];
  if (!first.startsWith("worktree ")) throw new Error("Git worktree registry could not be resolved");
  const repoRoot = await realpath(first.slice("worktree ".length));
  const [worktreeStat, gitStat] = await Promise.all([
    stat(worktreePath, { bigint: true }),
    stat(gitDir, { bigint: true }),
  ]);
  const branch = await git(worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
  return {
    worktreePath,
    repoRoot,
    gitDir,
    identity: `${worktreeStat.dev}:${worktreeStat.ino}:${gitStat.dev}:${gitStat.ino}`,
    branch: branch === "HEAD" ? null : branch,
  };
}

interface WorktreeOwner {
  sessionId: string;
  cwd: string;
  archived?: boolean;
}

export class AuxiliaryWorktreeLifecycle {
  private readonly cleaning = new Set<string>();

  constructor(
    readonly registry: AuxiliaryWorktreeRegistry,
    private readonly owners: () => WorktreeOwner[],
    private readonly tracker: WorktreeTracker,
  ) {}

  async register(sessionId: string, path: string, retention: "temporary" | "retained", baseBranch?: string) {
    return this.registry.update(async (records) => {
      const owner = this.owners().find((session) => session.sessionId === sessionId);
      if (!owner || owner.archived) throw new Error("Only an unarchived session can register its auxiliary worktrees");
      const inspected = await inspectAuxiliaryWorktree(path);
      if (pathsOverlap(await canonicalWorktreePath(owner.cwd), inspected.worktreePath))
        throw new Error("The session's primary checkout is not auxiliary");
      if (retention === "temporary") {
        if (!baseBranch) throw new Error("Temporary worktrees require --base <local-branch> for cleanup safety");
        await git(inspected.repoRoot, "check-ref-format", `refs/heads/${baseBranch}`);
        await git(inspected.repoRoot, "rev-parse", "--verify", `refs/heads/${baseBranch}^{commit}`);
      }
      const existing = records.find(
        (record) => record.sessionId === sessionId && record.worktreePath === inspected.worktreePath,
      );
      const record: AuxiliaryWorktreeRegistration = {
        ...inspected,
        sessionId,
        retention,
        baseBranch,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      // Archive can race the Git inspection. Do not attach new deletion authority afterward.
      if (!this.owners().some((session) => session.sessionId === sessionId && !session.archived)) {
        throw new Error("Session retired during worktree registration");
      }
      if (existing) Object.assign(existing, record, { cleanupStatus: undefined, cleanupReason: undefined });
      else records.push(record);
      return record;
    });
  }

  isCleaning(sessionId: string): boolean {
    return this.cleaning.has(sessionId);
  }

  async cleanup(sessionId: string, path?: string): Promise<AuxiliaryWorktreeRegistration[]> {
    if (this.cleaning.has(sessionId)) throw new Error("Auxiliary cleanup is already running");
    this.cleaning.add(sessionId);
    try {
      return await this.registry.update(async (records) => {
        if (!this.owners().some((owner) => owner.sessionId === sessionId && owner.archived)) {
          throw new Error("Auxiliary cleanup requires an archived session");
        }
        const selected = records.filter(
          (record) => record.sessionId === sessionId && (!path || record.worktreePath === path),
        );
        if (path && selected.length === 0) throw new Error("Registered auxiliary worktree not found");
        for (const record of selected) {
          if (record.retention === "retained" || record.cleanupStatus === "done") continue;
          try {
            await this.removeTemporary(record, records);
            record.cleanupStatus = "done";
            record.cleanupReason = undefined;
          } catch (error) {
            record.cleanupStatus = "blocked";
            record.cleanupReason = error instanceof Error ? error.message : String(error);
          }
        }
        return selected;
      });
    } finally {
      this.cleaning.delete(sessionId);
    }
  }

  private async removeTemporary(record: AuxiliaryWorktreeRegistration, records: AuxiliaryWorktreeRegistration[]) {
    const current = await inspectAuxiliaryWorktree(record.worktreePath);
    if (
      current.identity !== record.identity ||
      current.gitDir !== record.gitDir ||
      current.repoRoot !== record.repoRoot ||
      current.branch !== record.branch
    ) {
      throw new Error("Worktree identity or branch changed since registration");
    }
    if (
      records.some(
        (other) =>
          other !== record && other.cleanupStatus !== "done" && pathsOverlap(other.worktreePath, record.worktreePath),
      )
    ) {
      throw new Error("Worktree has another session's ownership or retention registration");
    }
    // Refresh the shared primary index; absent foreign sessions are not presumed retired.
    const mappings = this.tracker.load(true);
    for (const mapping of mappings) {
      if (pathsOverlap(await canonicalWorktreePath(mapping.worktreePath), record.worktreePath)) {
        throw new Error("Worktree is associated with a primary session");
      }
    }
    const primaryOwners = this.owners().filter((owner) => !owner.archived);
    for (const owner of primaryOwners) {
      const cwd = await canonicalWorktreePath(owner.cwd);
      if (pathsOverlap(cwd, record.worktreePath)) throw new Error("Worktree is in use by an unarchived session");
    }
    if (!record.baseBranch) throw new Error("Cleanup base branch is missing");
    if (await git(record.worktreePath, "status", "--porcelain", "--untracked-files=all")) {
      throw new Error("Worktree has uncommitted changes");
    }
    const base = await git(record.repoRoot, "rev-parse", "--verify", `refs/heads/${record.baseBranch}^{commit}`);
    const ahead = await git(record.worktreePath, "rev-list", "--count", `${base}..HEAD`);
    if (ahead !== "0") throw new Error("Worktree has commits not present in its cleanup base branch");
    if (!this.owners().some((owner) => owner.sessionId === record.sessionId && owner.archived)) {
      throw new Error("Session is no longer archived");
    }
    // No --force and no branch deletion. Git also vetoes locked/dirty worktrees.
    await git(record.repoRoot, "worktree", "remove", "--", record.worktreePath);
  }
}
