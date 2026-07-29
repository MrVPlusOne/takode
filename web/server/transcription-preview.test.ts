import { describe, expect, it } from "vitest";
import {
  buildTranscriptionPreview,
  getTranscriptionPreviewInputPrefix,
  normalizeTranscriptionPreview,
  TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES,
  TRANSCRIPTION_PREVIEW_MAX_CHARACTERS,
} from "./transcription-preview.js";

describe("transcription previews", () => {
  it("prefers enhanced text and normalizes it to one line", () => {
    expect(buildTranscriptionPreview("  Final\n\tcleaned   text  ", "raw text")).toBe("Final cleaned text");
  });

  it("falls back to raw text when enhancement is absent or empty", () => {
    expect(buildTranscriptionPreview(null, " raw\ntranscript ")).toBe("raw transcript");
    expect(buildTranscriptionPreview(" \n ", "raw transcript")).toBe("raw transcript");
  });

  it("truncates by Unicode code points with the ellipsis inside the bound", () => {
    const preview = normalizeTranscriptionPreview("🙂".repeat(TRANSCRIPTION_PREVIEW_MAX_CHARACTERS + 20));
    expect(Array.from(preview ?? "")).toHaveLength(TRANSCRIPTION_PREVIEW_MAX_CHARACTERS);
    expect(preview?.endsWith("…")).toBe(true);
    expect(preview).not.toContain("�");
  });

  it("fails closed for controls and path-like candidates", () => {
    expect(normalizeTranscriptionPreview("private /Users/example/archive/result.txt")).toBeUndefined();
    expect(normalizeTranscriptionPreview("file:///tmp/private.txt")).toBeUndefined();
    expect(normalizeTranscriptionPreview("hidden\u0000payload")).toBeUndefined();
    expect(normalizeTranscriptionPreview("damaged � text")).toBeUndefined();
  });

  it("applies the input prefix before normalization and enhanced/raw selection", () => {
    // Content after the shared byte prefix cannot rescue leading whitespace or become a preferred enhanced result.
    const beyondPrefix = " ".repeat(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES) + "late text";
    expect(buildTranscriptionPreview(undefined, beyondPrefix)).toBeUndefined();
    expect(buildTranscriptionPreview(beyondPrefix, "raw fallback")).toBe("raw fallback");
  });

  it("applies safety checks only to the agreed input prefix", () => {
    // Path/control-like bytes beyond the contract must not make live input differ from a disk prefix read.
    const safePrefix = "Visible ".padEnd(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES, "x");
    const preview = buildTranscriptionPreview(undefined, `${safePrefix} /Users/private/result.txt\u0000`);
    expect(preview).toBe(`${safePrefix.slice(0, TRANSCRIPTION_PREVIEW_MAX_CHARACTERS - 1)}…`);
  });

  it("drops a partial UTF-8 character at the byte boundary without replacement text", () => {
    // The first emoji byte falls inside the prefix, while the remaining bytes do not; both live and disk decoders omit it.
    const input = `${" ".repeat(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES - 1)}🙂after`;
    const prefix = getTranscriptionPreviewInputPrefix(input);
    expect(prefix).toBe(" ".repeat(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES - 1));
    expect(prefix).not.toContain("�");
  });
});
