// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageFeedNavigationControls } from "./MessageFeedNavigationControls.js";
import { useScrollActivity } from "./message-feed-scroll-activity.js";

// On touch screens the feed's navigation buttons show while the feed scrolls and fade 1.5 s
// after it stops. The scrolling flag now lives outside MessageFeed's state, so starting and
// stopping a scroll (including auto-follow on every new message) no longer re-renders the
// whole feed; only the buttons re-render.
describe("feed scroll activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows touch navigation buttons while scrolling and hides them after the idle delay", () => {
    const { result } = renderHook(() => useScrollActivity());
    const activity = result.current;
    const container = { current: null };
    render(
      <MessageFeedNavigationControls
        showScrollButton
        navFabStackClassName="gap-2"
        scrollActivity={activity}
        isTouch
        mobileNavBottomOffsetPx={80}
        navFabButtonClassName=""
        sessionId="s-1"
        normalizedThreadKey="main"
        isLeaderSession={false}
        useServerSearch={false}
        containerRef={container}
        contentRootRef={container}
        userNavigationTargets={[]}
        visibleWindowSignature=""
        navigatorStarredOnly={false}
        onNavigatorStarredOnlyChange={() => {}}
        onScrollToTop={() => {}}
        onPreviousUserMessage={() => {}}
        onNextUserMessage={() => {}}
        onSelectUserNavigationTarget={() => {}}
        onScrollToBottom={() => {}}
      />,
    );
    const stack = screen.getByTestId("message-feed-nav-fabs");
    expect(stack).toHaveClass("opacity-0", "pointer-events-none");

    act(() => activity.markScrolling());
    expect(stack).toHaveClass("opacity-60");
    expect(stack).not.toHaveClass("pointer-events-none");

    // Continued scrolling restarts the idle delay.
    act(() => vi.advanceTimersByTime(1000));
    act(() => activity.markScrolling());
    act(() => vi.advanceTimersByTime(1000));
    expect(stack).toHaveClass("opacity-60");

    act(() => vi.advanceTimersByTime(600));
    expect(stack).toHaveClass("opacity-0", "pointer-events-none");
  });

  it("notifies subscribers only when scrolling starts or stops", () => {
    const { result } = renderHook(() => useScrollActivity());
    const listener = vi.fn();
    result.current.subscribe(listener);

    act(() => {
      result.current.markScrolling();
      result.current.markScrolling();
      result.current.markScrolling();
    });
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1500));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(result.current.isActive()).toBe(false);
  });
});
