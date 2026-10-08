import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreActionLatency } from "./core-action-latency.js";
import { LATENCY_BUCKET_BOUNDS_MS, type ServerActionWindow } from "./latency-log.js";

describe("CoreActionLatency", () => {
  let root: string;
  let logPath: string;
  let latency: CoreActionLatency;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "core-action-latency-"));
    logPath = join(root, "perf", "server-actions.jsonl");
    latency = new CoreActionLatency(logPath);
  });

  afterEach(async () => {
    await latency.flush();
    await rm(root, { recursive: true, force: true });
  });

  async function readWindows(): Promise<ServerActionWindow[]> {
    const text = await readFile(logPath, "utf-8");
    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ServerActionWindow);
  }

  it("persists one aggregate line per action with a latency histogram", async () => {
    latency.record("codex-rpc turn/start", 3);
    latency.record("codex-rpc turn/start", 40);
    latency.record("codex-rpc thread/resume", 60_000);
    await latency.flush();

    const windows = await readWindows();
    expect(windows).toHaveLength(2);
    const turnStart = windows.find((window) => window.action === "codex-rpc turn/start")!;
    expect(turnStart).toMatchObject({ count: 2, sumMs: 43, maxMs: 40 });
    // 3ms lands in the <=5 bucket and 40ms in the <=50 bucket.
    expect(turnStart.buckets[LATENCY_BUCKET_BOUNDS_MS.indexOf(5)]).toBe(1);
    expect(turnStart.buckets[LATENCY_BUCKET_BOUNDS_MS.indexOf(50)]).toBe(1);
    expect(turnStart.since).toBeLessThanOrEqual(turnStart.ts);
    // Values past the last bound go to the overflow bucket.
    const resume = windows.find((window) => window.action === "codex-rpc thread/resume")!;
    expect(resume.buckets.at(-1)).toBe(1);
  });

  it("starts a fresh window after each flush and skips empty windows", async () => {
    latency.record("codex-rpc turn/start", 5);
    await latency.flush();
    await latency.flush();
    latency.record("codex-rpc turn/start", 7);
    await latency.flush();

    const windows = await readWindows();
    expect(windows.map((window) => window.count)).toEqual([1, 1]);
    expect(windows[1].since).toBe(windows[0].ts);
  });
});
