import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TodoProposalStatuses } from "../../shared/todo-types.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";

export type TodoProposalStatus = TodoProposalStatuses["statuses"][string];

/** Where proposal statuses come from: the server, or the Playground's mock list. */
export interface TodoProposalStatusSource {
  loadProposalStatuses: () => Promise<TodoProposalStatuses>;
}

interface StatusCache {
  statuses: TodoProposalStatuses["statuses"] | null;
  revision: number;
  loading: boolean;
  reloadAfterLoad: boolean;
  watching: boolean;
  listeners: Set<() => void>;
}

const caches = new WeakMap<TodoProposalStatusSource, StatusCache>();

/**
 * The status of one proposal for the marker on its link: `null` until the statuses first load,
 * `"missing"` when the list has no such proposal.
 *
 * All links share one cached status map per source, so a link that mounts after the first load
 * (scrolling, switching threads) renders its final marker straight away instead of loading it.
 */
export function useTodoProposalStatus(
  source: TodoProposalStatusSource,
  proposalId: string,
): TodoProposalStatus | "missing" | null {
  const cache = cacheFor(source);
  const subscribe = useCallback(
    (listener: () => void) => {
      cache.listeners.add(listener);
      return () => cache.listeners.delete(listener);
    },
    [cache],
  );
  useEffect(() => watchTodoProposalStatuses(source), [source]);
  return useSyncExternalStore(subscribe, () => (cache.statuses ? (cache.statuses[proposalId] ?? "missing") : null));
}

/**
 * Start loading a source's proposal statuses and keep them current: they reload whenever the
 * to-do list changes and when the page becomes visible again (a phone may have missed changes
 * while asleep). Idempotent; the server source is watched for the page's lifetime from app start.
 */
export function watchTodoProposalStatuses(source: TodoProposalStatusSource): void {
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

/** Take statuses from a full list the page already has, such as an open preview's, ignoring older revisions. */
export function applyTodoProposalStatuses(source: TodoProposalStatusSource, update: TodoProposalStatuses): void {
  const cache = cacheFor(source);
  if (cache.statuses && update.revision < cache.revision) return;
  cache.statuses = update.statuses;
  cache.revision = update.revision;
  for (const listener of cache.listeners) listener();
}

function cacheFor(source: TodoProposalStatusSource): StatusCache {
  let cache = caches.get(source);
  if (!cache) {
    cache = {
      statuses: null,
      revision: 0,
      loading: false,
      reloadAfterLoad: false,
      watching: false,
      listeners: new Set(),
    };
    caches.set(source, cache);
  }
  return cache;
}

function load(source: TodoProposalStatusSource, cache: StatusCache): void {
  // A change during a load may not be in its answer, so load once more after it.
  if (cache.loading) {
    cache.reloadAfterLoad = true;
    return;
  }
  cache.loading = true;
  Promise.resolve()
    .then(() => source.loadProposalStatuses())
    .then((update) => applyTodoProposalStatuses(source, update))
    .catch((error: unknown) => console.warn("[todo-links] Could not load proposal statuses:", error))
    .finally(() => {
      cache.loading = false;
      if (!cache.reloadAfterLoad) return;
      cache.reloadAfterLoad = false;
      load(source, cache);
    });
}
