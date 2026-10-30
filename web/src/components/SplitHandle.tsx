import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useStore } from "../store.js";
import { getEffectiveViewportWidth } from "../utils/layout.js";

/**
 * Draggable dividers for side-by-side split views. Every split view in Takode lets people drag
 * its divider to resize the panes (see the `takode-desktop-ui-design` skill): a fixed divider
 * forces one layout on every screen and every task. Widths are a local preference, kept per split
 * in this browser: in pixels, or for panes beside or over the conversation (`share`), as a share of
 * the window, so the pane keeps its proportion when the window changes size.
 */

const STORAGE_KEY = "cc-split-widths";

/** Mounted panes per split, so a width saved in one (another leader's view, kept mounted) reaches all. */
const panes = new Map<string, Set<(stored: number | undefined) => void>>();

function readStoredWidths(): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch (error) {
    console.warn("[split] Ignoring unreadable saved split widths:", error);
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

export interface SplitWidth {
  /** The pane's width in CSS px. */
  width: number;
  /** For the pane: `style={split.style}` with a `md:w-[var(--split-w)]`-style class sets its width. */
  style: CSSProperties;
  handleProps: SplitHandleProps;
}

/**
 * The width of a split's resizable pane, remembered per `id` and shared by every pane with that
 * `id`, mounted or not (each leader's topic panel, say). `side` is where the pane sits: a
 * pane on the left grows as the divider moves right, one on the right as it moves left.
 *
 * With `share`, a width the user chose is kept as a share of the window and turned back into pixels
 * whenever the window changes size; until then the pane has `defaultWidth`, which the caller may
 * compute from the window too. (A pixel width saved before is used as it is until the next drag.)
 * `keepUncovered` is the room always left for the rest of the window.
 */
export function useSplitWidth(
  id: string,
  options: {
    defaultWidth: number;
    min: number;
    max: number;
    side?: "left" | "right";
    share?: boolean;
    keepUncovered?: number;
  },
): SplitWidth {
  const { defaultWidth, min, max, side = "left", share = false, keepUncovered = 320 } = options;
  const windowWidth = useWindowWidth();
  const clamp = useCallback(
    (value: number) => {
      // Leave the other pane room on narrow windows.
      const limit = Math.min(max, Math.max(min, windowWidth - keepUncovered));
      return Math.round(Math.min(limit, Math.max(min, value)));
    },
    [min, max, windowWidth, keepUncovered],
  );
  // Stored values: pixels, or with `share` a share of the window (at most 1).
  const toWidth = useCallback(
    (stored: number | undefined) =>
      clamp(stored === undefined ? defaultWidth : share && stored <= 1 ? stored * windowWidth : stored),
    [clamp, defaultWidth, share, windowWidth],
  );
  // The saved value, read again at once when the split's ID changes (one pane serving several).
  const [saved, setSaved] = useState<{ id: string; value: number | undefined }>(() => ({
    id,
    value: readStoredWidths()[id],
  }));
  const stored = saved.id === id ? saved.value : readStoredWidths()[id];
  // While dragging, the pane follows the pointer; the drag's end saves.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  useEffect(() => {
    const follow = (value: number | undefined) => setSaved({ id, value });
    // A hidden view (React Activity) drops its effects, so catch up on what was saved meanwhile.
    follow(readStoredWidths()[id]);
    const set = panes.get(id) ?? new Set();
    panes.set(id, set.add(follow));
    return () => {
      set.delete(follow);
      if (!set.size) panes.delete(id);
    };
  }, [id]);
  const width = dragWidth ?? toWidth(stored);
  const save = useCallback(
    (value: number) => {
      setDragWidth(null);
      const widths = readStoredWidths();
      if (value === clamp(defaultWidth)) delete widths[id];
      else widths[id] = share ? Math.round((value / windowWidth) * 10_000) / 10_000 : value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
      for (const follow of panes.get(id) ?? []) follow(widths[id]);
    },
    [id, clamp, defaultWidth, share, windowWidth],
  );
  return {
    width,
    style: { "--split-w": `${width}px` } as CSSProperties,
    handleProps: { width, min, max, side, defaultWidth, clamp, setWidth: setDragWidth, save },
  };
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The window's width in the app's CSS pixels (zoom applied), following resizes. */
function useWindowWidth(): number {
  const zoomLevel = useStore((state) => state.zoomLevel);
  return useSyncExternalStore(subscribeResize, () => getEffectiveViewportWidth(zoomLevel));
}

export interface SplitHandleProps {
  width: number;
  min: number;
  max: number;
  side: "left" | "right";
  defaultWidth: number;
  clamp: (value: number) => number;
  setWidth: (value: number) => void;
  save: (value: number) => void;
}

/**
 * The divider between two panes: place it between them in their flex row. It takes no room of its
 * own; a strip a few pixels wide on the border catches the pointer. Drag to resize, double-click
 * to go back to the default width, or focus it and use the arrow keys. Hidden on phones, where
 * splits show one pane at a time.
 */
export function SplitHandle({
  label,
  className = "hidden md:block",
  gapCenter,
  ...props
}: SplitHandleProps & {
  label: string;
  /** When the split shows side by side; the default matches splits that start at the `md` width. */
  className?: string;
  /**
   * For panes laid out with a gap (a grid of cards): the handle is placed over the gap, this many
   * pixels right of the pane, inside the panes' relatively positioned container.
   */
  gapCenter?: number;
}) {
  const { width, min, max, side, defaultWidth, clamp, setWidth, save } = props;
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);
  const [active, setActive] = useState(false);
  const direction = side === "left" ? 1 : -1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, last: width };
    setActive(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.last = clamp(current.startWidth + direction * (event.clientX - current.startX));
    setWidth(current.last);
  };
  const end = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setActive(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    save(current.last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clamp(width + direction * delta);
    setWidth(next);
    save(next);
  };

  return (
    <div
      className={`${gapCenter === undefined ? "relative" : "absolute inset-y-0"} w-0 shrink-0 ${className}`}
      style={gapCenter === undefined ? undefined : { left: width + gapCenter }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a splitter. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        title="Drag to resize; double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => {
          const next = clamp(defaultWidth);
          setWidth(next);
          save(next);
        }}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none"
        data-testid="split-handle"
      >
        <div
          className={`mx-auto h-full w-0.5 transition-colors ${
            active ? "bg-cc-primary" : "bg-transparent group-hover:bg-cc-primary/50 group-focus-visible:bg-cc-primary"
          }`}
        />
      </div>
    </div>
  );
}
