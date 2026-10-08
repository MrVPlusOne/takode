import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCliLatencyRecord, commandLabel, parseServerTiming } from "./cli-latency.js";
import type { CliLatencyRecord } from "../server/latency-log.js";

describe("commandLabel", () => {
  // The log must never capture free-form arguments such as quest titles or
  // message text, only command names.
  it("records a subcommand only for known parent commands", () => {
    expect(commandLabel("takode", "board", ["advance", "q-12"])).toBe("board advance");
    expect(commandLabel("quest", "feedback", ["add", "q-1"])).toBe("feedback add");
    expect(commandLabel("memory", "catalog", ["show", "testing"])).toBe("catalog show");
    expect(commandLabel("quest", "create", ["secret title"])).toBe("create");
    expect(commandLabel("takode", "send", ["2", "please fix"])).toBe("send");
  });

  it("drops subcommand-like tokens that are not plain names", () => {
    expect(commandLabel("quest", "feedback", ["q-12"])).toBe("feedback");
    expect(commandLabel("takode", "board", ["--json"])).toBe("board");
    expect(commandLabel("takode", "notify", ["needs-input", "summary text"])).toBe("notify needs-input");
  });

  it("never records an unexpected command token verbatim", () => {
    expect(commandLabel("takode", undefined, [])).toBe("(none)");
    expect(commandLabel("takode", "Some Typed Text", [])).toBe("(other)");
    expect(commandLabel("quest", "--help", [])).toBe("(other)");
  });
});

describe("parseServerTiming", () => {
  it("reads the app metric among other Server-Timing entries", () => {
    expect(parseServerTiming("app;dur=12.34")).toBe(12.3);
    expect(parseServerTiming("db;dur=3, app;dur=7.5")).toBe(7.5);
    expect(parseServerTiming("db;dur=3")).toBeUndefined();
    expect(parseServerTiming(null)).toBeUndefined();
  });

  // On a remote host the API proxy appends its own round trip to the
  // coordinator, so a run there can split the network hop from local overhead.
  it("reads the host proxy hop next to the server's time", () => {
    const header = "app;dur=4, takode-node-hop;dur=31.25";
    expect(parseServerTiming(header)).toBe(4);
    expect(parseServerTiming(header, "takode-node-hop")).toBe(31.3);
    const record = buildCliLatencyRecord({
      tool: "quest",
      command: "show",
      exitCode: 0,
      totalMs: 80,
      startupMs: 10,
      requests: [{ method: "GET", path: "/api/quests/q-1", atMs: 20, ms: 40, serverMs: 4, hostHopMs: 31.3 }],
    });
    expect(record).toMatchObject({ httpMs: 40, serverMs: 4, hostHopMs: 31.3 });
  });
});

describe("buildCliLatencyRecord", () => {
  it("counts overlapping parallel requests once and caps server time at request wall time", () => {
    // Two parallel requests over [10, 30] and [20, 40] plus one later request
    // over [50, 55]: 35ms of wall time with a request in flight. Their summed
    // server time (50ms) exceeds that, so it is capped.
    const record = buildCliLatencyRecord({
      tool: "takode",
      command: "list",
      exitCode: 0,
      totalMs: 60,
      startupMs: 8,
      requests: [
        { method: "GET", path: "/api/a", atMs: 10, ms: 20, serverMs: 18 },
        { method: "GET", path: "/api/b", atMs: 20, ms: 20, serverMs: 18 },
        { method: "GET", path: "/api/c", atMs: 50, ms: 5, serverMs: 14 },
      ],
    });
    expect(record.httpMs).toBe(35);
    expect(record.serverMs).toBe(35);
    expect(record.serverRun).toBeUndefined();
  });

  it("marks runs the server spawned on a caller's behalf", () => {
    const record = buildCliLatencyRecord({
      tool: "quest",
      command: "create",
      serverRun: true,
      exitCode: 0,
      totalMs: 40,
      startupMs: 30,
      requests: [],
    });
    expect(record.serverRun).toBe(true);
    expect(record.httpMs).toBe(0);
  });
});

describe("trackCliLatency in a real process", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cli-latency-"));
    // Fake API that reports a fixed handler time, like the Takode server does.
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ ok: true }, { headers: { "Server-Timing": "app;dur=4.2" } }),
    });
  });

  afterEach(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("appends one record on exit with request timings and the real exit code", async () => {
    // The tracker patches global fetch and hooks process exit, so it is
    // exercised in a child process that exits through process.exit, as the CLIs do.
    const logPath = join(root, "perf", "cli-commands.jsonl");
    const script = join(root, "fixture.ts");
    const modulePath = fileURLToPath(new URL("./cli-latency.ts", import.meta.url));
    writeFileSync(
      script,
      [
        `import { trackCliLatency } from ${JSON.stringify(modulePath)};`,
        `trackCliLatency("takode", "board", ["show", "q-1"], { logPath: ${JSON.stringify(logPath)} });`,
        `const res = await fetch("http://127.0.0.1:${server.port}/api/takode/board?query=private", { method: "post" });`,
        `await res.json();`,
        `process.exit(3);`,
      ].join("\n"),
    );
    const child = spawn(process.execPath, [script], { stdio: "ignore" });
    const [exitCode] = await once(child, "exit");
    expect(exitCode).toBe(3);

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as CliLatencyRecord;
    expect(record).toMatchObject({ tool: "takode", command: "board show", exitCode: 3, serverMs: 4.2 });
    // The query string is dropped so search text and other inputs never reach the log.
    expect(record.requests).toEqual([
      { method: "POST", path: "/api/takode/board", atMs: expect.any(Number), ms: expect.any(Number), serverMs: 4.2 },
    ]);
    expect(record.httpMs).toBeGreaterThanOrEqual(record.serverMs);
    expect(record.totalMs).toBeGreaterThanOrEqual(record.startupMs + record.httpMs);
  });
});
