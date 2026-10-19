import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

/** One tab the user viewed: a session, and for leaders the thread tab on screen. */
export interface ViewedTab {
  sessionId: string;
  /** The leader thread tab ("main", "all" or a quest ID); null for sessions without thread tabs. */
  threadKey: string | null;
  viewedAt: number;
}

const STORAGE_KEY = "cc-view-history";
const MAX_ENTRIES = 40;

let entries: ViewedTab[] | null = null;
const listeners = new Set<() => void>();

/**
 * Recently viewed tabs, newest first, one entry per tab. This browser's own record of where the
 * user has been, kept for the navigation history list; it is local UI state like scroll position,
 * not session state.
 */
export function getViewHistory(): readonly ViewedTab[] {
  entries ??= load();
  return entries;
}

/** Move a tab to the top of the history, or add it. */
export function recordViewedTab(sessionId: string, threadKey: string | null, now = Date.now()): void {
  const current = getViewHistory();
  if (current[0]?.sessionId === sessionId && current[0].threadKey === threadKey) {
    entries = [{ ...current[0], viewedAt: now }, ...current.slice(1)];
  } else {
    const rest = current.filter((entry) => entry.sessionId !== sessionId || entry.threadKey !== threadKey);
    entries = [{ sessionId, threadKey, viewedAt: now }, ...rest].slice(0, MAX_ENTRIES);
  }
  try {
    scopedSetItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("[view-history] failed to save:", error);
  }
  for (const listener of listeners) listener();
}

export function subscribeViewHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget the in-memory copy so the next read loads storage again. For tests. */
export function resetViewHistoryForTest(): void {
  entries = null;
}

function load(): ViewedTab[] {
  try {
    const parsed: unknown = JSON.parse(scopedGetItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ViewedTab =>
        typeof entry?.sessionId === "string" &&
        (entry.threadKey === null || typeof entry.threadKey === "string") &&
        typeof entry.viewedAt === "number",
    );
  } catch (error) {
    console.warn("[view-history] ignoring unreadable saved history:", error);
    return [];
  }
}
