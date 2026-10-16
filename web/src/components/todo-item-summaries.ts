import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TodoItemSummaries } from "../../shared/todo-types.js";
import { api } from "../api.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";

/** Where to-do summaries come from: the server, or the Playground's mock list. */
export interface TodoItemSummarySource {
  load: () => Promise<TodoItemSummaries>;
}

export const SERVER_TODO_ITEM_SUMMARIES: TodoItemSummarySource = { load: () => api.getTodoItemSummaries() };

interface SummaryCache {
  summaries: TodoItemSummaries | null;
  loading: boolean;
  reloadAfterLoad: boolean;
  watching: boolean;
  listeners: Set<() => void>;
}

const caches = new WeakMap<TodoItemSummarySource, SummaryCache>();

/**
 * Every to-do's status, due date and archive time, `null` until they first load.
 *
 * All readers of a source share one cached copy, so a to-do link that mounts later (scrolling,
 * switching threads) renders its final marker straight away instead of loading it.
 */
export function useTodoItemSummaries(source: TodoItemSummarySource): TodoItemSummaries | null {
  const cache = cacheFor(source);
  const subscribe = useCallback(
    (listener: () => void) => {
      cache.listeners.add(listener);
      return () => cache.listeners.delete(listener);
    },
    [cache],
  );
  useEffect(() => watchTodoItemSummaries(source), [source]);
  return useSyncExternalStore(subscribe, () => cache.summaries);
}

/**
 * Start loading a source's summaries and keep them current: they reload whenever the to-do list
 * changes and when the page becomes visible again (a phone may have missed changes while asleep).
 * Idempotent; the server source is watched for the page's lifetime from app start.
 */
export function watchTodoItemSummaries(source: TodoItemSummarySource): void {
  const cache = cacheFor(source);
  if (cache.watching) return;
  cache.watching = true;
  const reload = () => load(source, cache);
  window.addEventListener(TODO_STATE_UPDATED_EVENT, reload);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reload();
  });
  reload();
}

/** Take summaries the page already has, such as an open preview's full list, ignoring older revisions. */
export function applyTodoItemSummaries(source: TodoItemSummarySource, update: TodoItemSummaries): void {
  const cache = cacheFor(source);
  if (cache.summaries && update.revision < cache.summaries.revision) return;
  cache.summaries = update;
  for (const listener of cache.listeners) listener();
}

function cacheFor(source: TodoItemSummarySource): SummaryCache {
  let cache = caches.get(source);
  if (!cache) {
    cache = { summaries: null, loading: false, reloadAfterLoad: false, watching: false, listeners: new Set() };
    caches.set(source, cache);
  }
  return cache;
}

function load(source: TodoItemSummarySource, cache: SummaryCache): void {
  // A change during a load may not be in its answer, so load once more after it.
  if (cache.loading) {
    cache.reloadAfterLoad = true;
    return;
  }
  cache.loading = true;
  Promise.resolve()
    .then(() => source.load())
    .then((update) => applyTodoItemSummaries(source, update))
    .catch((error: unknown) => console.warn("[todos] Could not load to-do summaries:", error))
    .finally(() => {
      cache.loading = false;
      if (!cache.reloadAfterLoad) return;
      cache.reloadAfterLoad = false;
      load(source, cache);
    });
}
