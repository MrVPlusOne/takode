// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageFeedNavigationControls } from "./MessageFeedNavigationControls.js";
import { type ScrollActivity, useScrollActivity } from "./message-feed-scroll-activity.js";

// On touch screens the feed's navigation buttons show while the feed scrolls and fade 1.5 s
// after it stops. The scrolling flag now lives outside MessageFeed's state, so starting and
// stopping a scroll (including auto-follow on every new message) no longer re-renders the
// whole feed; only the buttons re-render.
function renderControls(activity: ScrollActivity, isTouch: boolean) {
  const container = { current: null };
  return render(
    // The feed's overlay: the area whose pointer movement brings back the desktop buttons.
    <div data-testid="feed-overlay">
      <MessageFeedNavigationControls
        showScrollButton
        navFabStackClassName="gap-2"
        scrollActivity={activity}
        isTouch={isTouch}
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
      />
    </div>,
  );
}

function pointerMove(target: Element, clientX: number, clientY: number) {
  // jsdom lacks PointerEvent; a MouseEvent of the same type carries the coordinates.
  fireEvent(target, new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
}

describe("feed scroll activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows touch navigation buttons while scrolling and hides them after the idle delay", () => {
    const { result } = renderHook(() => useScrollActivity());
    const activity = result.current;
    renderControls(activity, true);
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

  // Desktop: with the topic panel open the chat column is narrow and the buttons sit over text, so
  // they fade like on phones once scrolling stops, and the mouse coming near brings them back.
  it("fades desktop navigation buttons after scrolling and shows them while the mouse is near", () => {
    const { result } = renderHook(() => useScrollActivity());
    const activity = result.current;
    renderControls(activity, false);
    const stack = screen.getByTestId("message-feed-nav-fabs");
    const overlay = screen.getByTestId("feed-overlay");
    vi.spyOn(stack, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 300, 32, 160));
    expect(stack).toHaveClass("opacity-0", "pointer-events-none");

    act(() => activity.markScrolling());
    expect(stack).toHaveClass("opacity-60");
    act(() => vi.advanceTimersByTime(1500));
    expect(stack).toHaveClass("opacity-0", "pointer-events-none");

    // Within reach (48 px) of the buttons: fully shown and clickable, even after scrolling stops.
    act(() => pointerMove(overlay, 880, 320));
    expect(stack).not.toHaveClass("opacity-0");
    expect(stack).not.toHaveClass("opacity-60");
    expect(stack).not.toHaveClass("pointer-events-none");

    // Moving away, or leaving the feed, hides them again.
    act(() => pointerMove(overlay, 600, 320));
    expect(stack).toHaveClass("opacity-0", "pointer-events-none");
    act(() => pointerMove(overlay, 910, 470));
    expect(stack).not.toHaveClass("opacity-0");
    act(() => {
      fireEvent(overlay, new MouseEvent("pointerleave"));
    });
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
