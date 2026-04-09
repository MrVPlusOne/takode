import { mkdirSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionTimerFile } from "./timer-types.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const COMPANION_DIR = join(homedir(), ".companion");
const TIMER_DIR = join(COMPANION_DIR, "timers");

// Cold-path initialization -- sync is fine here (runs once at module load)
mkdirSync(TIMER_DIR, { recursive: true }); // sync-ok: cold path, once at module load

function filePath(sessionId: string): string {
  return join(TIMER_DIR, `${sessionId}.json`);
}

/** Return an empty timer file for a session (define errors out of existence). */
function emptyFile(sessionId: string): SessionTimerFile {
  return { sessionId, nextId: 1, timers: [] };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Load all timers for a session. Returns empty file struct if no file exists.
 *  Logs a warning for non-ENOENT errors (corrupt data, permission issues). */
export async function loadTimers(sessionId: string): Promise<SessionTimerFile> {
  try {
    const raw = await readFile(filePath(sessionId), "utf-8");
    const data = JSON.parse(raw) as SessionTimerFile;
    // Defensive: ensure required fields exist even if file is partially corrupt
    if (!data.timers || !Array.isArray(data.timers)) return emptyFile(sessionId);
    if (typeof data.nextId !== "number") data.nextId = 1;
    data.sessionId = sessionId;
    return data;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[timer-store] Failed to load timers for ${sessionId}:`, err);
    }
    return emptyFile(sessionId);
  }
}

/** Save the full timer file for a session (atomic overwrite). */
export async function saveTimers(data: SessionTimerFile): Promise<void> {
  await writeFile(filePath(data.sessionId), JSON.stringify(data, null, 2), "utf-8");
}

/** Delete the timer file for a session (on archive/cleanup).
 *  No-op if the file doesn't exist. */
export async function deleteTimers(sessionId: string): Promise<void> {
  try {
    await unlink(filePath(sessionId));
  } catch {
    // File already deleted or never existed -- not an error
  }
}

/** List all session IDs that have timer files (for startup restore). */
export async function listTimerSessions(): Promise<string[]> {
  try {
    const files = await readdir(TIMER_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("[timer-store] Failed to list timer sessions:", err);
    }
    return [];
  }
}

/** Expose TIMER_DIR for testing. */
export function getTimerDir(): string {
  return TIMER_DIR;
}
