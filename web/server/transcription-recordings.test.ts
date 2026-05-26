import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _setTranscriptionRecordingRootForTest,
  deleteTranscriptionRecordingDirectory,
  writeTranscriptionRecording,
  writeTranscriptionRecordingFrontendTiming,
} from "./transcription-recordings.js";

describe("transcription recordings", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "transcription-recordings-"));
    _setTranscriptionRecordingRootForTest(root);
  });

  afterEach(async () => {
    _setTranscriptionRecordingRootForTest(null);
    await rm(root, { recursive: true, force: true });
  });

  it("writes a durable success recording directory with audio, prompts, result, and enhancement artifacts", async () => {
    const result = await writeTranscriptionRecording({
      status: "success",
      sessionId: "session-1",
      requestId: "tx-1",
      mode: "dictation",
      backend: "openai",
      uploadDurationMs: 12,
      sttModel: "gpt-4o-mini-transcribe",
      sttDurationMs: 34,
      sttPrompt: "Vocabulary context",
      rawTranscript: "raw text",
      audioBytes: Buffer.from([1, 2, 3]),
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioExtension: "wav",
      result: { text: "final text", backend: "openai", enhanced: true },
      enhancement: {
        model: "gpt-5-mini",
        systemPrompt: "system",
        userMessage: "user",
        enhancedText: "final text",
        durationMs: 56,
      },
    });

    expect(result.persistenceError).toBeUndefined();
    await expect(readFile(join(result.directoryPath, "audio.wav"))).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readFile(join(result.directoryPath, "stt-prompt.txt"), "utf-8")).resolves.toBe("Vocabulary context");
    await expect(readFile(join(result.directoryPath, "raw-transcript.txt"), "utf-8")).resolves.toBe("raw text");
    await expect(readFile(join(result.directoryPath, "final-result.txt"), "utf-8")).resolves.toBe("final text");
    await expect(readFile(join(result.directoryPath, "enhancement", "user-message.txt"), "utf-8")).resolves.toBe(
      "user",
    );
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf-8")) as { status: string; artifacts: object };
    expect(manifest.status).toBe("success");
    expect(manifest.artifacts).toMatchObject({ audio: "audio.wav", resultJson: "result.json" });
  });

  it("writes error artifacts and later frontend timing", async () => {
    const result = await writeTranscriptionRecording({
      status: "error",
      sessionId: null,
      requestId: "tx-error",
      mode: "dictation",
      backend: "openai",
      uploadDurationMs: 12,
      sttModel: "openai",
      sttDurationMs: 0,
      sttPrompt: "Context before failure",
      rawTranscript: "",
      audioBytes: Buffer.from([4, 5]),
      audioMimeType: "audio/webm",
      audioFileName: "recording.webm",
      audioExtension: "webm",
      error: { message: "STT failed", phase: "transcribe" },
    });

    await expect(readFile(join(result.directoryPath, "error.json"), "utf-8")).resolves.toContain("STT failed");
    await writeTranscriptionRecordingFrontendTiming(result.directoryPath, {
      requestId: "tx-error",
      totalElapsedMs: 10,
    });
    await expect(readFile(join(result.directoryPath, "frontend-timing.json"), "utf-8")).resolves.toContain(
      "totalElapsedMs",
    );
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf-8")) as { artifacts: Record<string, string> };
    expect(manifest.artifacts.frontendTiming).toBe("frontend-timing.json");
  });

  it("deletes only paths inside the recording root", async () => {
    const result = await writeTranscriptionRecording({
      status: "success",
      sessionId: null,
      requestId: "tx-delete",
      backend: "openai",
      uploadDurationMs: 1,
      sttModel: "openai",
      sttDurationMs: 1,
      sttPrompt: "",
      rawTranscript: "text",
      audioBytes: Buffer.from([1]),
      audioMimeType: "audio/webm",
      audioFileName: "recording.webm",
      audioExtension: "webm",
      enhancement: null,
    });

    await expect(deleteTranscriptionRecordingDirectory(result.directoryPath)).resolves.toBeUndefined();
    await expect(deleteTranscriptionRecordingDirectory(tmpdir())).rejects.toThrow(/outside/);
  });
});
