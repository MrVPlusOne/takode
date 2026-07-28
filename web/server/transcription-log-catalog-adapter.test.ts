import { describe, expect, it } from "vitest";

import { sanitizeIndexAudioMimeType, sanitizeIndexIdentifier } from "./transcription-log-catalog-adapter.js";

describe("transcription metadata index sanitizers", () => {
  it("preserves bounded model identifiers while rejecting path text and controls", () => {
    expect(sanitizeIndexIdentifier("openai/gpt-4o-mini-transcribe")).toBe("openai/gpt-4o-mini-transcribe");
    expect(sanitizeIndexIdentifier("hf.co:443/models/whisper-large-v3")).toBe("hf.co:443/models/whisper-large-v3");
    expect(sanitizeIndexIdentifier(" /Users/private/model ")).toBeNull();
    expect(sanitizeIndexIdentifier("custom:/var/private/model")).toBeNull();
    expect(sanitizeIndexIdentifier("custom C:\\Users\\private\\model")).toBeNull();
    expect(sanitizeIndexIdentifier("custom\nmodel")).toBeNull();
    expect(sanitizeIndexIdentifier("m".repeat(201))).toBeNull();
  });

  it("canonicalizes supported transcription MIME metadata and rejects arbitrary input", () => {
    expect(sanitizeIndexAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(sanitizeIndexAudioMimeType("video/mp4; codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(sanitizeIndexAudioMimeType("audio/x-wav")).toBe("audio/wav");
    expect(sanitizeIndexAudioMimeType("application/octet-stream")).toBeNull();
    expect(sanitizeIndexAudioMimeType("audio/wav;path=/Users/private/audio.wav")).toBeNull();
    expect(sanitizeIndexAudioMimeType("/Users/private/audio.wav")).toBeNull();
    expect(sanitizeIndexAudioMimeType("audio/wav\n/private/audio.wav")).toBeNull();
    expect(sanitizeIndexAudioMimeType(`audio/${"x".repeat(100)}`)).toBeNull();
  });
});
