import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { useStore } from "../store.js";
import { getVisualViewportRect } from "./quest-feed-preview-geometry.js";
import { isTouchDevice } from "../utils/mobile.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import type { ChatMessage } from "../types.js";
import {
  getMessageThreadLinkKey,
  MessageThreadHeader,
  MessageThreadHeaderOwnedContext,
} from "./MessageThreadHeader.js";
import { HidePawContext } from "./PawTrail.js";
import type { ThreadResponseReferencedUserMessage } from "./thread-response-presentation.js";

function ReplyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0">
      <path
        d="M6.5 4 3 7.5 6.5 11M3.5 7.5h6a3.5 3.5 0 0 1 3.5 3.5v1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

/** Wide enough on desktop to read a long message comfortably; phones use their full width. */
const PREVIEW_MAX_WIDTH = 640;
const PREVIEW_MAX_HEIGHT = 480;
/** A quoted line's "open" link previews one message in a smaller card, like message-link hover cards. */
const LINK_PREVIEW_MAX_WIDTH = 460;
const LINK_PREVIEW_MAX_HEIGHT = 280;

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
  limits: { maxWidth: number; maxHeight: number },
): CoveragePreviewPosition {
  const viewport = getVisualViewportRect();
  const safeZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 1;
  const gutter = 8;
  const gap = 6;
  const width = Math.min(limits.maxWidth, Math.max(1, (viewport.width - gutter * 2) / safeZoom));
  const maxHeight = Math.min(limits.maxHeight, Math.max(1, (viewport.height - gutter * 2) / safeZoom));

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
  messages: readonly ThreadResponseReferencedUserMessage[] | undefined,
): messages is readonly ThreadResponseReferencedUserMessage[] {
  if (!messages || messages.length !== messageCount || messageCount <= 0) return false;
  const historyIds = new Set<string>();
  const userIds = new Set<string>();
  for (const message of messages) {
    const attachmentCount = message.attachmentCount ?? 0;
    const hasComments = (message.annotations?.length ?? 0) > 0;
    if (
      !message.historyMessageId ||
      !message.userMessageId ||
      (!message.content.trim() && attachmentCount <= 0 && !hasComments) ||
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

const EXCERPT_MAX_LENGTH = 400;

/** Plain text that identifies a referenced message, for its clamped quote. */
function referencedMessageExcerpt(message: ThreadResponseReferencedUserMessage): string {
  const text = message.content.trim() || (message.annotations ?? []).map((annotation) => annotation.comment).join(" ");
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed) return collapsed.slice(0, EXCERPT_MAX_LENGTH);
  const images = message.attachmentCount ?? 0;
  return images === 1 ? "1 image" : `${images} images`;
}

function UpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0">
      <path
        d="M8 13V3.5M4 7l4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NewResultIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-3 w-3 shrink-0">
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

/**
 * Preview of the messages an answer answers, anchored to the trigger that
 * spreads `triggerProps`: click/tap/keyboard opens it as a dialog, and with
 * `hoverOpens` a mouse or pen hover opens it as a tooltip.
 */
function useReferencePreview(
  messageCount: number,
  referencedMessages: readonly ThreadResponseReferencedUserMessage[] | undefined,
  { hoverOpens = false, maxWidth = PREVIEW_MAX_WIDTH, maxHeight = PREVIEW_MAX_HEIGHT } = {},
) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusPreviewOnOpenRef = useRef(false);
  const previewId = useId();
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const [openMode, setOpenMode] = useState<"hover" | "explicit" | null>(null);
  const [position, setPosition] = useState<CoveragePreviewPosition | null>(null);
  const previewMessages = hasCompletePreview(messageCount, referencedMessages) ? referencedMessages : null;
  const previewAvailable = previewMessages !== null;

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
    const next = coveragePreviewPosition(anchor, preview, zoomLevel, { maxWidth, maxHeight });
    setPosition((current) => (samePosition(current, next) ? current : next));
  }, [close, maxHeight, maxWidth, zoomLevel]);

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

  useOutsidePress([buttonRef, previewRef], close, !!openMode);
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
    window.addEventListener("resize", scheduleGeometry);
    window.addEventListener("scroll", scheduleGeometry, true);
    window.visualViewport?.addEventListener("resize", scheduleGeometry);
    window.visualViewport?.addEventListener("scroll", scheduleGeometry);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("keydown", closeOnEscape, { capture: true });
      window.removeEventListener("resize", scheduleGeometry);
      window.removeEventListener("scroll", scheduleGeometry, true);
      window.visualViewport?.removeEventListener("resize", scheduleGeometry);
      window.visualViewport?.removeEventListener("scroll", scheduleGeometry);
    };
  }, [close, collectGeometry, openMode]);

  useEffect(() => {
    if (!previewAvailable && openMode) close();
  }, [close, openMode, previewAvailable]);

  const isOpen = openMode !== null;
  const triggerProps = {
    ref: buttonRef,
    type: "button" as const,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": isOpen,
    "aria-controls": previewId,
    "aria-describedby": openMode === "hover" ? previewId : undefined,
    onBlur: keepExplicitFocusWithinPreview,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      clearCloseTimer();
      if (hoverOpens && openMode !== "explicit") open("hover");
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") scheduleHoverClose();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => event.stopPropagation(),
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if ((event.key === "Enter" || event.key === " ") && openMode !== "explicit") {
        focusPreviewOnOpenRef.current = true;
      }
    },
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      clearCloseTimer();
      if (openMode === "explicit") close();
      else open("explicit", focusPreviewOnOpenRef.current || event.detail === 0);
    },
  };

  const preview =
    previewMessages && openMode
      ? createPortal(
          <div
            ref={previewRef}
            id={previewId}
            role={openMode === "explicit" ? "dialog" : "tooltip"}
            aria-label="Referenced user messages"
            tabIndex={openMode === "explicit" ? -1 : undefined}
            data-testid="thread-response-coverage-preview"
            data-placement={position?.placement}
            className="fixed z-[90] overflow-y-auto rounded-xl border border-cc-border bg-cc-card px-4 py-3 text-left shadow-xl focus:outline-none focus:ring-2 focus:ring-cc-primary/35"
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
            <ReferencedMessagesPreview messages={previewMessages} />
          </div>,
          document.body,
        )
      : null;

  return { triggerProps, preview, close };
}

/** The answered messages in full, at reading size, one after another. */
function ReferencedMessagesPreview({ messages }: { messages: readonly ThreadResponseReferencedUserMessage[] }) {
  return (
    <div className="divide-y divide-cc-border/60">
      {messages.map((message) => (
        <div
          key={message.historyMessageId}
          data-testid="thread-response-covered-message"
          data-message-id={message.historyMessageId}
          className="py-2.5 first:pt-0 last:pb-0"
        >
          {message.annotations?.map((annotation, commentIndex) => (
            <div
              key={annotation.id}
              className="mb-2 text-[14px] leading-relaxed"
              data-testid="thread-response-covered-message-comment"
            >
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-cc-primary/60 pl-2 text-cc-muted">
                {annotation.selectedText}
              </blockquote>
              <div className="mt-0.5 whitespace-pre-wrap break-words text-cc-fg">
                {message.annotations!.length > 1 && (
                  <span className="mr-1 text-[11px] text-cc-muted">Comment {commentIndex + 1}:</span>
                )}
                {annotation.comment}
              </div>
            </div>
          ))}
          {message.content.trim() && (
            <div
              className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-cc-fg"
              data-testid="thread-response-covered-message-content"
            >
              {message.content}
            </div>
          )}
          {(message.attachmentCount ?? 0) > 0 && (
            <div className="mt-1 text-[12px] text-cc-muted" data-testid="thread-response-covered-message-images">
              {message.attachmentCount} image {message.attachmentCount === 1 ? "attachment" : "attachments"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * What an answer answers, above the answer: a reply quote of the answered
 * messages. With a mouse, each quoted line ends in an "open" link that previews
 * its message on hover and jumps to it on click; on touch screens, where such
 * links are too small to tap, tapping the quote opens the messages in full. An
 * answer right under the message it answers points up instead of repeating it,
 * and an answer naming no message is marked as a new result.
 */
export function AnswerReference({
  answer,
  sessionId,
  currentThreadKey,
}: {
  answer: AnswerChrome;
  sessionId?: string;
  currentThreadKey?: string;
}) {
  // Every form carries the same test hooks: what kind of reference it is and how many messages it answers.
  const hooks = (variant: "quote" | "above" | "new-result" | "count") => ({
    "data-testid": "thread-response-answer-reference",
    "data-variant": variant,
    "data-answer-count": answer.messageCount,
  });
  const line = (variant: "above" | "new-result" | "count", icon: ReactNode, text: string) => (
    <div className="mb-1.5 flex items-center gap-1 text-[12px] leading-none text-cc-muted" {...hooks(variant)}>
      {icon}
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
  if (answer.messageCount <= 0) return line("new-result", <NewResultIcon />, "New result");
  if (answer.answersMessageAbove) return line("above", <UpIcon />, "Answers the message above");
  const countLabel = `Answers ${answer.messageCount} ${answer.messageCount === 1 ? "message" : "messages"}`;
  if (!hasCompletePreview(answer.messageCount, answer.referencedMessages)) {
    return line("count", <ReplyIcon />, countLabel);
  }

  const messages = answer.referencedMessages!;
  const shown = messages.slice(0, 3);
  const lineClamp = messages.length === 1 ? "line-clamp-2" : "line-clamp-1";
  const more = messages.length > shown.length ? `+${messages.length - shown.length} more` : null;
  if (isTouchDevice()) {
    return (
      <TappableQuote messages={messages} label={countLabel} hooks={hooks("quote")}>
        {shown.map((message) => (
          <span key={message.historyMessageId} className={`break-words ${lineClamp}`}>
            {referencedMessageExcerpt(message)}
          </span>
        ))}
        {more && <span className="block text-[12px]">{more}</span>}
      </TappableQuote>
    );
  }
  return (
    <div
      {...hooks("quote")}
      className="mb-2 border-l-2 border-cc-primary/50 py-0.5 pr-2 pl-2.5 text-[13px] leading-snug text-cc-muted"
    >
      {shown.map((message) => (
        <div key={message.historyMessageId} className="flex items-end gap-1.5">
          <span className={`min-w-0 break-words ${lineClamp}`}>{referencedMessageExcerpt(message)}</span>
          <QuotedMessageLink message={message} sessionId={sessionId} currentThreadKey={currentThreadKey} />
        </div>
      ))}
      {more && <div className="text-[12px]">{more}</div>}
    </div>
  );
}

/** The quote as one button that opens the answered messages in full when tapped. */
function TappableQuote({
  messages,
  label,
  hooks,
  children,
}: {
  messages: readonly ThreadResponseReferencedUserMessage[];
  label: string;
  hooks: Record<string, string | number>;
  children: ReactNode;
}) {
  const { triggerProps, preview } = useReferencePreview(messages.length, messages);
  return (
    <>
      <button
        {...triggerProps}
        {...hooks}
        aria-label={`${label}; preview referenced ${messages.length === 1 ? "message" : "messages"}`}
        className="mb-2 block w-full cursor-pointer rounded-r-md border-l-2 border-cc-primary/50 py-0.5 pr-2 pl-2.5 text-left text-[13px] leading-snug text-cc-muted transition-colors hover:bg-cc-hover/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/35"
      >
        {children}
      </button>
      {preview}
    </>
  );
}

/**
 * The "open" link after a quoted line: hovering previews that one message,
 * clicking jumps to it, in this tab when it shows the message, otherwise in the
 * thread the message was sent in.
 */
function QuotedMessageLink({
  message,
  sessionId,
  currentThreadKey,
}: {
  message: ThreadResponseReferencedUserMessage;
  sessionId?: string;
  currentThreadKey?: string;
}) {
  const { triggerProps, preview, close } = useReferencePreview(1, [message], {
    hoverOpens: true,
    maxWidth: LINK_PREVIEW_MAX_WIDTH,
    maxHeight: LINK_PREVIEW_MAX_HEIGHT,
  });
  const threadKey = message.homeThreadKey ?? currentThreadKey;
  return (
    <>
      <button
        ref={triggerProps.ref}
        type="button"
        aria-describedby={triggerProps["aria-describedby"]}
        onPointerEnter={triggerProps.onPointerEnter}
        onPointerLeave={triggerProps.onPointerLeave}
        onPointerDown={triggerProps.onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          close();
          if (!sessionId) return;
          navigateToSessionMessageId(sessionId, message.historyMessageId, {
            ...(threadKey ? { threadKey, preserveMainThreadRoute: true } : {}),
          });
        }}
        disabled={!sessionId}
        aria-label="Open the quoted message"
        className="shrink-0 cursor-pointer text-[12px] text-cc-primary hover:underline focus:outline-none focus-visible:underline disabled:cursor-default disabled:no-underline"
        data-testid="thread-response-quote-link"
      >
        open
      </button>
      {preview}
    </>
  );
}

/** What an answer's header shows: its thread and the messages it answers. */
export interface AnswerChrome {
  message: ChatMessage;
  messageCount: number;
  referencedMessages?: readonly ThreadResponseReferencedUserMessage[];
  /** The answer directly follows the one message it answers, with nothing between them. */
  answersMessageAbove?: boolean;
}

/**
 * A message with its answer header, or without one when `answer` is null. Both
 * render the same element tree, because the thread's answer presentation drops
 * out briefly whenever a message is sent; a changed tree would remount the
 * message and reload its images.
 */
export function AnsweredMessage({
  answer,
  sessionId,
  currentThreadKey,
  onSelectThread,
  children,
}: {
  answer: AnswerChrome | null;
  /** The feed's session, which the quote's "open" links jump within. */
  sessionId?: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  children: ReactNode;
}) {
  const outerHeaderOwned = useContext(MessageThreadHeaderOwnedContext);
  const outerHidePaw = useContext(HidePawContext);
  return (
    <>
      {answer && (
        <MessageThreadHeader
          threadKey={getMessageThreadLinkKey(answer.message, currentThreadKey)}
          onSelectThread={onSelectThread}
        />
      )}
      {answer && <AnswerReference answer={answer} sessionId={sessionId} currentThreadKey={currentThreadKey} />}
      <MessageThreadHeaderOwnedContext.Provider value={outerHeaderOwned || answer !== null}>
        <HidePawContext.Provider value={outerHidePaw || answer !== null}>{children}</HidePawContext.Provider>
      </MessageThreadHeaderOwnedContext.Provider>
    </>
  );
}

/** An expanded turn's message, framed as the thread's current answer when it is one. */
export function ExpandedCurrentThreadResponse(props: Parameters<typeof AnsweredMessage>[0]) {
  return (
    <div
      className={props.answer ? "rounded-xl border border-cc-primary/25 px-2.5 py-2 sm:px-3" : undefined}
      data-testid={props.answer ? "thread-response-current-expanded" : undefined}
    >
      <AnsweredMessage {...props} />
    </div>
  );
}
