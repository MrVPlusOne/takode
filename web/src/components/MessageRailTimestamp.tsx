import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatExactMessageTimestamp, formatMessageTimestamp, isValidMessageTimestamp } from "./MessageTimestamp.js";

type PopoverPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

function prefersCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function getPopoverPosition(anchor: HTMLElement): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const gutter = 8;
  const width = 248;
  const estimatedHeight = 64;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, gutter), viewportWidth - width - gutter);
  const belowTop = rect.bottom + gutter;
  if (belowTop + estimatedHeight <= viewportHeight - gutter) {
    return { left, top: belowTop, placement: "below" };
  }
  return { left, top: Math.max(rect.top - gutter, gutter), placement: "above" };
}

export function MessageRailTimestampTrigger({
  timestamp,
  className,
  testId,
  ariaLabel = "Message time",
  children,
  onPrimaryClick,
}: {
  timestamp: number;
  className: string;
  testId: string;
  ariaLabel?: string;
  children: ReactNode;
  onPrimaryClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [openMode, setOpenMode] = useState<"hover" | "pinned" | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const valid = isValidMessageTimestamp(timestamp);
  const compactText = valid ? formatMessageTimestamp(timestamp) : "";
  const exactText = valid ? formatExactMessageTimestamp(timestamp) : "";
  const labelText = valid && exactText ? `${ariaLabel}: ${exactText}` : `${ariaLabel} unavailable`;

  const openPopover = useCallback((mode: "hover" | "pinned") => {
    setOpenMode(mode);
  }, []);

  const closePopover = useCallback(() => {
    setOpenMode(null);
  }, []);

  useLayoutEffect(() => {
    if (!openMode || !buttonRef.current) return;
    setPosition(getPopoverPosition(buttonRef.current));
  }, [openMode, timestamp]);

  useEffect(() => {
    if (openMode !== "pinned") return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closePopover();
      buttonRef.current?.focus();
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closePopover();
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [closePopover, openMode]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (onPrimaryClick && !prefersCoarsePointer()) {
        closePopover();
        onPrimaryClick(event);
        return;
      }
      setOpenMode((mode) => (mode === "pinned" ? null : "pinned"));
    },
    [closePopover, onPrimaryClick],
  );

  const popover =
    openMode && position
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="tooltip"
            data-testid={`${testId}-timestamp-popover`}
            className="pointer-events-none fixed z-50 w-[248px] rounded-md border border-cc-border/70 bg-cc-card/95 px-2.5 py-2 text-left shadow-xl backdrop-blur"
            style={{
              left: position.left,
              top: position.top,
              transform: position.placement === "above" ? "translateY(-100%)" : undefined,
            }}
          >
            {valid ? (
              <span className="block">
                <span className="block text-[11px] font-medium leading-snug text-cc-fg">{compactText}</span>
                <span className="block text-[10px] leading-snug text-cc-muted">{exactText}</span>
              </span>
            ) : (
              <span className="block text-[11px] leading-snug text-cc-muted">Time unavailable</span>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={labelText}
        aria-describedby={openMode ? popoverId : undefined}
        data-testid={testId}
        title={labelText}
        onMouseEnter={() => openPopover("hover")}
        onMouseLeave={() => {
          if (openMode !== "pinned") closePopover();
        }}
        onFocus={() => openPopover("hover")}
        onBlur={() => {
          if (openMode !== "pinned") closePopover();
        }}
        onClick={handleClick}
      >
        <span className="absolute -inset-2" aria-hidden="true" />
        {children}
      </button>
      {popover}
    </>
  );
}

export function MessageRailTimestampDot({ timestamp, side }: { timestamp: number; side: "assistant" | "user" }) {
  const className = `pointer-events-auto relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-cc-primary/10 text-cc-primary transition-colors hover:bg-cc-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/35 ${
    side === "assistant" ? "mt-1.5" : ""
  }`;
  return (
    <MessageRailTimestampTrigger
      timestamp={timestamp}
      className={className}
      testId={`message-time-${side}-rail`}
      ariaLabel="Message time"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-cc-primary/50" aria-hidden="true" />
    </MessageRailTimestampTrigger>
  );
}
