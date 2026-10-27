// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { typeToComposeKey, useComposerTypeToCompose } from "./use-composer-type-to-compose.js";

/**
 * Type-to-compose: with nothing else focused, a typed character or a paste focuses the composer
 * (the browser then delivers the key there) and Enter opens it empty. These tests cover which keys
 * count and every situation where the page, not the composer, keeps the key.
 */

const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false };

function Harness({ enabled = true, disabled = false }: { enabled?: boolean; disabled?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useComposerTypeToCompose({ textareaRef, enabled });
  return <textarea aria-label="Message" ref={textareaRef} defaultValue="draft" disabled={disabled} />;
}

function composer() {
  return screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
}

/** Dispatches a keydown on `target`; returns true when the event's default was left alone. */
function press(target: Element, init: KeyboardEventInit) {
  return fireEvent.keyDown(target, init);
}

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("typeToComposeKey", () => {
  it("counts printable characters, with or without Shift", () => {
    for (const key of ["a", "Z", "7", "?", "/", ".", "é", "😀"]) {
      expect(typeToComposeKey({ ...NO_MODIFIERS, key }, true)).toBe("character");
    }
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "A", shiftKey: true }, true)).toBe("character");
  });

  it("leaves navigation keys, Escape and IME composition to the page", () => {
    for (const key of [
      " ",
      "ArrowDown",
      "ArrowUp",
      "PageDown",
      "PageUp",
      "Home",
      "End",
      "Tab",
      "Escape",
      "Dead",
      "Shift",
    ]) {
      expect(typeToComposeKey({ ...NO_MODIFIERS, key }, true)).toBeNull();
    }
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "a", isComposing: true }, true)).toBeNull();
  });

  it("leaves Cmd, Ctrl and Option shortcuts to the page", () => {
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "k", metaKey: true }, true)).toBeNull();
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "k", ctrlKey: true }, false)).toBeNull();
    // Option+e on a Mac types a dead key or an accented character; it stays a shortcut key.
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "é", altKey: true }, true)).toBeNull();
  });

  it("treats the platform's paste shortcut as paste, and only that one", () => {
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "v", metaKey: true }, true)).toBe("paste");
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "v", ctrlKey: true }, false)).toBe("paste");
    // Paste as plain text (Cmd+Shift+V) is still paste.
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "V", metaKey: true, shiftKey: true }, true)).toBe("paste");
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "v", ctrlKey: true }, true)).toBeNull();
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "v", metaKey: true }, false)).toBeNull();
  });

  it("opens on plain Enter but not Shift+Enter", () => {
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "Enter" }, true)).toBe("enter");
    expect(typeToComposeKey({ ...NO_MODIFIERS, key: "Enter", shiftKey: true }, true)).toBeNull();
  });
});

describe("useComposerTypeToCompose", () => {
  it("focuses the composer at the end of the draft and lets the browser deliver the character", () => {
    render(<Harness />);
    composer().setSelectionRange(0, 0);

    const defaultKept = press(document.body, { key: "h" });

    expect(document.activeElement).toBe(composer());
    expect(composer().selectionStart).toBe("draft".length);
    // The browser types the character into the newly focused composer only if the default stays.
    expect(defaultKept).toBe(true);
  });

  it("focuses the composer for paste without taking the paste's default", () => {
    render(<Harness />);
    const isMac = /Mac/.test(navigator.platform);
    const defaultKept = press(document.body, { key: "v", metaKey: isMac, ctrlKey: !isMac });
    expect(document.activeElement).toBe(composer());
    expect(defaultKept).toBe(true);
  });

  it("opens the composer on Enter without adding a new line", () => {
    render(<Harness />);
    const defaultKept = press(document.body, { key: "Enter" });
    expect(document.activeElement).toBe(composer());
    expect(defaultKept).toBe(false);
  });

  it("types from a focused button, but leaves Enter to the button it would activate", () => {
    render(
      <>
        <Harness />
        <button type="button">Open</button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Open" });

    button.focus();
    expect(press(button, { key: "Enter" })).toBe(true);
    expect(document.activeElement).toBe(button);

    press(button, { key: "x" });
    expect(document.activeElement).toBe(composer());
  });

  it("leaves keys to another focused input", () => {
    render(
      <>
        <Harness />
        <input aria-label="Search" />
      </>,
    );
    const search = screen.getByRole("textbox", { name: "Search" });
    search.focus();
    press(search, { key: "a" });
    press(search, { key: "Enter" });
    expect(document.activeElement).toBe(search);
  });

  it("leaves typeahead to a focused menu or list", () => {
    render(
      <>
        <Harness />
        <div role="listbox" aria-label="Options">
          <div role="option" aria-selected="false" tabIndex={-1}>
            Alpha
          </div>
        </div>
      </>,
    );
    const option = screen.getByRole("option", { name: "Alpha" });
    press(option, { key: "a" });
    expect(document.activeElement).not.toBe(composer());
  });

  it.each<[string, Record<string, string>]>([
    ["a dialog", { role: "dialog" }],
    ["a modal (image viewer, full-screen report)", { "aria-modal": "true" }],
    ["a menu", { role: "menu" }],
    ["a context menu", { "data-context-menu": "true" }],
    ["a backdrop-wrapped surface", { "data-modal-backdrop": "true" }],
  ])("does nothing while %s is open", (_label, attributes) => {
    render(
      <>
        <Harness />
        <div {...attributes}>Open surface</div>
      </>,
    );
    press(document.body, { key: "a" });
    press(document.body, { key: "Enter" });
    expect(document.activeElement).not.toBe(composer());
  });

  it("keeps a text selection (for a comment or copy) instead of typing over it", () => {
    render(
      <>
        <Harness />
        <p>Selected feed text</p>
      </>,
    );
    const range = document.createRange();
    range.selectNodeContents(screen.getByText("Selected feed text"));
    document.getSelection()?.addRange(range);

    press(document.body, { key: "a" });
    expect(document.activeElement).not.toBe(composer());
  });

  it("does nothing when the composer is inert, disabled, turned off, or the key was already claimed", () => {
    const { unmount } = render(
      <div inert>
        <Harness />
      </div>,
    );
    press(document.body, { key: "a" });
    expect(document.activeElement).not.toBe(composer());
    unmount();

    const disabled = render(<Harness disabled />);
    press(document.body, { key: "a" });
    expect(document.activeElement).not.toBe(composer());
    disabled.unmount();

    const off = render(<Harness enabled={false} />);
    press(document.body, { key: "a" });
    expect(document.activeElement).not.toBe(composer());
    off.unmount();

    render(<Harness />);
    // An app shortcut or open surface that handles a key prevents it before the bubble phase.
    const claim = (event: KeyboardEvent) => event.preventDefault();
    document.body.addEventListener("keydown", claim);
    press(document.body, { key: "a" });
    document.body.removeEventListener("keydown", claim);
    expect(document.activeElement).not.toBe(composer());
  });
});
