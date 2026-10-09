import { readFile } from "node:fs/promises";
import { availableParallelism, cpus, loadavg } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/**
 * How many test workers one Vitest run should start.
 *
 * Several agents often run the suite at once; each starting a worker per CPU
 * starves process- and git-heavy tests into timeouts without finishing any
 * sooner overall. So a run sizes its pool to the CPUs it may actually use,
 * minus the ones already busy.
 *
 * The CPUs a run may use are the fewest of the CPUs the runtime reports, the
 * CPUs this process may be scheduled on (affinity, as with cpuset job slots),
 * and the CPU quota of its cgroup (as in containers). Bun's
 * `os.availableParallelism()` honors neither of the last two, so a container
 * with a 15-CPU quota on a 96-CPU node otherwise starts dozens of workers.
 *
 * Busy CPUs come from the load average only when the run may use the whole
 * machine. Inside a quota or a CPU subset the load average describes the whole
 * node, so busy CPUs are the cgroup's measured CPU use over a short sample.
 */
export async function vitestWorkerCount(root = "/", sampleMs = 300): Promise<number> {
  const machineCpus = cpus().length || availableParallelism();
  const limit = await cpuLimit(root);
  const budget = Math.max(1, Math.min(availableParallelism(), limit.cpus ?? Infinity));
  const constrained = budget < machineCpus;
  const busy = constrained ? ((await sampleBusyCpus(limit.usageFile, sampleMs)) ?? 0) : loadavg()[0]!;
  return workersFor(budget, busy);
}

/** Leave one CPU for the main process; never go below four workers (or the budget) on a busy machine. */
export function workersFor(budget: number, busyCpus: number): number {
  const idle = Math.round(budget - busyCpus);
  return Math.max(1, Math.min(budget - 1, Math.max(4, idle)));
}

export interface CpuLimit {
  /** CPUs available under affinity and cgroup quota, or undefined when nothing limits them. */
  cpus?: number;
  /** A cgroup CPU usage counter for measuring busy CPUs: v2 `cpu.stat`, or v1 `cpuacct.usage`. */
  usageFile?: { path: string; kind: "v2" | "v1" };
}

export async function cpuLimit(root = "/"): Promise<CpuLimit> {
  const affinity = parseCpuList(statusField(await readText(join(root, "proc/self/status")), "Cpus_allowed_list"));
  const cgroup = await cgroupCpuLimit(root);
  const counts = [affinity, cgroup.cpus].filter((n): n is number => n !== undefined);
  return { cpus: counts.length ? Math.min(...counts) : undefined, usageFile: cgroup.usageFile };
}

/**
 * The tightest CPU quota on this process's cgroups and their ancestors (a parent's
 * quota also caps its children), with the usage counter of the cgroup that sets it.
 */
async function cgroupCpuLimit(root: string): Promise<CpuLimit> {
  const memberships = (await readText(join(root, "proc/self/cgroup"))) ?? "";
  const levels: CpuLimit[] = [];
  for (const line of memberships.split("\n")) {
    const [id, controllers, path] = splitMembership(line);
    if (path === undefined) continue;
    if (id === "0" && controllers === "") {
      levels.push(...(await walk(join(root, "sys/fs/cgroup"), path, readV2)));
    } else if (controllers.split(",").includes("cpu")) {
      // v1 mounts each hierarchy under its controller list, e.g. cpu,cpuacct; some systems only link plain cpu.
      for (const mount of new Set([controllers, "cpu"])) {
        const found = await walk(join(root, "sys/fs/cgroup", mount), path, readV1);
        levels.push(...found);
        if (found.some((level) => level.cpus !== undefined || level.usageFile)) break;
      }
    }
  }
  const limited = levels.filter((level) => level.cpus !== undefined).sort((a, b) => a.cpus! - b.cpus!)[0];
  // Without any quota, measure the innermost cgroup that has a usage counter.
  return limited ?? { usageFile: levels.find((level) => level.usageFile)?.usageFile };
}

type ReadLevel = (dir: string) => Promise<CpuLimit>;

/** Each level from the cgroup's directory up to the hierarchy root; namespaced mounts may lack the inner levels. */
async function walk(mount: string, path: string, read: ReadLevel): Promise<CpuLimit[]> {
  const top = resolve(mount);
  const inside = (dir: string) => dir.startsWith(top + sep);
  const levels: CpuLimit[] = [];
  // A path outside this cgroup namespace (it starts with /..) leaves only the mount root to read.
  const start = resolve(top, `.${path}`);
  for (let dir = inside(start) ? start : top; ; dir = dirname(dir)) {
    levels.push(await read(dir));
    if (!inside(dir)) return levels;
  }
}

async function readV2(dir: string): Promise<CpuLimit> {
  const max = await readText(join(dir, "cpu.max"));
  const stat = await readText(join(dir, "cpu.stat"));
  const usageFile = stat === undefined ? undefined : ({ path: join(dir, "cpu.stat"), kind: "v2" } as const);
  const [quota, period] = (max ?? "").trim().split(/\s+/);
  return { cpus: quotaCpus(Number(quota), Number(period)), usageFile };
}

async function readV1(dir: string): Promise<CpuLimit> {
  const quota = Number((await readText(join(dir, "cpu.cfs_quota_us")))?.trim());
  const period = Number((await readText(join(dir, "cpu.cfs_period_us")))?.trim());
  const usage = await readText(join(dir, "cpuacct.usage"));
  const usageFile = usage === undefined ? undefined : ({ path: join(dir, "cpuacct.usage"), kind: "v1" } as const);
  return { cpus: quotaCpus(quota, period), usageFile };
}

/** Whole CPUs a CFS quota allows; "max" or -1 (and anything unreadable) mean no quota. */
function quotaCpus(quota: number, period: number): number | undefined {
  if (!(quota > 0) || !(period > 0)) return undefined;
  return Math.max(1, Math.floor(quota / period));
}

function splitMembership(line: string): [string, string, string | undefined] {
  const first = line.indexOf(":");
  const second = line.indexOf(":", first + 1);
  if (first < 0 || second < 0) return ["", "", undefined];
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
}

/** CPUs busy in the cgroup over a short sample, or undefined when it has no readable usage counter. */
export async function sampleBusyCpus(usageFile: CpuLimit["usageFile"], sampleMs: number): Promise<number | undefined> {
  if (!usageFile) return undefined;
  const before = await readUsageMicros(usageFile);
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const after = await readUsageMicros(usageFile);
  if (before === undefined || after === undefined) return undefined;
  return (after - before) / ((performance.now() - start) * 1000);
}

/** A cgroup's total CPU use so far, in microseconds. */
export async function readUsageMicros(usageFile: NonNullable<CpuLimit["usageFile"]>): Promise<number | undefined> {
  const text = await readText(usageFile.path);
  if (text === undefined) return undefined;
  const value = usageFile.kind === "v2" ? Number(/^usage_usec\s+(\d+)/m.exec(text)?.[1]) : Number(text.trim()) / 1000;
  return Number.isFinite(value) ? value : undefined;
}

/** Count of a Linux CPU list such as "0-3,8,10-11"; undefined when absent or malformed. */
export function parseCpuList(list: string | undefined): number | undefined {
  if (!list?.trim()) return undefined;
  let count = 0;
  for (const part of list.trim().split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) return undefined;
    const low = Number(match[1]);
    const high = match[2] === undefined ? low : Number(match[2]);
    if (high < low) return undefined;
    count += high - low + 1;
  }
  return count;
}

function statusField(status: string | undefined, field: string): string | undefined {
  return status
    ?.split("\n")
    .find((line) => line.startsWith(`${field}:`))
    ?.slice(field.length + 1);
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf-8").catch(() => undefined);
}
