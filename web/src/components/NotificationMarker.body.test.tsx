// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { useTextSelection } from "../hooks/useTextSelection.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { ChatMessage, SessionNotification } from "../types.js";
import { getNotificationSourceContext } from "../utils/notification-source-context.js";
import { captureAnnotationSource, resolveAnnotationRange } from "./annotation-passages.js";
import { NotificationMarker } from "./NotificationMarker.js";

vi.mock("../api.js", () => ({
  api: {
    getNotificationReplies: vi.fn(),
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    sendNeedsInputResponse: vi.fn(),
  },
}));

const SESSION = "notification-body";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Approve the menu change",
  body: "Keep **Manual** and *Full access*.\n\n- Rename Default: recommended",
  questions: [{ prompt: "Approve?", suggestedAnswers: ["approve", "change something"] }],
  messageId: "tool-only",
  timestamp: 10,
  done: false,
};

function update(value: SessionNotification) {
  act(() => applySessionNotifications(SESSION, [value], {}));
}

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("Needs-input card body", () => {
  it("renders the decision context as Markdown in the pending card and keeps it in the answered history", () => {
    // The body is the only place the decision context lives, so it must be
    // visible while pending and still inspectable after the prompt is handled.
    update(notification);
    const view = render(
      <NotificationMarker
        sessionId={SESSION}
        category="needs-input"
        notificationId="n-1"
        summary={notification.summary}
      />,
    );
    const body = screen.getByTestId("notification-body");
    expect(within(body).getByText("Manual").tagName).toBe("STRONG");
    expect(body).toHaveTextContent("Rename Default: recommended");
    expect(screen.getByLabelText("Answer for Approve?")).toBeInTheDocument();

    update({ ...notification, done: true });
    view.rerender(
      <NotificationMarker
        sessionId={SESSION}
        category="needs-input"
        notificationId="n-1"
        summary={notification.summary}
      />,
    );
    expect(screen.queryByTestId("notification-body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve the menu change Handled" }));
    expect(screen.getByTestId("notification-body")).toHaveTextContent("Keep Manual and Full access.");
  });

  it("uses the body as the notification source context instead of the anchored message text", () => {
    // Menus and voice answers read source context; with a body, the anchored
    // tool-call message is not the decision context.
    const anchored: ChatMessage = { id: "tool-only", role: "assistant", content: "Ran a command", timestamp: 1 };
    expect(getNotificationSourceContext(notification, [anchored])).toBe(notification.body);
    expect(getNotificationSourceContext({ ...notification, body: undefined }, [anchored])).toBe("Ran a command");
  });

  it("lets a selection inside the body open the Comment / Copy menu and anchor a comment", () => {
    // Regression: selecting Markdown inside a needs-input card did not open the
    // feed selection menu because the body was not a chat selection scope.
    // Feed cards render after their anchoring assistant message's own text, so
    // the comment must anchor to that message without disturbing its text scope.
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      update({ ...notification, messageId: "assistant-1" });
      let selection: ReturnType<typeof useTextSelection> | null = null;
      function FeedHarness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [, setMounted] = useState(false);
        selection = useTextSelection(containerRef);
        useEffect(() => setMounted(true), []);
        return (
          <div ref={containerRef} data-testid="container">
            <div data-testid="message" data-message-id="assistant-1" data-message-role="assistant">
              <div data-chat-selection-scope="true">Rename Default</div>
              <NotificationMarker sessionId={SESSION} category="needs-input" messageId="assistant-1" />
            </div>
          </div>
        );
      }
      render(<FeedHarness />);

      const selectedText = screen.getByText("Rename Default: recommended").firstChild!;
      const range = document.createRange();
      range.setStart(selectedText, 0);
      range.setEnd(selectedText, "Rename Default".length);
      Object.defineProperty(range, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 10, top: 200, right: 110, bottom: 220, width: 100, height: 20 }) as DOMRect,
      });
      vi.spyOn(window, "getSelection").mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: selectedText,
        focusNode: selectedText,
        toString: () => "Rename Default",
        getRangeAt: () => range,
        removeAllRanges: vi.fn(),
      } as unknown as Selection);
      fireEvent.mouseDown(screen.getByTestId("container"));
      act(() => {
        fireEvent.mouseUp(document);
      });

      expect(selection!.isActive).toBe(true);
      expect(selection!.plainText).toBe("Rename Default");
      const source = captureAnnotationSource(selection!.range);
      // Scope 0 is the message's own text, which contains the same words.
      expect(source).toMatchObject({
        sourceMessageId: "assistant-1",
        sourceAnchor: { scopeIndex: 1, text: "Rename Default" },
      });
      const resolved = resolveAnnotationRange(screen.getByTestId("message"), {
        id: "comment-1",
        selectedText: "Rename Default",
        comment: "Why?",
        ...source,
      });
      expect(screen.getByTestId("notification-body").contains(resolved!.startContainer)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
