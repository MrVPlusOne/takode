// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadResponseCoverageBadge } from "./ThreadResponsePresentationChrome.js";

const storeMocks = vi.hoisted(() => ({ zoomLevel: 1 }));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: { zoomLevel: number }) => unknown) => selector(storeMocks),
}));

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

describe("ThreadResponseCoverageBadge", () => {
  beforeEach(() => {
    storeMocks.zoomLevel = 1;
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
    expect(messages[0]).toHaveTextContent("u7 · 1 of 2");
    expect(within(messages[0]!).getByTestId("thread-response-covered-message-content").textContent).toBe(
      referencedMessages[0].content,
    );
    expect(messages[1]).toHaveAttribute("data-message-id", "raw-u8");
    expect(messages[1]).toHaveTextContent("u8 · 2 of 2");
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

  it("opens on fine-pointer hover while touch relies on explicit activation", () => {
    render(<ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} />);

    const trigger = screen.getByRole("button", { name: "Answers 1 message; preview referenced message" });
    fireEvent.pointerEnter(trigger, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip", { name: "Referenced user messages" })).not.toBeInTheDocument();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toBeVisible();
    fireEvent.click(trigger);

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip", { name: "Referenced user messages" })).toHaveTextContent(
      "Please preserve the exact first request.",
    );
  });

  it("dismisses a hover preview with Escape without consuming the key or stealing focus", () => {
    render(
      <>
        <input aria-label="Composer" />
        <ThreadResponseCoverageBadge messageCount={1} referencedMessages={[referencedMessages[0]]} />
      </>,
    );
    const composer = screen.getByRole("textbox", { name: "Composer" });
    const trigger = screen.getByRole("button", { name: "Answers 1 message; preview referenced message" });
    composer.focus();
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip", { name: "Referenced user messages" })).toBeVisible();

    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
    expect(screen.queryByRole("tooltip", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
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
      if (this.dataset.testid === "thread-response-answer-count") return rect(350, 500, 40, 20);
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
    expect(preview).toHaveTextContent("u9");
    expect(within(preview).getByTestId("thread-response-covered-message-images")).toHaveTextContent(
      "1 image attachment",
    );
  });

  it.each([
    ["missing", undefined],
    ["incomplete", [referencedMessages[0]]],
    ["blank", [{ ...referencedMessages[0], content: "   " }, referencedMessages[1]]],
    ["duplicate identity", [referencedMessages[0], referencedMessages[0]]],
  ])("fails closed to a noninteractive compact badge for %s preview evidence", (_label, messages) => {
    render(<ThreadResponseCoverageBadge messageCount={2} referencedMessages={messages} />);

    expect(screen.getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 2 messages");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-response-coverage-preview")).not.toBeInTheDocument();
  });
});
