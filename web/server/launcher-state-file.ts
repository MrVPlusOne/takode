/**
 * The launcher's session list on disk (`launcher.json`), with each session's launch instructions
 * kept beside it, one file per session (`launch-instructions/<sessionId>.json`).
 *
 * The list is rewritten on nearly every session state change, about once a second on a busy
 * coordinator. The instructions a process started with (Session Info shows them, and a restart
 * compares them with what it would build now) change only at launches, yet with 600+ sessions they
 * were about 25 MB of a 27 MB list: every rewrite serialized and wrote them all again, which held
 * the event loop and kept the garbage collector busy enough to slow the whole server. Each
 * session's instructions are now written only when they change and joined back into the list on
 * load. A list saved before the split still loads as it is; its instructions move out at the next
 * save.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LIST_FILE = "launcher.json";
const INSTRUCTIONS_DIR = "launch-instructions";
const INSTRUCTION_FIELDS = ["injectedSystemPrompt", "codexInstructionSnapshot"] as const;
const SAFE_SESSION_ID = /^[\w-]+$/;

type InstructionField = (typeof INSTRUCTION_FIELDS)[number];
type LaunchInstructions = Partial<Record<InstructionField, unknown>>;
type Entry = Record<string, unknown> & { sessionId?: unknown };

export class LauncherStateFile {
  private writes: Promise<void> = Promise.resolve();
  /** Each session's instructions as they are on disk: last written, or read by `load`. */
  private saved = new Map<string, LaunchInstructions>();

  constructor(private readonly dir: string) {}

  /**
   * Snapshots `data` now and writes it after earlier saves: the instructions that changed first,
   * then the list. Resolves when this save is written; rejects with the first failure.
   */
  save(data: unknown): Promise<void> {
    const changed = new Map<string, LaunchInstructions>();
    const removed: string[] = [];
    let list = data;
    if (Array.isArray(data)) {
      const present = new Set<string>();
      list = data.map((entry) => this.splitEntry(entry, present, changed, removed));
      for (const sessionId of this.saved.keys()) {
        if (!present.has(sessionId)) removed.push(sessionId);
      }
      for (const sessionId of removed) this.saved.delete(sessionId);
    }
    const listJson = JSON.stringify(list, null, 2);
    const write = this.writes.then(async () => {
      await this.writeInstructions(changed, removed);
      await writeFile(join(this.dir, LIST_FILE), listJson, "utf-8");
    });
    this.writes = write.catch(() => {});
    return write;
  }

  /** The saved list with each session's instructions joined back in; null when there is none. */
  async load<T>(): Promise<T | null> {
    const list = await this.loadList<unknown>();
    if (!Array.isArray(list)) return list as T | null;
    await Promise.all(
      list.map(async (entry: Entry) => {
        if (!isEntry(entry) || INSTRUCTION_FIELDS.some((field) => field in entry)) return;
        const sessionId = entry.sessionId;
        const raw = await readFile(this.instructionsPath(sessionId), "utf-8").catch(() => null);
        if (raw === null) return;
        try {
          const instructions = JSON.parse(raw) as LaunchInstructions;
          Object.assign(entry, instructions);
          this.saved.set(sessionId, instructions);
        } catch (error) {
          console.warn(`[launcher-state] Unreadable launch instructions for ${sessionId}:`, error);
        }
      }),
    );
    return list as T;
  }

  /** The saved list without the instructions, for callers that only need sessions' states. */
  async loadList<T>(): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, LIST_FILE), "utf-8")) as T;
    } catch {
      return null;
    }
  }

  /** `entry` without its instructions, noting whether they differ from what is on disk. */
  private splitEntry(
    entry: unknown,
    present: Set<string>,
    changed: Map<string, LaunchInstructions>,
    removed: string[],
  ): unknown {
    if (!isEntry(entry)) return entry;
    const sessionId = entry.sessionId;
    present.add(sessionId);
    const rest: Entry = { ...entry };
    const instructions: LaunchInstructions = {};
    for (const field of INSTRUCTION_FIELDS) {
      if (rest[field] !== undefined) instructions[field] = rest[field];
      delete rest[field];
    }
    const previous = this.saved.get(sessionId);
    const hasInstructions = Object.keys(instructions).length > 0;
    // Compared by identity: a launch assigns new values, and an unchanged string compares instantly.
    if (previous && INSTRUCTION_FIELDS.every((field) => previous[field] === instructions[field])) return rest;
    if (!previous && !hasInstructions) return rest;
    if (hasInstructions) {
      changed.set(sessionId, instructions);
      this.saved.set(sessionId, instructions);
    } else {
      removed.push(sessionId);
    }
    return rest;
  }

  private async writeInstructions(changed: Map<string, LaunchInstructions>, removed: string[]): Promise<void> {
    if (changed.size) await mkdir(join(this.dir, INSTRUCTIONS_DIR), { recursive: true });
    for (const [sessionId, instructions] of changed) {
      try {
        await writeFile(this.instructionsPath(sessionId), JSON.stringify(instructions), "utf-8");
      } catch (error) {
        // Not on disk after all, so the next save writes it again.
        if (this.saved.get(sessionId) === instructions) this.saved.delete(sessionId);
        throw error;
      }
    }
    for (const sessionId of removed) {
      await unlink(this.instructionsPath(sessionId)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  private instructionsPath(sessionId: string): string {
    return join(this.dir, INSTRUCTIONS_DIR, `${sessionId}.json`);
  }
}

function isEntry(entry: unknown): entry is Entry & { sessionId: string } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as Entry).sessionId === "string" &&
    SAFE_SESSION_ID.test((entry as Entry).sessionId as string)
  );
}
