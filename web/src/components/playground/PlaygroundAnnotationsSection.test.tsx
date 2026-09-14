// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaygroundAnnotationsSection } from "./PlaygroundAnnotationsSection.js";
import { useStore } from "../../store.js";

beforeEach(() => {
  useStore.getState().reset();
  Element.prototype.scrollIntoView = vi.fn();
  // The fixture owns source-marker measurement; jsdom supplies no ResizeObserver implementation.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("demonstrates compact indicators with preserved multiline text and hidden attachment content", () => {
  // This fixture uses the same expansion boundary and sizing hook as the assembled composer.
  render(<PlaygroundAnnotationsSection />);
  const input = screen.getByLabelText("Annotation main message") as HTMLTextAreaElement;
  const original = input.value;
  expect(original.split("\n")).toHaveLength(2);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("composer-compact-preview").textContent).toContain("…");
  expect(screen.getByTestId("compact-image-count").textContent).toBe("1");
  expect(screen.getByTestId("compact-comment-count").textContent).toBe("2");
  expect(screen.queryByRole("img", { name: "Example attached image" })).toBeNull();
  act(() => input.focus());
  const image = screen.getByRole("img", { name: "Example attached image" });
  fireEvent.click(screen.getByLabelText("Minimize composer"));
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.value).toBe(original);
  expect(image.closest("[hidden]")).toBeTruthy();
  act(() => input.focus());
  expect(screen.getByRole("img", { name: "Example attached image" })).toBe(image);
  // An attachment-only draft remains discoverable without rendering full attachments.
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Conversation annotations" }));
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("compact-image-count").textContent).toBe("1");
  expect(screen.getByTestId("compact-comment-count").textContent).toBe("2");
});

it("keeps simulated voice completion visible until an outside interaction", async () => {
  // The sample intentionally releases focus; it does not record audio or emulate a native browser.
  render(<PlaygroundAnnotationsSection />);
  const input = screen.getByLabelText("Annotation main message") as HTMLTextAreaElement;
  const original = input.value;
  act(() => input.focus());
  const complete = screen.getByRole("button", { name: "Simulate voice completion" });
  act(() => complete.focus());
  fireEvent.click(complete);
  await act(async () => {});
  expect(document.activeElement).toBe(document.body);
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(input.value).toBe(`${original}\nSimulated voice text.`);
  expect(screen.getByRole("img", { name: "Example attached image" })).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Conversation annotations" }));
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.value).toBe(`${original}\nSimulated voice text.`);
  expect(screen.getByTestId("compact-comment-count").textContent).toBe("2");
});
