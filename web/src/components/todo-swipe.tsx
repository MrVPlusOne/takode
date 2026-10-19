import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { TodoItem, TodoStatus } from "../../shared/todo-types.js";
import { useOutsidePress } from "../hooks/useOutsidePress.js";

const ACTIONS_WIDTH = 144;
const COMPLETE_DISTANCE = 96;
const OPEN_DISTANCE = 56;
const LOCK_DISTANCE = 8;

/**
 * Swipe gestures for a to-do row on touch screens: swipe right to complete, swipe left to reveal
 * Start (or Pause) and More. Vertical moves stay page scrolls (`touch-action: pan-y`), and a mouse
 * never swipes. Put `containerRef` on the row's wrapper, spread `handlers` and `rowStyle` on the row, render
 * `renderBackground` behind it,
 * and ask `consumeClick` before treating a click as a tap.
 */
export function useSwipeActions({ enabled, onComplete }: { enabled: boolean; onComplete: () => void }) {
  const [offset, setOffsetState] = useState(0);
  // The latest offset for the gesture handlers, which may run before React re-renders with it.
  const offsetRef = useRef(0);
  const setOffset = (value: number) => {
    offsetRef.current = value;
    setOffsetState(value);
  };
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; base: number; lock: "h" | "v" | null } | null>(null);
  const swiped = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = offset < 0 && !dragging;

  useOutsidePress([containerRef], () => setOffset(0), open);

  const finish = () => {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (current?.lock !== "h") return;
    const final = offsetRef.current;
    if (final >= COMPLETE_DISTANCE) {
      setOffset(0);
      onComplete();
    } else {
      setOffset(final <= -OPEN_DISTANCE ? -ACTIONS_WIDTH : 0);
    }
  };

  const handlers = enabled
    ? {
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          if (event.pointerType !== "touch") return;
          swiped.current = false;
          gesture.current = { x: event.clientX, y: event.clientY, base: offsetRef.current, lock: null };
        },
        onPointerMove: (event: PointerEvent<HTMLElement>) => {
          const current = gesture.current;
          if (!current || current.lock === "v") return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.lock) {
            if (Math.abs(dy) > LOCK_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
              current.lock = "v";
              return;
            }
            if (Math.abs(dx) < LOCK_DISTANCE) return;
            current.lock = "h";
            swiped.current = true;
            setDragging(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          setOffset(Math.max(-ACTIONS_WIDTH - 24, Math.min(COMPLETE_DISTANCE + 40, current.base + dx)));
        },
        onPointerUp: finish,
        onPointerCancel: finish,
      }
    : {};

  const rowStyle: CSSProperties | undefined = enabled
    ? {
        transform: offset ? `translateX(${offset}px)` : undefined,
        transition: dragging ? "none" : "transform 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        touchAction: "pan-y",
      }
    : undefined;

  /** Whether the click that just arrived ended a swipe or closed open actions, so it is not a tap. */
  const consumeClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return true;
    }
    if (offsetRef.current !== 0) {
      setOffset(0);
      return true;
    }
    return false;
  };

  const renderBackground = ({
    item,
    busy,
    onSetStatus,
    onMore,
  }: {
    item: TodoItem;
    busy: boolean;
    onSetStatus: (status: TodoStatus) => void;
    onMore: () => void;
  }): ReactNode => (
    <div className="absolute inset-0 flex items-stretch justify-between" aria-hidden={offset === 0}>
      <div
        className={`flex items-center pl-4 text-sm font-medium text-white ${offset >= COMPLETE_DISTANCE ? "bg-emerald-500" : "bg-emerald-500/60"} ${offset > 0 ? "" : "invisible"}`}
        style={{ width: Math.max(0, offset) }}
      >
        ✓ Done
      </div>
      <div className={`flex ${offset < 0 ? "" : "invisible"}`} style={{ width: ACTIONS_WIDTH }}>
        <button
          type="button"
          disabled={busy}
          tabIndex={offset < 0 ? 0 : -1}
          onClick={() => {
            setOffset(0);
            onSetStatus(item.status === "todo" ? "doing" : "todo");
          }}
          className="flex-1 bg-amber-500 text-sm text-white disabled:opacity-60"
        >
          {item.status === "todo" ? "Start" : "Pause"}
        </button>
        <button
          type="button"
          tabIndex={offset < 0 ? 0 : -1}
          onClick={() => {
            setOffset(0);
            onMore();
          }}
          className="flex-1 bg-cc-muted/70 text-sm text-white"
        >
          More
        </button>
      </div>
    </div>
  );

  return { containerRef, handlers, rowStyle, consumeClick, renderBackground };
}
