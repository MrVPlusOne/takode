/**
 * Persisted latency stats for frequent server core actions, such as Codex
 * JSON-RPC requests, whose round trips will cross the network once sessions
 * run on other machines.
 *
 * Durations are aggregated in memory per action and appended to the server
 * action log once per window, so recording costs a map update and the log
 * stays small. `takode latency` summarizes the log.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import {
  LATENCY_BUCKET_BOUNDS_MS,
  LATENCY_LOG_MAX_BYTES,
  SERVER_ACTION_LOG_PATH,
  latencyBucketIndex,
  roundMs,
  type ServerActionWindow,
} from "./latency-log.js";

const FLUSH_INTERVAL_MS = 10 * 60_000;

type ActionStats = Pick<ServerActionWindow, "count" | "sumMs" | "maxMs" | "buckets">;

export class CoreActionLatency {
  private stats = new Map<string, ActionStats>();
  private windowStart = Date.now();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly logPath = SERVER_ACTION_LOG_PATH) {}

  /** Record one completed action. Starts the periodic flush on first use. */
  record(action: string, ms: number): void {
    let stats = this.stats.get(action);
    if (!stats) {
      stats = { count: 0, sumMs: 0, maxMs: 0, buckets: new Array(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0) };
      this.stats.set(action, stats);
    }
    stats.count++;
    stats.sumMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    stats.buckets[latencyBucketIndex(ms)]++;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.flushTimer.unref?.();
    }
  }

  /** Append the current window's aggregates to the log and start a new window. */
  flush(): Promise<void> {
    if (this.stats.size === 0) return this.pendingWrite;
    const now = Date.now();
    const host = hostname();
    const lines = [...this.stats].map(([action, stats]) => {
      const window: ServerActionWindow = {
        ts: now,
        since: this.windowStart,
        host,
        action,
        count: stats.count,
        sumMs: roundMs(stats.sumMs),
        maxMs: roundMs(stats.maxMs),
        buckets: stats.buckets,
      };
      return JSON.stringify(window);
    });
    this.stats = new Map();
    this.windowStart = now;
    this.pendingWrite = this.pendingWrite
      .then(() => this.append(`${lines.join("\n")}\n`))
      .catch((error) => console.error(`[core-action-latency] could not write ${this.logPath}:`, error));
    return this.pendingWrite;
  }

  private async append(text: string): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, text);
    if ((await stat(this.logPath)).size > LATENCY_LOG_MAX_BYTES) await rename(this.logPath, `${this.logPath}.1`);
  }
}

export const coreActionLatency = new CoreActionLatency();
