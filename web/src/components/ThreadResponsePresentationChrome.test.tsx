// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerReference } from "./ThreadResponsePresentationChrome.js";
import type { ThreadResponseReferencedUserMessage } from "./thread-response-presentation.js";

const storeMocks = vi.hoisted(() => ({ zoomLevel: 1 }));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: { zoomLevel: number }) => unknown) => selector(storeMocks),
}));

const routingMocks = vi.hoisted(() => ({ navigateToSessionMessageId: vi.fn() }));
vi.mock("../utils/routing.js", () => routingMocks);

/** Makes the component see a touch screen (no hover, coarse pointer) or a mouse. */
function useTouchScreen(touch: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: touch && query === "(hover: none) and (pointer: coarse)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const referencedMessages = [
  {
    historyMessageId: "raw-u7",
    userMessageId: "u7",
    content: "Please preserve the exact first request.\n\nIt has a second paragraph.",
  },
  {
    historyMessageId: "raw-u8",
    userMessageId: "u8",
    content: "Also include the later clarification.",
  },
] as const;

const ANSWER_MESSAGE = { id: "answer", role: "assistant" as const, content: "The answer.", timestamp: 1 };

/** The reference line above an answer that answers `messageCount` messages. */
function ThreadResponseCoverageBadge({
  messageCount,
  referencedMessages,
  answersMessageAbove,
}: {
  messageCount: number;
  referencedMessages?: readonly ThreadResponseReferencedUserMessage[];
  answersMessageAbove?: boolean;
}) {
  return (
    <AnswerReference
      answer={{ message: ANSWER_MESSAGE, messageCount, referencedMessages, answersMessageAbove }}
      sessionId="session-1"
      currentThreadKey="q-5"
    />
  );
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("AnswerReference on touch screens", () => {
  // Phones get one tappable quote: per-line links would be too small to tap.
  beforeEach(() => {
    storeMocks.zoomLevel = 1;
    useTouchScreen(true);
  });

  it("opens the ordered exact-message preview by explicit activation without activating its parent", async () => {
    const user = userEvent.setup();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <ThreadResponseCoverageBadge messageCount={2} referencedMessages={referencedMessages} />
        <button type="button">Next control</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Answers 2 messages; preview referenced messages" });
    await user.click(trigger);

    expect(parentClick).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const preview = screen.getByRole("dialog", { name: "Referenced user messages" });
    const messages = within(preview).getAllByTestId("thread-response-covered-message");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toHaveAttribute("data-message-id", "raw-u7");
    // The preview shows the messages themselves, not their model-facing u-numbers.
    expect(preview).not.toHaveTextContent("u7");
    expect(within(messages[0]!).getByTestId("thread-response-covered-message-content").textContent).toBe(
      referencedMessages[0].content,
    );
    expect(messages[1]).toHaveAttribute("data-message-id", "raw-u8");
    expect(messages[1]).toHaveTextContent("Also include the later clarification.");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    const keyboardPreview = screen.getByRole("dialog", { name: "Referenced user messages" });
    expect(keyboardPreview).toHaveFocus();

    await user.tab();
    expect(screen.queryByRole("dialog", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.queryByRole("dialog", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens only when tapped, never on hover", () => {
    render(<ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} />);

    const trigger = screen.getByRole("button", { name: "Answers 1 message; preview referenced message" });
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.pointerEnter(trigger, { pointerType: "pen" });
    expect(screen.queryByRole("tooltip", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-response-quote-link")).not.toBeInTheDocument();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toHaveTextContent(
      "Please preserve the exact first request.",
    );
  });

  it("uses visual-viewport bounds, measured dimensions, and Takode zoom for portal placement", async () => {
    storeMocks.zoomLevel = 2;
    const originalVisualViewport = window.visualViewport;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetLeft: 100,
        offsetTop: 200,
        width: 400,
        height: 400,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as VisualViewport,
    });
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === "thread-response-answer-reference") return rect(350, 500, 40, 20);
      if (this.dataset.testid === "thread-response-coverage-preview") return rect(0, 0, 384, 240);
      return rect(0, 0, 0, 0);
    });

    try {
      render(<ThreadResponseCoverageBadge messageCount={2} referencedMessages={referencedMessages} />);
      fireEvent.click(screen.getByRole("button", { name: "Answers 2 messages; preview referenced messages" }));
      const preview = screen.getByRole("dialog", { name: "Referenced user messages" });

      await waitFor(() => expect(preview).toHaveStyle({ visibility: "visible" }));
      expect(preview).toHaveAttribute("data-placement", "above");
      expect(preview).toHaveStyle({
        left: "108px",
        top: "254px",
        width: "192px",
        maxHeight: "192px",
        transform: "scale(2)",
      });
    } finally {
      geometry.mockRestore();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: originalVisualViewport });
    }
  });

  it("keeps image-only covered messages previewable", () => {
    render(
      <ThreadResponseCoverageBadge
        messageCount={1}
        referencedMessages={[{ historyMessageId: "raw-image", userMessageId: "u9", content: "", attachmentCount: 1 }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Answers 1 message; preview referenced message" }));
    const preview = screen.getByRole("dialog", { name: "Referenced user messages" });
    expect(within(preview).getByTestId("thread-response-covered-message-images")).toHaveTextContent(
      "1 image attachment",
    );
  });

  it("previews comment-only covered messages through their attached comments", () => {
    // A request sent only as comments on earlier text is stored with empty content and
    // structured annotations. It is a real covered message, so its label must stay hoverable.
    render(
      <ThreadResponseCoverageBadge
        messageCount={1}
        referencedMessages={[
          {
            historyMessageId: "raw-comment",
            userMessageId: "u4",
            content: "",
            annotations: [
              { id: "c1", selectedText: "This stall alert is a false alarm.", comment: "Can we fix this properly?" },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Answers 1 message; preview referenced message" }));
    const preview = screen.getByRole("dialog", { name: "Referenced user messages" });
    const comment = within(preview).getByTestId("thread-response-covered-message-comment");
    expect(within(comment).getByText("This stall alert is a false alarm.").tagName).toBe("BLOCKQUOTE");
    expect(comment).toHaveTextContent("Can we fix this properly?");
    expect(within(preview).queryByTestId("thread-response-covered-message-content")).not.toBeInTheDocument();
  });

  it("numbers multiple comments and keeps message text after them", () => {
    // Mirrors the agent-facing order: comments first, then any typed message text.
    render(
      <ThreadResponseCoverageBadge
        messageCount={1}
        referencedMessages={[
          {
            historyMessageId: "raw-comments",
            userMessageId: "u6",
            content: "And one more thing.",
            annotations: [
              { id: "c1", selectedText: "first quote", comment: "first comment" },
              { id: "c2", selectedText: "second quote", comment: "second comment" },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Answers 1 message; preview referenced message" }));
    const preview = screen.getByRole("dialog", { name: "Referenced user messages" });
    const comments = within(preview).getAllByTestId("thread-response-covered-message-comment");
    expect(comments.map((node) => node.textContent)).toEqual([
      "first quoteComment 1:first comment",
      "second quoteComment 2:second comment",
    ]);
    expect(within(preview).getByTestId("thread-response-covered-message-content")).toHaveTextContent(
      "And one more thing.",
    );
  });

  it.each([
    ["missing", undefined],
    ["incomplete", [referencedMessages[0]]],
    ["blank", [{ ...referencedMessages[0], content: "   " }, referencedMessages[1]]],
    ["duplicate identity", [referencedMessages[0], referencedMessages[0]]],
  ])("fails closed to a noninteractive compact badge for %s preview evidence", (_label, messages) => {
    render(<ThreadResponseCoverageBadge messageCount={2} referencedMessages={messages} />);

    const reference = screen.getByTestId("thread-response-answer-reference");
    expect(reference).toHaveAttribute("data-variant", "count");
    expect(reference).toHaveTextContent("Answers 2 messages");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-response-coverage-preview")).not.toBeInTheDocument();
  });
});

describe("AnswerReference lines", () => {
  // The quote text is the same with a mouse; the touch form has no link words in it.
  beforeEach(() => useTouchScreen(true));

  it("quotes the answered message as one line of text, whitespace collapsed", () => {
    // The quote must identify the request without hovering: paragraphs become one
    // clamped run of text, and the whole quote is the preview trigger.
    render(<ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} />);

    const quote = screen.getByTestId("thread-response-answer-reference");
    expect(quote).toHaveAttribute("data-variant", "quote");
    expect(quote.textContent).toBe("Please preserve the exact first request. It has a second paragraph.");
    expect(quote.querySelector(".line-clamp-2")).not.toBeNull();
  });

  it("gives several answered messages one line each and counts the rest past three", () => {
    const many = ["one", "two", "three", "four", "five"].map((word, index) => ({
      historyMessageId: `raw-${index}`,
      userMessageId: `u${index + 1}`,
      content: `Request ${word}`,
    }));
    render(<ThreadResponseCoverageBadge messageCount={5} referencedMessages={many} />);

    const quote = screen.getByRole("button", { name: "Answers 5 messages; preview referenced messages" });
    expect(quote.querySelectorAll(".line-clamp-1")).toHaveLength(3);
    expect(quote).toHaveTextContent("Request three+2 more");
    expect(quote).not.toHaveTextContent("Request four");
  });

  it("quotes a comment-only or image-only message by its comment or image count", () => {
    render(
      <>
        <ThreadResponseCoverageBadge
          messageCount={1}
          referencedMessages={[
            {
              historyMessageId: "raw-comment",
              userMessageId: "u4",
              content: "",
              annotations: [{ id: "c1", selectedText: "quoted text", comment: "Please fix this." }],
            },
          ]}
        />
        <ThreadResponseCoverageBadge
          messageCount={1}
          referencedMessages={[{ historyMessageId: "raw-image", userMessageId: "u9", content: "", attachmentCount: 2 }]}
        />
      </>,
    );

    const quotes = screen.getAllByTestId("thread-response-answer-reference");
    expect(quotes.map((quote) => quote.textContent)).toEqual(["Please fix this.", "2 images"]);
  });

  it("points up instead of quoting when the answer sits right under the message it answers", () => {
    render(
      <ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} answersMessageAbove />,
    );

    const reference = screen.getByTestId("thread-response-answer-reference");
    expect(reference).toHaveAttribute("data-variant", "above");
    expect(reference).toHaveTextContent("Answers the message above");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks an answer that names no message as a new result", () => {
    // A leader's unrequested result shares a card with earlier answers; without
    // this line it read as more paragraphs of the answer above it.
    render(<ThreadResponseCoverageBadge messageCount={0} />);

    const reference = screen.getByTestId("thread-response-answer-reference");
    expect(reference).toHaveAttribute("data-variant", "new-result");
    expect(reference).toHaveTextContent("New result");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("AnswerReference with a mouse", () => {
  // Desktop: the quote itself is inert; each quoted line ends in an "open" link that
  // previews just its message on hover and jumps to it on click, so no tall card
  // covering the feed opens just from moving the mouse over the quote.
  beforeEach(() => {
    storeMocks.zoomLevel = 1;
    useTouchScreen(false);
    routingMocks.navigateToSessionMessageId.mockClear();
  });

  it("ends every quoted line with an open link and leaves the quote itself inert", () => {
    render(<ThreadResponseCoverageBadge messageCount={2} referencedMessages={referencedMessages} />);

    const quote = screen.getByTestId("thread-response-answer-reference");
    expect(quote.tagName).toBe("DIV");
    expect(quote).toHaveAttribute("data-variant", "quote");
    const links = within(quote).getAllByRole("button", { name: "Open the quoted message" });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.textContent)).toEqual(["open", "open"]);
    fireEvent.pointerEnter(quote, { pointerType: "mouse" });
    expect(screen.queryByTestId("thread-response-coverage-preview")).not.toBeInTheDocument();
  });

  it("previews only the hovered link's message, in a smaller card, and not on touch", async () => {
    render(<ThreadResponseCoverageBadge messageCount={2} referencedMessages={referencedMessages} />);
    const second = screen.getAllByRole("button", { name: "Open the quoted message" })[1]!;

    fireEvent.pointerEnter(second, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.pointerEnter(second, { pointerType: "mouse" });
    const preview = screen.getByRole("tooltip", { name: "Referenced user messages" });
    const messages = within(preview).getAllByTestId("thread-response-covered-message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveAttribute("data-message-id", "raw-u8");
    // jsdom's viewport (1024x768) is larger than the link card, so the card's own limits apply.
    await waitFor(() => expect(preview).toHaveStyle({ width: "460px", maxHeight: "280px" }));
  });

  it("dismisses a hover preview with Escape without consuming the key or stealing focus", () => {
    render(
      <>
        <input aria-label="Composer" />
        <ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} />
      </>,
    );
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Open the quoted message" }), { pointerType: "mouse" });
    expect(screen.getByRole("tooltip", { name: "Referenced user messages" })).toBeVisible();

    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
    expect(screen.queryByRole("tooltip", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
  });

  it("jumps to the message in this tab, or in its own thread when this tab does not show it", async () => {
    const user = userEvent.setup();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <ThreadResponseCoverageBadge
          messageCount={2}
          referencedMessages={[referencedMessages[0], { ...referencedMessages[1], homeThreadKey: "main" }]}
        />
      </div>,
    );
    const [shownHere, shownInMain] = screen.getAllByRole("button", { name: "Open the quoted message" });

    fireEvent.pointerEnter(shownHere!, { pointerType: "mouse" });
    await user.click(shownHere!);
    expect(routingMocks.navigateToSessionMessageId).toHaveBeenLastCalledWith("session-1", "raw-u7", {
      threadKey: "q-5",
      preserveMainThreadRoute: true,
    });
    // Jumping closes the hover card and does not toggle the answer's turn.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(parentClick).not.toHaveBeenCalled();

    await user.click(shownInMain!);
    expect(routingMocks.navigateToSessionMessageId).toHaveBeenLastCalledWith("session-1", "raw-u8", {
      threadKey: "main",
      preserveMainThreadRoute: true,
    });
  });
});
