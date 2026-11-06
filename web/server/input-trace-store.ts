import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  INPUT_TRACE_MAX_EVENTS,
  INPUT_TRACE_WINDOW_MS,
  type InputTraceBatch,
  type SavedInputTrace,
} from "../shared/input-trace.js";

/** Durable rolling traces, independent of the server log and its unrelated log rotation. */
export class InputTraceStore {
  private pending: Promise<unknown> = Promise.resolve();
  private lastCleanup = 0;

  constructor(private readonly directory = join(homedir(), ".companion", "input-traces")) {}

  /** Merges a numbered upload atomically; retried/overlapping batches never duplicate events. */
  append(batch: InputTraceBatch, now = Date.now()): Promise<void> {
    return this.exclusive(async () => {
      if (!/^[\da-f-]{36}$/i.test(batch.traceId)) throw new Error("Invalid trace identifier");
      await mkdir(this.directory, { recursive: true });
      // Reloaded pages get new identities. Retire their expired files during normal recording,
      // too, rather than accumulating them until someone asks to read a trace.
      if (now - this.lastCleanup >= 60_000) {
        await this.readActive(now);
        this.lastCleanup = now;
      }
      const path = join(this.directory, `${batch.traceId}.json`);
      const previous = await this.read(path);
      const entries = new Map((previous?.events ?? []).map((event) => [event.seq, event]));
      for (const event of batch.events) entries.set(event.seq, event);
      const events = [...entries.values()]
        .filter((event) => event.t >= now - INPUT_TRACE_WINDOW_MS)
        .sort((a, b) => a.seq - b.seq)
        .slice(-INPUT_TRACE_MAX_EVENTS);
      const trace: SavedInputTrace = { ...batch, updatedAt: now, events };
      await writeFile(`${path}.tmp`, JSON.stringify(trace), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
  }

  /** Reads the retained hour and removes expired automatic traces; manual reports are elsewhere. */
  list(now = Date.now()): Promise<SavedInputTrace[]> {
    return this.exclusive(() => this.readActive(now));
  }

  private async readActive(now: number): Promise<SavedInputTrace[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const traces: SavedInputTrace[] = [];
    for (const name of names) {
      if (!/^[\da-f-]{36}\.json$/i.test(name)) continue;
      const path = join(this.directory, name);
      const trace = await this.read(path);
      if (!trace) continue;
      const events = trace.events.filter((event) => event.t >= now - INPUT_TRACE_WINDOW_MS);
      if (!events.length) {
        await unlink(path);
        continue;
      }
      traces.push({ ...trace, events });
    }
    return traces.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async read(path: string): Promise<SavedInputTrace | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as SavedInputTrace;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // The caller handles failure; a failed write must not poison later uploads.
    this.pending = result.catch(() => undefined);
    return result;
  }
}
