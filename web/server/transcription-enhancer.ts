import { callEnhancementLLM } from "./transcription-llm.js";
import {
  buildEnhancementPrompt,
  buildTranscriptionContext,
  buildVoiceAppendPrompt,
  buildVoiceEditPrompt,
  enhancerSystemPrompt,
  type EnhancementContextInput,
} from "./transcription-prompts.js";
/**
 * Tier-2 transcription enhancement: uses conversation context from the active
 * session to correct misheard technical terms via an LLM polish pass.
 *
 * Inspired by VoiceInk's two-tier architecture:
 *   Tier 1: Whisper STT (raw transcript)
 *   Tier 2: LLM correction using session context
 *
 * The prompts themselves are built in transcription-prompts.ts; this module runs the calls and keeps the
 * transcription debug log.
 */

import type { BrowserIncomingMessage } from "./session-types.js";
import { getSettings, type TranscriptionConfig } from "./settings-manager.js";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { getLocalPathOpenCapability } from "./local-path-actions.js";
import {
  buildTranscriptionAudioUrl,
  catalogEntryToStoredEntry,
  decodeLogIndexCursor,
  getEnhancementSkipReasonCode,
  getCatalogEntryForLocator,
  getTranscriptionIndexStatusReason,
  hasSafeTranscriptionAudio,
  loadCatalogStoredEntry,
  lookupTranscriptionLogAudio,
  sanitizeIndexAudioMimeType,
  sanitizeIndexFileName,
  sanitizeIndexIdentifier,
  sanitizeIndexModelIdentifier,
  storedEntryToCatalogEntry,
  transcriptionLogEntryKey,
  type TranscriptionIndexEnhancementSkipReason,
  type TranscriptionIndexStatusReason,
  type TranscriptionLogAudioLookup,
  type StoredTranscriptionLogEntry,
} from "./transcription-log-catalog-adapter.js";
import {
  _resetTranscriptionRecordingCatalogForTest,
  getRecentTranscriptionRecordingCatalogPage,
  getTranscriptionRecordingCompatibilityId,
  getTranscriptionRecordingKey,
  listTranscriptionRecordingCatalog,
  tombstoneAndDeleteTranscriptionRecording,
  TRANSCRIPTION_RECENT_PAGE_CURSOR,
  upsertTranscriptionRecordingCatalogEntry,
} from "./transcription-recording-catalog.js";
import {
  readTranscriptionReplayVariants,
  writeTranscriptionReplayVariant,
  writeTranscriptionRecording,
  writeTranscriptionRecordingFrontendTiming,
  type TranscriptionEnhancementReplayContext,
  type TranscriptionReplayVariant,
  type TranscriptionRecordingStatus,
  type TranscriptionSttReplayContext,
  type WriteTranscriptionReplayVariantInput,
} from "./transcription-recordings.js";
import { buildTranscriptionPreview } from "./transcription-preview.js";

// ─── LLM call ───────────────────────────────────────────────────────────────

// ─── Public API ─────────────────────────────────────────────────────────────

export interface EnhancementResult {
  /** The final text (enhanced or raw fallback). */
  text: string;
  /** The original Whisper output (only set when enhancement was attempted). */
  rawText?: string;
  /** Whether LLM enhancement was actually applied. */
  enhanced: boolean;
  /** Debug info about the enhancement call (for debug panel). */
  _debug?: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  };
}

/**
 * Enhance a raw transcript using conversation context from the active session.
 *
 * Returns the raw text unchanged (with enhanced=false) only when enhancement is disabled in config
 * or the LLM call fails. Every other transcript is enhanced, however short and even with no context:
 * the pass also fixes obvious misspellings, which the speech-to-text model leaves (Jiayi, Nov 1,
 * 2026; short clips and clips without context used to be skipped, and their errors stayed).
 */
export async function enhanceTranscript(
  rawText: string,
  history: BrowserIncomingMessage[] | null,
  config: TranscriptionConfig,
  apiKey: string,
  extra?: EnhancementContextInput,
): Promise<EnhancementResult> {
  const conversationContext = history ? buildTranscriptionContext(history, { everyReply: extra?.everyReply }) : "";
  return enhanceTranscriptFromReplayContext(rawText, conversationContext, config, apiKey, extra);
}

/** Same as `enhanceTranscript`, with the conversation context already built (live calls and replays). */
export async function enhanceTranscriptFromReplayContext(
  rawText: string,
  conversationContext: string,
  config: TranscriptionConfig,
  apiKey: string,
  extra?: EnhancementContextInput,
): Promise<EnhancementResult> {
  const model = config.enhancementModel || "gpt-5-mini";
  const systemPrompt = enhancerSystemPrompt("dictation", config, !!extra?.annotationContext);
  if (!config.enhancementEnabled) {
    return {
      text: rawText,
      enhanced: false,
      _debug: { model, systemPrompt, userMessage: "", enhancedText: null, durationMs: 0, skipReason: "disabled" },
    };
  }

  const prompt = buildEnhancementPrompt(rawText, conversationContext, extra, config.enhancementMode);
  const t0 = Date.now();
  const llmResult = await callEnhancementLLM(prompt, config, apiKey, systemPrompt, !!extra?.annotationContext);
  const durationMs = Date.now() - t0;

  if (!llmResult.ok) {
    return {
      text: rawText,
      enhanced: false,
      _debug: { model, systemPrompt, userMessage: prompt, enhancedText: null, durationMs, skipReason: llmResult.error },
    };
  }

  const enhanced = llmResult.text;
  return {
    text: enhanced,
    rawText,
    enhanced: true,
    _debug: { model, systemPrompt, userMessage: prompt, enhancedText: enhanced, durationMs },
  };
}

export interface VoiceEditResult {
  text: string;
  _debug: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  };
}

export async function applyVoiceEdit(
  instructionText: string,
  currentComposerText: string,
  history: BrowserIncomingMessage[] | null,
  config: TranscriptionConfig,
  apiKey: string,
  extra?: EnhancementContextInput,
): Promise<VoiceEditResult> {
  const model = config.enhancementModel || "gpt-5-mini";
  const conversationContext = history ? buildTranscriptionContext(history, { everyReply: extra?.everyReply }) : "";
  const prompt = buildVoiceEditPrompt(
    instructionText,
    currentComposerText,
    conversationContext,
    extra,
    config.enhancementMode,
  );
  const systemPrompt = enhancerSystemPrompt("edit", config, !!extra?.annotationContext);
  const t0 = Date.now();
  const llmResult = await callEnhancementLLM(prompt, config, apiKey, systemPrompt, !!extra?.annotationContext);
  const durationMs = Date.now() - t0;

  if (!llmResult.ok) {
    throw Object.assign(new Error(llmResult.error), {
      _debug: {
        model,
        systemPrompt,
        userMessage: prompt,
        enhancedText: null,
        durationMs,
        skipReason: llmResult.error,
      },
    });
  }

  return {
    text: llmResult.text,
    _debug: {
      model,
      systemPrompt,
      userMessage: prompt,
      enhancedText: llmResult.text,
      durationMs,
    },
  };
}

/** Voice append result shares the same shape as voice edit. */
export type VoiceAppendResult = VoiceEditResult;

/**
 * Clean up transcribed speech for appending to existing composer text.
 * Returns only the new text to insert -- never the existing draft.
 */
export async function applyVoiceAppend(
  rawSpeechText: string,
  existingDraftText: string,
  history: BrowserIncomingMessage[] | null,
  config: TranscriptionConfig,
  apiKey: string,
  extra?: EnhancementContextInput,
): Promise<VoiceAppendResult> {
  const model = config.enhancementModel || "gpt-5-mini";
  const conversationContext = history ? buildTranscriptionContext(history, { everyReply: extra?.everyReply }) : "";
  const prompt = buildVoiceAppendPrompt(
    rawSpeechText,
    existingDraftText,
    conversationContext,
    extra,
    config.enhancementMode,
  );
  const systemPrompt = enhancerSystemPrompt("append", config, !!extra?.annotationContext);
  const t0 = Date.now();
  const llmResult = await callEnhancementLLM(prompt, config, apiKey, systemPrompt, !!extra?.annotationContext);
  const durationMs = Date.now() - t0;

  if (!llmResult.ok) {
    throw Object.assign(new Error(llmResult.error), {
      _debug: {
        model,
        systemPrompt,
        userMessage: prompt,
        enhancedText: null,
        durationMs,
        skipReason: llmResult.error,
      },
    });
  }

  return {
    text: llmResult.text,
    _debug: {
      model,
      systemPrompt,
      userMessage: prompt,
      enhancedText: llmResult.text,
      durationMs,
    },
  };
}

// ─── Debug log (in-memory, for Settings debug panel) ─────────────────────────

export type TranscriptionFrontendTimingPhase =
  | "preparing"
  | "transcribing"
  | "finalizing"
  | "enhancing"
  | "editing"
  | "appending"
  | "complete"
  | "error";

export interface TranscriptionFrontendTimingEvent {
  phase: TranscriptionFrontendTimingPhase;
  source: "client" | "sse" | "websocket";
  eventTimestamp: number;
  clientTimestamp: number;
  elapsedMs: number;
  uploadDurationMs?: number;
  sttDurationMs?: number;
  enhancementDurationMs?: number;
  serverTiming?: TranscriptionServerTiming;
}

export interface TranscriptionServerTiming {
  bodyReadDurationMs?: number;
  contextBuildDurationMs?: number;
  ssePhaseWriteDurationMs?: number;
  sttCompleteWriteDurationMs?: number;
  resultReadyDurationMs?: number;
  resultWriteDurationMs?: number;
  serverTotalDurationMs?: number;
  uploadFormatMimeType?: string;
  uploadFormatExtension?: string;
}

export interface TranscriptionRecordingTiming {
  startedAt: number;
  recorderStartedAt?: number;
  stopRequestedAt?: number;
  firstDataAvailableAt?: number;
  lastDataAvailableAt?: number;
  stopEventAt?: number;
  blobReadyAt: number;
  recordingDurationMs?: number;
  stopToBlobReadyMs?: number;
  blobBuildDurationMs?: number;
  timesliceMs?: number;
  chunkCount: number;
  chunkBytes: number;
  blobBytes: number;
  encodedBlobDurationMs?: number;
  selectedMimeType?: string | null;
  recorderMimeType?: string | null;
  blobMimeType?: string | null;
  audioBitsPerSecond?: number;
  stopReason?: "manual" | "cancelled" | "unmount" | "error";
  recorderStateAtStart?: "inactive" | "recording" | "paused";
  recorderStateAfterStart?: "inactive" | "recording" | "paused";
  recorderStateAtStopRequest?: "inactive" | "recording" | "paused";
  recorderStateAtStopEvent?: "inactive" | "recording" | "paused";
  requestDataBeforeStop?: boolean;
  requestDataError?: string;
  audioTrackStatesAtStart?: string;
  audioTrackStatesAtStop?: string;
  audioTrackMutedAtStart?: boolean;
  audioTrackMutedAtStop?: boolean;
  audioInputLabel?: string;
  micOpenMs?: number;
  micRequest?: "picked" | "phone" | "system";
  trackEndedEventCount?: number;
  trackMuteEventCount?: number;
  trackUnmuteEventCount?: number;
  /** Why a direct recording's level meter was restarted during it (browser diagnostic). */
  meterRestarts?: string;
  firstTrackEventAt?: number;
  pageVisibility?: "visible" | "hidden" | "prerender";
}

export interface TranscriptionClientTiming {
  transport: "raw" | "multipart";
  requestConstructedAt: number;
  fetchStartAt: number;
  responseStartAt?: number;
  firstChunkAt?: number;
  webSocketResultAt?: number;
  resultEventAt?: number;
  resultReturnedAt?: number;
  resultDeliverySource?: "sse" | "websocket";
  responseStartDelayMs?: number;
  firstChunkDelayMs?: number;
  resultStreamDurationMs?: number;
  requestBodyBytes: number;
  audioMimeType?: string | null;
  audioFileName?: string | null;
}

export interface TranscriptionUiTiming {
  apiResolvedAt?: number;
  applyStartedAt?: number;
  applyCompletedAt?: number;
  nextPaintAt?: number;
  apiElapsedMs?: number;
  applyDurationMs?: number;
  applyToNextPaintMs?: number;
}

export interface TranscriptionFrontendTimingReport {
  requestId: string;
  sessionId: string | null;
  mode?: "dictation" | "edit" | "append";
  status: "success" | "error";
  startedAt: number;
  completedAt: number;
  totalElapsedMs: number;
  phaseDurationsMs: Partial<Record<Exclude<TranscriptionFrontendTimingPhase, "complete" | "error">, number>>;
  events: TranscriptionFrontendTimingEvent[];
  recordingTiming?: TranscriptionRecordingTiming;
  clientTiming?: TranscriptionClientTiming;
  uiTiming?: TranscriptionUiTiming;
}

export interface TranscriptionFrontendTiming extends TranscriptionFrontendTimingReport {
  receivedAt: number;
}

export interface TranscriptionLogEntry {
  id: number;
  /** Stable opaque locator derived from the recording's root-relative directory. */
  recordingKey?: string;
  recordingId?: string;
  timestamp: number;
  status?: TranscriptionRecordingStatus;
  sessionId: string | null;
  requestId: string | null;
  mode?: "dictation" | "edit" | "append";
  /** Browser upload + server multipart parse time before the SSE response opens. */
  uploadDurationMs: number;
  /** STT phase */
  sttModel: string;
  sttDurationMs: number;
  /** Bounded, normalized transcript excerpt allowed in the lightweight index. */
  previewText?: string;
  rawTranscript: string;
  audioSizeBytes: number;
  /** Prompt sent to the STT model to guide vocabulary recognition. */
  sttPrompt: string;
  /** Metadata-only STT context summary safe for lightweight debug indexes. */
  sttContext?: {
    promptLength: number;
    keywordCount: number;
    droppedKeywordCount: number;
    languageHints: string[];
  };
  /** Source audio metadata for replaying/debugging the original transcription input. */
  audioMimeType: string | null;
  audioFileName: string | null;
  serverTiming?: TranscriptionServerTiming;
  audioUrl?: string;
  audioAvailable?: boolean;
  /** Enhancement phase (null if not attempted) */
  enhancement: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  } | null;
  /** Browser-visible phase timings reported after transcription completion. */
  frontendTiming: TranscriptionFrontendTiming | null;
  /** Durable on-disk artifact directory for this request, when persistence succeeded or was attempted. */
  recordingDirectoryPath?: string;
  recordingManifestPath?: string;
  recordingStatus?: TranscriptionRecordingStatus;
  recordingPersistenceError?: string;
  recordingDeletedAt?: number;
  discoveryState?: "ready" | "incomplete" | "malformed" | "unsupported" | "unsafe" | "deleted";
  discoveryIssue?: string;
  canOpenRecordingDirectory?: boolean;
  openRecordingDirectoryLabel?: string;
  error?: {
    message: string;
    phase?: string;
  };
  replayVariants?: TranscriptionReplayVariant[];
  replayAvailability?: {
    retranscribe: { available: boolean; reason?: string; warning?: string };
    reenhance: { available: boolean; reason?: string };
  };
}

type PublicStoredTranscriptionLogFields = Omit<
  StoredTranscriptionLogEntry,
  "audioBytes" | "backend" | "audioExtension" | "inputContext" | "result"
>;

const MAX_LOG_ENTRIES = 50;
const MAX_PENDING_FRONTEND_TIMINGS = 50;
let logIdCounter = 0;
const transcriptionLog: StoredTranscriptionLogEntry[] = [];
const pendingFrontendTimingByRequestId = new Map<string, TranscriptionFrontendTiming>();

function toPublicTranscriptionLogEntry(entry: StoredTranscriptionLogEntry): TranscriptionLogEntry {
  const {
    audioBytes: _audioBytes,
    backend: _backend,
    audioExtension: _audioExtension,
    inputContext: _inputContext,
    result: _result,
    ...publicFields
  } = entry;
  const publicEntry: PublicStoredTranscriptionLogFields = publicFields;
  const capability = getLocalPathOpenCapability();
  const audioAvailable = hasSafeTranscriptionAudio(entry);
  return {
    ...publicEntry,
    canOpenRecordingDirectory: Boolean(
      entry.recordingDirectoryPath && !entry.recordingDeletedAt && capability.canOpenContainingFolder,
    ),
    openRecordingDirectoryLabel: capability.openContainingFolderLabel,
    replayAvailability: getReplayAvailability(entry),
    audioAvailable,
    ...(audioAvailable ? { audioUrl: buildTranscriptionAudioUrl(entry) } : {}),
  };
}

function hasOpenAIKey(): boolean {
  const settings = getSettings();
  return Boolean(
    settings.transcriptionConfig.apiKey ||
      process.env.OPENAI_API_KEY ||
      (settings.namerConfig.backend === "openai" && settings.namerConfig.apiKey),
  );
}

function getReplayAvailability(entry: StoredTranscriptionLogEntry): TranscriptionLogEntry["replayAvailability"] {
  const sourceUnavailable = getSourceUnavailableReason(entry);
  if (sourceUnavailable) {
    return {
      retranscribe: { available: false, reason: sourceUnavailable },
      reenhance: { available: false, reason: sourceUnavailable },
    };
  }
  if (!hasOpenAIKey()) {
    return {
      retranscribe: { available: false, reason: "No OpenAI-compatible API key configured" },
      reenhance: { available: false, reason: "No OpenAI-compatible API key configured" },
    };
  }
  const retranscribe = !entry.sttReplayContext
    ? {
        available: true,
        warning:
          "Original recognition context is incomplete or missing. Retry uses only saved context; missing vocabulary or hints cannot be recovered.",
      }
    : { available: true };
  const reenhance = (() => {
    if (!entry.rawTranscript.trim()) return { available: false, reason: "Source raw transcript is missing" };
    if (entry.mode && entry.mode !== "dictation") {
      return { available: false, reason: "Re-enhance is supported for dictation recordings only in v1" };
    }
    if (!entry.enhancementReplayContext) {
      return { available: false, reason: "Separated enhancement replay context is missing" };
    }
    return { available: true };
  })();
  return { retranscribe, reenhance };
}

function getSourceUnavailableReason(entry: StoredTranscriptionLogEntry): string | null {
  if (entry.recordingDeletedAt) return "Source recording was deleted";
  if (!entry.recordingDirectoryPath) return "Source recording is not available";
  if (entry.recordingPersistenceError) return entry.recordingPersistenceError;
  if (entry.audioAvailable === false || (entry.audioAvailable === undefined && !entry.audioBytes.length)) {
    return "Source audio is missing";
  }
  return null;
}

/** Add a transcription log entry. Called from routes.ts after each transcription. */
export async function addTranscriptionLogEntry(
  entry: Omit<StoredTranscriptionLogEntry, "id" | "timestamp" | "requestId" | "frontendTiming"> & {
    requestId?: string | null;
    frontendTiming?: TranscriptionFrontendTiming | null;
  },
): Promise<TranscriptionLogEntry> {
  const requestId = entry.requestId ?? null;
  const pendingFrontendTiming = requestId ? pendingFrontendTimingByRequestId.get(requestId) : null;
  if (requestId && pendingFrontendTiming) pendingFrontendTimingByRequestId.delete(requestId);
  const full: StoredTranscriptionLogEntry = {
    ...entry,
    requestId,
    frontendTiming: entry.frontendTiming ?? pendingFrontendTiming ?? null,
    recordingStatus: entry.status ?? "success",
    id: 0,
    timestamp: Date.now(),
  };
  const recording = await writeTranscriptionRecording({
    status: full.recordingStatus ?? "success",
    sessionId: full.sessionId,
    requestId: full.requestId,
    mode: full.mode,
    backend: full.backend,
    uploadDurationMs: full.uploadDurationMs,
    sttModel: full.sttModel,
    sttDurationMs: full.sttDurationMs,
    sttPrompt: full.sttPrompt,
    sttReplayContext: full.sttReplayContext,
    sttContext: full.sttContext,
    rawTranscript: full.rawTranscript,
    audioBytes: full.audioBytes,
    audioMimeType: full.audioMimeType,
    audioFileName: full.audioFileName,
    audioExtension: full.audioExtension,
    serverTiming: full.serverTiming,
    inputContext: full.inputContext,
    enhancementReplayContext: full.enhancementReplayContext,
    result: full.result,
    enhancement: full.enhancement,
    frontendTiming: full.frontendTiming,
    error: full.error,
  });
  full.recordingDirectoryPath = recording.directoryPath;
  full.recordingManifestPath = recording.manifestPath;
  full.recordingId = recording.recordingId;
  full.recordingKey = getTranscriptionRecordingKey(recording.directoryPath);
  full.id = getTranscriptionRecordingCompatibilityId(full.recordingKey);
  logIdCounter = Math.max(logIdCounter, full.id);
  full.recordingStatus = recording.status;
  if (recording.persistenceError) {
    full.recordingPersistenceError = recording.persistenceError;
    console.warn(`[transcription-recordings] failed to persist recording: ${recording.persistenceError}`);
  }
  const catalogEntry = storedEntryToCatalogEntry(full);
  if (catalogEntry) upsertTranscriptionRecordingCatalogEntry(catalogEntry);
  transcriptionLog.push(full);
  if (transcriptionLog.length > MAX_LOG_ENTRIES) {
    transcriptionLog.splice(0, transcriptionLog.length - MAX_LOG_ENTRIES);
  }
  // Persist to JSONL file (fire-and-forget, non-blocking)
  persistLogEntry(toPublicTranscriptionLogEntry(full));
  return toPublicTranscriptionLogEntry(full);
}

export async function attachTranscriptionFrontendTiming(report: TranscriptionFrontendTimingReport): Promise<{
  attached: boolean;
  logId?: number;
}> {
  const timing = { ...report, receivedAt: Date.now() };
  const existing = transcriptionLog.find(
    (entry) =>
      entry.requestId === report.requestId &&
      (report.sessionId === null || entry.sessionId === null || entry.sessionId === report.sessionId),
  );
  if (!existing) {
    while (pendingFrontendTimingByRequestId.size >= MAX_PENDING_FRONTEND_TIMINGS) {
      const oldestKey = pendingFrontendTimingByRequestId.keys().next().value;
      if (!oldestKey) break;
      pendingFrontendTimingByRequestId.delete(oldestKey);
    }
    pendingFrontendTimingByRequestId.set(report.requestId, timing);
    return { attached: false };
  }

  existing.frontendTiming = timing;
  if (existing.recordingDirectoryPath && !existing.recordingPersistenceError && !existing.recordingDeletedAt) {
    try {
      await writeTranscriptionRecordingFrontendTiming(existing.recordingDirectoryPath, timing);
    } catch (error) {
      existing.recordingPersistenceError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[transcription-recordings] failed to persist frontend timing: ${existing.recordingPersistenceError}`,
      );
    }
  }
  persistFrontendTimingAttachment(existing.id, timing);
  return { attached: true, logId: existing.id };
}

export type TranscriptionLogLocator = string | number;

export async function getTranscriptionLogRecordingDirectory(
  locator: TranscriptionLogLocator,
): Promise<{ path?: string; deletedAt?: number; persistenceError?: string } | undefined> {
  const entry = findLiveTranscriptionEntry(locator) ?? (await loadCatalogStoredEntry(locator, false));
  if (!entry || (!entry.recordingDirectoryPath && !entry.recordingDeletedAt)) return undefined;
  return {
    ...(entry.recordingDirectoryPath ? { path: entry.recordingDirectoryPath } : {}),
    ...(entry.recordingDeletedAt ? { deletedAt: entry.recordingDeletedAt } : {}),
    ...(entry.recordingPersistenceError ? { persistenceError: entry.recordingPersistenceError } : {}),
  };
}

export interface TranscriptionReplaySource {
  id: number;
  recordingKey?: string;
  recordingId?: string;
  sessionId: string | null;
  requestId: string | null;
  mode?: "dictation" | "edit" | "append";
  backend: string;
  sttModel: string;
  sttPrompt: string;
  sttContext?: TranscriptionLogEntry["sttContext"];
  sttReplayContext?: TranscriptionSttReplayContext;
  enhancementReplayContext?: TranscriptionEnhancementReplayContext;
  rawTranscript: string;
  audioBytes: Buffer;
  audioMimeType: string | null;
  audioFileName: string | null;
  audioExtension: string;
  audioSizeBytes: number;
  recordingDirectoryPath?: string;
  recordingManifestPath?: string;
  recordingStatus?: TranscriptionRecordingStatus;
  recordingPersistenceError?: string;
  recordingDeletedAt?: number;
  enhancement: TranscriptionLogEntry["enhancement"];
}

export async function getTranscriptionReplaySource(
  locator: TranscriptionLogLocator,
): Promise<TranscriptionReplaySource | undefined> {
  const entry = findLiveTranscriptionEntry(locator) ?? (await loadCatalogStoredEntry(locator, true));
  if (!entry) return undefined;
  return {
    id: entry.id,
    recordingKey: entry.recordingKey,
    recordingId: entry.recordingId,
    sessionId: entry.sessionId,
    requestId: entry.requestId,
    mode: entry.mode,
    backend: entry.backend,
    sttModel: entry.sttModel,
    sttPrompt: entry.sttPrompt,
    sttContext: entry.sttContext,
    sttReplayContext: entry.sttReplayContext,
    enhancementReplayContext: entry.enhancementReplayContext,
    rawTranscript: entry.rawTranscript,
    audioBytes: entry.audioBytes,
    audioMimeType: entry.audioMimeType,
    audioFileName: entry.audioFileName,
    audioExtension: entry.audioExtension,
    audioSizeBytes: entry.audioSizeBytes,
    recordingDirectoryPath: entry.recordingDirectoryPath,
    recordingManifestPath: entry.recordingManifestPath,
    recordingStatus: entry.recordingStatus,
    recordingPersistenceError: entry.recordingPersistenceError,
    recordingDeletedAt: entry.recordingDeletedAt,
    enhancement: entry.enhancement,
  };
}

export async function addTranscriptionReplayVariant(
  locator: TranscriptionLogLocator,
  input: WriteTranscriptionReplayVariantInput,
): Promise<TranscriptionReplayVariant> {
  const entry = findLiveTranscriptionEntry(locator) ?? (await loadCatalogStoredEntry(locator, false));
  if (!entry?.recordingDirectoryPath) {
    throw new Error("Source recording not found");
  }
  const variant = await writeTranscriptionReplayVariant(entry.recordingDirectoryPath, input);
  return variant;
}

export async function deleteTranscriptionLogRecording(
  locator: TranscriptionLogLocator,
): Promise<TranscriptionLogEntry | undefined> {
  const liveEntry = findLiveTranscriptionEntry(locator);
  const catalogEntry = await getCatalogEntryForLocator(locator, liveEntry);
  if (!catalogEntry?.directoryPath) return undefined;
  const deleted = await tombstoneAndDeleteTranscriptionRecording(catalogEntry);
  if (liveEntry) {
    liveEntry.recordingDeletedAt = deleted.recordingDeletedAt;
    liveEntry.recordingPersistenceError = undefined;
    liveEntry.discoveryState = "deleted";
    liveEntry.discoveryIssue = "Source recording was deleted";
    liveEntry.audioBytes = Buffer.alloc(0);
    liveEntry.audioAvailable = false;
    liveEntry.sttPrompt = "";
    liveEntry.rawTranscript = "";
    liveEntry.enhancement = null;
    liveEntry.sttReplayContext = undefined;
    liveEntry.enhancementReplayContext = undefined;
  }
  persistLogRecord({
    kind: "transcription_recording_deleted",
    logId: deleted.id,
    recordingKey: deleted.recordingKey,
    deletedAt: deleted.recordingDeletedAt,
  });
  return toPublicTranscriptionLogEntry(liveEntry ?? catalogEntryToStoredEntry(deleted));
}

export function _resetTranscriptionLogForTest(): void {
  logIdCounter = 0;
  transcriptionLog.length = 0;
  pendingFrontendTimingByRequestId.clear();
  _resetTranscriptionRecordingCatalogForTest();
}

// ─── Persistent JSONL file logging ──────────────────────────────────────────
// Follows the same buffered async pattern as server-logger.ts and recorder.ts.
// Entries survive server restarts for offline analysis of enhancer effectiveness.

const LOG_DIR = join(homedir(), ".companion", "logs");
const LOG_FILE = join(LOG_DIR, "transcription.jsonl");
const FLUSH_INTERVAL_MS = 200;

let logBuffer: string[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
let logFlushing = false;
let logDirReady = false;

function persistLogEntry(entry: TranscriptionLogEntry): void {
  persistLogRecord(entry);
}

function persistFrontendTimingAttachment(logId: number, timing: TranscriptionFrontendTiming): void {
  persistLogRecord({ kind: "transcription_frontend_timing", logId, ...timing });
}

function persistLogRecord(record: unknown): void {
  logBuffer.push(JSON.stringify(record) + "\n");
  scheduleLogFlush();
}

function scheduleLogFlush(): void {
  if (logFlushTimer || logFlushing) return;
  logFlushTimer = setTimeout(flushLog, FLUSH_INTERVAL_MS);
}

async function flushLog(): Promise<void> {
  logFlushTimer = null;
  if (logFlushing || logBuffer.length === 0) return;
  logFlushing = true;
  const data = logBuffer.join("");
  logBuffer = [];
  try {
    if (!logDirReady) {
      await mkdir(LOG_DIR, { recursive: true });
      logDirReady = true;
    }
    await appendFile(LOG_FILE, data);
  } catch {
    // Silently ignore write errors (disk full, NFS unavailable, etc.)
  }
  logFlushing = false;
  if (logBuffer.length > 0) scheduleLogFlush();
}

export interface TranscriptionLogIndexEntry {
  id: number;
  recordingKey?: string;
  recordingId?: string;
  timestamp: number;
  status?: TranscriptionRecordingStatus;
  sessionId: string | null;
  requestId: string | null;
  mode?: "dictation" | "edit" | "append";
  uploadDurationMs: number;
  sttModel: string;
  sttDurationMs: number;
  previewText?: string;
  sttContext?: TranscriptionLogEntry["sttContext"];
  audioSizeBytes: number;
  audioMimeType: string | null;
  audioFileName: string | null;
  audioUrl?: string;
  audioAvailable: boolean;
  recordingStatus?: TranscriptionRecordingStatus;
  recordingDeletedAt?: number;
  discoveryState?: TranscriptionLogEntry["discoveryState"];
  statusReason?: TranscriptionIndexStatusReason;
  enhancement: {
    model: string;
    durationMs: number;
    enhancedTextPresent: boolean;
    skipReasonCode?: TranscriptionIndexEnhancementSkipReason;
  } | null;
}

export interface TranscriptionLogIndexPage {
  entries: TranscriptionLogIndexEntry[];
  nextCursor: string | null;
  total: number;
}

/** Current-process compatibility view. The HTTP index uses getTranscriptionLogIndexPage. */
export function getTranscriptionLogIndex(): TranscriptionLogIndexEntry[] {
  return transcriptionLog.map(toTranscriptionLogIndexEntry).reverse();
}

export async function getTranscriptionLogIndexPage(options?: {
  limit?: number;
  cursor?: string | null;
  refresh?: boolean;
  initial?: boolean;
}): Promise<TranscriptionLogIndexPage> {
  const recentPage = options?.initial
    ? await getRecentTranscriptionRecordingCatalogPage({ limit: options.limit, refresh: options.refresh })
    : null;
  const catalogEntries =
    recentPage?.entries ?? (await listTranscriptionRecordingCatalog({ refresh: options?.refresh }));
  const merged = new Map<string, StoredTranscriptionLogEntry>();
  for (const catalogEntry of catalogEntries) {
    merged.set(catalogEntry.recordingKey, catalogEntryToStoredEntry(catalogEntry));
  }
  for (const liveEntry of transcriptionLog) {
    const key = transcriptionLogEntryKey(liveEntry);
    const existing = merged.get(key);
    if (existing?.recordingDeletedAt && !liveEntry.recordingDeletedAt) continue;
    merged.set(key, liveEntry);
  }
  const all = [...merged.values()].map(toTranscriptionLogIndexEntry).sort((a, b) => {
    const timestampDelta = b.timestamp - a.timestamp;
    if (timestampDelta !== 0) return timestampDelta;
    const aKey = transcriptionLogEntryKey(a);
    const bKey = transcriptionLogEntryKey(b);
    return aKey === bKey ? 0 : aKey < bKey ? 1 : -1;
  });
  const cursor = options?.cursor === TRANSCRIPTION_RECENT_PAGE_CURSOR ? null : decodeLogIndexCursor(options?.cursor);
  const eligible = cursor
    ? all.filter(
        (entry) =>
          entry.timestamp < cursor.timestamp ||
          (entry.timestamp === cursor.timestamp && transcriptionLogEntryKey(entry) < cursor.recordingKey),
      )
    : all;
  const limit = Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 50)));
  const entries = eligible.slice(0, limit);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor:
      recentPage?.nextCursor ??
      (eligible.length > entries.length && last
        ? Buffer.from(JSON.stringify([last.timestamp, transcriptionLogEntryKey(last)]), "utf-8").toString("base64url")
        : null),
    total: recentPage && recentPage.total === 0 ? 0 : all.length,
  };
}

/** Get a single log entry by ID (includes full details). */
export function getTranscriptionLogEntry(id: number): TranscriptionLogEntry | undefined {
  const entry = transcriptionLog.find((e) => e.id === id);
  return entry ? toPublicTranscriptionLogEntry(entry) : undefined;
}

export async function getTranscriptionLogEntryWithReplays(
  locator: TranscriptionLogLocator,
): Promise<TranscriptionLogEntry | undefined> {
  const entry = findLiveTranscriptionEntry(locator) ?? (await loadCatalogStoredEntry(locator, false));
  if (!entry) return undefined;
  const publicEntry = toPublicTranscriptionLogEntry(entry);
  if (entry.recordingDirectoryPath && !entry.recordingDeletedAt && !entry.recordingPersistenceError) {
    publicEntry.replayVariants = await readTranscriptionReplayVariants(entry.recordingDirectoryPath);
  }
  return publicEntry;
}

/** Get source audio bytes for a transcription log entry. */
export async function getTranscriptionLogAudio(locator: TranscriptionLogLocator): Promise<TranscriptionLogAudioLookup> {
  return lookupTranscriptionLogAudio(locator, findLiveTranscriptionEntry(locator));
}

function findLiveTranscriptionEntry(locator: TranscriptionLogLocator): StoredTranscriptionLogEntry | undefined {
  if (typeof locator === "number") return transcriptionLog.find((entry) => entry.id === locator);
  if (locator.startsWith("r_")) return transcriptionLog.find((entry) => entry.recordingKey === locator);
  const numeric = Number(locator);
  return Number.isInteger(numeric) && numeric > 0 ? transcriptionLog.find((entry) => entry.id === numeric) : undefined;
}

function toTranscriptionLogIndexEntry(entry: StoredTranscriptionLogEntry): TranscriptionLogIndexEntry {
  const audioAvailable = hasSafeTranscriptionAudio(entry);
  const skipReasonCode = getEnhancementSkipReasonCode(entry.enhancement?.skipReason);
  const previewText =
    !entry.recordingDeletedAt &&
    !entry.recordingPersistenceError &&
    (!entry.discoveryState || entry.discoveryState === "ready")
      ? (entry.previewText ?? buildTranscriptionPreview(entry.enhancement?.enhancedText, entry.rawTranscript))
      : undefined;
  return {
    id: entry.id,
    recordingKey: entry.recordingKey,
    recordingId: entry.recordingId,
    timestamp: entry.timestamp,
    status: entry.status,
    sessionId: sanitizeIndexIdentifier(entry.sessionId),
    requestId: sanitizeIndexIdentifier(entry.requestId),
    mode: entry.mode,
    uploadDurationMs: entry.uploadDurationMs,
    sttModel: sanitizeIndexModelIdentifier(entry.sttModel) ?? "unknown",
    sttDurationMs: entry.sttDurationMs,
    ...(previewText ? { previewText } : {}),
    sttContext: entry.sttContext
      ? {
          ...entry.sttContext,
          languageHints: entry.sttContext.languageHints.filter((hint) => /^[A-Za-z0-9-]{1,20}$/.test(hint)),
        }
      : undefined,
    audioSizeBytes: entry.audioSizeBytes,
    audioMimeType: sanitizeIndexAudioMimeType(entry.audioMimeType),
    audioFileName: sanitizeIndexFileName(entry.audioFileName),
    audioAvailable,
    ...(audioAvailable ? { audioUrl: buildTranscriptionAudioUrl(entry) } : {}),
    recordingStatus: entry.recordingStatus,
    recordingDeletedAt: entry.recordingDeletedAt,
    discoveryState: entry.discoveryState,
    statusReason: getTranscriptionIndexStatusReason(entry),
    enhancement: entry.enhancement
      ? {
          model: sanitizeIndexModelIdentifier(entry.enhancement.model) ?? "unknown",
          durationMs: entry.enhancement.durationMs,
          enhancedTextPresent: entry.enhancement.enhancedText !== null,
          ...(skipReasonCode ? { skipReasonCode } : {}),
        }
      : null,
  };
}
