import { mkdirSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionTimer, SessionTimerFile } from "./timer-types.js";

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

function normalizeLegacyPrompt(prompt: unknown): { title: string; description: string } {
  const raw = String(prompt ?? "").trim();
  if (!raw) return { title: "Timer", description: "" };

  const normalizedNewlines = raw.replace(/\r\n?/g, "\n");

  const dashDivider = splitOnce(normalizedNewlines, " -- ");
  if (dashDivider) return dashDivider;

  const newlineDivider = splitOnce(normalizedNewlines, "\n");
  if (newlineDivider) return newlineDivider;

  const colonDivider = splitOnce(normalizedNewlines, ": ");
  if (colonDivider) return colonDivider;

  const sentenceDivider = splitOnce(normalizedNewlines, ". ");
  if (sentenceDivider) return sentenceDivider;

  const title = raw.length > 72 ? `${raw.slice(0, 69).trimEnd()}...` : raw;
  return { title, description: raw.length > 72 ? raw : "" };
}

function splitOnce(text: string, divider: string): { title: string; description: string } | null {
  const index = text.indexOf(divider);
  if (index === -1) return null;
  const title = text.slice(0, index).trim();
  const description = text.slice(index + divider.length).trim();
  if (!title) return null;
  return { title, description };
}

function normalizeTimer(sessionId: string, timer: SessionTimer | (SessionTimer & { prompt?: unknown })): SessionTimer {
  const { prompt: _legacyPrompt, ...rest } = timer as SessionTimer & { prompt?: unknown };
  const title = typeof timer.title === "string" ? timer.title.trim() : "";
  const description = typeof timer.description === "string" ? timer.description.trim() : undefined;
  if (title) {
    return {
      ...rest,
      sessionId,
      title,
      description: description ?? normalizeLegacyPrompt((timer as { prompt?: unknown }).prompt).description,
    };
  }

  const normalized = normalizeLegacyPrompt((timer as { prompt?: unknown }).prompt);
  return {
    ...rest,
    sessionId,
    title: normalized.title,
    description: description ?? normalized.description,
  };
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
    data.timers = data.timers.map((timer) => normalizeTimer(sessionId, timer as SessionTimer & { prompt?: unknown }));
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
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
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
