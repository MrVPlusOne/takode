import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { claimPawLanding, liveAnswerArrivalMark } from "../utils/live-answer-arrivals.js";
import { CatPawLeft } from "./CatIcons.js";

/**
 * Counter state for sequential paw index assignment.
 * Uses a Map keyed by React useId() to make index assignment
 * idempotent — safe under StrictMode's double-invocation of
 * useState initializers.
 */
export type PawCounterState = {
  next: number;
  cache: Map<string, number>;
};

export const PawCounterContext = createContext<React.MutableRefObject<PawCounterState>>({
  current: { next: 0, cache: new Map() },
} as React.MutableRefObject<PawCounterState>);

/**
 * When true, child components should not render their own PawTrailAvatar.
 * Used in collapsed turns where a single paw is placed outside the card.
 */
export const HidePawContext = createContext(false);

/**
 * How one paw marker looks, written to its `data-paw-state` attribute and drawn
 * by the `.paw-trail` rules in index.css. Without the attribute a paw is a dot.
 */
type PawState = "paw" | "landing" | "settling" | "dot";

interface PawRegistration {
  el: HTMLElement;
  /** The answer this paw marks; only answers that arrived live can land. */
  messageId?: string;
}

const PawTrailContext = createContext<{ register: (paw: PawRegistration) => () => void } | null>(null);

/**
 * Coordinates the feed's paw markers: every answer rests as a dot and the
 * newest one keeps a paw. When a new answer arrives while the feed is open,
 * its paw lands and the previous newest paw settles into a dot, so the paw
 * walks down the feed. Nothing runs while scrolling; states change only when
 * paws mount or unmount, and CSS plays the animations.
 *
 * `scopeKey` identifies the view (session and thread): changing it counts as
 * opening a new view, so answers that arrived before it never land.
 * `showNewestPaw` is false while the newest part of the history is not loaded.
 */
export function PawTrailProvider({
  scopeKey,
  showNewestPaw,
  children,
}: {
  scopeKey: string;
  showNewestPaw: boolean;
  children: React.ReactNode;
}) {
  const paws = useRef(new Set<PawRegistration>());
  const newest = useRef<PawRegistration | null>(null);
  const view = useRef<{ scopeKey: string | null; openedMark: number }>({ scopeKey: null, openedMark: 0 });
  const latest = useRef({ scopeKey, showNewestPaw });
  latest.current = { scopeKey, showNewestPaw };
  const scheduled = useRef(false);

  const update = useCallback(() => {
    scheduled.current = false;
    if (view.current.scopeKey !== latest.current.scopeKey) {
      view.current = { scopeKey: latest.current.scopeKey, openedMark: liveAnswerArrivalMark() };
    }
    let next: PawRegistration | null = null;
    if (latest.current.showNewestPaw) {
      for (const paw of paws.current) {
        if (!next || next.el.compareDocumentPosition(paw.el) & Node.DOCUMENT_POSITION_FOLLOWING) next = paw;
      }
    }
    const previous = newest.current;
    if (next === previous) return;
    newest.current = next;
    const landing = !!next?.messageId && claimPawLanding(next.messageId, view.current.openedMark);
    if (previous && paws.current.has(previous)) setPawState(previous.el, landing ? "settling" : "dot");
    if (next) setPawState(next.el, landing ? "landing" : "paw");
  }, []);

  // Mounts arrive in bursts (a new turn, a window slide); settle them in one pass
  // after the commit so DOM order is final.
  const schedule = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(update);
  }, [update]);

  const register = useCallback(
    (paw: PawRegistration) => {
      paws.current.add(paw);
      schedule();
      return () => {
        paws.current.delete(paw);
        schedule();
      };
    },
    [schedule],
  );

  useEffect(schedule, [schedule, scopeKey, showNewestPaw]);

  const value = useMemo(() => ({ register }), [register]);
  return <PawTrailContext.Provider value={value}>{children}</PawTrailContext.Provider>;
}

function setPawState(el: HTMLElement, state: PawState) {
  el.dataset.pawState = state;
}

/**
 * The rail marker beside an answer: a dot, or a paw while it marks the newest
 * answer (see PawTrailProvider). Paws alternate left and right like a walk.
 * Outside a PawTrailProvider (previews, tests) it always shows the dot.
 */
export function PawTrailAvatar({ messageId }: { messageId?: string }) {
  const componentId = useId();
  const counter = useContext(PawCounterContext);
  const [index] = useState(() => {
    const { cache } = counter.current;
    const cached = cache.get(componentId);
    if (cached !== undefined) return cached;
    const idx = counter.current.next++;
    cache.set(componentId, idx);
    return idx;
  });
  const ref = useRef<HTMLDivElement>(null);
  const trail = useContext(PawTrailContext);

  useEffect(() => {
    if (!trail || !ref.current) return;
    return trail.register({ el: ref.current, messageId });
  }, [trail, messageId]);

  return (
    <div
      ref={ref}
      data-paw-side={index % 2 === 0 ? "left" : "right"}
      className="paw-trail relative w-3.5 h-3.5 rounded-full bg-cc-primary/10 flex items-center justify-center shrink-0 mt-1.5"
    >
      <CatPawLeft className="paw-trail-paw absolute w-3 h-3 text-cc-primary pointer-events-none" />
      <div className="paw-trail-dot w-1.5 h-1.5 rounded-full bg-cc-primary/50 pointer-events-none" />
    </div>
  );
}
