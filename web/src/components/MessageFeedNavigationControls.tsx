import type { RefObject } from "react";
import { type ScrollActivity, useIsScrolling } from "./message-feed-scroll-activity.js";
import { UserMessageNavigator } from "./UserMessageNavigator.js";
import type { UserNavigationTarget } from "./message-feed-user-navigation.js";

const DESKTOP_NAV_STACK_BOTTOM_CLASS = "bottom-16";

interface MessageFeedNavigationControlsProps {
  showScrollButton: boolean;
  navFabStackClassName: string;
  /** On touch screens the buttons show only while the feed is scrolling. */
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
  if (!showScrollButton) return null;
  const visibilityClassName =
    isTouch && scrollActivity ? (isScrolling ? "opacity-60" : "opacity-0 pointer-events-none") : "";
  return (
    <div
      data-testid="message-feed-nav-fabs"
      className={`absolute ${DESKTOP_NAV_STACK_BOTTOM_CLASS} right-3 z-10 flex flex-col items-center transition-opacity duration-300 ${navFabStackClassName} ${visibilityClassName}`}
      style={isTouch ? { bottom: `${mobileNavBottomOffsetPx}px` } : undefined}
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
