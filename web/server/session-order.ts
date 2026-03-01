import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export type SessionOrderByGroup = Record<string, string[]>;

const DEFAULT_PATH = join(homedir(), ".companion", "session-order.json");

let sessionOrder: SessionOrderByGroup = {};
let loaded = false;
let filePath = DEFAULT_PATH;
let pendingWrite: Promise<void> = Promise.resolve();

function cloneOrder(source: SessionOrderByGroup): SessionOrderByGroup {
  const out: SessionOrderByGroup = {};
  for (const [groupKey, orderedIds] of Object.entries(source)) {
    out[groupKey] = [...orderedIds];
  }
  return out;
}

function sanitizeOrderedIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sanitizeOrder(input: unknown): SessionOrderByGroup {
  if (!input || typeof input !== "object") return {};
  const parsed = input as Record<string, unknown>;
  const out: SessionOrderByGroup = {};
  for (const [rawGroupKey, rawOrderedIds] of Object.entries(parsed)) {
    const groupKey = rawGroupKey.trim();
    if (!groupKey) continue;
    out[groupKey] = sanitizeOrderedIds(rawOrderedIds);
  }
  return out;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(filePath, "utf-8");
    sessionOrder = sanitizeOrder(JSON.parse(raw));
  } catch {
    sessionOrder = {};
  }
  loaded = true;
}

function persist(): void {
  const path = filePath;
  const data = JSON.stringify(sessionOrder, null, 2);
  pendingWrite = pendingWrite
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, "utf-8");
    })
    .catch(() => {});
}

export async function getAllOrder(): Promise<SessionOrderByGroup> {
  await ensureLoaded();
  return cloneOrder(sessionOrder);
}

export async function setAllOrder(next: SessionOrderByGroup): Promise<void> {
  await ensureLoaded();
  sessionOrder = sanitizeOrder(next);
  persist();
}

/** Wait for any pending async writes to complete. Test-only. */
export function _flushForTest(): Promise<void> {
  return pendingWrite;
}

/** Reset internal state and optionally set a custom file path (for testing). */
export function _resetForTest(customPath?: string): void {
  sessionOrder = {};
  loaded = false;
  filePath = customPath || DEFAULT_PATH;
  pendingWrite = Promise.resolve();
}
