import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LATENCY_BUCKET_BOUNDS_MS, type CliLatencyRecord, type ServerActionWindow } from "../server/latency-log.js";
import { formatLatencyReport, readLatencyLog, summarizeCliLatency, summarizeServerActions } from "./takode-latency.js";

function cliRecord(overrides: Partial<CliLatencyRecord>): CliLatencyRecord {
  return {
    ts: 1_000,
    host: "host",
    tool: "takode",
    command: "list",
    exitCode: 0,
    totalMs: 100,
    startupMs: 20,
    httpMs: 0,
    serverMs: 0,
    requests: [],
    ...overrides,
  };
}

function actionWindow(action: string, values: number[]): ServerActionWindow {
  const buckets = new Array(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0);
  for (const ms of values) {
    const index = LATENCY_BUCKET_BOUNDS_MS.findIndex((bound) => ms <= bound);
    buckets[index === -1 ? LATENCY_BUCKET_BOUNDS_MS.length : index]++;
  }
  return {
    ts: 2_000,
    since: 1_000,
    host: "host",
    action,
    count: values.length,
    sumMs: values.reduce((sum, ms) => sum + ms, 0),
    maxMs: Math.max(...values),
    buckets,
  };
}

describe("summarizeCliLatency", () => {
  it("splits mean run time into parts that add up to the mean total", () => {
    const [row] = summarizeCliLatency([
      cliRecord({ totalMs: 100, startupMs: 20, httpMs: 50, serverMs: 30 }),
      cliRecord({ totalMs: 200, startupMs: 40, httpMs: 70, serverMs: 50, exitCode: 1 }),
    ]);
    expect(row).toMatchObject({
      command: "takode list",
      runs: 2,
      failures: 1,
      meanTotalMs: 150,
      meanStartupMs: 30,
      meanServerMs: 40,
      meanTransportMs: 20,
      meanLocalMs: 60,
      p50TotalMs: 100,
      p95TotalMs: 200,
    });
    expect(row.meanStartupMs + row.meanLocalMs + row.meanServerMs + row.meanTransportMs).toBe(row.meanTotalMs);
    expect(row.overheadShare).toBeCloseTo(50 / 150);
  });

  it("flags commands whose transport overhead outweighs their actual work, ahead of busier rows", () => {
    // Remote-style command: 80ms of transport for 10ms of server work.
    const remote = cliRecord({ command: "board show", totalMs: 120, startupMs: 25, httpMs: 90, serverMs: 10 });
    // Frequent local command with more total time but no transport problem.
    const local = Array.from({ length: 10 }, () => cliRecord({ tool: "quest", command: "show", totalMs: 300 }));
    // Loopback-sized transport stays unflagged even when it exceeds the work.
    const loopback = cliRecord({ command: "info", totalMs: 40, startupMs: 25, httpMs: 12, serverMs: 1 });

    const rows = summarizeCliLatency([...local, loopback, remote]);
    expect(rows.map((row) => [row.command, row.flagged])).toEqual([
      ["takode board show", true],
      ["quest show", false],
      ["takode info", false],
    ]);
  });

  it("does not flag commands whose requests lacked server timing", () => {
    // An older server sends no Server-Timing, so all request time looks like
    // transport; flagging that would blame the network for server work.
    const [row] = summarizeCliLatency([
      cliRecord({
        command: "list",
        totalMs: 120,
        startupMs: 25,
        httpMs: 90,
        requests: [{ method: "GET", path: "/api/takode/sessions", atMs: 25, ms: 90 }],
      }),
    ]);
    expect(row).toMatchObject({ unsplit: true, flagged: false, meanTransportMs: 90 });
    expect(formatLatencyReport({ since: "1h", cli: [row], actions: [], limit: 20 })).toMatch(/^ {2}\? {2}takode list/m);
  });

  it("reports server-run invocations apart from direct runs", () => {
    const rows = summarizeCliLatency([
      cliRecord({ tool: "quest", command: "create" }),
      cliRecord({ tool: "quest", command: "create", serverRun: true }),
    ]);
    expect(rows.map((row) => row.command).sort()).toEqual(["quest create", "quest create (server-run)"]);
  });
});

describe("summarizeServerActions", () => {
  it("merges windows per action and estimates p95 from the histogram", () => {
    const values = [...Array.from({ length: 19 }, () => 4), 400];
    const [row] = summarizeServerActions([
      actionWindow("codex-rpc turn/start", values.slice(0, 10)),
      actionWindow("codex-rpc turn/start", values.slice(10)),
    ]);
    expect(row).toMatchObject({ action: "codex-rpc turn/start", calls: 20, maxMs: 400 });
    expect(row.meanMs).toBeCloseTo((19 * 4 + 400) / 20);
    // 19 of 20 calls (95%) fall in the <=5ms bucket.
    expect(row.p95UpperMs).toBe(5);
  });

  it("reports an open-ended p95 when it falls past the last bucket bound", () => {
    const [row] = summarizeServerActions([actionWindow("codex-rpc thread/resume", [60_000])]);
    expect(row.p95UpperMs).toBeNull();
  });
});

describe("formatLatencyReport", () => {
  it("prints compact tables with flags, a row limit hint and raw log locations", () => {
    const cli = summarizeCliLatency([
      cliRecord({ command: "board show", totalMs: 120, startupMs: 25, httpMs: 90, serverMs: 10 }),
      cliRecord({ tool: "quest", command: "show" }),
      cliRecord({ tool: "memory", command: "status" }),
    ]);
    const report = formatLatencyReport({
      since: "24h",
      cli,
      actions: summarizeServerActions([actionWindow("codex-rpc turn/start", [3, 4])]),
      limit: 2,
    });
    expect(report).toContain("CLI commands, last 24h: 3 runs");
    expect(report).toMatch(/^ {2}! {2}takode board show/m);
    expect(report).toContain("... 1 more (use --limit 3 or --json)");
    expect(report).toMatch(/codex-rpc turn\/start\s+2\s+3\.5ms\s+<=5\.0ms\s+4\.0ms/);
    expect(report).toContain("cli-commands.jsonl");
  });

  it("says when nothing was recorded", () => {
    const report = formatLatencyReport({ since: "1h", cli: [], actions: [], limit: 20 });
    expect(report).toContain("(no runs recorded)");
    expect(report).toContain("(no actions recorded)");
  });
});

describe("readLatencyLog", () => {
  it("reads the rotated file first and skips a partial line", async () => {
    // A concurrent writer or crash can leave one truncated line; the rest of the log must stay usable.
    const root = await mkdtemp(join(tmpdir(), "takode-latency-"));
    try {
      const path = join(root, "cli-commands.jsonl");
      await writeFile(`${path}.1`, `${JSON.stringify({ ts: 1 })}\n`);
      await writeFile(path, `${JSON.stringify({ ts: 2 })}\n{"ts":3,"tru\n${JSON.stringify({ ts: 4 })}\n`);
      expect(await readLatencyLog<{ ts: number }>(path)).toEqual([{ ts: 1 }, { ts: 2 }, { ts: 4 }]);
      expect(await readLatencyLog(join(root, "missing.jsonl"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
