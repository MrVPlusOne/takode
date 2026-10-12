import { useEffect, useState, useSyncExternalStore } from "react";

const SCROLL_IDLE_MS = 1500;

/** Whether the feed scrolled recently, held outside React state so scrolling does not re-render the whole feed. */
export interface ScrollActivity {
  markScrolling(): void;
  subscribe(listener: () => void): () => void;
  isActive(): boolean;
}

/** Create the feed's scroll-activity signal once and stop its timer on unmount. */
export function useScrollActivity(): ScrollActivity {
  const [state] = useState(createScrollActivity);
  useEffect(() => state.dispose, [state]);
  return state.activity;
}

/** Re-render only the caller when scrolling starts or stops. */
export function useIsScrolling(activity: ScrollActivity | undefined): boolean {
  return useSyncExternalStore(activity?.subscribe ?? subscribeNever, activity?.isActive ?? notActive);
}

function createScrollActivity(): { activity: ScrollActivity; dispose: () => void } {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    for (const listener of listeners) listener();
  };
  return {
    activity: {
      markScrolling() {
        setActive(true);
        clearTimeout(timer);
        timer = setTimeout(() => setActive(false), SCROLL_IDLE_MS);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isActive: () => active,
    },
    dispose: () => clearTimeout(timer),
  };
}

const subscribeNever = () => () => {};
const notActive = () => false;
