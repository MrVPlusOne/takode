// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

it("keeps annotation and image indicators while desktop hover restores a selected draft range", () => {
  // Exercise the actual Playground wiring, including the shared textarea ref and expansion intent.
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  render(<PlaygroundAnnotationsSection />);
  const input = screen.getByLabelText("Annotation main message") as HTMLTextAreaElement;
  act(() => input.focus());
  input.setSelectionRange(8, 20, "backward");
  const boundary = screen.getByTestId("composer-minimizer");
  const pointer = (type: string) =>
    fireEvent(
      boundary,
      Object.assign(
        new MouseEvent(type, {
          bubbles: true,
          relatedTarget: document.body,
        }),
        { pointerType: "mouse" },
      ),
    );
  pointer("pointerout");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("compact-image-count").textContent).toBe("1");
  expect(screen.getByTestId("compact-comment-count").textContent).toBe("2");
  pointer("pointerover");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([8, 20, "backward"]);
  expect(document.activeElement).toBe(input);
  vi.restoreAllMocks();
});

it("demonstrates default-open short, long and multiple sent comments through history normalization", () => {
  // These are sent user-message fixtures; the existing editable composer chips stay independent.
  render(<PlaygroundAnnotationsSection />);
  const examples = within(screen.getByTestId("playground-sent-comments"));
  const picker = examples.getByLabelText("Sent comment example");
  expect(examples.getByLabelText("Comment 1").closest("details")?.open).toBe(true);
  fireEvent.change(picker, { target: { value: "long" } });
  expect(examples.getByText(/Paragraph 12:/).textContent).toContain("Paragraph 1:");
  expect(examples.getByLabelText("Comment 1").closest("details")?.open).toBe(true);
  fireEvent.change(picker, { target: { value: "multiple" } });
  expect(examples.getByLabelText("Comment 3").closest("details")?.open).toBe(true);
  expect(examples.getByText("Please address each comment before changing the refresh behavior.")).toBeTruthy();
});
