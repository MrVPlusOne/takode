import { useMemo, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { MessageRailTimestampTrigger } from "./MessageRailTimestamp.js";

export function StarIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1.75 9.83 5.7l4.32.52-3.2 2.95.84 4.27L8 11.32l-3.79 2.12.84-4.27-3.2-2.95 4.32-.52L8 1.75z" />
    </svg>
  );
}

export function StarredMessageRailMarker({
  side,
  timestamp,
  onUnstar,
}: {
  side: "assistant" | "user";
  timestamp: number;
  onUnstar?: () => void;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const items = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: "Unstar message",
        onClick: () => {
          onUnstar?.();
        },
      },
    ],
    [onUnstar],
  );
  const className = `pointer-events-auto relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border border-amber-300/25 bg-amber-300/10 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.05)] ${
    side === "assistant" ? "mt-1.5" : ""
  }`;

  if (!onUnstar) {
    return (
      <MessageRailTimestampTrigger
        timestamp={timestamp}
        className={className}
        testId={`starred-message-${side}-rail`}
        ariaLabel="Starred message time"
      >
        <StarIcon className="h-3 w-3" />
      </MessageRailTimestampTrigger>
    );
  }

  return (
    <span className="inline-flex shrink-0">
      <MessageRailTimestampTrigger
        className={`${className} transition-colors hover:border-amber-300/45 hover:bg-amber-300/16 focus:outline-none focus:ring-2 focus:ring-amber-300/25`}
        timestamp={timestamp}
        testId={`starred-message-${side}-rail`}
        ariaLabel="Starred message time"
        onPrimaryClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPos({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <StarIcon className="h-3 w-3" />
      </MessageRailTimestampTrigger>
      {menuPos && <ContextMenu x={menuPos.x} y={menuPos.y} items={items} onClose={() => setMenuPos(null)} />}
    </span>
  );
}
