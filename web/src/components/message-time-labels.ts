import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * A message shows no time of its own when the last time shown before it on its side of the
 * feed is less than this much earlier. Labels have minute resolution, so within a couple of
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
 * Which messages' time labels to hide: within a run of consecutive messages from the same
 * side, a message shows no time when the last label shown before it is less than
 * MESSAGE_TIME_CLUSTER_MS earlier. Times sit at the start of messages, so a run reads as
 * starting at its first time. A message from the other side ends the run. Hiding depends only
 * on older messages, so a new message never changes the labels above it.
 */
export function hiddenMessageTimeLabels(entries: readonly MessageTimeEntry[]): Set<string> {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const hidden = new Set<string>();
  let previousSide: MessageTimeSide | null = null;
  let lastShownAt = Number.NEGATIVE_INFINITY;
  for (const entry of sorted) {
    if (entry.side === previousSide && entry.timestamp - lastShownAt < MESSAGE_TIME_CLUSTER_MS) {
      hidden.add(entry.id);
    } else {
      lastShownAt = entry.timestamp;
    }
    previousSide = entry.side;
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

/** Whether an earlier message on the same side covers this message's time. False outside a feed. */
export function useMessageTimeLabelHidden(id: string, side: MessageTimeSide, timestamp: number): boolean {
  const store = useContext(MessageTimeLabelContext);
  useLayoutEffect(() => store?.register({ id, side, timestamp }), [store, id, side, timestamp]);
  return useSyncExternalStore(
    store ? store.subscribe : subscribeNothing,
    () => store?.isHidden(id) ?? false,
    () => false,
  );
}

/**
 * The id of a message whose time its wrapper already shows: an answer's one-line reference
 * ("Answers the message above") carries the answer's time at its start, so the message itself
 * shows none.
 */
export const MessageTimeShownByWrapperContext = createContext<string | null>(null);
