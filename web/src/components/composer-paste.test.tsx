// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { insertComposerPaste } from "./composer-paste.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Editor() {
  const [text, setText] = useState("before after");
  return (
    <textarea
      aria-label="Draft"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onPaste={(event) => {
        event.preventDefault();
        insertComposerPaste(event.currentTarget, event.clipboardData.getData("text/plain"));
      }}
    />
  );
}

describe("composer paste insertion", () => {
  it("updates a controlled draft and replaces the selection even when the browser supplies no default edit", () => {
    render(<Editor />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(7, 12);
    // Mirrors the observed boundary: the paste contains text, but no browser input follows it.
    fireEvent.paste(textarea, { clipboardData: { getData: () => "link" } });
    expect(textarea.value).toBe("before link");
    expect(textarea.selectionStart).toBe(11);
    fireEvent.change(textarea, { target: { value: `${textarea.value}!` } });
    expect(textarea.value).toBe("before link!");
  });

  it("uses the undoable insertion exactly once when the browser supports it", () => {
    const insert = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: insert });
    const textarea = document.createElement("textarea");
    const input = vi.fn();
    textarea.addEventListener("input", input);
    insertComposerPaste(textarea, "a\nb");
    expect(insert).toHaveBeenCalledExactlyOnceWith("insertText", false, "a\nb");
    expect(input).not.toHaveBeenCalled(); // no fallback that could duplicate a native insertion
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });
});
