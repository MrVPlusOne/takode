import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export interface AuxiliaryWorktreeRegistration {
  sessionId: string;
  worktreePath: string;
  repoRoot: string;
  gitDir: string;
  identity: string;
  branch: string | null;
  baseBranch?: string;
  retention: "temporary" | "retained";
  createdAt: number;
  cleanupStatus?: "pending" | "done" | "blocked" | "failed";
  cleanupReason?: string;
}

function parseRegistrations(value: unknown): AuxiliaryWorktreeRegistration[] {
  if (!Array.isArray(value)) throw new Error("Invalid auxiliary worktree metadata");
  for (const record of value) {
    if (
      !record ||
      typeof record !== "object" ||
      ["sessionId", "worktreePath", "repoRoot", "gitDir", "identity"].some(
        (key) => typeof record[key] !== "string" || !record[key],
      ) ||
      (record.branch !== null && typeof record.branch !== "string") ||
      (record.baseBranch !== undefined && typeof record.baseBranch !== "string") ||
      !["temporary", "retained"].includes(record.retention) ||
      !Number.isFinite(record.createdAt) ||
      (record.cleanupStatus !== undefined &&
        !["pending", "done", "blocked", "failed"].includes(record.cleanupStatus)) ||
      (record.cleanupReason !== undefined && typeof record.cleanupReason !== "string")
    ) {
      throw new Error("Invalid auxiliary worktree metadata; cleanup refused");
    }
  }
  return value;
}

/** Session-associated ownership metadata, retained independently of session deletion. */
export class AuxiliaryWorktreeRegistry {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async list(sessionId?: string): Promise<AuxiliaryWorktreeRegistration[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    // Corrupt ownership metadata must never turn into permission to delete.
    const records = parseRegistrations(JSON.parse(text));
    return sessionId ? records.filter((record) => record.sessionId === sessionId) : records;
  }

  /** Serialize registration and cleanup across local servers, using fresh disk authority. */
  update<T>(operation: (records: AuxiliaryWorktreeRegistration[]) => Promise<T>): Promise<T> {
    const task = this.tail.then(() => this.updateLocked(operation));
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async updateLocked<T>(operation: (records: AuxiliaryWorktreeRegistration[]) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Worktree registration/cleanup is busy. Retry later; a persistent lock requires inspection: ${lockPath}`,
        );
      }
      throw error;
    }
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      const records = await this.list();
      const result = await operation(records);
      const file = await open(temporaryPath, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(records, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, this.path);
      return result;
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          console.warn("Worktree metadata temp cleanup failed", error);
      });
      await lock.close();
      await unlink(lockPath);
    }
  }
}
