// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import type { MessageSearchResponse } from "../api.js";
import { UserMessageNavigator } from "./UserMessageNavigator.js";
import type { UserNavigationTarget } from "./message-feed-user-navigation.js";

const mockSearchSessionMessages = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    searchSessionMessages: (...args: unknown[]) => mockSearchSessionMessages(...args),
  },
}));

const TARGETS: UserNavigationTarget[] = [
  {
    key: "turn:u1",
    turnId: "u1",
    blockId: "turn:u1",
    messageId: "u1",
    content: "Please inspect the mobile layout before changing the composer.",
    timestamp: 1_700_000_000_000,
  },
  {
    key: "message:u1",
    turnId: "u1",
    blockId: "message:u1",
    messageId: "u1",
    content: "Please inspect the mobile layout before changing the composer.",
    timestamp: 1_700_000_000_000,
  },
  {
    key: "turn:u2",
    turnId: "u2",
    blockId: "turn:u2",
    messageId: "u2",
    content: "Find the approval question and jump back to it.",
    timestamp: 1_700_000_060_000,
  },
];

function messageSearchResponse(messageIds: string[]): MessageSearchResponse {
  return {
    sessionId: "s1",
    sessionNum: 5,
    query: "approval",
    scope: { kind: "current_thread", threadKey: "q-12", label: "Searching in #5 thread q-12" },
    filters: { user: true, assistant: true, event: false },
    totalMatches: messageIds.length,
    results: messageIds.map((messageId, index) => ({
      id: `s1:${index}:${messageId}`,
      sessionId: "s1",
      sessionNum: 5,
      messageId,
      historyIndex: index,
      role: "user",
      category: "user",
      timestamp: 1_700_000_000_000 + index,
      snippet: messageId,
      sourceThreadKey: "q-12",
      sourceLabel: "q-12",
      routeThreadKey: "q-12",
    })),
    nextOffset: null,
    hasMore: false,
    tookMs: 1,
  };
}

function renderNavigator(
  props: Partial<{
    targets: UserNavigationTarget[];
    defaultOpen: boolean;
    useServerSearch: boolean;
    isLeaderSession: boolean;
  }> = {},
) {
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const onSelectTarget = vi.fn();
  const targets = props.targets ?? TARGETS;

  function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRootRef = useRef<HTMLDivElement>(null);
    return (
      <div ref={containerRef}>
        <div ref={contentRootRef}>
          {targets.map((target) => (
            <div key={target.key} data-feed-block-id={target.blockId}>
              {target.content}
            </div>
          ))}
        </div>
        <UserMessageNavigator
          sessionId="s1"
          currentThreadKey="q-12"
          isLeaderSession={props.isLeaderSession ?? true}
          useServerSearch={props.useServerSearch ?? false}
          isTouch={false}
          containerRef={containerRef}
          contentRootRef={contentRootRef}
          targets={targets}
          visibleWindowSignature="test"
          buttonClassName="h-8 w-8"
          defaultOpen={props.defaultOpen}
          onPrevious={onPrevious}
          onNext={onNext}
          onSelectTarget={onSelectTarget}
        />
      </div>
    );
  }

  return { onPrevious, onNext, onSelectTarget, ...render(<Harness />) };
}

describe("UserMessageNavigator", () => {
  beforeEach(() => {
    mockSearchSessionMessages.mockReset();
  });

  it("renders a compact current and total indicator using deduped user targets", () => {
    renderNavigator();

    expect(screen.getByRole("button", { name: "User message navigator, 2 of 2" })).toBeTruthy();
  });

  it("filters expanded local previews and jumps through the selected target", () => {
    const { onSelectTarget } = renderNavigator({ defaultOpen: true });
    const dialog = screen.getByRole("dialog", { name: "User message selector" });

    fireEvent.change(within(dialog).getByLabelText("Search user messages"), { target: { value: "approval" } });

    expect(within(dialog).queryByText(/mobile layout/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Find the approval question/ }));

    expect(onSelectTarget).toHaveBeenCalledWith(expect.objectContaining({ messageId: "u2" }));
  });

  it("centers the current user-message row when the selector opens", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderNavigator();

      fireEvent.click(screen.getByRole("button", { name: "User message navigator, 2 of 2" }));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" }));
      const dialog = screen.getByRole("dialog", { name: "User message selector" });
      expect(
        within(dialog)
          .getByRole("button", { name: /Find the approval question/ })
          .getAttribute("aria-current"),
      ).toBe("location");
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("uses the existing message search endpoint for queried leader-thread results", async () => {
    mockSearchSessionMessages.mockResolvedValue(messageSearchResponse(["u2"]));
    renderNavigator({ defaultOpen: true, useServerSearch: true, isLeaderSession: true });
    const dialog = screen.getByRole("dialog", { name: "User message selector" });

    fireEvent.change(within(dialog).getByLabelText("Search user messages"), { target: { value: "approval" } });

    await waitFor(() => expect(mockSearchSessionMessages).toHaveBeenCalled());
    expect(mockSearchSessionMessages).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({
        query: "approval",
        scope: "current_thread",
        threadKey: "q-12",
        filters: { user: true, assistant: true, event: false },
      }),
    );
    expect(await within(dialog).findByText(/Find the approval question/)).toBeTruthy();
    expect(within(dialog).queryByText(/mobile layout/)).toBeNull();
  });
});
