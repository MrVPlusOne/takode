// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useContext, useEffect, useRef, useState, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComposerMinimizer,
  ComposerMinimizeButton,
  ComposerVisibilityContext,
  type ComposerExpansion,
} from "./ComposerMinimizer.js";
import { useComposerNavigationFocus } from "./use-composer-navigation-focus.js";
import { useComposerTextareaSize } from "./use-composer-textarea-size.js";
import { useStore } from "../store.js";

beforeEach(() => useStore.setState({ focusComposerTrigger: 0 }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Draft({
  unmounted = () => {},
  portal = false,
  textareaRef: ref,
}: {
  unmounted?: () => void;
  portal?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const expanded = useContext(ComposerVisibilityContext);
  const [text, setText] = useState("First line\nSecond line");
  useEffect(() => unmounted, [unmounted]);
  useComposerTextareaSize(ref, text);
  useComposerNavigationFocus({ textareaRef: ref, sessionId: "session", threadKey: "main", usesTouchKeyboard: false });
  return (
    <>
      <textarea
        ref={ref}
        aria-label="Draft"
        aria-expanded={expanded}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div hidden={!expanded}>
        <img src="/fixture.png" alt="Attached image" />
        <button>Comment 1</button>
        <span data-testid="internal-label">Menu label</span>
      </div>
      {portal && createPortal(<button>Attachment preview</button>, document.body)}
    </>
  );
}

function Fixture({
  destination = "session:main",
  reveal = false,
  unmounted,
  portal = false,
}: {
  destination?: string;
  reveal?: boolean;
  unmounted?: () => void;
  portal?: boolean;
}) {
  const [expansion, setExpanded] = useState<ComposerExpansion>(false);
  const expanded = expansion === true || (expansion !== "hover-collapsed" && reveal);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <button>Outside</button>
      <ComposerMinimizer
        destination={destination}
        expanded={expanded}
        onExpandedChange={setExpanded}
        textareaRef={textareaRef}
      >
        <Draft unmounted={unmounted} portal={portal} textareaRef={textareaRef} />
        <div hidden={!expanded}>
          <ComposerMinimizeButton onClick={() => setExpanded(false)} disabled={reveal} />
        </div>
      </ComposerMinimizer>
    </>
  );
}

const isCollapsed = () => screen.getByTestId("composer-minimizer").getAttribute("data-collapsed") === "true";
const focusDraft = () => act(() => screen.getByRole("textbox").focus());

describe("composer minimization", () => {
  it("keeps the same full draft, image, and comments mounted behind an input-only compact view", () => {
    // Visibility changes must not dispose pending uploads or truncate the draft's later lines.
    const unmounted = vi.fn();
    render(<Fixture unmounted={unmounted} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(isCollapsed()).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
    focusDraft();
    const image = screen.getByRole("img");
    fireEvent.change(textarea, { target: { value: "Unsaved first line\nUnsaved second line" } });
    fireEvent.click(screen.getByLabelText("Minimize composer"));
    expect(isCollapsed()).toBe(true);
    expect(screen.getByRole("textbox")).toBe(textarea);
    expect(textarea.value).toBe("Unsaved first line\nUnsaved second line");
    expect(textarea.style.height).toBe("24px");
    expect(screen.queryByRole("button", { name: "Comment 1" })).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
    focusDraft();
    expect(screen.getByRole("img")).toBe(image);
    expect(document.activeElement).toBe(textarea);
  });

  it("honors only fresh focus requests and keeps active voice/editor work revealed", () => {
    // Historical counters are not active requests; resetting them must not focus an idle input.
    useStore.setState({ focusComposerTrigger: 3 });
    const view = render(<Fixture />);
    act(() => useStore.setState({ focusComposerTrigger: 0 }));
    expect(isCollapsed()).toBe(true);
    act(() => useStore.getState().focusComposer());
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole("textbox")).toBe(document.activeElement);
    fireEvent.click(screen.getByLabelText("Minimize composer"));
    view.rerender(<Fixture reveal />);
    expect(isCollapsed()).toBe(false);
    expect((screen.getByLabelText("Minimize composer") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not revive old destination or blur requests after a fresh expansion", async () => {
    // A destination round trip starts compact unless an intentional focus actually survives it.
    const view = render(<Fixture destination="one:main" />);
    focusDraft();
    fireEvent.click(screen.getByLabelText("Minimize composer"));
    view.rerender(<Fixture destination="two:main" />);
    expect(isCollapsed()).toBe(true);
    view.rerender(<Fixture destination="one:main" />);
    focusDraft();
    await act(async () => {});
    expect(isCollapsed()).toBe(false);
  });

  it("stays expanded across internal buttons, non-focusable labels, and attachment portals", async () => {
    // Pointer focus loss on non-focusable content is internal interaction, not an outside click.
    render(<Fixture portal />);
    focusDraft();
    act(() => screen.getByRole("button", { name: "Comment 1" }).focus());
    expect(isCollapsed()).toBe(false);
    fireEvent.pointerDown(screen.getByTestId("internal-label"));
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.pointerUp(screen.getByTestId("internal-label"));
    await act(async () => {});
    expect(isCollapsed()).toBe(false);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Attachment preview" }));
    act(() => screen.getByRole("button", { name: "Attachment preview" }).focus());
    expect(isCollapsed()).toBe(false);
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    await act(async () => {});
    expect(isCollapsed()).toBe(true);
  });

  it("keeps internal controls available when blur arrives after pointer release", async () => {
    // This models the suspected touch ordering, without claiming native Safari reproduction.
    render(<Fixture />);
    focusDraft();
    const control = screen.getByRole("button", { name: "Comment 1" });
    fireEvent.pointerDown(control, { pointerType: "touch" });
    fireEvent.pointerUp(control, { pointerType: "touch" });
    act(() => screen.getByRole("textbox").blur());
    await act(async () => {});
    expect(isCollapsed()).toBe(false);
    expect(screen.getByRole("button", { name: "Comment 1" })).toBe(control);
  });

  it("retains intentional expansion after active voice ends despite transient focus loss", async () => {
    // Voice's temporary reveal must not mask a blur-driven loss of persistent expansion.
    const view = render(<Fixture reveal />);
    focusDraft();
    act(() => screen.getByRole("textbox").blur());
    await act(async () => {});
    view.rerender(<Fixture />);
    expect(isCollapsed()).toBe(false);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("First line\nSecond line");
  });

  it("keeps a later outside action authoritative when active voice ends", () => {
    // A late recording/transcription completion must not reopen a deliberately closed draft.
    const view = render(<Fixture reveal />);
    focusDraft();
    fireEvent.pointerDown(document.body);
    expect(isCollapsed()).toBe(false);
    view.rerender(<Fixture />);
    expect(isCollapsed()).toBe(true);
  });

  it("collapses populated drafts on outside pointers and keyboard focus departure", async () => {
    // Both non-focusable conversation clicks and Tab navigation out of the complete composer count.
    render(<Fixture />);
    focusDraft();
    fireEvent.pointerDown(document.body);
    expect(isCollapsed()).toBe(true);
    focusDraft();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab" });
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    await act(async () => {});
    expect(isCollapsed()).toBe(true);
  });

  it("preserves expansion through transient blur and refocus", async () => {
    // A temporary lack of focus must not undo an explicit interaction in the same event turn.
    render(<Fixture />);
    focusDraft();
    act(() => screen.getByRole("textbox").blur());
    focusDraft();
    await act(async () => {});
    expect(isCollapsed()).toBe(false);
  });
});

function hover(element: Element, inside: boolean, pointerType = "mouse", buttons = 0) {
  // jsdom has no native PointerEvent; retain the actual pointer producer fields.
  fireEvent(
    element,
    Object.assign(
      new MouseEvent(inside ? "pointerover" : "pointerout", {
        bubbles: true,
        relatedTarget: document.body,
        buttons,
      }),
      { pointerType },
    ),
  );
}

function desktopHover(enabled = true) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: enabled && query === "(hover: hover) and (pointer: fine)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

it("restores a scrolled backward selection after hovering out, selecting feed text, and returning", () => {
  // Hover must preserve the real editing range and scroll without preventing an independent feed selection.
  desktopHover();
  render(<Fixture />);
  const boundary = screen.getByTestId("composer-minimizer");
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  hover(boundary, true);
  expect(isCollapsed()).toBe(false);
  expect(document.activeElement).not.toBe(input);
  focusDraft();
  const text = "A long paragraph with the editing position in its middle. ".repeat(30);
  fireEvent.change(input, { target: { value: text } });
  for (let cycle = 0; cycle < 2; cycle++) {
    input.setSelectionRange(450 + cycle, 490 + cycle, "backward");
    input.scrollTop = 125;
    hover(boundary, false);
    expect(isCollapsed()).toBe(true);
    expect(document.activeElement).not.toBe(input);
    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => outside.focus());
    const range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe("Outside");
    hover(boundary, true);
    expect(isCollapsed()).toBe(false);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
      450 + cycle,
      490 + cycle,
      "backward",
    ]);
    expect(input.scrollTop).toBe(125);
    expect(input.value).toBe(text);
    expect(screen.getByRole("textbox")).toBe(input);
  }
});

it("hides active work on desktop hover departure without disposing it or reopening on completion", () => {
  // The hover close is presentation intent; the voice/editor lifetime remains mounted and independent.
  desktopHover();
  const unmounted = vi.fn();
  const view = render(<Fixture reveal unmounted={unmounted} />);
  focusDraft();
  const boundary = screen.getByTestId("composer-minimizer");
  hover(boundary, false);
  expect(isCollapsed()).toBe(true);
  expect(unmounted).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  act(() => screen.getByRole("button", { name: "Outside" }).focus());
  expect(isCollapsed()).toBe(true);
  view.rerender(<Fixture unmounted={unmounted} />);
  expect(isCollapsed()).toBe(true);
  hover(boundary, true);
  expect(isCollapsed()).toBe(false);
});

it("leaves touch and pen interactions unchanged and requires real desktop hover capability", () => {
  // Synthetic mouse compatibility events on a touch-only device must not enable this desktop behavior.
  desktopHover();
  render(<Fixture />);
  const boundary = screen.getByTestId("composer-minimizer");
  hover(boundary, true, "touch");
  hover(boundary, true, "pen");
  expect(isCollapsed()).toBe(true);
  focusDraft();
  hover(boundary, false, "touch");
  hover(boundary, false, "pen");
  expect(isCollapsed()).toBe(false);
  desktopHover(false);
  hover(boundary, false);
  expect(isCollapsed()).toBe(false);
});

it("does not take focus from a feed selection drag or restore an old destination's range", () => {
  // Returning while still dragging must not steal native feed selection; route changes retire saved editing intent.
  desktopHover();
  const view = render(<Fixture />);
  const boundary = screen.getByTestId("composer-minimizer");
  focusDraft();
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(4, 9);
  hover(boundary, false);
  hover(boundary, true, "mouse", 1);
  expect(isCollapsed()).toBe(true);
  expect(document.activeElement).not.toBe(input);
  view.rerender(<Fixture destination="another:main" />);
  input.setSelectionRange(0, 0);
  hover(boundary, true);
  expect(input.selectionStart).toBe(0);
  expect(document.activeElement).not.toBe(input);
});

it("retains a newer collapsed draft result instead of replaying the saved selection over it", () => {
  // Completion while hidden owns its inserted text and caret; hover must not restore obsolete indices.
  desktopHover();
  render(<Fixture />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  const boundary = screen.getByTestId("composer-minimizer");
  focusDraft();
  input.setSelectionRange(4, 9);
  hover(boundary, false);
  fireEvent.change(input, { target: { value: "Completed voice result." } });
  input.setSelectionRange(input.value.length, input.value.length);
  hover(boundary, true);
  expect(input.value).toBe("Completed voice result.");
  expect(input.selectionStart).toBe(input.value.length);
  expect(input.selectionEnd).toBe(input.value.length);
});
