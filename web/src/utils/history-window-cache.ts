import type { BrowserIncomingMessage, HistoryWindowState, ThreadWindowEntry, ThreadWindowState } from "../types.js";
import { normalizeThreadKey } from "./thread-projection.js";

const MAX_HISTORY_ENTRIES_PER_SESSION = 12;
const MAX_THREAD_ENTRIES_PER_THREAD = 12;

const LEGACY_HISTORY_WINDOW_CACHE_KEY_PREFIX = "cc-history-window-cache:";
const LEGACY_THREAD_WINDOW_CACHE_KEY_PREFIX = "cc-thread-window-cache:";

interface HistoryWindowCacheEntry {
  key: string;
  fromTurn: number;
  turnCount: number;
  sectionTurnCount: number;
  visibleSectionCount: number;
  windowHash: string;
  messages: BrowserIncomingMessage[];
  updatedAt: number;
}

interface ThreadWindowCacheEntry {
  key: string;
  threadKey: string;
  fromItem: number;
  itemCount: number;
  sectionItemCount: number;
  visibleItemCount: number;
  windowHash: string;
  entries: ThreadWindowEntry[];
  updatedAt: number;
}

interface WindowCacheEnvelope<TEntry> {
  entries: TEntry[];
}

const historyCacheBySession = new Map<string, WindowCacheEnvelope<HistoryWindowCacheEntry>>();
const threadCacheByKey = new Map<string, WindowCacheEnvelope<ThreadWindowCacheEntry>>();
let legacyWindowCacheCleanupAttempted = false;

export interface HistoryWindowCacheLookup {
  fromTurn: number;
  turnCount: number;
  sectionTurnCount: number;
  visibleSectionCount: number;
}

export interface ThreadWindowCacheLookup {
  threadKey: string;
  fromItem: number;
  itemCount: number;
  sectionItemCount: number;
  visibleItemCount: number;
}

export function getCachedHistoryWindowHash(sessionId: string, lookup: HistoryWindowCacheLookup): string | undefined {
  purgeLegacyPersistedWindowCaches();
  return readHistoryCache(sessionId).entries.find((entry) => entry.key === historyEntryKey(lookup))?.windowHash;
}

export function getCachedThreadWindowHash(sessionId: string, lookup: ThreadWindowCacheLookup): string | undefined {
  purgeLegacyPersistedWindowCaches();
  if (lookup.fromItem < 0) return undefined;
  return readThreadCache(sessionId, lookup.threadKey).entries.find((entry) => entry.key === threadEntryKey(lookup))
    ?.windowHash;
}

export function cacheHistoryWindow(sessionId: string, window: HistoryWindowState, messages: BrowserIncomingMessage[]) {
  purgeLegacyPersistedWindowCaches();
  if (!window.window_hash || messages.length === 0) return;
  const lookup = {
    fromTurn: window.from_turn,
    turnCount: window.turn_count,
    sectionTurnCount: window.section_turn_count,
    visibleSectionCount: window.visible_section_count,
  };
  const entry: HistoryWindowCacheEntry = {
    key: historyEntryKey(lookup),
    ...lookup,
    windowHash: window.window_hash,
    messages,
    updatedAt: Date.now(),
  };
  writeBoundedCache(
    historyCacheBySession,
    sessionId,
    readHistoryCache(sessionId).entries,
    entry,
    MAX_HISTORY_ENTRIES_PER_SESSION,
  );
}

export function cacheThreadWindow(sessionId: string, window: ThreadWindowState, entries: ThreadWindowEntry[]) {
  purgeLegacyPersistedWindowCaches();
  if (!window.window_hash || entries.length === 0) return;
  const lookup = {
    threadKey: window.thread_key,
    fromItem: window.from_item,
    itemCount: window.item_count,
    sectionItemCount: window.section_item_count,
    visibleItemCount: window.visible_item_count,
  };
  const entry: ThreadWindowCacheEntry = {
    key: threadEntryKey(lookup),
    ...lookup,
    threadKey: normalizeThreadKey(lookup.threadKey),
    windowHash: window.window_hash,
    entries,
    updatedAt: Date.now(),
  };
  writeBoundedCache(
    threadCacheByKey,
    threadCacheKey(sessionId, lookup.threadKey),
    readThreadCache(sessionId, lookup.threadKey).entries,
    entry,
    MAX_THREAD_ENTRIES_PER_THREAD,
  );
}

export function invalidateHistoryWindowCache(sessionId: string): void {
  historyCacheBySession.delete(sessionId);
}

export function invalidateThreadWindowCache(sessionId: string, threadKey: string): void {
  threadCacheByKey.delete(threadCacheKey(sessionId, threadKey));
}

export function resolveCachedHistoryWindowMessages(
  sessionId: string,
  window: HistoryWindowState,
): BrowserIncomingMessage[] | null {
  purgeLegacyPersistedWindowCaches();
  if (!window.window_hash) return null;
  const lookup = {
    fromTurn: window.from_turn,
    turnCount: window.turn_count,
    sectionTurnCount: window.section_turn_count,
    visibleSectionCount: window.visible_section_count,
  };
  const entry = readHistoryCache(sessionId).entries.find(
    (candidate) => candidate.key === historyEntryKey(lookup) && candidate.windowHash === window.window_hash,
  );
  return entry?.messages ?? null;
}

export function resolveCachedThreadWindowEntries(
  sessionId: string,
  window: ThreadWindowState,
): ThreadWindowEntry[] | null {
  purgeLegacyPersistedWindowCaches();
  if (!window.window_hash) return null;
  const lookup = {
    threadKey: window.thread_key,
    fromItem: window.from_item,
    itemCount: window.item_count,
    sectionItemCount: window.section_item_count,
    visibleItemCount: window.visible_item_count,
  };
  const entry = readThreadCache(sessionId, window.thread_key).entries.find(
    (candidate) => candidate.key === threadEntryKey(lookup) && candidate.windowHash === window.window_hash,
  );
  return entry?.entries ?? null;
}

export function resetHistoryWindowCacheForTests(): void {
  historyCacheBySession.clear();
  threadCacheByKey.clear();
  legacyWindowCacheCleanupAttempted = false;
}

function historyEntryKey(lookup: HistoryWindowCacheLookup): string {
  return [
    Math.max(0, Math.floor(lookup.fromTurn)),
    Math.max(0, Math.floor(lookup.turnCount)),
    Math.max(1, Math.floor(lookup.sectionTurnCount)),
    Math.max(1, Math.floor(lookup.visibleSectionCount)),
  ].join(":");
}

function threadEntryKey(lookup: ThreadWindowCacheLookup): string {
  return [
    normalizeThreadKey(lookup.threadKey),
    Math.max(0, Math.floor(lookup.fromItem)),
    Math.max(0, Math.floor(lookup.itemCount)),
    Math.max(1, Math.floor(lookup.sectionItemCount)),
    Math.max(1, Math.floor(lookup.visibleItemCount)),
  ].join(":");
}

function threadCacheKey(sessionId: string, threadKey: string): string {
  return `${sessionId}:${normalizeThreadKey(threadKey)}`;
}

function readHistoryCache(sessionId: string): WindowCacheEnvelope<HistoryWindowCacheEntry> {
  return historyCacheBySession.get(sessionId) ?? emptyCache();
}

function readThreadCache(sessionId: string, threadKey: string): WindowCacheEnvelope<ThreadWindowCacheEntry> {
  return threadCacheByKey.get(threadCacheKey(sessionId, threadKey)) ?? emptyCache();
}

function purgeLegacyPersistedWindowCaches(): void {
  if (legacyWindowCacheCleanupAttempted || typeof window === "undefined") return;
  legacyWindowCacheCleanupAttempted = true;
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isLegacyWindowCacheStorageKey(key)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn("[takode] Could not remove legacy persisted window cache entries.", error);
  }
}

function isLegacyWindowCacheStorageKey(key: string): boolean {
  return (
    key.startsWith(LEGACY_HISTORY_WINDOW_CACHE_KEY_PREFIX) ||
    key.includes(`:${LEGACY_HISTORY_WINDOW_CACHE_KEY_PREFIX}`) ||
    key.startsWith(LEGACY_THREAD_WINDOW_CACHE_KEY_PREFIX) ||
    key.includes(`:${LEGACY_THREAD_WINDOW_CACHE_KEY_PREFIX}`)
  );
}

function writeBoundedCache<TEntry extends { key: string; updatedAt: number }>(
  cache: Map<string, WindowCacheEnvelope<TEntry>>,
  cacheKey: string,
  currentEntries: TEntry[],
  entry: TEntry,
  maxEntries: number,
) {
  const deduped = currentEntries.filter((candidate) => candidate.key !== entry.key);
  const entries = [...deduped, entry].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, maxEntries);
  cache.set(cacheKey, { entries });
}

function emptyCache<TEntry>(): WindowCacheEnvelope<TEntry> {
  return { entries: [] };
}
