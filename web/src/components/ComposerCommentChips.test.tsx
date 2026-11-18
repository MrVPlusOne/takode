// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { ComposerCommentChips, chipsThatFit } from "./ComposerCommentChips.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const comments: ConversationAnnotation[] = Array.from({ length: 5 }, (_, index) => ({
  id: `c${index + 1}`,
  selectedText: `passage ${index + 1}`,
  comment: `comment text ${index + 1}`,
}));

it("fits chips in order and keeps room for the +N chip only when some don't fit", () => {
  // Everything fits: no +N chip, so its width is not reserved.
  expect(chipsThatFit([100, 100], 40, 6, 206)).toBe(2);
  // One too many: the +N chip (40) takes the place of what no longer fits.
  expect(chipsThatFit([100, 100, 100], 40, 6, 300)).toBe(2);
  expect(chipsThatFit([100, 100, 100], 40, 6, 250)).toBe(1);
  // Narrower than one chip plus +N: only the +N chip shows.
  expect(chipsThatFit([100, 100], 40, 6, 120)).toBe(0);
});

it("counts the comments that don't fit on a +N chip that lists every comment", () => {
  // The row is 300px wide, each chip 120px and the +N chip 40px, so two chips fit beside "+3".
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === "composer-comment-chips" ? 300 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-more-comments") ? 40 : this.hasAttribute("data-comment-chip") ? 120 : 0;
  });
  const onOpen = vi.fn();
  const onRemove = vi.fn();
  render(
    <ComposerCommentChips annotations={comments} sessionId="s1" disabled={false} onOpen={onOpen} onRemove={onRemove} />,
  );
  // Unshown chips leave the accessibility tree; each shown chip starts with its comment's text.
  expect(screen.getAllByRole("button", { name: /^Comment \d$/ }).map((chip) => chip.textContent)).toEqual([
    "1comment text 1",
    "2comment text 2",
  ]);
  const more = screen.getByRole("button", { name: "3 more comments" });
  expect(more.textContent).toBe("+3");

  fireEvent.click(more);
  const list = screen.getByRole("list", { name: "Comments" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  fireEvent.click(within(list).getByRole("button", { name: "Remove comment 4" }));
  expect(onRemove).toHaveBeenCalledWith("c4");
  fireEvent.click(within(list).getByRole("button", { name: "Open comment 5" }));
  expect(onOpen).toHaveBeenCalledWith(comments[4]);
  expect(screen.queryByRole("list", { name: "Comments" })).toBeNull();
});

it("shows every chip and no +N chip when they all fit", () => {
  // Without layout (jsdom's zero widths) or with room to spare, nothing is hidden.
  render(<ComposerCommentChips annotations={comments.slice(0, 2)} sessionId="s1" disabled={false} onOpen={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Comment \d$/ })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /more comment/ })).toBeNull();
});
