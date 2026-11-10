import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { HostProcessEvent } from "../../shared/host-protocol.js";
import { formatBytes, MEMORY_GUARD_MESSAGE_TAG } from "../../shared/memory-guard.js";
import { readPhysFootprint } from "../process-footprint.js";
import { jobProcessGroups } from "./process-tree.js";

const execFileAsync = promisify(execFile);

/** What the memory guard reports when it kills a session's processes, or a command over its own limit. */
export type MemoryKill = Omit<Extract<HostProcessEvent, { kind: "memory_kill" }>, "kind">;

/** A process the node started, whose tree the guard may kill. */
export interface GuardedProcess {
  procId: string;
  pid: number;
  /**
   * A command (`takode exec`), which goes whole. Otherwise an agent CLI, of
   * which the guard kills one process tree it started (a command it ran, as a
   * rule) and keeps the agent to be told why, unless the agent itself holds
   * the memory.
   */
  command: boolean;
  /**
   * A command's own memory limit (`takode exec --memory-limit`): once its
   * processes together use more, the guard kills all of them, however much
   * memory the machine has left.
   */
  memoryLimitBytes?: number;
}

/** Memory in use (not counting reclaimable file cache) against what this machine or container may use. */
export interface MemoryUse {
  usedBytes: number;
  limitBytes: number;
}

export interface ListedProcess {
  pid: number;
  ppid: number;
  pgid: number;
  /** Its session id; 0 where `ps` does not show it (macOS). */
  sid: number;
  /** Resident memory as `ps` shows it, which counts shared and file pages in full. */
  rssBytes: number;
  /** Program name, as `ps` shows it. */
  name: string;
}

export interface MemoryGuardOptions {
  /** The processes the node runs now. */
  processes: () => GuardedProcess[];
  /** Called after the guard killed (part of) a process's tree. */
  onKill: (procId: string, kill: MemoryKill) => void;
  log: (message: string) => void;
  /** Overrides for tests. */
  readMemory?: () => Promise<MemoryUse | null>;
  listProcesses?: () => Promise<ListedProcess[]>;
  /** Anonymous (non-file) resident memory of a process in bytes; 0 once it has ended. */
  anonBytes?: (pid: number) => Promise<number>;
  /** A process's share of the memory it uses (see {@link readMemoryShare}); null where it cannot be read. */
  memoryShare?: (pid: number) => Promise<number | null>;
  /**
   * Whether `ps`'s resident size is at least each process's memory share, so a
   * command within its limit by `ps` is within it. True except on macOS.
   */
  rssCoversShare?: boolean;
  kill?: (pid: number) => void;
  now?: () => number;
}

/** How often memory use is checked. */
export const MEMORY_CHECK_INTERVAL_MS = 2_000;
/** Share of the limit in use at which the guard acts. */
export const MEMORY_GUARD_THRESHOLD = 0.9;
/** A tree holding less than this share of the limit is not what fills the machine, so it is spared. */
const MIN_VICTIM_SHARE = 0.1;
/** After killing, wait this long for the memory to be freed before acting again. */
const COOLDOWN_MS = 15_000;

/**
 * Keeps one session's runaway job from taking a whole machine down. On a
 * machine running the coordinator, running out of memory stalls or kills the
 * Takode server with every session on it. The node checks memory use every
 * couple of seconds and, once it nears the limit, kills the process tree that
 * holds the most memory among those its sessions started (or the agent CLI
 * itself, or a whole `takode exec` command), then reports it so that session
 * is told why. A runaway spread over several trees loses one per check.
 *
 * Per-session memory limits would be stronger, but they need a cgroup the
 * node may manage, which containers usually do not delegate. The kernel's own
 * OOM killer stays the backstop: `raiseOomScore` makes it pick session
 * processes before the Takode server and node.
 *
 * The same checks enforce the memory limit a command may be given: past it,
 * the whole command goes, as for `takode exec kill`. That needs no cgroup and
 * works on macOS too (by physical footprint), where the machine-wide check
 * finds nothing to read.
 */
export class MemoryGuard {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private quietUntil = 0;
  /** Memory has stayed nearly full with nothing worth killing since this was logged. */
  private loggedNothingToKill = false;
  /** Commands killed for passing their limit, which may take a moment to end. */
  private readonly overLimit = new Set<string>();

  constructor(private readonly options: MemoryGuardOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), MEMORY_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check: kills commands over their own limit, then acts if the machine's memory use is over the threshold. */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.enforceCommandLimits().catch((error) => this.logFailure("Command memory limit check", error));
      await this.guardMachine().catch((error) => this.logFailure("Memory guard check", error));
    } finally {
      this.checking = false;
    }
  }

  private async guardMachine(): Promise<void> {
    const now = this.options.now ?? Date.now;
    if (now() < this.quietUntil) return;
    const use = await (this.options.readMemory ?? readMemoryUse)();
    if (!use || use.usedBytes < use.limitBytes * MEMORY_GUARD_THRESHOLD) {
      this.loggedNothingToKill = false;
      return;
    }
    // A runaway that is still small is checked again next time, as it grows.
    if (await this.killLargest(use)) this.quietUntil = now() + COOLDOWN_MS;
  }

  /**
   * Kill each command whose processes together use more memory than its
   * limit. Its processes are those `takode exec kill` stops: the members of
   * its process groups, including the ones `timeout` or `setsid` moved to
   * groups of their own.
   */
  private async enforceCommandLimits(): Promise<void> {
    const limited = this.options.processes().filter((proc) => proc.memoryLimitBytes !== undefined);
    for (const procId of this.overLimit) {
      if (!limited.some((proc) => proc.procId === procId)) this.overLimit.delete(procId);
    }
    const pending = limited.filter((proc) => !this.overLimit.has(proc.procId));
    if (pending.length === 0) return;
    const listed = await (this.options.listProcesses ?? listProcesses)();
    const memoryShare = this.options.memoryShare ?? readMemoryShare;
    const rssCoversShare = this.options.rssCoversShare ?? process.platform !== "darwin";
    for (const command of pending) {
      const limit = command.memoryLimitBytes!;
      const groups = jobProcessGroups(command.pid, listed);
      const members = listed.filter((proc) => groups.includes(proc.pgid));
      // `ps` is cheap but counts a page every process maps in full, such as the
      // copy-on-write memory forked workers share, so on Linux it can only clear
      // a command. Not on macOS, where compressed memory leaves its count.
      if (rssCoversShare && sum(members.map((member) => member.rssBytes)) <= limit) continue;
      const measured = await Promise.all(
        members.map(async (member) => ({ ...member, bytes: (await memoryShare(member.pid)) ?? member.rssBytes })),
      );
      const bytes = sum(measured.map((member) => member.bytes));
      if (bytes <= limit) continue;
      this.overLimit.add(command.procId);
      // Whole groups, so processes started since the listing go too.
      for (const pgid of groups) this.killQuietly(-pgid);
      const report: MemoryKill = {
        reason: "command_limit",
        processes: members.length,
        bytes,
        programs: programSummary(measured),
        usedBytes: bytes,
        limitBytes: limit,
      };
      this.options.log(
        `Command ${command.procId} used ${formatBytes(bytes)}, over its ${formatBytes(limit)} memory limit; ` +
          `killed its ${report.processes} processes (${report.programs.join(", ")})`,
      );
      this.options.onKill(command.procId, report);
    }
  }

  private killQuietly(pid: number): void {
    try {
      (this.options.kill ?? ((target: number) => process.kill(target, "SIGKILL")))(pid);
    } catch (error) {
      // One that already ended.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private logFailure(what: string, error: unknown): void {
    this.options.log(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Kill what holds the most memory, if anything holds enough; whether it did. */
  private async killLargest(use: MemoryUse): Promise<boolean> {
    const listed = await (this.options.listProcesses ?? listProcesses)();
    const byPid = new Map(listed.map((proc) => [proc.pid, proc]));
    const children = new Map<number, ListedProcess[]>();
    for (const proc of listed) {
      const siblings = children.get(proc.ppid);
      if (siblings) siblings.push(proc);
      else children.set(proc.ppid, [proc]);
    }
    const anonBytes = this.options.anonBytes ?? readAnonBytes;
    const candidates = await Promise.all(
      this.options.processes().flatMap((root) => {
        const proc = byPid.get(root.pid);
        if (!proc) return [];
        // An agent's own process and each tree it started (its MCP servers, the
        // commands it runs) are separate candidates, so a runaway command goes
        // and the rest of the session keeps working.
        const trees = root.command
          ? [treeOf(proc, children)]
          : [[proc], ...(children.get(proc.pid) ?? []).map((child) => treeOf(child, children))];
        return trees.map(async (tree) => {
          const victims = await Promise.all(
            tree.map(async (member) => ({
              ...member,
              bytes: await anonBytes(member.pid),
            })),
          );
          return {
            root,
            victims,
            bytes: sum(victims.map((victim) => victim.bytes)),
          };
        });
      }),
    );
    const largest = candidates.sort((a, b) => b.bytes - a.bytes)[0];
    const situation = `${formatBytes(use.usedBytes)} of ${formatBytes(use.limitBytes)} in use`;
    if (!largest || largest.bytes < use.limitBytes * MIN_VICTIM_SHARE) {
      if (!this.loggedNothingToKill) {
        this.options.log(`Memory is nearly full (${situation}), but no session's processes hold much of it`);
      }
      this.loggedNothingToKill = true;
      return false;
    }
    for (const victim of largest.victims) this.killQuietly(victim.pid);
    const report: MemoryKill = {
      processes: largest.victims.length,
      bytes: largest.bytes,
      programs: programSummary(largest.victims),
      usedBytes: use.usedBytes,
      limitBytes: use.limitBytes,
    };
    this.options.log(
      `Memory is nearly full (${situation}); killed ${report.processes} processes of ${largest.root.procId} ` +
        `holding ${formatBytes(report.bytes)} (${report.programs.join(", ")})`,
    );
    this.options.onKill(largest.root.procId, report);
    return true;
  }
}

/**
 * Make the kernel's OOM killer choose this process, and everything it starts,
 * before the Takode server and node. Any process may raise its own score;
 * lowering the server's would need privileges. Linux only; elsewhere a no-op.
 */
export async function raiseOomScore(pid: number): Promise<void> {
  if (process.platform !== "linux") return;
  await writeFile(`/proc/${pid}/oom_score_adj`, "1000");
}

/**
 * Memory use against the closest cgroup memory limit (a container or a
 * cluster job), else against the machine's memory. File cache, which the
 * kernel frees under pressure, does not count as used. `fsRoot` stands in for
 * `/` in tests.
 */
export async function readMemoryUse(fsRoot = ""): Promise<MemoryUse | null> {
  return (await cgroupMemoryUse(fsRoot).catch(() => null)) ?? (await machineMemoryUse(fsRoot).catch(() => null));
}

/**
 * The message a session gets after the guard killed its processes. It says
 * what went and why, and how to rerun the work without filling the machine.
 * `owner` names whose processes they were, such as `your command x-12`.
 */
export function memoryKillNotice(kill: MemoryKill, machine: string, owner = "this session"): string {
  return [
    `${MEMORY_GUARD_MESSAGE_TAG} Killed ${kill.processes} ${kill.processes === 1 ? "process" : "processes"} of ${owner} on \`${machine}\`, holding ${formatBytes(kill.bytes)}: ${kill.programs.map((program) => `\`${program}\``).join(", ")}.`,
    "",
    `The machine was nearly out of memory (${formatBytes(kill.usedBytes)} of ${formatBytes(kill.limitBytes)} in use), and these were the largest user among its sessions. Running out of memory there can stall or kill the Takode server and every other session, so Takode stopped them. ` +
      "If you need that work, rerun it with less parallelism (fewer jobs, workers or threads), or run it on a machine with more room using `takode exec --host <machine>`.",
  ].join("\n");
}

/** The root and every process descended from it. */
function treeOf(root: ListedProcess, children: Map<number, ListedProcess[]>): ListedProcess[] {
  const tree = [root];
  for (let index = 0; index < tree.length; index++) {
    for (const child of children.get(tree[index]!.pid) ?? []) tree.push(child);
  }
  return tree;
}

/** Program names of the killed processes, largest total first, with counts: `lean ×93`. */
function programSummary(victims: Array<ListedProcess & { bytes: number }>): string[] {
  const byName = new Map<string, { count: number; bytes: number }>();
  for (const victim of victims) {
    const entry = byName.get(victim.name) ?? { count: 0, bytes: 0 };
    byName.set(victim.name, {
      count: entry.count + 1,
      bytes: entry.bytes + victim.bytes,
    });
  }
  const names = [...byName].sort((a, b) => b[1].bytes - a[1].bytes);
  const shown = names.slice(0, 3).map(([name, { count }]) => (count > 1 ? `${name} ×${count}` : name));
  return names.length > 3 ? [...shown, `${names.length - 3} more`] : shown;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Where each cgroup version keeps a group's memory limit, use and file cache.
 * A machine may mount both (hybrid): its `0::` group then has no memory
 * controller, and the limit, such as a Slurm job's, is in the v1 `memory`
 * hierarchy.
 */
const CGROUP_MEMORY = [
  {
    line: /^0::(.*)$/m,
    root: "/sys/fs/cgroup",
    limit: "memory.max",
    usage: "memory.current",
    // `file` includes tmpfs and shared memory (`shmem`), which cannot be dropped.
    cache: "file",
    shmem: "shmem",
  },
  {
    line: /^\d+:(?:[^:\n]*,)?memory(?:,[^:\n]*)?:(.*)$/m,
    root: "/sys/fs/cgroup/memory",
    limit: "memory.limit_in_bytes",
    usage: "memory.usage_in_bytes",
    // The `total_` counts include the group's children; `cache` includes shared memory.
    cache: "total_cache",
    shmem: "total_shmem",
  },
] as const;
/** v1 reports no limit as a number near 2^63. */
const NO_CGROUP_LIMIT = 2 ** 60;

async function cgroupMemoryUse(fsRoot: string): Promise<MemoryUse | null> {
  const groups = await readFile(`${fsRoot}/proc/self/cgroup`, "utf-8");
  for (const version of CGROUP_MEMORY) {
    const path = groups.match(version.line)?.[1];
    if (path === undefined) continue;
    // The closest limit up the tree: a container's at its root, a cluster job's a level or two up.
    const parts = path.trim().split("/").filter(Boolean);
    for (let depth = parts.length; depth >= 0; depth--) {
      const dir = [fsRoot + version.root, ...parts.slice(0, depth)].join("/");
      const limit = Number((await readFile(`${dir}/${version.limit}`, "utf-8").catch(() => "max")).trim());
      if (!Number.isFinite(limit) || limit >= NO_CGROUP_LIMIT) continue;
      const [usage, stat] = await Promise.all([
        readFile(`${dir}/${version.usage}`, "utf-8"),
        readFile(`${dir}/memory.stat`, "utf-8"),
      ]);
      const reclaimable = statValue(stat, version.cache) - statValue(stat, version.shmem);
      return {
        usedBytes: Number(usage.trim()) - reclaimable,
        limitBytes: limit,
      };
    }
  }
  return null;
}

async function machineMemoryUse(fsRoot: string): Promise<MemoryUse> {
  const meminfo = await readFile(`${fsRoot}/proc/meminfo`, "utf-8");
  return {
    usedBytes: kibValue(meminfo, "MemTotal") - kibValue(meminfo, "MemAvailable"),
    limitBytes: kibValue(meminfo, "MemTotal"),
  };
}

function statValue(stat: string, key: string): number {
  return Number(stat.match(new RegExp(`^${key} (\\d+)$`, "m"))?.[1] ?? 0);
}

async function listProcesses(): Promise<ListedProcess[]> {
  const columns = ["pid=", "ppid=", "pgid=", "sess=", "rss=", "comm="].flatMap((column) => ["-o", column]);
  const { stdout } = await execFileAsync("ps", ["-A", ...columns], {
    timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    // The program name comes last, as it may hold spaces (macOS shows its path).
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match
      ? [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            pgid: Number(match[3]),
            sid: Number(match[4]),
            rssBytes: Number(match[5]) * 1024,
            name: match[6]!.trim(),
          },
        ]
      : [];
  });
}

async function readAnonBytes(pid: number): Promise<number> {
  const status = await readFile(`/proc/${pid}/status`, "utf-8").catch(() => "");
  return kibValue(status, "RssAnon");
}

/**
 * What a process uses of memory that cannot be dropped, anonymous and shared
 * (tmpfs, shared memory) alike, counting pages it shares with others in part
 * (PSS), so forked workers' shared copy-on-write memory counts once among
 * them. Older kernels lack that split; there it is the resident anonymous
 * and shared memory. 0 once the process ended. On macOS it is the physical
 * footprint, which unlike `ps`'s resident size keeps compressed memory. Null
 * where neither can be read, so `ps` must do.
 */
export async function readMemoryShare(pid: number): Promise<number | null> {
  if (process.platform === "darwin") return readPhysFootprint(pid);
  if (process.platform !== "linux") return null;
  const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf-8").catch(() => "");
  if (rollup.includes("Pss_Anon:")) return kibValue(rollup, "Pss_Anon") + kibValue(rollup, "Pss_Shmem");
  const status = await readFile(`/proc/${pid}/status`, "utf-8").catch(() => "");
  return kibValue(status, "RssAnon") + kibValue(status, "RssShmem");
}

/** A `Key:   123 kB` line of a /proc file, in bytes; 0 when it is missing. */
function kibValue(text: string, key: string): number {
  return Number(text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"))?.[1] ?? 0) * 1024;
}
