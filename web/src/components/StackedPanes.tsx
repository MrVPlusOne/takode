import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * Groups stacked in one panel, as in VS Code's side bar: each group has a header that folds it,
 * open groups share the panel's height and scroll on their own, and the line between two open
 * groups can be dragged to set their proportions (see the `takode-desktop-ui-design` skill). Folded
 * groups and sizes are a local preference, kept per stack in this browser.
 */

const STORAGE_KEY = "cc-stacked-panes";
/** The least height an open group keeps while a divider is dragged. */
const MIN_PANE_HEIGHT = 72;
const KEY_STEP = 24;

export interface StackedPane {
  id: string;
  title: string;
  /** Shown after the title, such as a count. */
  meta?: ReactNode;
  /** Controls at the end of the header (they don't fold the group). */
  actions?: ReactNode;
  /** Its share of the height before the user drags (default 1). */
  defaultWeight?: number;
  children: ReactNode;
}

interface StackState {
  folded: string[];
  /** Heights of open groups as relative weights. */
  weights: Record<string, number>;
}

function readState(stackId: string): StackState {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Partial<StackState>>;
    const saved = all[stackId];
    return {
      folded: Array.isArray(saved?.folded) ? saved.folded.filter((id) => typeof id === "string") : [],
      weights: saved?.weights && typeof saved.weights === "object" ? saved.weights : {},
    };
  } catch (error) {
    console.warn("[stacked-panes] Ignoring unreadable saved layout:", error);
    return { folded: [], weights: {} };
  }
}

function writeState(stackId: string, state: StackState): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, StackState>;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [stackId]: state }));
  } catch (error) {
    console.warn("[stacked-panes] Could not save the layout:", error);
  }
}

export function StackedPanes({ stackId, panes }: { stackId: string; panes: StackedPane[] }) {
  const [state, setState] = useState(() => readState(stackId));
  useEffect(() => writeState(stackId, state), [stackId, state]);
  // Open groups' elements, whose heights the divider moves between.
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const weightOf = (pane: StackedPane) => state.weights[pane.id] ?? pane.defaultWeight ?? 1;
  const open = panes.filter((pane) => !state.folded.includes(pane.id));

  const toggle = (id: string) =>
    setState((previous) => ({
      ...previous,
      folded: previous.folded.includes(id)
        ? previous.folded.filter((folded) => folded !== id)
        : [...previous.folded, id],
    }));

  /** Moves the line above `below` by `delta` px, between it and the nearest open group above. */
  const resize = useCallback((above: string, below: string, delta: number, start: { above: number; below: number }) => {
    const total = start.above + start.below;
    const aboveHeight = Math.min(total - MIN_PANE_HEIGHT, Math.max(MIN_PANE_HEIGHT, start.above + delta));
    setState((previous) => {
      // Every open group's weight becomes its height, so the two heights carry over exactly.
      const weights = { ...previous.weights };
      for (const [id, element] of bodies.current) weights[id] = element.getBoundingClientRect().height || 1;
      weights[above] = aboveHeight;
      weights[below] = total - aboveHeight;
      return { ...previous, weights };
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stacked-panes">
      {panes.map((pane, index) => {
        const folded = state.folded.includes(pane.id);
        const previousOpen = [...panes.slice(0, index)].reverse().find((other) => !state.folded.includes(other.id));
        return (
          <div
            key={pane.id}
            ref={(element) => {
              if (element && !folded) bodies.current.set(pane.id, element);
              else bodies.current.delete(pane.id);
            }}
            className={`flex min-h-0 flex-col ${folded ? "shrink-0" : ""}`}
            style={folded ? undefined : { flexGrow: weightOf(pane), flexShrink: 1, flexBasis: 0 }}
            data-testid="stacked-pane"
            data-pane={pane.id}
            data-folded={folded ? "true" : "false"}
          >
            {index > 0 && (
              <PaneDivider
                enabled={!folded && !!previousOpen}
                onDrag={(delta, start) => previousOpen && resize(previousOpen.id, pane.id, delta, start)}
                measure={() => ({
                  above: (previousOpen && bodies.current.get(previousOpen.id)?.getBoundingClientRect().height) || 0,
                  below: bodies.current.get(pane.id)?.getBoundingClientRect().height || 0,
                })}
                onReset={() => setState((previous) => ({ ...previous, weights: {} }))}
              />
            )}
            <div className="flex h-7 shrink-0 items-center gap-1 px-1">
              <button
                type="button"
                onClick={() => toggle(pane.id)}
                aria-expanded={!folded}
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-medium uppercase tracking-wide text-cc-muted hover:text-cc-fg cursor-pointer"
                data-testid="stacked-pane-header"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`h-3 w-3 shrink-0 transition-transform ${folded ? "" : "rotate-90"}`}
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className="truncate">{pane.title}</span>
                {pane.meta}
              </button>
              {pane.actions}
            </div>
            {!folded && (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1" data-testid="stacked-pane-body">
                {pane.children}
              </div>
            )}
          </div>
        );
      })}
      {open.length === 0 && <div className="flex-1" />}
    </div>
  );
}

/** The line above a group's header; dragging it moves height between the open groups around it. */
function PaneDivider({
  enabled,
  onDrag,
  measure,
  onReset,
}: {
  enabled: boolean;
  onDrag: (delta: number, start: { above: number; below: number }) => void;
  measure: () => { above: number; below: number };
  onReset: () => void;
}) {
  const drag = useRef<{ y: number; start: { above: number; below: number } } | null>(null);
  if (!enabled) return <div className="h-px shrink-0 bg-cc-border/70" />;
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the groups"
      tabIndex={0}
      className="group relative h-px shrink-0 cursor-row-resize bg-cc-border/70 outline-none focus-visible:bg-cc-primary"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, start: measure() };
      }}
      onPointerMove={(event) => {
        if (drag.current) onDrag(event.clientY - drag.current.y, drag.current.start);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={onReset}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onDrag(event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP, measure());
      }}
      data-testid="stacked-pane-divider"
    >
      {/* A taller invisible grip than the 1px line, so it is easy to catch with a mouse or finger. */}
      <span className="absolute inset-x-0 -top-1.5 h-3 group-hover:bg-cc-primary/40 group-active:bg-cc-primary/60" />
    </div>
  );
}
