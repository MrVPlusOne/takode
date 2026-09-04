import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { getVisualViewportRect } from "./quest-feed-preview-geometry.js";
import type { ThreadResponseCoveredUserMessage } from "./thread-response-presentation.js";

const FOCUSABLE_CONTROL_SELECTOR =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,iframe,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"])';

function nextFocusableAfter(element: HTMLElement): HTMLElement | null {
  const controls = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)).filter(
    (candidate) =>
      !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true" && !candidate.closest("[inert]"),
  );
  const index = controls.indexOf(element);
  return index >= 0 ? (controls[index + 1] ?? null) : null;
}

interface CoveragePreviewPosition {
  left: number;
  top: number;
  placement: "above" | "below";
  width: number;
  maxHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function coveragePreviewPosition(
  anchor: HTMLElement,
  preview: HTMLElement,
  zoomLevel: number,
): CoveragePreviewPosition {
  const viewport = getVisualViewportRect();
  const safeZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 1;
  const gutter = 8;
  const gap = 6;
  const width = Math.min(360, Math.max(1, (viewport.width - gutter * 2) / safeZoom));
  const maxHeight = Math.min(320, Math.max(1, (viewport.height - gutter * 2) / safeZoom));

  preview.style.width = `${width}px`;
  preview.style.maxHeight = `${maxHeight}px`;
  preview.style.transform = `scale(${safeZoom})`;
  preview.style.transformOrigin = "top left";

  const anchorRect = anchor.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const measuredWidth = previewRect.width > 0 ? previewRect.width : width * safeZoom;
  const measuredHeight =
    previewRect.height > 0 ? Math.min(previewRect.height, maxHeight * safeZoom) : maxHeight * safeZoom;
  const minLeft = viewport.left + gutter;
  const maxLeft = viewport.right - gutter - measuredWidth;
  const left = clamp(anchorRect.left, minLeft, maxLeft);
  const spaceBelow = viewport.bottom - gutter - (anchorRect.bottom + gap);
  const spaceAbove = anchorRect.top - gap - (viewport.top + gutter);
  const placement = spaceBelow >= measuredHeight || spaceBelow >= spaceAbove ? "below" : "above";
  const preferredTop = placement === "below" ? anchorRect.bottom + gap : anchorRect.top - gap - measuredHeight;
  const top = clamp(preferredTop, viewport.top + gutter, viewport.bottom - gutter - measuredHeight);

  return { left, top, placement, width, maxHeight };
}

function samePosition(left: CoveragePreviewPosition | null, right: CoveragePreviewPosition): boolean {
  return (
    left?.left === right.left &&
    left.top === right.top &&
    left.placement === right.placement &&
    left.width === right.width &&
    left.maxHeight === right.maxHeight
  );
}

function hasCompletePreview(
  messageCount: number,
  messages: readonly ThreadResponseCoveredUserMessage[] | undefined,
): messages is readonly ThreadResponseCoveredUserMessage[] {
  if (!messages || messages.length !== messageCount || messageCount <= 0) return false;
  const historyIds = new Set<string>();
  const userIds = new Set<string>();
  for (const message of messages) {
    const attachmentCount = message.attachmentCount ?? 0;
    if (
      !message.historyMessageId ||
      !message.userMessageId ||
      (!message.content.trim() && attachmentCount <= 0) ||
      !Number.isInteger(attachmentCount) ||
      attachmentCount < 0
    ) {
      return false;
    }
    if (historyIds.has(message.historyMessageId) || userIds.has(message.userMessageId)) return false;
    historyIds.add(message.historyMessageId);
    userIds.add(message.userMessageId);
  }
  return true;
}

export function ThreadResponseCoverageBadge({
  messageCount,
  referencedMessages,
  className = "",
}: {
  messageCount: number;
  referencedMessages?: readonly ThreadResponseCoveredUserMessage[];
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusPreviewOnOpenRef = useRef(false);
  const previewId = useId();
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const [openMode, setOpenMode] = useState<"hover" | "explicit" | null>(null);
  const [position, setPosition] = useState<CoveragePreviewPosition | null>(null);
  const label = `Answers ${messageCount} ${messageCount === 1 ? "message" : "messages"}`;
  const previewAvailable = hasCompletePreview(messageCount, referencedMessages);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearCloseTimer();
    focusPreviewOnOpenRef.current = false;
    setOpenMode(null);
    setPosition(null);
  }, [clearCloseTimer]);

  const open = useCallback(
    (mode: "hover" | "explicit", focusPreview = false) => {
      if (!buttonRef.current) return;
      clearCloseTimer();
      focusPreviewOnOpenRef.current = mode === "explicit" && focusPreview;
      setPosition(null);
      setOpenMode(mode);
    },
    [clearCloseTimer],
  );

  const collectGeometry = useCallback(() => {
    const anchor = buttonRef.current;
    const preview = previewRef.current;
    if (!anchor || !preview || !anchor.isConnected || !preview.isConnected) {
      close();
      return;
    }
    const viewport = getVisualViewportRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorHasArea = anchorRect.width > 0 || anchorRect.height > 0;
    if (
      anchorHasArea &&
      (anchorRect.right <= viewport.left ||
        anchorRect.left >= viewport.right ||
        anchorRect.bottom <= viewport.top ||
        anchorRect.top >= viewport.bottom)
    ) {
      close();
      return;
    }
    const next = coveragePreviewPosition(anchor, preview, zoomLevel);
    setPosition((current) => (samePosition(current, next) ? current : next));
  }, [close, zoomLevel]);

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpenMode((current) => {
        if (current !== "hover") return current;
        setPosition(null);
        return null;
      });
    }, 80);
  }, [clearCloseTimer]);

  const keepExplicitFocusWithinPreview = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (openMode !== "explicit") return;
      const next = event.relatedTarget as Node | null;
      if (next && (buttonRef.current?.contains(next) || previewRef.current?.contains(next))) return;
      close();
    },
    [close, openMode],
  );

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!openMode) return;
    collectGeometry();
  }, [collectGeometry, openMode, referencedMessages]);

  useLayoutEffect(() => {
    if (openMode !== "explicit" || !position || !focusPreviewOnOpenRef.current) return;
    focusPreviewOnOpenRef.current = false;
    previewRef.current?.focus({ preventScroll: true });
  }, [openMode, position]);

  useEffect(() => {
    if (!openMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openMode === "hover") {
        close();
        return;
      }
      const activeElement = document.activeElement;
      const focusWasWithin =
        activeElement != null &&
        (buttonRef.current?.contains(activeElement) === true || previewRef.current?.contains(activeElement) === true);
      event.preventDefault();
      event.stopPropagation();
      close();
      if (focusWasWithin) buttonRef.current?.focus({ preventScroll: true });
    };
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || previewRef.current?.contains(target))) return;
      close();
    };
    let frame: number | null = null;
    const scheduleGeometry = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        collectGeometry();
      });
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleGeometry) : null;
    if (buttonRef.current) observer?.observe(buttonRef.current);
    if (previewRef.current) observer?.observe(previewRef.current);
    document.addEventListener("keydown", closeOnEscape, { capture: true });
    document.addEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
    window.addEventListener("resize", scheduleGeometry);
    window.addEventListener("scroll", scheduleGeometry, true);
    window.visualViewport?.addEventListener("resize", scheduleGeometry);
    window.visualViewport?.addEventListener("scroll", scheduleGeometry);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("keydown", closeOnEscape, { capture: true });
      document.removeEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
      window.removeEventListener("resize", scheduleGeometry);
      window.removeEventListener("scroll", scheduleGeometry, true);
      window.visualViewport?.removeEventListener("resize", scheduleGeometry);
      window.visualViewport?.removeEventListener("scroll", scheduleGeometry);
    };
  }, [close, collectGeometry, openMode]);

  useEffect(() => {
    if (!previewAvailable && openMode) close();
  }, [close, openMode, previewAvailable]);

  if (messageCount <= 0) return null;

  const badgeClass = `${className} inline-flex max-w-full items-center rounded-full border border-cc-primary/25 bg-cc-primary/10 px-2 py-0.5 text-[10px] font-medium text-cc-primary`;
  if (!previewAvailable) {
    return (
      <div className={badgeClass} data-testid="thread-response-answer-count">
        {label}
      </div>
    );
  }

  const isOpen = openMode !== null;
  const handlePointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    clearCloseTimer();
    if (openMode !== "explicit") open("hover");
  };

  const preview =
    isOpen && openMode
      ? createPortal(
          <div
            ref={previewRef}
            id={previewId}
            role={openMode === "explicit" ? "dialog" : "tooltip"}
            aria-label="Referenced user messages"
            tabIndex={openMode === "explicit" ? -1 : undefined}
            data-testid="thread-response-coverage-preview"
            data-placement={position?.placement}
            className="fixed z-[90] overflow-y-auto rounded-lg border border-cc-border bg-cc-card/98 p-2.5 text-left shadow-xl backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-cc-primary/35"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              width: position?.width,
              maxHeight: position?.maxHeight,
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top left",
              visibility: position ? "visible" : "hidden",
            }}
            onBlur={keepExplicitFocusWithinPreview}
            onKeyDown={(event) => {
              if (openMode !== "explicit" || event.key !== "Tab") return;
              event.preventDefault();
              event.stopPropagation();
              const target = event.shiftKey ? buttonRef.current : nextFocusableAfter(buttonRef.current!);
              close();
              (target ?? buttonRef.current)?.focus({ preventScroll: true });
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse" || event.pointerType === "pen") clearCloseTimer();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse" || event.pointerType === "pen") scheduleHoverClose();
            }}
          >
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cc-muted">
              Referenced {messageCount === 1 ? "message" : "messages"}
            </div>
            <div className="space-y-2">
              {referencedMessages.map((message, index) => (
                <div
                  key={message.historyMessageId}
                  data-testid="thread-response-covered-message"
                  data-message-id={message.historyMessageId}
                  className="rounded-md border border-cc-border/60 bg-cc-bg/70 px-2.5 py-2"
                >
                  <div className="mb-1 font-mono-code text-[10px] text-cc-primary">
                    {message.userMessageId}
                    {messageCount > 1 ? ` · ${index + 1} of ${messageCount}` : ""}
                  </div>
                  {message.content.trim() && (
                    <div
                      className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-cc-fg"
                      data-testid="thread-response-covered-message-content"
                    >
                      {message.content}
                    </div>
                  )}
                  {(message.attachmentCount ?? 0) > 0 && (
                    <div
                      className="mt-1 text-[11px] text-cc-muted"
                      data-testid="thread-response-covered-message-images"
                    >
                      {message.attachmentCount} image {message.attachmentCount === 1 ? "attachment" : "attachments"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${badgeClass} cursor-pointer transition-colors hover:border-cc-primary/45 hover:bg-cc-primary/15 focus:outline-none focus:ring-2 focus:ring-cc-primary/35`}
        data-testid="thread-response-answer-count"
        aria-label={`${label}; preview referenced ${messageCount === 1 ? "message" : "messages"}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={previewId}
        aria-describedby={openMode === "hover" ? previewId : undefined}
        onBlur={keepExplicitFocusWithinPreview}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" || event.pointerType === "pen") scheduleHoverClose();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && openMode !== "explicit") {
            focusPreviewOnOpenRef.current = true;
          }
        }}
        onClick={(event) => {
          event.stopPropagation();
          clearCloseTimer();
          if (openMode === "explicit") close();
          else open("explicit", focusPreviewOnOpenRef.current || event.detail === 0);
        }}
      >
        {label}
      </button>
      {preview}
    </>
  );
}

export function ExpandedCurrentThreadResponse({
  messageCount,
  referencedMessages,
  children,
}: {
  messageCount: number;
  referencedMessages?: readonly ThreadResponseCoveredUserMessage[];
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-cc-primary/25 px-2.5 py-2 sm:px-3"
      data-testid="thread-response-current-expanded"
    >
      <ThreadResponseCoverageBadge
        messageCount={messageCount}
        referencedMessages={referencedMessages}
        className="mb-1.5"
      />
      {children}
    </div>
  );
}
