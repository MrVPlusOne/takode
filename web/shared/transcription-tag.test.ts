import { describe, expect, it } from "vitest";
import { addTranscriptionTag, splitTrailingTranscriptionTag } from "./transcription-tag.js";

describe("addTranscriptionTag", () => {
  it("puts the tag on its own final line, dropping trailing whitespace before it", () => {
    // A separate line keeps taps near the end of the dictated text out of the tag.
    expect(addTranscriptionTag("hello world\n")).toBe("hello world\n[transcribed]");
  });

  it("moves an earlier tag to the end instead of leaving it between passages", () => {
    // Composer append after a dictated draft inserts " Second passage." after the tag's line.
    expect(addTranscriptionTag("First passage.\n[transcribed] Second passage.")).toBe(
      "First passage. Second passage.\n[transcribed]",
    );
    // A line break the user typed after the tag stays as the separator.
    expect(addTranscriptionTag("Line one\n[transcribed]\nLine two")).toBe("Line one\nLine two\n[transcribed]");
    // Needs-input dictation inserts text straight after the tag; it continues with one space.
    expect(addTranscriptionTag("ship it\n[transcribed]Takode")).toBe("ship it Takode\n[transcribed]");
  });

  it("moves a tag left inline by the earlier same-line format onto its own line", () => {
    // Drafts saved before the tag moved to its own line still end up with a single trailing tag.
    expect(addTranscriptionTag("First passage. [transcribed] Second passage.")).toBe(
      "First passage. Second passage.\n[transcribed]",
    );
    expect(addTranscriptionTag("dictated [transcribed]")).toBe("dictated\n[transcribed]");
  });

  it("keeps a single tag already on its own final line", () => {
    expect(addTranscriptionTag("dictated\n[transcribed]")).toBe("dictated\n[transcribed]");
  });
});

describe("splitTrailingTranscriptionTag", () => {
  it("strips a trailing tag and reports the message as transcribed", () => {
    expect(splitTrailingTranscriptionTag("hello world\n[transcribed]\n")).toEqual({
      text: "hello world",
      transcribed: true,
    });
  });

  it("leaves a tag that is not at the end as ordinary text", () => {
    const text = "dictated\n[transcribed]\ntyped later";
    expect(splitTrailingTranscriptionTag(text)).toEqual({
      text,
      transcribed: false,
    });
  });
});
