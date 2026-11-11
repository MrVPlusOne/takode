import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

/** One tab the user viewed: a session, and for leaders the thread tab on screen. */
export interface ViewedTab {
  sessionId: string;
  /** The leader thread tab ("main", "all" or a quest ID); null for sessions without thread tabs. */
  threadKey: string | null;
  viewedAt: number;
  /** Viewed in the side column rather than the main view, so it is not what the main view shows. */
  side?: boolean;
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

/**
 * Move a tab to the top of the history, or add it. A side-column view (`side`) of the tab the main
 * view shows changes nothing: that entry stays the current one.
 */
export function recordViewedTab(
  sessionId: string,
  threadKey: string | null,
  now = Date.now(),
  { side = false }: { side?: boolean } = {},
): void {
  const current = getViewHistory();
  const same = (entry: ViewedTab) => entry.sessionId === sessionId && entry.threadKey === threadKey;
  const main = current.find((entry) => !entry.side);
  if (side && main && same(main)) return;
  const entry: ViewedTab = { sessionId, threadKey, viewedAt: now, ...(side ? { side } : {}) };
  entries = [entry, ...current.filter((other) => !same(other))].slice(0, MAX_ENTRIES);
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
        typeof entry.viewedAt === "number" &&
        (entry.side === undefined || typeof entry.side === "boolean"),
    );
  } catch (error) {
    console.warn("[view-history] ignoring unreadable saved history:", error);
    return [];
  }
}
