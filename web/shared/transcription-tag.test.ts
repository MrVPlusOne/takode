import { describe, expect, it } from "vitest";
import { addTranscriptionTag, splitTrailingTranscriptionTag } from "./transcription-tag.js";

describe("addTranscriptionTag", () => {
  it("appends the tag after the text, dropping trailing whitespace before it", () => {
    expect(addTranscriptionTag("hello world\n")).toBe("hello world [transcribed]");
  });

  it("does not add a second tag when the text already carries one anywhere", () => {
    // A user may keep typing after the tag; repeated dictation must not stack tags.
    expect(addTranscriptionTag("dictated [transcribed] typed later")).toBe("dictated [transcribed] typed later");
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
