import { describe, expect, it } from "vitest";
import {
  buildTranscriptionPreview,
  normalizeTranscriptionPreview,
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
});
