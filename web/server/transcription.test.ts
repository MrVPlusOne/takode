import { describe, expect, it } from "vitest";
import {
  buildOpenaiTranscriptionUrl,
  resolveAudioUploadFormat,
  sanitizeTranscriptionKeywords,
} from "./transcription.js";

describe("resolveAudioUploadFormat", () => {
  it("normalizes browser codec suffixes for mp4 recordings", () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);

    expect(resolveAudioUploadFormat(buffer, "audio/mp4;codecs=mp4a.40.2", "recording.mp4")).toEqual({
      mimeType: "audio/mp4",
      extension: "mp4",
    });
  });

  it("prefers sniffed mp4 bytes over a mislabeled webm mime type", () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);

    expect(resolveAudioUploadFormat(buffer, "audio/webm", "recording.webm")).toEqual({
      mimeType: "audio/mp4",
      extension: "mp4",
    });
  });

  it("accepts video/webm recorder outputs for audio-only captures", () => {
    const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42]);

    expect(resolveAudioUploadFormat(buffer, "video/webm", "recording.webm")).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
  });

  it("falls back to the filename extension when mime type is missing", () => {
    const buffer = Buffer.from("unknown");

    expect(resolveAudioUploadFormat(buffer, "", "recording.ogg")).toEqual({
      mimeType: "audio/ogg",
      extension: "ogg",
    });
  });
});

describe("sanitizeTranscriptionKeywords", () => {
  it("trims, deduplicates, and drops keyword values rejected by gpt-transcribe", () => {
    // gpt-transcribe rejects keywords containing angle brackets or line breaks,
    // so invalid terms are dropped instead of silently rewritten.
    expect(sanitizeTranscriptionKeywords(" Takode, WsBridge, takode, bad<term>, multi\nline, , AC-42 ")).toEqual({
      keywords: ["Takode", "WsBridge", "AC-42"],
      droppedKeywordCount: 4,
    });
  });
});

describe("buildOpenaiTranscriptionUrl", () => {
  it("routes OpenAI-compatible transcription through the configured base URL", () => {
    expect(buildOpenaiTranscriptionUrl("https://provider.example/v1/")).toBe(
      "https://provider.example/v1/audio/transcriptions",
    );
    expect(buildOpenaiTranscriptionUrl("https://provider.example/v1/audio/transcriptions")).toBe(
      "https://provider.example/v1/audio/transcriptions",
    );
  });
});
