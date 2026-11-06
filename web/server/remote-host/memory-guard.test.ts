import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MemoryGuard,
  readMemoryUse,
  type GuardedProcess,
  type ListedProcess,
  type MemoryKill,
  type MemoryUse,
} from "./memory-guard.js";

const GB = 2 ** 30;

/**
 * A guard over a fake machine: `memory` is what it reads, `table` the process
 * table with each process's anonymous memory, and killed pids are recorded.
 */
function fakeGuard(options: {
  memory: MemoryUse;
  table: Array<ListedProcess & { bytes: number }>;
  processes: GuardedProcess[];
}) {
  const killed: number[] = [];
  const kills: Array<{ procId: string; kill: MemoryKill }> = [];
  const logs: string[] = [];
  let now = 1_000_000;
  const guard = new MemoryGuard({
    processes: () => options.processes,
    onKill: (procId, kill) => kills.push({ procId, kill }),
    log: (message) => logs.push(message),
    readMemory: async () => options.memory,
    listProcesses: async () => options.table,
    anonBytes: async (pid) => options.table.find((proc) => proc.pid === pid)?.bytes ?? 0,
    kill: (pid) => void killed.push(pid),
    now: () => now,
  });
  return { guard, killed, kills, logs, advance: (ms: number) => (now += ms) };
}

/** An agent CLI (pid 100) that runs a build: a shell, `lake` and many `lean` processes. */
function runawayBuild(leanCount: number, leanBytes: number) {
  return [
    { pid: 1, ppid: 0, name: "init", bytes: 0 },
    { pid: 100, ppid: 1, name: "claude", bytes: 0.3 * GB },
    { pid: 101, ppid: 100, name: "bash", bytes: 0.01 * GB },
    { pid: 150, ppid: 100, name: "mcp-server", bytes: 0.1 * GB },
    { pid: 102, ppid: 101, name: "lake", bytes: 0.2 * GB },
    ...Array.from({ length: leanCount }, (_, index) => ({
      pid: 200 + index,
      ppid: 102,
      name: "lean",
      bytes: leanBytes,
    })),
    // Another session's agent, idle.
    { pid: 300, ppid: 1, name: "codex", bytes: 0.4 * GB },
    { pid: 301, ppid: 300, name: "node", bytes: 0.2 * GB },
  ];
}

describe("MemoryGuard", () => {
  // The incident it exists for: one session's build fills a container shared
  // with the Takode server. The guard kills that build's process tree and keeps
  // the agent, so it can be told why, its MCP server, and other sessions.
  it("kills the process tree holding the most memory, keeping its agent and other sessions", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table: runawayBuild(20, 2 * GB),
      processes: [
        { procId: "p-claude", pid: 100, command: false },
        { procId: "p-codex", pid: 300, command: false },
      ],
    });
    await fake.guard.check();
    expect(fake.killed.sort((a, b) => a - b)).toEqual([101, 102, ...Array.from({ length: 20 }, (_, i) => 200 + i)]);
    expect(fake.kills).toHaveLength(1);
    expect(fake.kills[0]!.procId).toBe("p-claude");
    expect(fake.kills[0]!.kill).toMatchObject({
      processes: 22,
      programs: ["lean ×20", "lake", "bash"],
      usedBytes: 54 * GB,
      limitBytes: 56 * GB,
    });
    expect(fake.kills[0]!.kill.bytes).toBeCloseTo(40.21 * GB, -6);
  });

  // Below the threshold nothing is even listed or killed.
  it("does nothing while memory use is below the threshold", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 40 * GB, limitBytes: 56 * GB },
      table: runawayBuild(10, 2 * GB),
      processes: [{ procId: "p-claude", pid: 100, command: false }],
    });
    await fake.guard.check();
    expect(fake.killed).toEqual([]);
    expect(fake.kills).toEqual([]);
  });

  // When memory is full but no session holds much of it (the server itself, or
  // processes that left their session), killing a session would free nothing
  // useful, so the guard only logs.
  it("spares sessions that hold little of the memory", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table: runawayBuild(2, 1 * GB),
      processes: [{ procId: "p-claude", pid: 100, command: false }],
    });
    await fake.guard.check();
    expect(fake.killed).toEqual([]);
    expect(fake.logs.join("\n")).toContain("no session's processes hold much");
  });

  // An agent CLI that itself holds the memory (rather than anything it started)
  // goes; Takode relaunches the session.
  it("kills the agent itself when it holds the memory", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table: [
        { pid: 100, ppid: 1, name: "claude", bytes: 30 * GB },
        { pid: 101, ppid: 100, name: "bash", bytes: 0.01 * GB },
      ],
      processes: [{ procId: "p-claude", pid: 100, command: false }],
    });
    await fake.guard.check();
    expect(fake.killed).toEqual([100]);
  });

  // A runaway is often still small when memory first nears the limit (other
  // sessions hold the rest). The guard keeps checking as it grows instead of
  // waiting, and logs the nothing-to-kill case once.
  it("acts as soon as a growing runaway holds enough", async () => {
    const table = runawayBuild(2, 1 * GB);
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table,
      processes: [{ procId: "p-claude", pid: 100, command: false }],
    });
    await fake.guard.check();
    await fake.guard.check();
    expect(fake.kills).toEqual([]);
    expect(fake.logs.filter((line) => line.includes("no session's processes hold much"))).toHaveLength(1);
    for (const lean of table.filter((proc) => proc.name === "lean")) lean.bytes = 4 * GB;
    await fake.guard.check();
    expect(fake.kills).toHaveLength(1);
  });

  // A `takode exec` command is killed whole, its shell included.
  it("kills all of a command", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table: [
        { pid: 400, ppid: 1, name: "sh", bytes: 0.01 * GB },
        { pid: 401, ppid: 400, name: "pytest", bytes: 12 * GB },
      ],
      processes: [{ procId: "p-exec", pid: 400, command: true }],
    });
    await fake.guard.check();
    expect(fake.killed.sort((a, b) => a - b)).toEqual([400, 401]);
    expect(fake.kills[0]!.procId).toBe("p-exec");
  });

  // Freed memory takes a moment to show, so one runaway costs one kill: the
  // guard waits before acting again, then acts if memory is still full.
  it("waits after acting before acting again", async () => {
    const fake = fakeGuard({
      memory: { usedBytes: 54 * GB, limitBytes: 56 * GB },
      table: runawayBuild(20, 2 * GB),
      processes: [{ procId: "p-claude", pid: 100, command: false }],
    });
    await fake.guard.check();
    await fake.guard.check();
    expect(fake.kills).toHaveLength(1);
    fake.advance(20_000);
    await fake.guard.check();
    expect(fake.kills).toHaveLength(2);
  });
});

describe("readMemoryUse", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "memory-use-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Write files under the fake filesystem root. */
  async function files(entries: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(entries)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
  }

  const MEMINFO = "MemTotal:       1054867456 kB\nMemFree:        728760320 kB\nMemAvailable:   995098624 kB\n";

  // The Condor incident: a node in a Slurm job on a hybrid cgroup machine. The
  // job's 800 GiB limit sits on the v1 memory controller; the `0::` group has
  // no memory files. Reading only v2 fell back to the machine's 1 TB, so the
  // guard never acted before the job's own OOM killer did.
  it("reads a Slurm job's limit from the v1 memory controller on a hybrid machine", async () => {
    const job = "/sys/fs/cgroup/memory/slurm/uid_4132/job_7485516";
    await files({
      "/proc/self/cgroup": [
        "12:cpuset:/slurm/uid_4132/job_7485516/step_batch",
        "2:memory:/slurm/uid_4132/job_7485516/step_batch/task_0",
        "0::/kubepods/burstable/pod24751dba/308004683cd6",
        "",
      ].join("\n"),
      "/proc/meminfo": MEMINFO,
      // The task's own group has no limit; its parents carry the job's.
      [`${job}/step_batch/task_0/memory.limit_in_bytes`]: "9223372036854771712\n",
      [`${job}/step_batch/memory.limit_in_bytes`]: "858993459200\n",
      [`${job}/step_batch/memory.usage_in_bytes`]: `${700 * GB}\n`,
      [`${job}/step_batch/memory.stat`]: `cache 0\nshmem 0\ntotal_cache ${30 * GB}\ntotal_shmem ${2 * GB}\n`,
    });
    expect(await readMemoryUse(root)).toEqual({
      usedBytes: 672 * GB,
      limitBytes: 800 * GB,
    });
  });

  // A container on cgroup v2, like the DevBox: the limit is `memory.max` at its root.
  it("reads a container's cgroup v2 limit", async () => {
    await files({
      "/proc/self/cgroup": "0::/\n",
      "/proc/meminfo": MEMINFO,
      "/sys/fs/cgroup/memory.max": `${56 * GB}\n`,
      "/sys/fs/cgroup/memory.current": `${40 * GB}\n`,
      "/sys/fs/cgroup/memory.stat": `anon ${30 * GB}\nfile ${12 * GB}\nshmem ${1 * GB}\n`,
    });
    expect(await readMemoryUse(root)).toEqual({
      usedBytes: 29 * GB,
      limitBytes: 56 * GB,
    });
  });

  // No cgroup sets a limit: the machine's own memory is the limit.
  it("falls back to the machine's memory without a cgroup limit", async () => {
    await files({
      "/proc/self/cgroup": "0::/user.slice\n",
      "/proc/meminfo": MEMINFO,
      "/sys/fs/cgroup/user.slice/memory.max": "max\n",
      "/sys/fs/cgroup/memory.max": "max\n",
    });
    expect(await readMemoryUse(root)).toEqual({
      usedBytes: (1054867456 - 995098624) * 1024,
      limitBytes: 1054867456 * 1024,
    });
  });

  // On Linux it reads the real cgroup or /proc numbers; the shape is what the guard relies on.
  it.skipIf(process.platform !== "linux")("reads this machine's memory use and limit", async () => {
    const use = await readMemoryUse();
    expect(use).not.toBeNull();
    expect(use!.limitBytes).toBeGreaterThan(0);
    expect(use!.usedBytes).toBeGreaterThan(0);
    expect(use!.usedBytes).toBeLessThanOrEqual(use!.limitBytes);
  });
});
