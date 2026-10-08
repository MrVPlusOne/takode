/**
 * `takode latency`: audit where Takode CLI commands and server core actions
 * spend their time, from the logs written by cli-latency.ts and
 * core-action-latency.ts. Reads local files only, so it works without a server.
 */

import { readFile } from "node:fs/promises";
import { parseDuration } from "../server/timer-parse.js";
import {
  CLI_LATENCY_LOG_PATH,
  LATENCY_BUCKET_BOUNDS_MS,
  SERVER_ACTION_LOG_PATH,
  type CliLatencyRecord,
  type ServerActionWindow,
} from "../server/latency-log.js";
import { assertKnownFlags, err, parseFlags, parsePositiveIntegerFlag, resolveStringFlag } from "./takode-core.js";

const USAGE = "Usage: takode latency [--since <duration>] [--limit <n>] [--json]";
const DEFAULT_SINCE = "24h";
const DEFAULT_LIMIT = 20;
/** Transport below this mean is never flagged: loopback noise, not a coordinator problem. */
const FLAG_MIN_TRANSPORT_MS = 25;

/** Mean time split for one command. Means add up: startup + local + server + transport = total. */
export interface CliCommandSummary {
  command: string;
  runs: number;
  failures: number;
  p50TotalMs: number;
  p95TotalMs: number;
  meanTotalMs: number;
  meanStartupMs: number;
  meanLocalMs: number;
  meanServerMs: number;
  meanTransportMs: number;
  /** Share of total time spent on startup and transport rather than work. */
  overheadShare: number;
  /** Some requests had no Server-Timing (for example an older server), so their server time counts as transport. */
  unsplit: boolean;
  /** Transport is at least FLAG_MIN_TRANSPORT_MS and exceeds the work (local + server). Never set when unsplit. */
  flagged: boolean;
}

export interface ServerActionSummary {
  action: string;
  calls: number;
  meanMs: number;
  /** Upper bound of the histogram bucket holding the 95th percentile; null when it is past the last bound. */
  p95UpperMs: number | null;
  maxMs: number;
}

export async function handleLatency(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  assertKnownFlags(flags, new Set(["since", "limit", "json"]), USAGE);
  const sinceSpec = resolveStringFlag(flags, "since", "duration") ?? DEFAULT_SINCE;
  let sinceMs: number;
  try {
    sinceMs = parseDuration(sinceSpec);
  } catch (error) {
    err(`${error instanceof Error ? error.message : error}\n${USAGE}`);
  }
  const limit = parsePositiveIntegerFlag(flags, "limit", "count", DEFAULT_LIMIT);
  const cutoff = Date.now() - sinceMs;

  const cli = summarizeCliLatency(
    (await readLatencyLog<CliLatencyRecord>(CLI_LATENCY_LOG_PATH)).filter((r) => r.ts >= cutoff),
  );
  const actions = summarizeServerActions(
    (await readLatencyLog<ServerActionWindow>(SERVER_ACTION_LOG_PATH)).filter((w) => w.ts >= cutoff),
  );

  if (flags.json) {
    console.log(JSON.stringify({ since: sinceSpec, cli, serverActions: actions }, null, 2));
    return;
  }
  console.log(formatLatencyReport({ since: sinceSpec, cli, actions, limit }));
}

export function summarizeCliLatency(records: CliLatencyRecord[]): CliCommandSummary[] {
  const groups = new Map<string, CliLatencyRecord[]>();
  for (const record of records) {
    const key = `${record.tool} ${record.command}${record.serverRun ? " (server-run)" : ""}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  const summaries = [...groups].map(([command, runs]) => {
    const mean = (pick: (r: CliLatencyRecord) => number) => runs.reduce((sum, r) => sum + pick(r), 0) / runs.length;
    const totals = runs.map((r) => r.totalMs).sort((a, b) => a - b);
    const meanTotalMs = mean((r) => r.totalMs);
    const meanStartupMs = mean((r) => r.startupMs);
    const meanServerMs = mean((r) => r.serverMs);
    const meanTransportMs = mean((r) => r.httpMs - r.serverMs);
    const meanLocalMs = Math.max(0, meanTotalMs - meanStartupMs - meanServerMs - meanTransportMs);
    const unsplit = runs.some((r) => r.requests.some((request) => request.serverMs === undefined));
    return {
      command,
      runs: runs.length,
      failures: runs.filter((r) => r.exitCode !== 0).length,
      p50TotalMs: percentile(totals, 0.5),
      p95TotalMs: percentile(totals, 0.95),
      meanTotalMs,
      meanStartupMs,
      meanLocalMs,
      meanServerMs,
      meanTransportMs,
      overheadShare: meanTotalMs > 0 ? (meanStartupMs + meanTransportMs) / meanTotalMs : 0,
      unsplit,
      flagged: !unsplit && meanTransportMs >= FLAG_MIN_TRANSPORT_MS && meanTransportMs > meanLocalMs + meanServerMs,
    };
  });
  // Flagged commands first, then by total time spent, which is what slows agents down most.
  return summaries.sort(
    (a, b) => Number(b.flagged) - Number(a.flagged) || b.meanTotalMs * b.runs - a.meanTotalMs * a.runs,
  );
}

export function summarizeServerActions(windows: ServerActionWindow[]): ServerActionSummary[] {
  const merged = new Map<string, { calls: number; sumMs: number; maxMs: number; buckets: number[] }>();
  for (const window of windows) {
    const entry = merged.get(window.action) ?? {
      calls: 0,
      sumMs: 0,
      maxMs: 0,
      buckets: new Array(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0),
    };
    entry.calls += window.count;
    entry.sumMs += window.sumMs;
    entry.maxMs = Math.max(entry.maxMs, window.maxMs);
    window.buckets.forEach((count, index) => (entry.buckets[index] += count));
    merged.set(window.action, entry);
  }
  return [...merged]
    .map(([action, entry]) => ({
      action,
      calls: entry.calls,
      meanMs: entry.sumMs / entry.calls,
      p95UpperMs: histogramUpperBound(entry.buckets, entry.calls, 0.95),
      maxMs: entry.maxMs,
    }))
    .sort((a, b) => b.meanMs * b.calls - a.meanMs * a.calls);
}

export function formatLatencyReport(input: {
  since: string;
  cli: CliCommandSummary[];
  actions: ServerActionSummary[];
  limit: number;
}): string {
  const lines: string[] = [];
  const runs = input.cli.reduce((sum, row) => sum + row.runs, 0);
  lines.push(`CLI commands, last ${input.since}: ${runs} runs`);
  if (input.cli.length === 0) {
    lines.push("  (no runs recorded)");
  } else {
    lines.push(
      "  Mean split per run: startup (runtime boot + module load), local (CLI-side work), server (handler time),",
      `  transport (request time outside the server handler). ! = transport >= ${FLAG_MIN_TRANSPORT_MS}ms and larger than local + server.`,
      "  ? = some requests lacked server timing (older server), so their server time is counted as transport.",
      "",
    );
    lines.push(
      ...formatTable(
        ["", "command", "runs", "fail", "p50", "p95", "startup", "local", "server", "transport", "overhead"],
        input.cli
          .slice(0, input.limit)
          .map((row) => [
            row.flagged ? "!" : row.unsplit ? "?" : "",
            row.command,
            String(row.runs),
            String(row.failures),
            formatMs(row.p50TotalMs),
            formatMs(row.p95TotalMs),
            formatMs(row.meanStartupMs),
            formatMs(row.meanLocalMs),
            formatMs(row.meanServerMs),
            formatMs(row.meanTransportMs),
            `${Math.round(row.overheadShare * 100)}%`,
          ]),
        new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ),
    );
    appendMoreHint(lines, input.cli.length, input.limit);
  }

  lines.push("", `Server core actions, last ${input.since}`);
  if (input.actions.length === 0) {
    lines.push("  (no actions recorded)");
  } else {
    lines.push(
      ...formatTable(
        ["action", "calls", "mean", "p95", "max"],
        input.actions
          .slice(0, input.limit)
          .map((row) => [
            row.action,
            String(row.calls),
            formatMs(row.meanMs),
            row.p95UpperMs === null
              ? `>${formatMs(LATENCY_BUCKET_BOUNDS_MS.at(-1)!)}`
              : `<=${formatMs(row.p95UpperMs)}`,
            formatMs(row.maxMs),
          ]),
        new Set([1, 2, 3, 4]),
      ),
    );
    appendMoreHint(lines, input.actions.length, input.limit);
  }

  lines.push("", `Raw logs: ${CLI_LATENCY_LOG_PATH}, ${SERVER_ACTION_LOG_PATH} (plus .1 rotations)`);
  return lines.join("\n");
}

/** Read a latency log and its rotated `.1` sibling, oldest first. */
export async function readLatencyLog<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (const file of [`${path}.1`, path]) {
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        items.push(JSON.parse(line) as T);
      } catch {
        // A concurrent writer or a crash can leave one partial line; the rest of the log stays usable.
      }
    }
  }
  return items;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function histogramUpperBound(buckets: number[], count: number, fraction: number): number | null {
  let seen = 0;
  for (let index = 0; index < buckets.length; index++) {
    seen += buckets[index];
    if (seen >= fraction * count) return LATENCY_BUCKET_BOUNDS_MS[index] ?? null;
  }
  return null;
}

function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`;
}

function formatTable(header: string[], rows: string[][], rightAligned: ReadonlySet<number>): string[] {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)));
  return [header, ...rows].map(
    (row) =>
      "  " +
      row
        .map((cell, column) => (rightAligned.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
        .join("  ")
        .trimEnd(),
  );
}

function appendMoreHint(lines: string[], total: number, limit: number): void {
  if (total > limit) lines.push(`  ... ${total - limit} more (use --limit ${total} or --json)`);
}
