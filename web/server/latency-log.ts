/**
 * Shared format for Takode's persisted latency logs.
 *
 * Two bounded JSONL files live under `~/.companion/perf/`:
 * - `cli-commands.jsonl`: one record per `quest`, `memory` or `takode` CLI
 *   invocation, written by the CLI process itself when it exits.
 * - `server-actions.jsonl`: one aggregate per server core action (such as a
 *   Codex JSON-RPC method) per flush window, written by the server.
 *
 * Records hold timings, command names and request paths only, never payloads,
 * so the logs are safe to keep and share for performance audits. Each file
 * rotates to a single `.1` sibling once it passes LATENCY_LOG_MAX_BYTES.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const LATENCY_LOG_DIR = join(homedir(), ".companion", "perf");
export const CLI_LATENCY_LOG_PATH = join(LATENCY_LOG_DIR, "cli-commands.jsonl");
export const SERVER_ACTION_LOG_PATH = join(LATENCY_LOG_DIR, "server-actions.jsonl");
export const LATENCY_LOG_MAX_BYTES = 4 * 1024 * 1024;

/** Server handler time is reported to clients through this Server-Timing metric. */
export const SERVER_TIMING_METRIC = "app";
/** A remote host's API proxy reports its round trip to the coordinator through this Server-Timing metric. */
export const HOST_HOP_TIMING_METRIC = "takode-node-hop";

/** Upper bounds (ms) of the histogram buckets in server action aggregates; one extra bucket counts larger values. */
export const LATENCY_BUCKET_BOUNDS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000] as const;

export type CliTool = "quest" | "memory" | "takode";

/** One HTTP request made by a CLI invocation. */
export interface CliRequestTiming {
  method: string;
  /** URL path without query string, so search text and other inputs are never logged. */
  path: string;
  /** Request start, in ms since the CLI process started. */
  atMs: number;
  /** Client-observed request time, from fetch start until the body is read (or headers arrive, if it is streamed). */
  ms: number;
  /** Server handler time from the response's Server-Timing header, when the server reported it. */
  serverMs?: number;
  /**
   * On a remote host: the API proxy's round trip to the coordinator, including
   * the server time. The rest of the request time is spent on this machine.
   */
  hostHopMs?: number;
}

/** One CLI invocation. All durations are milliseconds, rounded to 0.1 ms. */
export interface CliLatencyRecord {
  ts: number;
  host: string;
  tool: CliTool;
  /** Command name, plus the subcommand for commands that have them (for example `board advance`). */
  command: string;
  /** Set when the server spawned this run on a caller's behalf, so its time is part of that caller's server time. */
  serverRun?: true;
  exitCode: number;
  /** Process start until exit. */
  totalMs: number;
  /** Runtime boot and module loading, before the CLI's own code starts. */
  startupMs: number;
  /** Wall time with at least one server request in flight. */
  httpMs: number;
  /** Server handler time across requests, capped at httpMs. */
  serverMs: number;
  /** On a remote host: proxy-to-coordinator round trips across requests, capped at httpMs. */
  hostHopMs?: number;
  requests: CliRequestTiming[];
}

/** Durations recorded for one server core action during one flush window. */
export interface ServerActionWindow {
  /** Window end (epoch ms). */
  ts: number;
  /** Window start (epoch ms). */
  since: number;
  host: string;
  action: string;
  count: number;
  sumMs: number;
  maxMs: number;
  /** Counts per LATENCY_BUCKET_BOUNDS_MS bucket, plus a final overflow bucket. */
  buckets: number[];
}

/** Index of the histogram bucket that holds `ms`. */
export function latencyBucketIndex(ms: number): number {
  const index = LATENCY_BUCKET_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return index === -1 ? LATENCY_BUCKET_BOUNDS_MS.length : index;
}

export function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}
