import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { useStore } from "../store.js";
import { SidebarTitleRow } from "./SidebarTitleRow.js";

/*
 * The unlocked desktop sessions panel. Unlocked, the panel folds up to its top row (logo, server
 * name, Back, Forward and Recently viewed), which sits in the top bar's row, and the conversation
 * takes the whole width below it. Pointing at that row drops the rest of the panel down over the
 * conversation; leaving both folds it again shortly after. The lock beside the panel's search
 * field switches between the two modes, remembered in this browser.
 */

/** A pointer only passing over the folded row should not flash the panel open. */
const DROP_DELAY_MS = 80;
/** Short enough to feel immediate, long enough to cross the gap between the row and the panel. */
const FOLD_DELAY_MS = 150;

export interface SidebarDropDown {
  /** Whether the panel below the folded row is showing. */
  open: boolean;
  stripRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  /** For both the folded row and the dropped panel. */
  hoverHandlers: {
    onPointerEnter: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
  };
  /** For the folded row: a tap (no hover on touch screens) drops the panel down or folds it. */
  stripTapHandlers: {
    onPointerDown: (event: PointerEvent) => void;
    onClick: (event: MouseEvent) => void;
  };
}

/**
 * Hover state of the folded panel. A mouse entering the folded row or the dropped panel keeps it
 * down; leaving both folds it, unless the user is typing in it (renaming a session). Touch drops
 * it with a tap on the row and folds it with a tap outside. `enabled` is off while the panel is
 * locked open or closed, which folds it.
 */
export function useSidebarDropDown(enabled: boolean): SidebarDropDown {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (enabled) return;
    clearTimer();
    setOpen(false);
  }, [enabled, clearTimer]);
  useEffect(() => clearTimer, [clearTimer]);

  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !enabled) return;
      clearTimer();
      if (!openRef.current) timerRef.current = setTimeout(() => setOpen(true), DROP_DELAY_MS);
    },
    [enabled, clearTimer],
  );
  const onPointerLeave = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearTimer();
      if (!openRef.current) return;
      timerRef.current = setTimeout(() => {
        if (!isEditingIn(panelRef.current) && !isEditingIn(stripRef.current)) setOpen(false);
      }, FOLD_DELAY_MS);
    },
    [clearTimer],
  );

  // Menus and the Recently viewed list open in their own layer; pressing them keeps the panel down.
  useOutsidePress(
    [panelRef, stripRef, "[data-context-menu]", "[data-testid='navigation-history-panel']"],
    () => setOpen(false),
    enabled && open,
  );

  return {
    open,
    stripRef,
    panelRef,
    hoverHandlers: { onPointerEnter, onPointerLeave },
    stripTapHandlers: {
      onPointerDown: (event) => {
        lastPointerTypeRef.current = event.pointerType;
      },
      onClick: (event) => {
        const onControl =
          event.target instanceof Element && event.target.closest("button, input, [data-sidebar-server-name]");
        if (lastPointerTypeRef.current === "mouse" || !enabled || onControl) return;
        clearTimer();
        setOpen((value) => !value);
      },
    },
  };
}

function isEditingIn(container: Element | null): boolean {
  const active = document.activeElement;
  if (!container || !active || !container.contains(active)) return false;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

/** The height of an element, measured while `enabled` and kept current as it changes. */
export function useElementHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    setHeight(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

/**
 * The folded panel's top row, placed before the top bar and as wide as the panel, so the
 * dropped-down panel continues straight below it.
 */
export function SidebarFoldStrip({ dropDown, style }: { dropDown: SidebarDropDown; style: CSSProperties }) {
  return (
    <div
      ref={dropDown.stripRef}
      style={style}
      data-testid="sidebar-fold-strip"
      data-open={dropDown.open ? "true" : "false"}
      className="flex w-[var(--split-w)] shrink-0 items-center border-r border-b border-cc-border bg-cc-sidebar px-4"
      {...dropDown.hoverHandlers}
      {...dropDown.stripTapHandlers}
    >
      <SidebarTitleRow compact />
    </div>
  );
}

/**
 * Switches the desktop sessions panel between locked open beside the conversation and folded to
 * its top row. Sits beside the panel's search field, the same place in both modes.
 */
export function SidebarLockToggle() {
  const locked = useStore((s) => s.sidebarLocked);
  const title = locked
    ? "Unlock the sessions panel: it folds to its top row and drops down when you point at it"
    : "Lock the sessions panel open beside the conversation";
  return (
    <button
      type="button"
      onClick={() => useStore.getState().setSidebarLocked(!locked)}
      aria-pressed={locked}
      aria-label="Keep the sessions panel open"
      title={title}
      data-testid="sidebar-lock-toggle"
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-cc-border bg-cc-input-bg text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <rect x="3" y="7" width="10" height="7" rx="1.5" />
        <path d={locked ? "M5.5 7V5a2.5 2.5 0 015 0v2" : "M5.5 7V5a2.5 2.5 0 014.9-.7"} />
      </svg>
    </button>
  );
}
