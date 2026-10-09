import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  landingQueueKey,
  parseLandingGateConfig,
  type LandingGateConfig,
  type LandingGateRecord,
  type LandingTarget,
} from "../shared/landing-queue.js";

const LANDING_GATES_DIR = join(homedir(), ".companion", "landing-gates");

interface LandingGatesFile {
  version: 1;
  gates: LandingGateRecord[];
}

/**
 * Saved landing gates, one per repository branch. A repository branch with a
 * saved gate lands through the landing queue; every machine's `takode land`
 * reads the gate from here. One JSON file per server; writes are chained so
 * they land in order.
 */
export class LandingGateStore {
  private filePath: string;
  private gates: Map<string, LandingGateRecord> | null = null;
  private loading: Promise<Map<string, LandingGateRecord>> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    namespace = "default",
    private baseDir = LANDING_GATES_DIR,
  ) {
    this.filePath = join(baseDir, `${namespace.trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "default"}.json`);
  }

  async get(target: LandingTarget): Promise<LandingGateRecord | null> {
    return (await this.load()).get(landingQueueKey(target)) ?? null;
  }

  async list(): Promise<LandingGateRecord[]> {
    return [...(await this.load()).values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async set(
    target: LandingTarget,
    config: LandingGateConfig,
    by: { sessionId?: string; sessionNum?: number },
    now = Date.now(),
  ): Promise<{ gate: LandingGateRecord; previous: LandingGateRecord | null }> {
    const gates = await this.load();
    const key = landingQueueKey(target);
    const previous = gates.get(key) ?? null;
    const gate: LandingGateRecord = {
      key,
      target: { repo: target.repo.toLowerCase(), branch: target.branch },
      config: parseLandingGateConfig(config),
      updatedAt: now,
      ...(by.sessionId ? { updatedBySessionId: by.sessionId } : {}),
      ...(by.sessionNum !== undefined ? { updatedBySessionNum: by.sessionNum } : {}),
    };
    gates.set(key, gate);
    await this.save(gates);
    return { gate, previous };
  }

  async remove(target: LandingTarget): Promise<LandingGateRecord | null> {
    const gates = await this.load();
    const key = landingQueueKey(target);
    const previous = gates.get(key) ?? null;
    if (previous) {
      gates.delete(key);
      await this.save(gates);
    }
    return previous;
  }

  private async load(): Promise<Map<string, LandingGateRecord>> {
    if (this.gates) return this.gates;
    this.loading ??= this.read().then(
      (gates) => (this.gates = gates),
      (error) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }

  private async read(): Promise<Map<string, LandingGateRecord>> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as Partial<LandingGatesFile>;
      return new Map((Array.isArray(raw.gates) ? raw.gates : []).map((gate) => [gate.key, gate]));
    } catch (err: any) {
      // A file that exists but cannot be read must not silently become "no gates": that would
      // look like every repository opted out and could later be overwritten by a save.
      if (err?.code !== "ENOENT") throw new Error(`Cannot read the saved landing gates in ${this.filePath}: ${err}`);
      return new Map();
    }
  }

  private async save(gates: Map<string, LandingGateRecord>): Promise<void> {
    const data: LandingGatesFile = { version: 1, gates: [...gates.values()] };
    const serialized = JSON.stringify(data, null, 2);
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.baseDir, { recursive: true });
        await writeFile(this.filePath, serialized, "utf-8");
      });
    await this.pendingWrite;
  }
}
