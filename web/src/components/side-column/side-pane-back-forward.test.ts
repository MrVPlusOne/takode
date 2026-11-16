// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { backForwardOf } from "./side-pane-back-forward.js";

const key = (init: KeyboardEventInit, target?: HTMLElement) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

/**
 * Which presses are the browser's own Back and Forward, which a focused side pane takes over:
 * each platform's keys, and a mouse's side buttons.
 */
describe("backForwardOf", () => {
  it("reads Cmd+[ and Cmd+] on a Mac, and Cmd+Left and Cmd+Right only outside text", () => {
    expect(backForwardOf(key({ key: "[", metaKey: true }), true)).toBe("back");
    expect(backForwardOf(key({ key: "]", metaKey: true }), true)).toBe("forward");
    expect(backForwardOf(key({ key: "ArrowLeft", metaKey: true }), true)).toBe("back");
    expect(backForwardOf(key({ key: "ArrowRight", metaKey: true }), true)).toBe("forward");
    // In text, Cmd+Left and Cmd+Right move to the line's ends.
    const box = document.createElement("textarea");
    document.body.append(box);
    expect(backForwardOf(key({ key: "ArrowLeft", metaKey: true }, box), true)).toBeNull();
    expect(backForwardOf(key({ key: "[", metaKey: true }, box), true)).toBe("back");
    box.remove();
    // Alt+Left moves by word on a Mac; other modifiers make other shortcuts.
    expect(backForwardOf(key({ key: "ArrowLeft", altKey: true }), true)).toBeNull();
    expect(backForwardOf(key({ key: "[", metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(backForwardOf(key({ key: "[" }), true)).toBeNull();
  });

  it("reads Alt+Left and Alt+Right elsewhere", () => {
    expect(backForwardOf(key({ key: "ArrowLeft", altKey: true }), false)).toBe("back");
    expect(backForwardOf(key({ key: "ArrowRight", altKey: true }), false)).toBe("forward");
    expect(backForwardOf(key({ key: "[", metaKey: true }), false)).toBeNull();
    expect(backForwardOf(key({ key: "ArrowLeft", altKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it("reads a mouse's back and forward buttons", () => {
    expect(backForwardOf(new MouseEvent("mouseup", { button: 3 }), false)).toBe("back");
    expect(backForwardOf(new MouseEvent("mouseup", { button: 4 }), true)).toBe("forward");
    expect(backForwardOf(new MouseEvent("mouseup", { button: 0 }), false)).toBeNull();
  });
});
