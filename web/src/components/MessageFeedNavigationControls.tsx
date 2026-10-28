import { useEffect, useRef, useState, type RefObject } from "react";
import { type ScrollActivity, useIsScrolling } from "./message-feed-scroll-activity.js";
import { UserMessageNavigator } from "./UserMessageNavigator.js";
import type { UserNavigationTarget } from "./message-feed-user-navigation.js";
import { useComposerOverlayLift } from "./ComposerFeedLayout.js";

const DESKTOP_NAV_STACK_BOTTOM_CLASS = "bottom-16";
/** How close (px) the mouse must come to the faded desktop buttons to bring them back. */
const DESKTOP_REVEAL_DISTANCE_PX = 48;
// Hidden desktop buttons come back for keyboard focus and while the message selector is open.
const DESKTOP_HIDDEN_CLASS =
  "opacity-0 pointer-events-none has-[:focus-visible]:opacity-100 has-[:focus-visible]:pointer-events-auto has-[[role=dialog]]:opacity-100 has-[[role=dialog]]:pointer-events-auto";

interface MessageFeedNavigationControlsProps {
  showScrollButton: boolean;
  navFabStackClassName: string;
  /**
   * The buttons show only while the feed is scrolling, so they stop covering text once it rests.
   * On desktop they also show while the mouse is near them.
   */
  scrollActivity?: ScrollActivity;
  isTouch: boolean;
  mobileNavBottomOffsetPx: number;
  navFabButtonClassName: string;
  sessionId: string;
  normalizedThreadKey: string;
  isLeaderSession: boolean;
  useServerSearch: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  contentRootRef: RefObject<HTMLDivElement | null>;
  userNavigationTargets: readonly UserNavigationTarget[];
  visibleWindowSignature: string;
  navigatorStarredOnly: boolean;
  onNavigatorStarredOnlyChange: (value: boolean) => void;
  onScrollToTop: () => void;
  onPreviousUserMessage: () => void;
  onNextUserMessage: () => void;
  onSelectUserNavigationTarget: (target: UserNavigationTarget) => void;
  onScrollToBottom: () => void;
}

export function MessageFeedNavigationControls({
  showScrollButton,
  navFabStackClassName,
  scrollActivity,
  isTouch,
  mobileNavBottomOffsetPx,
  navFabButtonClassName,
  sessionId,
  normalizedThreadKey,
  isLeaderSession,
  useServerSearch,
  containerRef,
  contentRootRef,
  userNavigationTargets,
  visibleWindowSignature,
  navigatorStarredOnly,
  onNavigatorStarredOnlyChange,
  onScrollToTop,
  onPreviousUserMessage,
  onNextUserMessage,
  onSelectUserNavigationTarget,
  onScrollToBottom,
}: MessageFeedNavigationControlsProps) {
  const isScrolling = useIsScrolling(scrollActivity);
  const composerOverlayLift = useComposerOverlayLift();
  const stackRef = useRef<HTMLDivElement>(null);
  const pointerNear = usePointerNear(stackRef, !isTouch && !!scrollActivity && showScrollButton);
  if (!showScrollButton) return null;
  const visibilityClassName = !scrollActivity
    ? ""
    : isTouch
      ? isScrolling
        ? "opacity-60"
        : "opacity-0 pointer-events-none"
      : pointerNear
        ? ""
        : isScrolling
          ? "opacity-60"
          : DESKTOP_HIDDEN_CLASS;
  return (
    <div
      ref={stackRef}
      data-testid="message-feed-nav-fabs"
      className={`absolute ${DESKTOP_NAV_STACK_BOTTOM_CLASS} right-3 z-10 flex flex-col items-center transition-opacity duration-300 ${navFabStackClassName} ${visibilityClassName}`}
      style={isTouch ? { bottom: `${mobileNavBottomOffsetPx}px` } : composerOverlayLift}
    >
      <button onClick={onScrollToTop} className={navFabButtonClassName} title="Go to top" aria-label="Go to top">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <path d="M4 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 12h8" strokeLinecap="round" />
        </svg>
      </button>
      <UserMessageNavigator
        sessionId={sessionId}
        currentThreadKey={normalizedThreadKey}
        isLeaderSession={isLeaderSession}
        useServerSearch={useServerSearch}
        isTouch={isTouch}
        containerRef={containerRef}
        contentRootRef={contentRootRef}
        targets={userNavigationTargets}
        visibleWindowSignature={visibleWindowSignature}
        buttonClassName={navFabButtonClassName}
        starredOnly={navigatorStarredOnly}
        onStarredOnlyChange={onNavigatorStarredOnlyChange}
        onPrevious={onPreviousUserMessage}
        onNext={onNextUserMessage}
        onSelectTarget={onSelectUserNavigationTarget}
      />
      <button
        onClick={onScrollToBottom}
        className={navFabButtonClassName}
        title="Go to bottom"
        aria-label="Go to bottom"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <path d="M4 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 4h8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Whether the mouse is within reach of the element, watched over the element's parent (the feed's
 * overlay), so a hidden kept conversation never listens. Re-renders only when the answer changes.
 */
function usePointerNear(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const area = ref.current?.parentElement;
    if (!enabled || !area) {
      setNear(false);
      return;
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = ref.current?.getBoundingClientRect();
      const reach = DESKTOP_REVEAL_DISTANCE_PX;
      setNear(
        !!rect &&
          event.clientX >= rect.left - reach &&
          event.clientX <= rect.right + reach &&
          event.clientY >= rect.top - reach &&
          event.clientY <= rect.bottom + reach,
      );
    };
    const onLeave = () => setNear(false);
    area.addEventListener("pointermove", onMove, { passive: true });
    area.addEventListener("pointerleave", onLeave);
    return () => {
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled, ref]);
  return near;
}

/** "New content below" pill: jumps to the latest content, lifted above an expanded desktop composer. */
export function LatestContentPill({
  latestSectionBelow,
  onClick,
}: {
  /** The latest content is in a newer, unloaded section rather than further down this one. */
  latestSectionBelow: boolean;
  onClick: () => void;
}) {
  const composerOverlayLift = useComposerOverlayLift();
  return (
    <div
      style={composerOverlayLift}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3 sm:px-4"
    >
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-cc-primary/25 bg-cc-card/95 px-4 py-2 text-sm font-medium text-cc-fg shadow-lg backdrop-blur-sm transition-colors hover:bg-cc-hover cursor-pointer"
        title="Jump to latest"
        aria-label="Jump to latest"
      >
        <span
          className={`inline-flex h-2 w-2 shrink-0 rounded-full bg-cc-primary ${latestSectionBelow ? "" : "animate-pulse"}`}
        />
        <span className="truncate">{latestSectionBelow ? "Latest section below" : "New content below"}</span>
      </button>
    </div>
  );
}
