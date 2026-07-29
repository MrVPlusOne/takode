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
  mockApi.getTranscriptionLogs.mockResolvedValue({
    entries: [
      {
        id: 42,
        recordingKey: "r_test-recording",
        timestamp: Date.now(),
        sessionId: "session-12345678",
        mode: "dictation",
        uploadDurationMs: 12,
        sttModel: "gpt-4o-mini-transcribe-alpha-tapioca-4",
        sttDurationMs: 1100,
        previewText: "Useful bounded transcript preview",
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
    ],
    nextCursor: null,
    total: 1,
  });
  mockApi.getTranscriptionLogEntry.mockResolvedValue({
    id: 42,
    recordingKey: "r_test-recording",
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
    audioAvailable: true,
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
    recordingKey: "r_test-recording",
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
    audioAvailable: false,
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
  it("renders the server-authored list preview as a single bounded row", async () => {
    render(<TranscriptionDebugPanel />);
    fireEvent.click(screen.getByText("Show"));

    const preview = await screen.findByText("Useful bounded transcript preview");
    expect(preview).toHaveClass("truncate");
    expect(preview).toHaveAttribute("aria-label", "Transcript preview: Useful bounded transcript preview");
  });

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
    await waitFor(() => expect(mockApi.openTranscriptionRecordingDirectory).toHaveBeenCalledWith("r_test-recording"));

    fireEvent.click(screen.getByRole("button", { name: "Delete recording" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("cannot be undone"));
    await waitFor(() => expect(mockApi.deleteTranscriptionRecording).toHaveBeenCalledWith("r_test-recording"));
    expect((await screen.findAllByText("deleted")).length).toBeGreaterThan(0);
  });

  it("runs replay actions immediately without provider confirmations", async () => {
    render(<TranscriptionDebugPanel />);

    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("gpt-4o-mini-transcribe-alpha-tapioca-4"));

    expect(await screen.findByText("Replay & compare")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Target STT model/i), { target: { value: "gpt-transcribe" } });
    fireEvent.click(screen.getByRole("button", { name: "Run re-transcribe" }));

    await waitFor(() =>
      expect(mockApi.retranscribeLogEntry).toHaveBeenCalledWith("r_test-recording", "gpt-transcribe"),
    );
    expect(window.confirm).not.toHaveBeenCalled();
    const replayStt = await waitFor(() => document.querySelector('[data-transcript-diff-side="replay"]'));
    expect(replayStt).toHaveTextContent("replay transcript");
    expect(replayStt?.querySelectorAll('[data-transcript-diff-kind="added"]')).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Enhancement model/i), { target: { value: "gpt-5.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Bullet Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Run re-enhance" }));

    await waitFor(() =>
      expect(mockApi.reenhanceLogEntry).toHaveBeenCalledWith("r_test-recording", "gpt-5.5", "bullet"),
    );
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("replay enhanced")).toBeInTheDocument();
  });

  it("loads additional durable pages without duplicating stable recording keys", async () => {
    const first = {
      id: 1,
      recordingKey: "r_first",
      timestamp: Date.now(),
      sessionId: null,
      uploadDurationMs: 1,
      sttModel: "first-model",
      sttDurationMs: 2,
      audioSizeBytes: 3,
      enhancement: null,
    };
    const second = {
      ...first,
      id: 2,
      recordingKey: "r_second",
      timestamp: Date.now() - 1,
      sttModel: "second-model",
    };
    mockApi.getTranscriptionLogs
      .mockResolvedValueOnce({ entries: [first], nextCursor: "next-page", total: 2 })
      // The second page intentionally repeats the boundary record to validate UI deduplication.
      .mockResolvedValueOnce({ entries: [first, second], nextCursor: null, total: 2 });

    render(<TranscriptionDebugPanel />);
    fireEvent.click(screen.getByText("Show"));
    expect(await screen.findByText("first-model")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("second-model")).toBeInTheDocument();
    expect(screen.getAllByText("first-model")).toHaveLength(1);
    expect(mockApi.getTranscriptionLogs).toHaveBeenLastCalledWith("next-page", false);
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
    expect(document.querySelector('[data-transcript-diff-side="original"]')).toHaveTextContent(
      "original enhanced output",
    );
    expect(screen.getByText("Replay enhanced output")).toBeInTheDocument();
    expect(document.querySelector('[data-transcript-diff-side="replay"]')).toHaveTextContent("replay enhanced output");
    expect(document.querySelectorAll('[data-transcript-diff-kind="added"]')).not.toHaveLength(0);
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

  it.each([
    ["malformed", undefined],
    ["incomplete", undefined],
    ["deleted", Date.now()],
  ] as const)("does not advertise source audio for %s durable records", async (discoveryState, deletedAt) => {
    mockApi.getTranscriptionLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 42,
          recordingKey: "r_test-recording",
          timestamp: Date.now(),
          sessionId: null,
          uploadDurationMs: 0,
          sttModel: "unknown",
          sttDurationMs: 0,
          audioSizeBytes: 0,
          audioAvailable: false,
          discoveryState,
          recordingDeletedAt: deletedAt,
          statusReason: discoveryState === "deleted" ? "recording_deleted" : `recording_${discoveryState}`,
          previewText: "must stay hidden",
          enhancement: null,
        },
      ],
      nextCursor: null,
      total: 1,
    });
    mockApi.getTranscriptionLogEntry.mockResolvedValueOnce({
      id: 42,
      recordingKey: "r_test-recording",
      timestamp: Date.now(),
      sessionId: null,
      uploadDurationMs: 0,
      sttModel: "unknown",
      sttDurationMs: 0,
      rawTranscript: "",
      sttPrompt: "",
      audioSizeBytes: 0,
      audioAvailable: false,
      audioUrl: "/api/transcription-logs/r_test-recording/audio",
      discoveryState,
      discoveryIssue: `Safe ${discoveryState} state`,
      recordingDeletedAt: deletedAt,
      enhancement: null,
    });

    render(<TranscriptionDebugPanel />);
    fireEvent.click(screen.getByText("Show"));
    fireEvent.click(await screen.findByText("unknown"));
    await screen.findByText("Transcription Detail");
    expect(screen.queryByText("must stay hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open source audio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy audio link" })).not.toBeInTheDocument();
  });
});
