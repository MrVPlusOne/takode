import { describe, expect, it } from "vitest";
import { addTranscriptionTag, splitTrailingTranscriptionTag } from "./transcription-tag.js";

describe("addTranscriptionTag", () => {
  it("appends the tag after the text, dropping trailing whitespace before it", () => {
    expect(addTranscriptionTag("hello world\n")).toBe("hello world [transcribed]");
  });

  it("moves an earlier tag to the end instead of leaving it between passages", () => {
    // Appending after a dictated draft puts new text after its tag; the result must end with one tag.
    expect(addTranscriptionTag("First passage. [transcribed] Second passage.")).toBe(
      "First passage. Second passage. [transcribed]",
    );
    expect(addTranscriptionTag("Line one [transcribed]\nLine two")).toBe("Line one\nLine two [transcribed]");
    // Needs-input dictation inserts text straight after the tag; the space before it must survive.
    expect(addTranscriptionTag("ship it [transcribed]Takode")).toBe("ship it Takode [transcribed]");
  });

  it("keeps a single tag already at the end", () => {
    expect(addTranscriptionTag("dictated [transcribed]")).toBe("dictated [transcribed]");
  });
});

describe("splitTrailingTranscriptionTag", () => {
  it("strips a trailing tag and reports the message as transcribed", () => {
    expect(splitTrailingTranscriptionTag("hello world [transcribed]\n")).toEqual({
      text: "hello world",
      transcribed: true,
    });
  });

  it("leaves a tag that is not at the end as ordinary text", () => {
    const text = "dictated [transcribed] typed later";
    expect(splitTrailingTranscriptionTag(text)).toEqual({
      text,
      transcribed: false,
    });
  });
});
