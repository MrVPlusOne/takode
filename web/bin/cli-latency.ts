/**
 * End-to-end latency tracking for the Takode CLIs (`quest`, `memory`, `takode`).
 *
 * Each CLI calls trackCliLatency() once at startup. It times every server
 * request by wrapping the global fetch, so new server-routed code paths are
 * covered without touching each call site, and appends one record to the CLI
 * latency log when the process exits. The record splits the run into process
 * startup, CLI-side work, server handler time (from the Server-Timing header)
 * and transport, the remaining request time spent on connections, network and
 * routing. `takode latency` summarizes the log.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import {
  CLI_LATENCY_LOG_PATH,
  HOST_HOP_TIMING_METRIC,
  LATENCY_LOG_MAX_BYTES,
  SERVER_TIMING_METRIC,
  roundMs,
  type CliLatencyRecord,
  type CliRequestTiming,
  type CliTool,
} from "../server/latency-log.js";

/** Commands whose first argument is a subcommand worth recording; other arguments are never logged. */
const SUBCOMMAND_PARENTS: Record<CliTool, ReadonlySet<string>> = {
  quest: new Set(["feedback", "quiz", "outcome"]),
  memory: new Set(["repo", "catalog", "lock"]),
  takode: new Set(["board", "goal", "lease", "notify", "permission", "port", "thread", "timer", "todo", "worktree"]),
};
const COMMAND_NAME = /^[a-z][a-z-]{0,39}$/;
const BODY_READERS = ["arrayBuffer", "json", "text"] as const;

/**
 * Start timing this CLI process and log the result when it exits.
 *
 * `command` and `rest` are the CLI's own parse of its arguments: the command
 * name and the arguments after it. Only the command and, for known parents, a
 * subcommand name are recorded. Set `serverRun` when the server spawned this
 * process on a caller's behalf, so its time is reported apart from direct runs.
 */
export function trackCliLatency(
  tool: CliTool,
  command: string | undefined,
  rest: readonly string[],
  options: { serverRun?: boolean; logPath?: string } = {},
): void {
  const logPath = options.logPath ?? CLI_LATENCY_LOG_PATH;
  const startupMs = performance.now();
  const requests: CliRequestTiming[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const start = performance.now();
    const timing: CliRequestTiming = {
      method: requestMethod(input, init),
      path: requestPath(input),
      atMs: roundMs(start),
      ms: 0,
    };
    requests.push(timing);
    const finish = () => {
      timing.ms = roundMs(performance.now() - start);
    };
    try {
      const response = await originalFetch(input, init);
      finish();
      const header = response.headers.get("server-timing");
      const serverMs = parseServerTiming(header);
      if (serverMs !== undefined) timing.serverMs = serverMs;
      const hostHopMs = parseServerTiming(header, HOST_HOP_TIMING_METRIC);
      if (hostHopMs !== undefined) timing.hostHopMs = hostHopMs;
      extendTimingThroughBodyRead(response, finish);
      return response;
    } catch (error) {
      finish();
      throw error;
    }
  }) as typeof fetch;

  process.on("exit", (exitCode) => {
    const record = buildCliLatencyRecord({
      tool,
      command: commandLabel(tool, command, rest),
      serverRun: options.serverRun,
      exitCode,
      totalMs: performance.now(),
      startupMs,
      requests,
    });
    try {
      appendLatencyRecord(logPath, record);
    } catch (error) {
      // Latency logging must never change a command's outcome or exit code.
      console.error(`[cli-latency] could not write ${logPath}: ${error instanceof Error ? error.message : error}`);
    }
  });
}

/** The recorded command name: the command plus a subcommand for known parents, never free-form arguments. */
export function commandLabel(tool: CliTool, command: string | undefined, rest: readonly string[]): string {
  if (!command) return "(none)";
  if (!COMMAND_NAME.test(command)) return "(other)";
  const sub = rest[0];
  if (SUBCOMMAND_PARENTS[tool].has(command) && sub && COMMAND_NAME.test(sub)) return `${command} ${sub}`;
  return command;
}

export function buildCliLatencyRecord(input: {
  tool: CliTool;
  command: string;
  serverRun?: boolean;
  exitCode: number;
  totalMs: number;
  startupMs: number;
  requests: CliRequestTiming[];
}): CliLatencyRecord {
  const httpMs = unionDuration(input.requests.map((request) => [request.atMs, request.atMs + request.ms]));
  const serverMs = input.requests.reduce((sum, request) => sum + (request.serverMs ?? 0), 0);
  const hostHopMs = input.requests.reduce((sum, request) => sum + (request.hostHopMs ?? 0), 0);
  return {
    ts: Date.now(),
    host: hostname(),
    tool: input.tool,
    command: input.command,
    ...(input.serverRun ? { serverRun: true } : {}),
    exitCode: input.exitCode,
    totalMs: roundMs(input.totalMs),
    startupMs: roundMs(input.startupMs),
    httpMs: roundMs(httpMs),
    // Parallel requests can report more summed server time than wall time spent waiting.
    serverMs: roundMs(Math.min(serverMs, httpMs)),
    ...(hostHopMs > 0 ? { hostHopMs: roundMs(Math.min(hostHopMs, httpMs)) } : {}),
    requests: input.requests,
  };
}

/** The duration of one Server-Timing metric (the server's handler time by default). */
export function parseServerTiming(header: string | null, metric = SERVER_TIMING_METRIC): number | undefined {
  const match = header ? new RegExp(`(?:^|,)\\s*${metric};dur=([\\d.]+)`).exec(header) : null;
  return match ? roundMs(Number(match[1])) : undefined;
}

/** Length of the union of [start, end] intervals, so overlapping parallel requests count once. */
function unionDuration(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let currentEnd = -Infinity;
  for (const [start, end] of sorted) {
    if (end <= currentEnd) continue;
    total += end - Math.max(start, currentEnd);
    currentEnd = end;
  }
  return total;
}

/**
 * Count response body download as request time. Streaming readers (such as
 * `takode logs --follow`) keep the headers-only timing.
 */
function extendTimingThroughBodyRead(response: Response, finish: () => void): void {
  for (const name of BODY_READERS) {
    const read = response[name].bind(response) as () => Promise<unknown>;
    Object.defineProperty(response, name, {
      value: async () => {
        try {
          return await read();
        } finally {
          finish();
        }
      },
    });
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function requestPath(input: RequestInfo | URL): string {
  const url = input instanceof Request ? input.url : String(input);
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0];
  }
}

function appendLatencyRecord(logPath: string, record: CliLatencyRecord): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  if (statSync(logPath).size > LATENCY_LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
}
