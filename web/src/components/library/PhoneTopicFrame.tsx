import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

/**
 * The topic panel's frame on a phone: a page that slides in from the right, where the panel sits
 * on desktop. It covers the screen from `top` (just under the thread strip) down, so the top bar
 * and the tabs stay usable and the page keeps following the tab on screen. It slides out when
 * closed (`open` false), then calls `onHidden`; swiping it to the right closes it too, like going
 * back on iOS.
 */
export function PhoneTopicFrame({
  open,
  top,
  onClose,
  onHidden,
  frameRef,
  children,
}: {
  open: boolean;
  top: number;
  onClose: () => void;
  onHidden: () => void;
  frameRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  // Whether the page sits in place (true) or off screen; a CSS transition moves between the two.
  const [placed, setPlaced] = useState(false);
  // How far the finger dragged the page to the right.
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const animated = !reducedMotion();

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setPlaced(true));
      return () => cancelAnimationFrame(frame);
    }
    setPlaced(false);
    const timer = setTimeout(onHidden, animated ? EXIT_MS : 0);
    return () => clearTimeout(timer);
  }, [open, animated, onHidden]);

  // Swiping right anywhere outside horizontally scrolling content closes it; a mostly vertical
  // drag is a scroll.
  const swipe = {
    onTouchStart: (event: React.TouchEvent) => {
      if ((event.target as Element).closest("pre, table, .overflow-x-auto, input, textarea, select")) return;
      const touch = event.touches[0]!;
      start.current = { x: touch.clientX, y: touch.clientY, axis: null };
    },
    onTouchMove: (event: React.TouchEvent) => {
      const origin = start.current;
      if (!origin) return;
      const touch = event.touches[0]!;
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      if (!origin.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        origin.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (origin.axis === "x") setDrag(Math.max(0, dx));
    },
    onTouchEnd: () => {
      const moved = drag ?? 0;
      start.current = null;
      setDrag(null);
      if (moved > window.innerWidth * 0.3) onClose();
    },
  };

  const transform = drag !== null ? `translateX(${drag}px)` : placed ? "none" : "translateX(100%)";
  const transition =
    drag !== null || !animated ? "none" : `transform ${placed ? ENTER_MS : EXIT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 overflow-hidden" style={{ top }}>
      <div
        ref={frameRef}
        style={{ transform, transition }}
        className="absolute inset-0 flex flex-col overflow-hidden border-l border-cc-border bg-cc-bg shadow-2xl"
        role="dialog"
        aria-label="Topics"
        data-testid="topic-side-panel"
        data-variant="sheet"
        {...swipe}
      >
        {children}
      </div>
    </div>
  );
}

const ENTER_MS = 240;
const EXIT_MS = 200;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
