import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatExactMessageTimestamp, formatMessageTimestamp, isValidMessageTimestamp } from "./MessageTimestamp.js";

type PopoverPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

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

export function MessageTimeMenuMetadata({ timestamp, testId }: { timestamp: number; testId: string }) {
  const valid = isValidMessageTimestamp(timestamp);
  const compactText = valid ? formatMessageTimestamp(timestamp) : "";
  const exactText = valid ? formatExactMessageTimestamp(timestamp) : "";

  return (
    <div
      role="note"
      aria-label="Message time"
      data-testid={testId}
      className="mt-1 border-t border-cc-border/70 px-2.5 py-2 text-left"
    >
      <span className="block text-[9px] font-medium uppercase tracking-wider text-cc-muted/70">Message time</span>
      {valid ? (
        <time dateTime={new Date(timestamp).toISOString()} className="mt-0.5 block break-words">
          <span className="block text-[11px] font-medium leading-snug text-cc-fg">{compactText}</span>
          <span className="block text-[10px] leading-snug text-cc-muted">{exactText}</span>
        </time>
      ) : (
        <span className="mt-0.5 block text-[11px] leading-snug text-cc-muted">Time unavailable</span>
      )}
    </div>
  );
}

export function MessageTimestampMenuTrigger({
  timestamp,
  className,
  testId,
  ariaLabel = "Message options",
  title = "Message options",
  children,
  onClick,
}: {
  timestamp: number;
  className: string;
  testId: string;
  ariaLabel?: string;
  title?: string;
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const valid = isValidMessageTimestamp(timestamp);
  const compactText = valid ? formatMessageTimestamp(timestamp) : "";
  const exactText = valid ? formatExactMessageTimestamp(timestamp) : "";

  const openPopover = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePopover = useCallback(() => {
    setIsOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    setPosition(getPopoverPosition(buttonRef.current));
  }, [isOpen, timestamp]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closePopover();
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closePopover, isOpen]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      closePopover();
      onClick(event);
    },
    [closePopover, onClick],
  );

  const popover =
    isOpen && position
      ? createPortal(
          <div
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
        aria-label={ariaLabel}
        aria-describedby={isOpen ? popoverId : undefined}
        data-testid={testId}
        title={title}
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
        onFocus={openPopover}
        onBlur={closePopover}
        onClick={handleClick}
      >
        {children}
      </button>
      {popover}
    </>
  );
}
