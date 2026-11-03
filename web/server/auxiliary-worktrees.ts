import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { AuxiliaryWorktreeRegistration, AuxiliaryWorktreeRegistry } from "./auxiliary-worktree-registry.js";
import { onMachine } from "./remote-host/host-operations.js";
import { hostIsOnline, machineFor } from "./remote-host/session-machine.js";
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

/** Host side: refuse a cleanup base that is not an existing local branch. */
export async function verifyCleanupBaseBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, "check-ref-format", `refs/heads/${branch}`);
  await git(repoRoot, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`);
}

/** Host side: why a temporary checkout must stay (uncommitted changes or commits missing from its base), or null. */
export async function auxiliaryWorktreeKeepReason(
  worktreePath: string,
  repoRoot: string,
  baseBranch: string,
): Promise<string | null> {
  if (await git(worktreePath, "status", "--porcelain", "--untracked-files=all")) {
    return "Worktree has uncommitted changes";
  }
  const base = await git(repoRoot, "rev-parse", "--verify", `refs/heads/${baseBranch}^{commit}`);
  const ahead = await git(worktreePath, "rev-list", "--count", `${base}..HEAD`);
  return ahead === "0" ? null : "Worktree has commits not present in its cleanup base branch";
}

/** Host side: remove a checkout. No --force and no branch deletion; Git also vetoes locked/dirty worktrees. */
export async function removeAuxiliaryWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(repoRoot, "worktree", "remove", "--", worktreePath);
}

interface WorktreeOwner {
  sessionId: string;
  cwd: string;
  archived?: boolean;
  /** Remote host of the session's primary checkout; absent for this machine. */
  hostId?: string;
}

/** Whether two paths' machines are the same: a remote host id, or this machine when absent. */
function sameMachine(a: string | undefined, b: string | undefined): boolean {
  return (a || undefined) === (b || undefined);
}

/** Selects one registration by path and, when several machines have that path, by machine. */
export interface AuxiliaryWorktreeTarget {
  path: string;
  /** The machine to pick (undefined for this machine); omit the key to accept any machine. */
  hostId?: string;
}

/** Whether a registered checkout's path still exists: "unknown" when its machine is offline or cannot tell. */
export type AuxiliaryWorktreePathState = "present" | "missing" | "unknown";

/** A session's registrations matching `target` (all of them without one); refuses an ambiguous or unknown path. */
function selectRegistrations(
  records: AuxiliaryWorktreeRegistration[],
  sessionId: string,
  target: AuxiliaryWorktreeTarget | undefined,
): AuxiliaryWorktreeRegistration[] {
  const selected = records.filter(
    (record) =>
      record.sessionId === sessionId &&
      (!target ||
        (record.worktreePath === target.path && (!("hostId" in target) || sameMachine(record.hostId, target.hostId)))),
  );
  if (target && selected.length === 0) throw new Error("Registered auxiliary worktree not found");
  if (target && selected.length > 1) {
    throw new Error("That path is registered on more than one machine; name the machine with --host");
  }
  return selected;
}

export class AuxiliaryWorktreeLifecycle {
  private readonly cleaning = new Set<string>();

  constructor(
    readonly registry: AuxiliaryWorktreeRegistry,
    private readonly owners: () => WorktreeOwner[],
    private readonly tracker: WorktreeTracker,
  ) {}

  /**
   * Register a checkout for a session. `hostId` names the remote host it lives on
   * (absent for this machine); the path and Git checks run there.
   */
  async register(
    sessionId: string,
    path: string,
    retention: "temporary" | "retained",
    baseBranch?: string,
    hostId?: string,
  ) {
    return this.registry.update(async (records) => {
      const owner = this.owners().find((session) => session.sessionId === sessionId);
      if (!owner || owner.archived) throw new Error("Only an unarchived session can register its auxiliary worktrees");
      const inspected = await onMachine(hostId, "inspectAuxiliaryWorktree", path);
      if (
        sameMachine(owner.hostId, hostId) &&
        pathsOverlap(await onMachine(hostId, "canonicalWorktreePath", owner.cwd), inspected.worktreePath)
      )
        throw new Error("The session's primary checkout is not auxiliary");
      if (retention === "temporary") {
        if (!baseBranch) throw new Error("Temporary worktrees require --base <local-branch> for cleanup safety");
        await onMachine(hostId, "verifyCleanupBaseBranch", inspected.repoRoot, baseBranch);
      }
      const existing = records.find(
        (record) =>
          record.sessionId === sessionId &&
          record.worktreePath === inspected.worktreePath &&
          sameMachine(record.hostId, hostId),
      );
      const record: AuxiliaryWorktreeRegistration = {
        ...inspected,
        ...(hostId ? { hostId } : {}),
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

  /** Whether a registration's path still exists on its machine. */
  async pathState(record: AuxiliaryWorktreeRegistration): Promise<AuxiliaryWorktreePathState> {
    if (record.hostId && !hostIsOnline(record.hostId)) return "unknown";
    try {
      return (await machineFor(record.hostId).stat(record.worktreePath)) ? "present" : "missing";
    } catch {
      return "unknown";
    }
  }

  /**
   * Drop a session's registration, for a checkout it removed itself or no longer
   * wants tracked. Only the metadata goes; the checkout and its branch are untouched.
   */
  async unregister(sessionId: string, target: AuxiliaryWorktreeTarget): Promise<AuxiliaryWorktreeRegistration> {
    return this.registry.update(async (records) => {
      const [record] = selectRegistrations(records, sessionId, target);
      records.splice(records.indexOf(record), 1);
      return record;
    });
  }

  isCleaning(sessionId: string): boolean {
    return this.cleaning.has(sessionId);
  }

  async cleanup(sessionId: string, target?: AuxiliaryWorktreeTarget): Promise<AuxiliaryWorktreeRegistration[]> {
    if (this.cleaning.has(sessionId)) throw new Error("Auxiliary cleanup is already running");
    this.cleaning.add(sessionId);
    try {
      return await this.registry.update(async (records) => {
        if (!this.owners().some((owner) => owner.sessionId === sessionId && owner.archived)) {
          throw new Error("Auxiliary cleanup requires an archived session");
        }
        const selected = selectRegistrations(records, sessionId, target);
        for (const record of selected) {
          if (record.retention === "retained" || record.cleanupStatus === "done") continue;
          // A checkout already removed (usually by its session) has nothing left to clean up or protect.
          if ((await this.pathState(record)) === "missing") {
            records.splice(records.indexOf(record), 1);
            record.cleanupStatus = "done";
            record.cleanupReason = undefined;
            continue;
          }
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
    const host = record.hostId;
    if (host && !hostIsOnline(host)) {
      throw new Error("Its machine is offline; nothing was removed. Retry with takode worktree retry once it is back");
    }
    const current = await onMachine(host, "inspectAuxiliaryWorktree", record.worktreePath);
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
          other !== record &&
          other.cleanupStatus !== "done" &&
          sameMachine(other.hostId, host) &&
          pathsOverlap(other.worktreePath, record.worktreePath),
      )
    ) {
      throw new Error("Worktree has another session's ownership or retention registration");
    }
    // Refresh the shared primary index; absent foreign sessions are not presumed retired.
    const mappings = this.tracker.load(true);
    for (const mapping of mappings.filter((candidate) => sameMachine(candidate.hostId, host))) {
      if (pathsOverlap(await onMachine(host, "canonicalWorktreePath", mapping.worktreePath), record.worktreePath)) {
        throw new Error("Worktree is associated with a primary session");
      }
    }
    const primaryOwners = this.owners().filter((owner) => !owner.archived && sameMachine(owner.hostId, host));
    for (const owner of primaryOwners) {
      const cwd = await onMachine(host, "canonicalWorktreePath", owner.cwd);
      if (pathsOverlap(cwd, record.worktreePath)) throw new Error("Worktree is in use by an unarchived session");
    }
    if (!record.baseBranch) throw new Error("Cleanup base branch is missing");
    const keepReason = await onMachine(
      host,
      "auxiliaryWorktreeKeepReason",
      record.worktreePath,
      record.repoRoot,
      record.baseBranch,
    );
    if (keepReason) throw new Error(keepReason);
    if (!this.owners().some((owner) => owner.sessionId === record.sessionId && owner.archived)) {
      throw new Error("Session is no longer archived");
    }
    await onMachine(host, "removeAuxiliaryWorktree", record.repoRoot, record.worktreePath);
  }
}
