// @vitest-environment jsdom

import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import { MessageFeedNavigationControls } from "./MessageFeedNavigationControls.js";
import type { UserNavigationTarget } from "./message-feed-user-navigation.js";

const TARGETS: UserNavigationTarget[] = [
  {
    key: "turn:u1",
    turnId: "u1",
    blockId: "turn:u1",
    messageId: "u1",
    content: "First user message",
    role: "user",
    starred: false,
    timestamp: 1_700_000_000_000,
  },
  {
    key: "turn:u2",
    turnId: "u2",
    blockId: "turn:u2",
    messageId: "u2",
    content: "Second user message",
    role: "user",
    starred: false,
    timestamp: 1_700_000_060_000,
  },
];

function renderControls({ isTouch = false, mobileNavBottomOffsetPx = 42 } = {}) {
  const props = {
    showScrollButton: true,
    navFabStackClassName: isTouch ? "gap-2" : "gap-4",
    isTouch,
    mobileNavBottomOffsetPx,
    navFabButtonClassName: isTouch ? "h-10 w-10" : "h-8 w-8",
    sessionId: "s1",
    normalizedThreadKey: "main",
    isLeaderSession: false,
    useServerSearch: false,
    containerRef: createRef<HTMLDivElement>(),
    contentRootRef: createRef<HTMLDivElement>(),
    userNavigationTargets: TARGETS,
    visibleWindowSignature: "test",
    navigatorStarredOnly: false,
    onNavigatorStarredOnlyChange: vi.fn(),
    onScrollToTop: vi.fn(),
    onPreviousUserMessage: vi.fn(),
    onNextUserMessage: vi.fn(),
    onSelectUserNavigationTarget: vi.fn(),
    onScrollToBottom: vi.fn(),
  };

  return render(<MessageFeedNavigationControls {...props} />);
}

describe("MessageFeedNavigationControls", () => {
  it("anchors the desktop stack above the lower-right feed status chip area", () => {
    renderControls();

    const navFabs = screen.getByTestId("message-feed-nav-fabs");
    expect(navFabs.className).toContain("bottom-16");
    expect(navFabs.style.bottom).toBe("");
    expect(within(navFabs).getByLabelText("Go to top")).toBeTruthy();
    expect(within(navFabs).getByRole("button", { name: "Message navigator, 2 of 2" })).toBeTruthy();
    expect(within(navFabs).getByLabelText("Go to bottom")).toBeTruthy();
  });

  it("keeps touch positioning controlled by the measured mobile clearance offset", () => {
    renderControls({ isTouch: true, mobileNavBottomOffsetPx: 42 });

    const navFabs = screen.getByTestId("message-feed-nav-fabs");
    // The touch path follows the measured lower-right status stack height; the
    // desktop class remains only as a fallback when inline positioning is absent.
    expect(navFabs.className).toContain("bottom-16");
    expect(navFabs.style.bottom).toBe("42px");
  });
});
