// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { ChatTextBox } from "./ChatTextBox.js";
import { setComposerTextBoxMode } from "./composer-text-box-preview.js";

// Every chat input renders through ChatTextBox: today's textarea by default, or with the Message
// Box preview on, the Markdown box. These tests pin the switch, that references are highlighted
// in the Markdown box, and that a box without its own draft history still undoes.

function Box({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <ChatTextBox aria-label="Answer" value={value} onChange={(event) => setValue(event.target.value)} />;
}

afterEach(() => {
  cleanup();
  setComposerTextBoxMode("textarea");
  localStorage.clear();
});

it("is today's textarea unless the Markdown box is chosen", () => {
  render(<Box initial="hi #5" />);
  expect(screen.getByLabelText("Answer").tagName).toBe("TEXTAREA");
  act(() => setComposerTextBoxMode("rich-markdown"));
  const box = screen.getByLabelText("Answer");
  expect(box.getAttribute("contenteditable")).toBe("plaintext-only");
  expect(box.hasAttribute("data-chat-input")).toBe(true);
  expect(box.querySelector(".md-ref")?.textContent).toBe("#5");
});

it("undoes and redoes on its own when the draft keeps no history", () => {
  setComposerTextBoxMode("rich-markdown");
  render(<Box initial="one" />);
  const box = screen.getByLabelText("Answer") as HTMLElement & { value: string };
  act(() => {
    box.value = "one two";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(box.value).toBe("one two");
  fireEvent.keyDown(box, { key: "z", ctrlKey: true });
  expect(box.value).toBe("one");
  fireEvent.keyDown(box, { key: "z", ctrlKey: true, shiftKey: true });
  expect(box.value).toBe("one two");
});
