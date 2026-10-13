import { useSyncExternalStore } from "react";

/**
 * Sessions whose row action (archive, unarchive, delete) is waiting on the
 * server. The row dims and pulses meanwhile, so a swipe or menu choice shows it
 * registered before the row moves. Purely local UI state: the server's answer
 * still decides what the list shows.
 */
export async function trackSessionRowAction<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
  pendingCounts.set(sessionId, (pendingCounts.get(sessionId) ?? 0) + 1);
  notify();
  try {
    return await action();
  } finally {
    const remaining = (pendingCounts.get(sessionId) ?? 1) - 1;
    if (remaining > 0) pendingCounts.set(sessionId, remaining);
    else pendingCounts.delete(sessionId);
    notify();
  }
}

/** True while an action started with {@link trackSessionRowAction} is waiting for this session. */
export function useSessionRowPending(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pendingCounts.has(sessionId),
    () => false,
  );
}

const pendingCounts = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}
