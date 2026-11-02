import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How long processes have to end after the first signal before the survivors get SIGKILL. */
export const STOP_GRACE_MS = 10_000;

/** A process as `ps` lists it. */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  /** Its session id; 0 where `ps` does not show it (macOS). */
  sid: number;
}

export interface StopOptions {
  graceMs?: number;
  log?: (message: string) => void;
  /** Override for tests. */
  listProcesses?: () => Promise<ProcessEntry[]>;
}

/**
 * Stop a process started as the leader of its own session and process group
 * (`detached`) and everything it started: `signal` now and, unless that was
 * SIGKILL, SIGKILL after a grace period to whatever is still running, even
 * once the leader has exited.
 *
 * Signalling the leader's group is not enough: commands leave it on purpose.
 * GNU `timeout` moves into a group of its own, `setsid` and daemons start new
 * sessions, and a shell with job control puts each job in its own group. So
 * the process table is read before anything is signalled, while the tree is
 * still intact, and every group of the leader's session and of its
 * descendants is signalled. A killed parent's children are adopted by init,
 * but keep their session and group, which is how the second round finds them.
 */
export async function stopProcessTree(
  rootPid: number,
  signal: NodeJS.Signals,
  options: StopOptions = {},
): Promise<void> {
  const groups = await jobGroups(rootPid, [], options);
  signalGroups(groups, signal, options);
  if (signal === "SIGKILL") return;
  const timer = setTimeout(() => {
    void jobGroups(rootPid, groups, options).then((survivors) => signalGroups(survivors, "SIGKILL", options));
  }, options.graceMs ?? STOP_GRACE_MS);
  timer.unref?.();
}

/**
 * The process groups of everything the root started: its own, those of the
 * members of its session, and those of its descendants. A process can only
 * join a group of its own session or start a new one, so none of these
 * groups holds processes the root did not start.
 */
export function jobProcessGroups(rootPid: number, processes: ProcessEntry[]): number[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of processes) {
    const siblings = children.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else children.set(entry.ppid, [entry]);
  }
  const groups = new Set([rootPid]);
  for (const entry of processes) if (entry.sid === rootPid) groups.add(entry.pgid);
  const pending = [rootPid];
  const seen = new Set(pending);
  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      groups.add(child.pgid);
      pending.push(child.pid);
    }
  }
  return [...groups];
}

async function jobGroups(rootPid: number, known: number[], options: StopOptions): Promise<number[]> {
  try {
    const processes = await (options.listProcesses ?? listProcesses)();
    return [...new Set([...known, ...jobProcessGroups(rootPid, processes)])];
  } catch (error) {
    // Without the table, the root's own group is still reachable.
    options.log?.(`Could not list processes to stop ${rootPid}'s children: ${errorMessage(error)}`);
    return [...new Set([...known, rootPid])];
  }
}

async function listProcesses(): Promise<ProcessEntry[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "sess="], {
    timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    const [pid, ppid, pgid, sid] = line.trim().split(/\s+/).map(Number);
    return pid && pgid ? [{ pid, ppid: ppid ?? 0, pgid, sid: sid || 0 }] : [];
  });
}

function signalGroups(groups: number[], signal: NodeJS.Signals, options: StopOptions): void {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      // A group whose processes have all ended.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        options.log?.(`Could not send ${signal} to process group ${pgid}: ${errorMessage(error)}`);
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
