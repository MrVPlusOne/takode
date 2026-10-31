import { useCallback, useSyncExternalStore } from "react";
import { scopedGetItem, setLocalStorageItem } from "./scoped-storage.js";

/**
 * Which collapsible sections and groups the user folded or opened, remembered in this browser. Every
 * fold in the app that the user would expect to stay as they left it (sidebar groups, the archive,
 * Overview and topic-page sections, Session Info sections, side-column overview, to-do categories,
 * worker lists under leader cards) reads and writes it here, so they all survive reloads, view and
 * session switches and reconnects the same way.
 *
 * - One localStorage entry maps a fold's ID to whether it is folded. Only explicit choices are kept;
 *   a fold the user never touched shows its own default.
 * - A change re-reads the entry before writing, so a choice made in another tab is never overwritten
 *   with this tab's older copy, and other tabs follow the change through the `storage` event.
 * - It stays small: the least recently changed choices drop out past {@link MAX_FOLDS}.
 *
 * Folds are per browser on purpose: phones and desktops lay sections out differently, and Takode
 * treats open/closed sections as local UI state. IDs are namespaced by surface, such as
 * `sidebar:archived` or `stack:sidebar-topics:sessions`.
 */

export const REMEMBERED_FOLDS_KEY = "cc-folds";
const MAX_FOLDS = 1000;

type Folds = Map<string, boolean>;

/** The parsed entry, with the saved text it came from: a change there (another tab) re-reads it. */
let cache: { raw: string | null; folds: Folds } | null = null;
let migrated = false;
const listeners = new Set<() => void>();

/** Whether the fold `id` is folded: the user's last choice, else `foldedByDefault`. */
export function isRememberedFolded(id: string, foldedByDefault = false): boolean {
  return folds().get(id) ?? foldedByDefault;
}

/** Remembers that the fold `id` is folded (or open). */
export function setRememberedFolded(id: string, folded: boolean): void {
  // `folds()` starts from what is saved, so another tab's newer choices survive.
  const next = new Map(folds());
  next.delete(id);
  next.set(id, folded);
  while (next.size > MAX_FOLDS) next.delete(next.keys().next().value as string);
  const raw = JSON.stringify(Object.fromEntries(next));
  // When the save fails (a full storage), the choice still holds in this page until storage changes.
  cache = { raw: setLocalStorageItem(REMEMBERED_FOLDS_KEY, raw) ? raw : storedRaw(), folds: next };
  notify();
}

export function toggleRememberedFold(id: string, foldedByDefault = false): void {
  setRememberedFolded(id, !isRememberedFolded(id, foldedByDefault));
}

/** IDs starting with `prefix` (without it) whose remembered state is `folded`. */
export function rememberedFoldIds(prefix: string, folded = true): string[] {
  return [...folds()].flatMap(([id, value]) =>
    id.startsWith(prefix) && value === folded ? [id.slice(prefix.length)] : [],
  );
}

/** Calls `listener` whenever a fold changes, in this tab or another. Returns the unsubscribe. */
export function subscribeRememberedFolds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One fold: whether it is folded, and a toggle. */
export function useRememberedFold(id: string, foldedByDefault = false): [boolean, () => void] {
  const folded = useSyncExternalStore(subscribeRememberedFolds, () => isRememberedFolded(id, foldedByDefault));
  const toggle = useCallback(() => toggleRememberedFold(id, foldedByDefault), [id, foldedByDefault]);
  return [folded, toggle];
}

/**
 * Any number of folds whose IDs are known only while rendering (a list's groups or sections). The
 * component re-renders when any fold changes.
 */
export function useRememberedFolds(): {
  isFolded: (id: string, foldedByDefault?: boolean) => boolean;
  toggle: (id: string, foldedByDefault?: boolean) => void;
} {
  const snapshot = useSyncExternalStore(subscribeRememberedFolds, folds);
  const isFolded = useCallback(
    (id: string, foldedByDefault = false) => snapshot.get(id) ?? foldedByDefault,
    [snapshot],
  );
  return { isFolded, toggle: toggleRememberedFold };
}

/** Forgets the parsed entry and lets earlier builds' folds move again, as on a fresh page load. */
export function resetRememberedFoldsForTest(): void {
  cache = null;
  migrated = false;
}

function folds(): Folds {
  if (!migrated) {
    migrated = true;
    migrateLegacyFolds();
  }
  const raw = storedRaw();
  if (!cache || cache.raw !== raw) cache = { raw, folds: parseFolds(raw) };
  return cache.folds;
}

function storedRaw(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(REMEMBERED_FOLDS_KEY);
}

function parseFolds(raw: string | null): Folds {
  if (raw === null) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch (error) {
    console.warn("[folds] Ignoring unreadable remembered folds:", error);
    return new Map();
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // `folds()` sees the new text and re-reads it; this only tells the folds on screen.
    if (event.key === REMEMBERED_FOLDS_KEY || event.key === null) notify();
  });
}

// ── Folds saved before they were kept here ──────────────────────────────────────────────────────

/** Folds that used to keep their own entries (some per server), by key. Each moves here once. */
const LEGACY_SETS: { key: string; idOf: (value: string) => string; folded: boolean }[] = [
  { key: "cc-collapsed-tree-groups", idOf: (id) => `space:${id}`, folded: true },
  { key: "cc-collapsed-tree-nodes", idOf: (id) => `tree-node:${id}`, folded: true },
  { key: "cc-expanded-herd-nodes", idOf: (id) => `workers:${id}`, folded: false },
  { key: "cc-todo-collapsed-categories", idOf: (id) => `todo-category:${id}`, folded: true },
  { key: "cc-overview-open", idOf: (name) => `overview:${name}`, folded: false },
];
const LEGACY_TOPIC_SECTIONS_KEY = "cc-topic-collapsed-sections";
const LEGACY_COLLAPSE_PREFIX = "cc-collapse-";
const STACKED_PANES_KEY = "cc-stacked-panes";
const SIDE_COLUMNS_KEY = "cc-side-columns";

/**
 * Moves folds saved by earlier builds into the shared entry, the first time it is read, and removes
 * the old entries (including copies kept for other servers, which nothing reads any more). Layout
 * entries that also held folds (stacked panes, side columns) keep their other state.
 */
function migrateLegacyFolds(): void {
  if (typeof localStorage === "undefined" || localStorage.getItem(REMEMBERED_FOLDS_KEY) !== null) return;
  try {
    const found: [string, boolean][] = [];
    for (const { key, idOf, folded } of LEGACY_SETS) {
      for (const value of parseJson<unknown[]>(scopedGetItem(key), [])) {
        if (typeof value === "string") found.push([idOf(value), folded]);
      }
    }
    const topics = parseJson<Record<string, Record<string, unknown>>>(scopedGetItem(LEGACY_TOPIC_SECTIONS_KEY), {});
    for (const [topicId, sections] of Object.entries(topics)) {
      for (const [name, folded] of Object.entries(sections ?? {})) {
        if (typeof folded === "boolean") found.push([`topic:${topicId}:${name}`, folded]);
      }
    }
    const legacyKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {
      if (!key.startsWith(LEGACY_COLLAPSE_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value === "1" || value === "0") found.push([key, value === "1"]);
    }
    found.push(...takeStackedPaneFolds(), ...takeSideOverviewFolds());
    setLocalStorageItem(REMEMBERED_FOLDS_KEY, JSON.stringify(Object.fromEntries(found)));
    const retired = [...LEGACY_SETS.map((entry) => entry.key), LEGACY_TOPIC_SECTIONS_KEY];
    for (const key of legacyKeys) {
      const isLegacy =
        key.startsWith(LEGACY_COLLAPSE_PREFIX) || retired.some((name) => key === name || key.endsWith(`:${name}`));
      if (isLegacy) localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn("[folds] Could not move earlier saved folds:", error);
  }
}

/** Stacked panes kept `folded` beside their sizes; the sizes stay where they are. */
function takeStackedPaneFolds(): [string, boolean][] {
  const stacks = parseJson<Record<string, { folded?: unknown; weights?: unknown }>>(
    localStorage.getItem(STACKED_PANES_KEY),
    {},
  );
  const found: [string, boolean][] = [];
  for (const [stackId, stack] of Object.entries(stacks)) {
    if (!Array.isArray(stack?.folded)) continue;
    for (const paneId of stack.folded) if (typeof paneId === "string") found.push([`stack:${stackId}:${paneId}`, true]);
    delete stack.folded;
  }
  if (found.length) setLocalStorageItem(STACKED_PANES_KEY, JSON.stringify(stacks));
  return found;
}

/** Side columns kept whether each leader's overview was folded beside their items. */
function takeSideOverviewFolds(): [string, boolean][] {
  const columns = parseJson<Record<string, { overviewFolded?: unknown }>>(localStorage.getItem(SIDE_COLUMNS_KEY), {});
  const found: [string, boolean][] = [];
  for (const [leaderId, column] of Object.entries(columns)) {
    if (typeof column?.overviewFolded !== "boolean") continue;
    found.push([`side-overview:${leaderId}`, column.overviewFolded]);
    delete column.overviewFolded;
  }
  if (found.length) setLocalStorageItem(SIDE_COLUMNS_KEY, JSON.stringify(columns));
  return found;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}
