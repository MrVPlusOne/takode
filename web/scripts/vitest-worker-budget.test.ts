import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cpuLimit, parseCpuList, readUsageMicros, sampleBusyCpus, workersFor } from "./vitest-worker-budget";

// The worker budget reads Linux /proc and /sys files. Each test builds a fake
// root with only the files a scenario needs, so the cases cover cgroup v2, v1,
// nested quotas and affinity without depending on the machine running them.
let root: string;

async function fakeRoot(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "vitest-worker-budget-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("cpuLimit", () => {
  it("reads a cgroup v2 quota at a container's namespaced root", async () => {
    // A container sees its own cgroup as "/" (the DevBox: 15 CPUs on a 96-CPU node).
    const dir = await fakeRoot({
      "proc/self/cgroup": "0::/\n",
      "proc/self/status": "Name:\tbun\nCpus_allowed_list:\t0-95\n",
      "sys/fs/cgroup/cpu.max": "1500000 100000\n",
      "sys/fs/cgroup/cpu.stat": "usage_usec 100\n",
    });
    expect(await cpuLimit(dir)).toEqual({
      cpus: 15,
      usageFile: { path: join(dir, "sys/fs/cgroup/cpu.stat"), kind: "v2" },
    });
  });

  it("takes the tightest quota among a cgroup and its ancestors, with that cgroup's usage", async () => {
    // A parent's quota caps every child, so a looser child quota must not win.
    const dir = await fakeRoot({
      "proc/self/cgroup": "0::/pod/job\n",
      "sys/fs/cgroup/cpu.max": "max 100000\n",
      "sys/fs/cgroup/pod/cpu.max": "400000 100000\n",
      "sys/fs/cgroup/pod/cpu.stat": "usage_usec 5\n",
      "sys/fs/cgroup/pod/job/cpu.max": "800000 100000\n",
      "sys/fs/cgroup/pod/job/cpu.stat": "usage_usec 3\n",
    });
    expect(await cpuLimit(dir)).toEqual({
      cpus: 4,
      usageFile: { path: join(dir, "sys/fs/cgroup/pod/cpu.stat"), kind: "v2" },
    });
  });

  it("treats an unlimited quota as no limit but keeps the innermost usage counter", async () => {
    const dir = await fakeRoot({
      "proc/self/cgroup": "0::/user.slice\n",
      "sys/fs/cgroup/cpu.stat": "usage_usec 9\n",
      "sys/fs/cgroup/user.slice/cpu.max": "max 100000\n",
      "sys/fs/cgroup/user.slice/cpu.stat": "usage_usec 1\n",
    });
    expect(await cpuLimit(dir)).toEqual({
      cpus: undefined,
      usageFile: { path: join(dir, "sys/fs/cgroup/user.slice/cpu.stat"), kind: "v2" },
    });
  });

  it("reads a cgroup v1 CFS quota from the cpu,cpuacct hierarchy", async () => {
    const dir = await fakeRoot({
      "proc/self/cgroup": "5:memory:/docker/abc\n3:cpu,cpuacct:/docker/abc\n",
      "sys/fs/cgroup/cpu,cpuacct/docker/abc/cpu.cfs_quota_us": "250000\n",
      "sys/fs/cgroup/cpu,cpuacct/docker/abc/cpu.cfs_period_us": "100000\n",
      "sys/fs/cgroup/cpu,cpuacct/docker/abc/cpuacct.usage": "1000\n",
      "sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us": "-1\n",
      "sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us": "100000\n",
    });
    expect(await cpuLimit(dir)).toEqual({
      cpus: 2,
      usageFile: { path: join(dir, "sys/fs/cgroup/cpu,cpuacct/docker/abc/cpuacct.usage"), kind: "v1" },
    });
  });

  it("falls back to the namespace root when the cgroup path lies outside the mount", async () => {
    // Paths outside the reader's cgroup namespace start with /.. and must not escape the mount.
    const dir = await fakeRoot({
      "proc/self/cgroup": "0::/../../other\n",
      "sys/fs/cgroup/cpu.max": "300000 100000\n",
    });
    expect((await cpuLimit(dir)).cpus).toBe(3);
  });

  it("limits CPUs to the affinity set, as with cpuset job slots", async () => {
    const dir = await fakeRoot({
      "proc/self/cgroup": "0::/\n",
      "proc/self/status": "Cpus_allowed_list:\t0-3,8\n",
      "sys/fs/cgroup/cpu.max": "max 100000\n",
    });
    expect((await cpuLimit(dir)).cpus).toBe(5);
  });

  it("reports no limit when no Linux files exist (macOS)", async () => {
    const dir = await fakeRoot({});
    expect(await cpuLimit(dir)).toEqual({ cpus: undefined, usageFile: undefined });
  });
});

describe("workersFor", () => {
  it("leaves one CPU for the main process when idle", () => {
    expect(workersFor(15, 0)).toBe(14);
  });

  it("subtracts busy CPUs but keeps at least four workers", () => {
    expect(workersFor(15, 6)).toBe(9);
    expect(workersFor(15, 40)).toBe(4);
  });

  it("never exceeds the budget on small machines", () => {
    expect(workersFor(2, 0)).toBe(1);
    expect(workersFor(1, 0)).toBe(1);
  });
});

describe("parseCpuList", () => {
  it("counts ranges and single CPUs", () => {
    expect(parseCpuList("0-95")).toBe(96);
    expect(parseCpuList(" 0-3,8,10-11\n")).toBe(7);
  });

  it("rejects malformed lists", () => {
    expect(parseCpuList(undefined)).toBeUndefined();
    expect(parseCpuList("")).toBeUndefined();
    expect(parseCpuList("3-1")).toBeUndefined();
    expect(parseCpuList("a-b")).toBeUndefined();
  });
});

describe("readUsageMicros", () => {
  it("reads cgroup v2 usage_usec and v1 nanoseconds as microseconds", async () => {
    const dir = await fakeRoot({
      "cpu.stat": "usage_usec 1500\nuser_usec 1000\n",
      "cpuacct.usage": "2500000\n",
    });
    expect(await readUsageMicros({ path: join(dir, "cpu.stat"), kind: "v2" })).toBe(1500);
    expect(await readUsageMicros({ path: join(dir, "cpuacct.usage"), kind: "v1" })).toBe(2500);
  });

  it("returns undefined for missing or malformed counters, so busy CPUs fall back to none", async () => {
    const dir = await fakeRoot({ "cpuacct.usage": "garbage\n", "cpu.stat": "user_usec 1\n" });
    expect(await readUsageMicros({ path: join(dir, "cpuacct.usage"), kind: "v1" })).toBeUndefined();
    expect(await readUsageMicros({ path: join(dir, "cpu.stat"), kind: "v2" })).toBeUndefined();
    expect(await readUsageMicros({ path: join(dir, "missing"), kind: "v2" })).toBeUndefined();
    expect(await sampleBusyCpus(undefined, 1)).toBeUndefined();
  });
});
