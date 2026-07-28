import type { VoiceTranscriptionFrontendTimingReport, VoiceTranscriptionTiming } from "../transcription-progress.js";

export interface TranscriptionLogIndexEntry {
  id: number;
  timestamp: number;
  status?: "success" | "error";
  sessionId: string | null;
  requestId?: string | null;
  mode?: "dictation" | "edit" | "append";
  /** Browser upload + server request-body read/setup time before SSE begins. */
  uploadDurationMs: number;
  sttModel: string;
  sttDurationMs: number;
  sttContext?: {
    promptLength: number;
    keywordCount: number;
    droppedKeywordCount: number;
    languageHints: string[];
  };
  audioSizeBytes: number;
  audioMimeType?: string | null;
  audioFileName?: string | null;
  serverTiming?: VoiceTranscriptionTiming["serverTiming"];
  frontendTiming?: VoiceTranscriptionFrontendTimingReport & { receivedAt: number };
  audioUrl?: string;
  recordingDirectoryPath?: string;
  recordingManifestPath?: string;
  recordingStatus?: "success" | "error";
  recordingPersistenceError?: string;
  recordingDeletedAt?: number;
  canOpenRecordingDirectory?: boolean;
  openRecordingDirectoryLabel?: string;
  error?: {
    message: string;
    phase?: string;
  };
  replayAvailability?: {
    retranscribe: { available: boolean; reason?: string };
    reenhance: { available: boolean; reason?: string };
  };
  enhancement: {
    model: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  } | null;
}

export interface TranscriptionLogEntry extends TranscriptionLogIndexEntry {
  rawTranscript: string;
  sttPrompt: string;
  enhancement: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  } | null;
  replayVariants?: TranscriptionReplayVariant[];
}

export interface TranscriptionReplayVariant {
  id: string;
  kind: "stt_replay" | "enhancement_replay";
  status: "success" | "error";
  createdAt: number;
  sourceLogId: number;
  model: string;
  provider: "openai";
  enhancementMode?: "default" | "bullet";
  sttContext?: {
    promptLength: number;
    keywordCount: number;
    droppedKeywordCount: number;
    languageHints: string[];
  };
  timing?: {
    sttDurationMs?: number;
    enhancementDurationMs?: number;
  };
  rawTranscript?: string;
  enhancedText?: string | null;
  systemPrompt?: string;
  userMessage?: string;
  sttPrompt?: string;
  error?: {
    message: string;
    phase?: string;
  };
}
