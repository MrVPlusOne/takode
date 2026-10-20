// @vitest-environment jsdom
/**
 * Long code blocks in rendered Markdown: capped to a scrollable window, with the line count
 * and an expand button in the header, and collapsible again from the header or the block's end.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent.js";

// jsdom has no layout: the block's <pre> reports a content height taller than its capped box
// when it holds more than 20 lines, which is what a browser measures for such a block.
const CAPPED_PX = 352;
const LINE_PX = 20;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return (this.textContent ?? "").split("\n").length * LINE_PX;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    const capped = this.className.includes("max-h-");
    const height = (this.textContent ?? "").split("\n").length * LINE_PX;
    return capped ? Math.min(height, CAPPED_PX) : height;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function json(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `  "key${index}": ${index},`).join("\n");
}

describe("long code blocks", () => {
  it("caps a long block, shows its line count beside the expand button, and expands and collapses it", () => {
    render(<MarkdownContent text={`\`\`\`json\n${json(1200)}\n\`\`\``} />);
    const block = screen.getByTestId("code-block");
    const pre = within(block).getByTestId("code-block-pre");
    expect(pre.className).toContain("max-h-");
    expect(within(block).getByTestId("code-block-line-count")).toHaveTextContent("1,200 lines");

    fireEvent.click(within(block).getByRole("button", { name: "Show all 1,200 lines" }));
    expect(pre.className).not.toContain("max-h-");
    expect(block).toHaveAttribute("data-expanded", "true");

    // The bar at the block's end collapses it without scrolling back to its header.
    fireEvent.click(within(block).getByTestId("code-block-collapse-bar"));
    expect(pre.className).toContain("max-h-");
    expect(within(block).getByRole("button", { name: "Show all 1,200 lines" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("brings the block's top back into view when collapsing it from below", () => {
    // After reading an expanded block to its end, its top is above the screen; collapsing
    // must not leave the reader far below the now short block.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<MarkdownContent text={`\`\`\`json\n${json(1200)}\n\`\`\``} />);
    const block = screen.getByTestId("code-block");
    fireEvent.click(within(block).getByTestId("code-block-toggle"));
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top: -5000 } as DOMRect);

    act(() => fireEvent.click(within(block).getByTestId("code-block-collapse-bar")));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("leaves a short block at its own height with no line count or expand button", () => {
    render(<MarkdownContent text={"```\nshort block\nsecond line\n```"} />);
    const block = screen.getByTestId("code-block");
    expect(within(block).queryByTestId("code-block-toggle")).not.toBeInTheDocument();
    expect(within(block).queryByTestId("code-block-line-count")).not.toBeInTheDocument();
    expect(block).not.toHaveAttribute("data-expanded");
  });
});
