import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/**
 * Draggable dividers for side-by-side split views. Every split view in Takode lets people drag
 * its divider to resize the panes (see the `takode-desktop-ui-design` skill): a fixed divider
 * forces one layout on every screen and every task. Widths are a local preference, kept per split
 * in this browser.
 */

const STORAGE_KEY = "cc-split-widths";

/** Mounted panes per split, so a width saved in one (another leader's view, kept mounted) reaches all. */
const panes = new Map<string, Set<(width: number) => void>>();

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
 */
export function useSplitWidth(
  id: string,
  options: { defaultWidth: number; min: number; max: number; side?: "left" | "right" },
): SplitWidth {
  const { defaultWidth, min, max, side = "left" } = options;
  const clamp = useCallback(
    (value: number) => {
      // Leave the other pane room on narrow windows.
      const limit = typeof window === "undefined" ? max : Math.min(max, Math.max(min, window.innerWidth - 320));
      return Math.round(Math.min(limit, Math.max(min, value)));
    },
    [min, max],
  );
  const [width, setWidth] = useState(() => clamp(readStoredWidths()[id] ?? defaultWidth));
  useEffect(() => {
    const follow = (value: number) => setWidth(clamp(value));
    // A hidden view (React Activity) drops its effects, so catch up on what was saved meanwhile.
    follow(readStoredWidths()[id] ?? defaultWidth);
    const set = panes.get(id) ?? new Set();
    panes.set(id, set.add(follow));
    return () => {
      set.delete(follow);
      if (!set.size) panes.delete(id);
    };
  }, [id, clamp, defaultWidth]);
  const save = useCallback(
    (value: number) => {
      const widths = readStoredWidths();
      if (value === defaultWidth) delete widths[id];
      else widths[id] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
      for (const follow of panes.get(id) ?? []) follow(value);
    },
    [id, defaultWidth],
  );
  return {
    width,
    style: { "--split-w": `${width}px` } as CSSProperties,
    handleProps: { width, min, max, side, defaultWidth, clamp, setWidth, save },
  };
}

interface SplitHandleProps {
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
