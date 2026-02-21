import { useRef, useState, useEffect } from "react";
import { useStore } from "../store.js";

export function TaskOutlineBar({ sessionId }: { sessionId: string }) {
  const taskHistory = useStore((s) => s.sessionTaskHistory.get(sessionId));
  const requestScrollToTurn = useStore((s) => s.requestScrollToTurn);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Track scroll overflow state for fade indicators
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [taskHistory]);

  if (!taskHistory || taskHistory.length === 0) return null;

  return (
    <div className="shrink-0 relative border-b border-cc-border bg-cc-card">
      {/* Left fade */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-cc-card to-transparent z-10 pointer-events-none" />
      )}
      {/* Right fade */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-cc-card to-transparent z-10 pointer-events-none" />
      )}

      <div
        ref={scrollRef}
        className="flex gap-1.5 px-3 py-1.5 overflow-x-auto scrollbar-hide"
      >
        {taskHistory.map((task, i) => (
          <button
            key={`${task.triggerMessageId}-${i}`}
            type="button"
            onClick={() => requestScrollToTurn(sessionId, task.triggerMessageId)}
            className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-cc-hover/60 hover:bg-cc-border text-cc-fg/70 hover:text-cc-fg transition-colors cursor-pointer truncate max-w-[200px]"
            title={task.title}
          >
            {task.title}
          </button>
        ))}
      </div>
    </div>
  );
}
