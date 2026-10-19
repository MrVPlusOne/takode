// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";

vi.mock("../api.js", () => ({
  api: {
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
    markNotificationDone: vi.fn(async () => ({})),
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
  },
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div className="markdown-body">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));

import { MessageBubble } from "./MessageBubble.js";
import { ExpandedCurrentThreadResponse } from "./ThreadResponsePresentationChrome.js";
import { useStore } from "../store.js";

const SESSION_ID = "framed-answer-session";

/** A leader answer naming no request, framed as a "New result" card, with its corner time. */
function renderFramedNewResult() {
  const message: ChatMessage = {
    id: "framed-new-result",
    role: "assistant",
    content: "From the 4 PM check: the review request arrived.",
    timestamp: new Date(2026, 9, 19, 16, 0).getTime(),
    historyIndex: 12,
  };
  render(
    <ExpandedCurrentThreadResponse answer={{ message, messageCount: 0 }} sessionId={SESSION_ID}>
      <MessageBubble message={message} sessionId={SESSION_ID} showTimestamp showSideChatActions={false} />
    </ExpandedCurrentThreadResponse>,
  );
  return message;
}

/** Tailwind `z-N` of an element, 0 when it has none (z-index auto). */
function zIndexClass(element: Element): number {
  return Number(/(?:^|\s)z-(\d+)(?:\s|$)/.exec(element.className)?.[1] ?? 0);
}

const positioned = (element: Element) => /(?:^|\s)(relative|absolute|fixed|sticky)(?:\s|$)/.test(element.className);

describe("message options button on a framed answer card", () => {
  beforeEach(() => {
    useStore.setState({ sessions: new Map(), replyContexts: new Map(), compactToolActivity: false });
  });

  it("is not painted under the positioned text and corner time that follow it", () => {
    // Regression: the "⋯" button floats right in the answer's first line, and the text
    // wrapper after it is `relative` for the corner time. Browsers paint (and hit-test) a
    // positioned box over a plain float, so the button showed on hover but no click reached
    // it. jsdom has no layout, so this checks the stacking rule the browser applies: the
    // button's row must itself be positioned, with a z-index at least that of every
    // positioned element after it in the message (later elements win ties).
    renderFramedNewResult();
    expect(screen.getByTestId("thread-response-current-expanded")).toBeTruthy();
    const row = document.querySelector("[data-message-action-menu-row]")!;
    const message = row.closest(".group\\/msg")!;
    const later = [...message.querySelectorAll("*")].filter(
      (element) => positioned(element) && row.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The corner time's wrapper and label are among them, or the check would prove nothing.
    expect(later.some((element) => element.classList.contains("message-time-trail"))).toBe(true);
    expect(later.some((element) => element.querySelector("[data-testid=message-time-label]"))).toBe(true);

    expect(positioned(row)).toBe(true);
    for (const element of later) expect(zIndexClass(row)).toBeGreaterThan(zIndexClass(element));
  });

  it("opens its menu on a mouse click and on a finger tap, and starts a reply", () => {
    const message = renderFramedNewResult();
    const button = screen.getByRole("button", { name: "Message options" });

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Reply to this message" })).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("button", { name: "Reply to this message" })).toBeNull();

    fingerTap(button);
    fingerTap(screen.getByRole("button", { name: "Reply to this message" }));
    expect(useStore.getState().replyContexts.get(SESSION_ID)?.messageId).toBe(message.id);
  });
});
