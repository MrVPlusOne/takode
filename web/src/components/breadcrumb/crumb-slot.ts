import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Where a leader conversation's breadcrumb starts: the strip on screen (quest strip, topic or thread
 * header, Main's strip) leaves a place at its start, and the thread bar, which knows the leader's
 * topics, draws the place picker (Main, All or a topic, with its list) there. One per conversation;
 * the newest strip to mount holds it.
 */
const slots = new Map<string, HTMLElement[]>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** A strip's place for the breadcrumb's first part, as a ref callback for an element. */
export function crumbSlotRef(sessionId: string) {
  let held: HTMLElement | null = null;
  return (element: HTMLElement | null) => {
    const list = slots.get(sessionId) ?? [];
    if (held)
      slots.set(
        sessionId,
        list.filter((slot) => slot !== held),
      );
    held = element;
    if (element) slots.set(sessionId, [...(slots.get(sessionId) ?? []), element]);
    changed();
  };
}

/** The element where this conversation's place picker goes, once a strip has drawn it. */
export function useCrumbSlot(sessionId: string, enabled: boolean): HTMLElement | null {
  const slot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (enabled ? (slots.get(sessionId)?.at(-1) ?? null) : null),
    () => null,
  );
  return slot;
}

/** A stable ref callback for a strip's crumb place. */
export function useCrumbSlotRef(sessionId: string) {
  const ref = useMemo(() => crumbSlotRef(sessionId), [sessionId]);
  // Drops the place if the strip unmounts without React clearing the ref (it always does; belt only).
  useEffect(() => () => ref(null), [ref]);
  return ref;
}
