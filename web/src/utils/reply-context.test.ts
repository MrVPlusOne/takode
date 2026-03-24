import { describe, it, expect } from "vitest";
import { injectReplyContext, parseReplyContext } from "./reply-context.js";

describe("injectReplyContext", () => {
  it("wraps preview text in delimiters and appends user message", () => {
    const result = injectReplyContext("Hello world", "My reply");
    expect(result).toBe("<<<REPLY_TO>>>Hello world<<<END_REPLY>>>\n\nMy reply");
  });

  it("handles preview text with special characters (quotes, brackets, code)", () => {
    const preview = 'Here\'s some `code` with "quotes" and [brackets] and {braces}';
    const result = injectReplyContext(preview, "Follow up");
    expect(result).toContain(preview);
    expect(result).toBe(`<<<REPLY_TO>>>${preview}<<<END_REPLY>>>\n\nFollow up`);
  });

  it("handles multi-line preview text", () => {
    const preview = "Line 1\nLine 2\nLine 3";
    const result = injectReplyContext(preview, "My message");
    expect(result).toBe(`<<<REPLY_TO>>>${preview}<<<END_REPLY>>>\n\nMy message`);
  });
});

describe("parseReplyContext", () => {
  it("extracts preview and user message from valid reply format", () => {
    const input = "<<<REPLY_TO>>>Hello world<<<END_REPLY>>>\n\nMy reply";
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: "Hello world", userMessage: "My reply" });
  });

  it("returns null for messages without reply prefix", () => {
    expect(parseReplyContext("Just a normal message")).toBeNull();
    expect(parseReplyContext("")).toBeNull();
  });

  it("returns null for malformed prefix (missing close delimiter)", () => {
    expect(parseReplyContext("<<<REPLY_TO>>>some text without close")).toBeNull();
  });

  it("handles preview text with special characters", () => {
    const preview = 'Code: `fn main() { println!("hello"); }` with "quotes" and [brackets]';
    const input = `<<<REPLY_TO>>>${preview}<<<END_REPLY>>>\n\nMy reply`;
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: preview, userMessage: "My reply" });
  });

  it("handles multi-line preview text", () => {
    const preview = "First line\nSecond line\nThird line";
    const input = `<<<REPLY_TO>>>${preview}<<<END_REPLY>>>\n\nUser message`;
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: preview, userMessage: "User message" });
  });

  it("handles multi-line user message", () => {
    const input = "<<<REPLY_TO>>>Preview<<<END_REPLY>>>\n\nLine 1\nLine 2\nLine 3";
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: "Preview", userMessage: "Line 1\nLine 2\nLine 3" });
  });

  it("handles empty user message after reply context", () => {
    const input = "<<<REPLY_TO>>>Preview<<<END_REPLY>>>\n\n";
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: "Preview", userMessage: "" });
  });

  it("handles case where close delimiter is immediately followed by content (no newlines)", () => {
    // Edge case: no \n\n separator
    const input = "<<<REPLY_TO>>>Preview<<<END_REPLY>>>Direct content";
    const parsed = parseReplyContext(input);
    expect(parsed).toEqual({ previewText: "Preview", userMessage: "Direct content" });
  });

  it("roundtrips with injectReplyContext", () => {
    const preview = 'Complex "preview" with `code` and\nnewlines [1] {2}';
    const message = "The user's actual message\nwith multiple lines";
    const injected = injectReplyContext(preview, message);
    const parsed = parseReplyContext(injected);
    expect(parsed).toEqual({ previewText: preview, userMessage: message });
  });
});
