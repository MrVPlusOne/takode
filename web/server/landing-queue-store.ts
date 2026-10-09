import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LandingEntry, LandingRun, LandingRunnerLaunch } from "../shared/landing-queue.js";

const LANDING_QUEUE_DIR = join(homedir(), ".companion", "landing-queue");

export interface LandingQueueFile {
  version: 1;
  entries: LandingEntry[];
  runs: LandingRun[];
  /** Runners started for the queues, kept so a runner can still authenticate after a server restart. */
  launches: LandingRunnerLaunch[];
}

export function emptyLandingQueueFile(): LandingQueueFile {
  return { version: 1, entries: [], runs: [], launches: [] };
}

/** One JSON file per server; writes are chained so they land in order. */
export class LandingQueueStore {
  private filePath: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(namespace = "default", baseDir = LANDING_QUEUE_DIR) {
    mkdirSync(baseDir, { recursive: true }); // sync-ok: cold path, once during store construction
    this.filePath = join(baseDir, `${namespace.trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "default"}.json`);
  }

  async load(): Promise<LandingQueueFile> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as Partial<LandingQueueFile>;
      return {
        version: 1,
        entries: Array.isArray(raw.entries) ? raw.entries : [],
        runs: Array.isArray(raw.runs) ? raw.runs : [],
        launches: Array.isArray(raw.launches) ? raw.launches : [],
      };
    } catch (err: any) {
      if (err?.code !== "ENOENT") console.warn("[landing-queue-store] Failed to load the landing queue:", err);
      return emptyLandingQueueFile();
    }
  }

  async save(data: LandingQueueFile): Promise<void> {
    const serialized = JSON.stringify(data, null, 2);
    this.pendingWrite = this.pendingWrite.then(() => writeFile(this.filePath, serialized, "utf-8"));
    await this.pendingWrite;
  }
}
