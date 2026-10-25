import { useCallback, useEffect, useSyncExternalStore, type RefObject } from "react";

/** One remembered draft state and where the cursor belongs when it comes back. */
interface DraftState {
  text: string;
  cursor: number;
}

/** Typing within this pause joins the previous undo step. */
const TYPING_GROUP_MS = 1000;
const MAX_STEPS = 100;

/**
 * Undo and redo for a composer draft.
 *
 * The draft text changes from many places (typing, paste, voice transcripts, autocomplete,
 * drafts synced from another browser), and the textarea's native undo stack loses track as
 * soon as React sets its value. So the history watches the draft itself: every change is a
 * step, except that consecutive single-character typing within a short pause joins one step.
 */
export class ComposerUndoHistory {
  private past: DraftState[] = [];
  private future: DraftState[] = [];
  private current: DraftState;
  private lastChangeAt = 0;
  private lastChangeWasTyping = false;
  private listeners = new Set<() => void>();
  /** Bumped on every change, so React can tell when to show new button states. */
  version = 0;

  constructor(text: string) {
    this.current = { text, cursor: text.length };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records the draft's text after a change; returns whether anything was recorded. */
  record(text: string, cursor: number, now: number): boolean {
    if (text === this.current.text) return false;
    const typing = Math.abs(text.length - this.current.text.length) === 1;
    const joinsGroup = typing && this.lastChangeWasTyping && now - this.lastChangeAt < TYPING_GROUP_MS;
    if (!joinsGroup) {
      this.past.push(this.current);
      if (this.past.length > MAX_STEPS) this.past.shift();
    }
    this.current = { text, cursor };
    this.future = [];
    this.lastChangeAt = now;
    this.lastChangeWasTyping = typing;
    this.changed();
    return true;
  }

  /** Steps back; returns the state to show, or null when there is nothing to undo. */
  undo(): DraftState | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.current);
    this.current = previous;
    this.lastChangeWasTyping = false;
    this.changed();
    return previous;
  }

  /** Steps forward again after an undo; returns the state to show, or null. */
  redo(): DraftState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    this.lastChangeWasTyping = false;
    this.changed();
    return next;
  }

  /** Forgets every step, for example once the draft was sent. */
  reset(text: string): void {
    this.past = [];
    this.future = [];
    this.current = { text, cursor: text.length };
    this.lastChangeWasTyping = false;
    this.changed();
  }
}

// Kept per session outside React so the history survives switching threads and remounts.
const histories = new Map<string, ComposerUndoHistory>();

/** Forgets every session's history; tests use it so one test's draft changes don't leak into the next. */
export function clearComposerUndoHistoriesForTest(): void {
  histories.clear();
}

/**
 * Watches a session's composer draft and offers undo and redo over it.
 * `apply` writes a restored text back to the draft.
 */
export function useComposerUndoHistory({
  sessionId,
  text,
  apply,
  textareaRef,
}: {
  sessionId: string;
  text: string;
  apply: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const history = histories.get(sessionId) ?? new ComposerUndoHistory(text);
  histories.set(sessionId, history);
  useSyncExternalStore(history.subscribe, () => history.version);

  useEffect(() => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    histories.get(sessionId)?.record(text, cursor, Date.now());
  }, [sessionId, text, textareaRef]);

  const restore = useCallback(
    (state: { text: string; cursor: number } | null) => {
      if (!state) return;
      apply(state.text);
      const el = textareaRef.current;
      // Only place the cursor in a textarea that already has focus: focusing it would open the phone keyboard.
      if (el && document.activeElement === el) {
        requestAnimationFrame(() => el.setSelectionRange(state.cursor, state.cursor));
      }
    },
    [apply, textareaRef],
  );

  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: useCallback(() => restore(histories.get(sessionId)?.undo() ?? null), [restore, sessionId]),
    redo: useCallback(() => restore(histories.get(sessionId)?.redo() ?? null), [restore, sessionId]),
    reset: useCallback((nextText: string) => histories.get(sessionId)?.reset(nextText), [sessionId]),
  };
}
