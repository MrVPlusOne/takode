import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * A message shows no time of its own when the next time shown on its side of the feed
 * is less than this much later. Labels have minute resolution, so within a couple of
 * minutes a second label repeats nearly the same time; from three minutes apart the
 * difference starts to say something.
 */
export const MESSAGE_TIME_CLUSTER_MS = 3 * 60 * 1000;

export type MessageTimeSide = "user" | "assistant";

interface MessageTimeEntry {
  id: string;
  side: MessageTimeSide;
  timestamp: number;
}

/**
 * Which messages' time labels to hide: within a run of consecutive messages from the
 * same side, a message is covered by the next label shown after it when that label is
 * less than MESSAGE_TIME_CLUSTER_MS later. A message from the other side ends the run.
 * Hiding depends only on newer messages, so loading older history never changes the
 * labels already on screen.
 */
export function hiddenMessageTimeLabels(entries: readonly MessageTimeEntry[]): Set<string> {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const hidden = new Set<string>();
  let nextSide: MessageTimeSide | null = null;
  let nextShownAt = Number.POSITIVE_INFINITY;
  for (let index = sorted.length - 1; index >= 0; index--) {
    const entry = sorted[index]!;
    if (entry.side === nextSide && nextShownAt - entry.timestamp < MESSAGE_TIME_CLUSTER_MS) {
      hidden.add(entry.id);
    } else {
      nextShownAt = entry.timestamp;
    }
    nextSide = entry.side;
  }
  return hidden;
}

/**
 * The time labels one feed has on screen. Each label registers while mounted; the store
 * works out which ones a newer neighbour covers and tells the labels.
 */
export class MessageTimeLabelStore {
  private entries = new Map<string, MessageTimeEntry>();
  private hidden = new Set<string>();
  private listeners = new Set<() => void>();
  private recomputeQueued = false;

  register(entry: MessageTimeEntry): () => void {
    this.entries.set(entry.id, entry);
    this.queueRecompute();
    return () => {
      if (this.entries.get(entry.id) !== entry) return;
      this.entries.delete(entry.id);
      this.queueRecompute();
    };
  }

  isHidden = (id: string): boolean => this.hidden.has(id);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // Registrations arrive one label at a time during a commit; one pass handles them all.
  private queueRecompute() {
    if (this.recomputeQueued) return;
    this.recomputeQueued = true;
    queueMicrotask(() => {
      this.recomputeQueued = false;
      const next = hiddenMessageTimeLabels([...this.entries.values()]);
      if (next.size === this.hidden.size && [...next].every((id) => this.hidden.has(id))) return;
      this.hidden = next;
      for (const listener of this.listeners) listener();
    });
  }
}

export const MessageTimeLabelContext = createContext<MessageTimeLabelStore | null>(null);

const subscribeNothing = () => () => {};

/** Whether a newer message on the same side covers this message's time. False outside a feed. */
export function useMessageTimeLabelHidden(id: string, side: MessageTimeSide, timestamp: number): boolean {
  const store = useContext(MessageTimeLabelContext);
  useLayoutEffect(() => store?.register({ id, side, timestamp }), [store, id, side, timestamp]);
  return useSyncExternalStore(
    store ? store.subscribe : subscribeNothing,
    () => store?.isHidden(id) ?? false,
    () => false,
  );
}
