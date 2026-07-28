// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockApi = vi.hoisted(() => ({
  getTranscriptionLogs: vi.fn(),
  getTranscriptionLogEntry: vi.fn(),
  openTranscriptionRecordingDirectory: vi.fn(),
  deleteTranscriptionRecording: vi.fn(),
  retranscribeLogEntry: vi.fn(),
  reenhanceLogEntry: vi.fn(),
}));

vi.mock("../api.js", () => ({
  api: {
    getTranscriptionLogs: (...args: unknown[]) => mockApi.getTranscriptionLogs(...args),
    getTranscriptionLogEntry: (...args: unknown[]) => mockApi.getTranscriptionLogEntry(...args),
    openTranscriptionRecordingDirectory: (...args: unknown[]) => mockApi.openTranscriptionRecordingDirectory(...args),
    deleteTranscriptionRecording: (...args: unknown[]) => mockApi.deleteTranscriptionRecording(...args),
    retranscribeLogEntry: (...args: unknown[]) => mockApi.retranscribeLogEntry(...args),
    reenhanceLogEntry: (...args: unknown[]) => mockApi.reenhanceLogEntry(...args),
  },
}));

import { TranscriptionDebugPanel } from "./TranscriptionDebugPanel.js";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  mockApi.getTranscriptionLogs.mockResolvedValue([
    {
      id: 42,
      timestamp: Date.now(),
      sessionId: "session-12345678",
      mode: "dictation",
      uploadDurationMs: 12,
      sttModel: "gpt-4o-mini-transcribe-alpha-tapioca-4",
      sttDurationMs: 1100,
      audioSizeBytes: 4096,
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioUrl: "/api/transcription-logs/42/audio",
      recordingDirectoryPath: "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42",
      recordingStatus: "success",
      canOpenRecordingDirectory: true,
      openRecordingDirectoryLabel: "Open in Finder",
      enhancement: null,
    },
  ]);
  mockApi.getTranscriptionLogEntry.mockResolvedValue({
    id: 42,
    timestamp: Date.now(),
    sessionId: "session-12345678",
    mode: "dictation",
    uploadDurationMs: 12,
    sttModel: "gpt-4o-mini-transcribe-alpha-tapioca-4",
    sttDurationMs: 1100,
    rawTranscript: "debug transcript",
    audioSizeBytes: 4096,
    audioMimeType: "audio/wav",
    audioFileName: "recording.wav",
    audioUrl: "/api/transcription-logs/42/audio",
    recordingDirectoryPath: "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42",
    recordingStatus: "success",
    canOpenRecordingDirectory: true,
    openRecordingDirectoryLabel: "Open in Finder",
    replayAvailability: {
      retranscribe: { available: true },
      reenhance: { available: true },
    },
    sttPrompt: "Prompt sent to the STT model",
    sttContext: {
      promptLength: 28,
      keywordCount: 1,
      droppedKeywordCount: 0,
      languageHints: ["en"],
    },
    enhancement: null,
  });
  mockApi.openTranscriptionRecordingDirectory.mockResolvedValue({ ok: true });
  mockApi.deleteTranscriptionRecording.mockResolvedValue({
    id: 42,
    timestamp: Date.now(),
    sessionId: "session-12345678",
    mode: "dictation",
    uploadDurationMs: 12,
    sttModel: "gpt-4o-mini-transcribe-alpha-tapioca-4",
    sttDurationMs: 1100,
    rawTranscript: "debug transcript",
    audioSizeBytes: 4096,
    audioMimeType: "audio/wav",
    audioFileName: "recording.wav",
    audioUrl: "/api/transcription-logs/42/audio",
    recordingDirectoryPath: "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42",
    recordingStatus: "success",
    recordingDeletedAt: Date.now(),
    canOpenRecordingDirectory: false,
    sttPrompt: "Prompt sent to the STT model",
    enhancement: null,
  });
  mockApi.retranscribeLogEntry.mockResolvedValue({
    ok: true,
    variant: {
      id: "variant-stt",
      kind: "stt_replay",
      status: "success",
      createdAt: Date.now(),
      sourceLogId: 42,
      model: "gpt-transcribe",
      provider: "openai",
      rawTranscript: "replay transcript",
      timing: { sttDurationMs: 222 },
    },
  });
  mockApi.reenhanceLogEntry.mockResolvedValue({
    ok: true,
    variant: {
      id: "variant-enh",
      kind: "enhancement_replay",
      status: "success",
      createdAt: Date.now(),
      sourceLogId: 42,
      model: "gpt-5.5",
      provider: "openai",
      enhancementMode: "bullet",
      rawTranscript: "debug transcript",
      enhancedText: "replay enhanced",
      timing: { enhancementDurationMs: 333 },
    },
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TranscriptionDebugPanel", () => {
  it("uses model-agnostic raw transcript labeling and exposes a copyable source audio link", async () => {
    // Non-Whisper STT models should not inherit legacy Whisper-specific debug copy.
    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    expect(await screen.findByText("Raw Transcript (STT Output)")).toBeInTheDocument();
    expect(screen.queryByText(/Whisper Output/i)).not.toBeInTheDocument();

    const audioUrl = new URL("/api/transcription-logs/42/audio", window.location.origin).toString();
    expect(screen.getByRole("link", { name: "Open source audio" })).toHaveAttribute("href", audioUrl);

    fireEvent.click(screen.getByRole("button", { name: "Copy audio link" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(audioUrl));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("exposes recording folder actions for path copy, open, and delete", async () => {
    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    const path = "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42";
    expect(await screen.findByText("Recording folder")).toBeInTheDocument();
    expect(screen.getByText(path)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(path));

    fireEvent.click(screen.getByRole("button", { name: "Open in Finder" }));
    await waitFor(() => expect(mockApi.openTranscriptionRecordingDirectory).toHaveBeenCalledWith(42));

    fireEvent.click(screen.getByRole("button", { name: "Delete recording" }));
    await waitFor(() => expect(mockApi.deleteTranscriptionRecording).toHaveBeenCalledWith(42));
    expect(await screen.findByText("deleted")).toBeInTheDocument();
  });

  it("runs replay actions from detail with explicit provider confirmations", async () => {
    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    expect(await screen.findByText("Replay & compare")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Target STT model/i), { target: { value: "gpt-transcribe" } });
    fireEvent.click(screen.getByRole("button", { name: "Run re-transcribe" }));

    await waitFor(() => expect(mockApi.retranscribeLogEntry).toHaveBeenCalledWith(42, "gpt-transcribe"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("original audio plus stored STT context"));
    expect(await screen.findByText("replay transcript")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Enhancement model/i), { target: { value: "gpt-5.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Bullet Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Run re-enhance" }));

    await waitFor(() => expect(mockApi.reenhanceLogEntry).toHaveBeenCalledWith(42, "gpt-5.5", "bullet"));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("raw STT transcript plus stored enhancement context"),
    );
    expect(await screen.findByText("replay enhanced")).toBeInTheDocument();
  });

  it("compares original enhancement output against replay enhancement output", async () => {
    mockApi.getTranscriptionLogEntry.mockResolvedValueOnce({
      id: 42,
      timestamp: Date.now(),
      sessionId: "session-12345678",
      mode: "dictation",
      uploadDurationMs: 12,
      sttModel: "gpt-transcribe",
      sttDurationMs: 1100,
      rawTranscript: "source raw transcript",
      audioSizeBytes: 4096,
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioUrl: "/api/transcription-logs/42/audio",
      recordingDirectoryPath: "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42",
      recordingStatus: "success",
      canOpenRecordingDirectory: true,
      openRecordingDirectoryLabel: "Open in Finder",
      replayAvailability: {
        retranscribe: { available: true },
        reenhance: { available: true },
      },
      sttPrompt: "Prompt sent to the STT model",
      enhancement: {
        model: "gpt-5-mini",
        systemPrompt: "system",
        userMessage: "user",
        enhancedText: "original enhanced output",
        durationMs: 1200,
      },
      replayVariants: [
        {
          id: "variant-enhanced",
          kind: "enhancement_replay",
          status: "success",
          createdAt: Date.now(),
          sourceLogId: 42,
          model: "gpt-5.5",
          provider: "openai",
          enhancementMode: "bullet",
          rawTranscript: "source raw transcript",
          enhancedText: "replay enhanced output",
          timing: { enhancementDurationMs: 333 },
        },
      ],
    });

    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    expect(await screen.findByText("Original enhanced output")).toBeInTheDocument();
    expect(screen.getAllByText("original enhanced output").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Replay enhanced output")).toBeInTheDocument();
    expect(screen.getByText("replay enhanced output")).toBeInTheDocument();
    expect(screen.getByText("Source raw transcript context")).toBeInTheDocument();
    expect(screen.getAllByText("source raw transcript").length).toBeGreaterThanOrEqual(1);
  });

  it("shows backend disabled replay reasons in detail", async () => {
    mockApi.getTranscriptionLogEntry.mockResolvedValueOnce({
      id: 42,
      timestamp: Date.now(),
      sessionId: "session-12345678",
      mode: "dictation",
      uploadDurationMs: 12,
      sttModel: "gpt-transcribe",
      sttDurationMs: 1100,
      rawTranscript: "debug transcript",
      audioSizeBytes: 4096,
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioUrl: "/api/transcription-logs/42/audio",
      recordingDirectoryPath: "/Users/test/.companion/transcription-recordings/prod/2026-05-25/tx-42",
      recordingStatus: "success",
      canOpenRecordingDirectory: true,
      openRecordingDirectoryLabel: "Open in Finder",
      replayAvailability: {
        retranscribe: { available: false, reason: "Separated STT replay context is missing" },
        reenhance: { available: false, reason: "No OpenAI-compatible API key configured" },
      },
      sttPrompt: "Prompt sent to the STT model",
      enhancement: null,
    });

    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    expect(await screen.findByText("Separated STT replay context is missing")).toBeInTheDocument();
    expect(screen.getByText("No OpenAI-compatible API key configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run re-transcribe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run re-enhance" })).toBeDisabled();
  });
});
