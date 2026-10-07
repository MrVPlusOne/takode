import { describe, expect, it } from "vitest";
import { isSendKeyEvent, sendKeyHint } from "./useSendKey.js";

// Minimal keydown shape; every field defaults to an unmodified, non-IME Enter press.
function key(overrides: Partial<Parameters<typeof isSendKeyEvent>[0]> = {}) {
  return {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  };
}
const desktop = { touchKeyboard: false, platform: "MacIntel" };
const touch = { touchKeyboard: true, platform: "iPhone" };

describe("isSendKeyEvent", () => {
  it("default scheme: Enter sends, Shift+Enter is a newline", () => {
    expect(isSendKeyEvent(key(), "enter", desktop)).toBe(true);
    expect(isSendKeyEvent(key({ shiftKey: true }), "enter", desktop)).toBe(false);
  });

  it("mod-enter scheme: Enter and Shift+Enter are newlines, Cmd or Ctrl+Enter sends", () => {
    expect(isSendKeyEvent(key(), "mod-enter", desktop)).toBe(false);
    expect(isSendKeyEvent(key({ shiftKey: true }), "mod-enter", desktop)).toBe(false);
    expect(isSendKeyEvent(key({ metaKey: true }), "mod-enter", desktop)).toBe(true);
    // Ctrl is accepted on every platform so non-Mac keyboards have an equivalent.
    expect(isSendKeyEvent(key({ ctrlKey: true }), "mod-enter", { touchKeyboard: false, platform: "Win32" })).toBe(true);
  });

  it("Cmd+Enter also sends under the default scheme", () => {
    expect(isSendKeyEvent(key({ metaKey: true }), "enter", desktop)).toBe(true);
  });

  it("never sends while an IME candidate is being confirmed", () => {
    // CJK input: Enter confirms the candidate, so neither plain nor modified Enter may send.
    for (const scheme of ["enter", "mod-enter"] as const) {
      expect(isSendKeyEvent(key({ isComposing: true }), scheme, desktop)).toBe(false);
      expect(isSendKeyEvent(key({ keyCode: 229, metaKey: true }), scheme, desktop)).toBe(false);
    }
  });

  it("touch keyboards keep plain Enter as a newline but a hardware Cmd+Enter still sends", () => {
    expect(isSendKeyEvent(key(), "enter", touch)).toBe(false);
    expect(isSendKeyEvent(key({ metaKey: true }), "enter", touch)).toBe(true);
  });

  it("ignores keys other than Enter", () => {
    expect(isSendKeyEvent(key({ key: "a", metaKey: true }), "mod-enter", desktop)).toBe(false);
  });
});

describe("sendKeyHint", () => {
  it("describes the active scheme with the platform's modifier", () => {
    expect(sendKeyHint("enter", desktop)).toBe("Send: Enter; New line: Shift+Enter");
    expect(sendKeyHint("mod-enter", desktop, "Save")).toBe("Save: ⌘+Enter; New line: Enter");
    expect(sendKeyHint("mod-enter", { touchKeyboard: false, platform: "Linux x86_64" })).toBe(
      "Send: Ctrl+Enter; New line: Enter",
    );
    expect(sendKeyHint("mod-enter", touch)).toBe("Send: tap button; New line: Enter");
  });
});
