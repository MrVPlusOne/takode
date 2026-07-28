import {
  getTranscriptionRecordingCatalogEntry,
  readTranscriptionRecordingCatalogAudio,
  readTranscriptionRecordingCatalogDetail,
  type TranscriptionRecordingCatalogEntry,
} from "./transcription-recording-catalog.js";
import type {
  TranscriptionEnhancementReplayContext,
  TranscriptionSttReplayContext,
} from "./transcription-recordings.js";
import type {
  TranscriptionFrontendTiming,
  TranscriptionLogEntry,
  TranscriptionServerTiming,
} from "./transcription-enhancer.js";

export interface StoredTranscriptionLogEntry extends Omit<TranscriptionLogEntry, "audioUrl"> {
  audioBytes: Buffer;
  audioAvailable?: boolean;
  backend: string;
  audioExtension: string;
  sttReplayContext?: TranscriptionSttReplayContext;
  inputContext?: {
    threadKey?: string;
    threadTitle?: string;
    focusedContext?: string;
    composerText?: string;
  };
  enhancementReplayContext?: TranscriptionEnhancementReplayContext;
  result?: unknown;
}

export async function loadCatalogStoredEntry(
  locator: string | number,
  includeAudio: boolean,
): Promise<StoredTranscriptionLogEntry | undefined> {
  const detail = await readTranscriptionRecordingCatalogDetail(locator);
  if (!detail) return undefined;
  const audio = includeAudio ? await readTranscriptionRecordingCatalogAudio(locator) : undefined;
  return catalogEntryToStoredEntry(detail.entry, {
    sttPrompt: detail.sttPrompt,
    rawTranscript: detail.rawTranscript,
    sttReplayContext: detail.sttReplayContext,
    enhancementReplayContext: detail.enhancementReplayContext,
    frontendTiming: detail.frontendTiming,
    enhancement: detail.enhancement,
    audioAvailable: detail.audioAvailable,
    audioBytes: audio?.data,
    audioStoredFile: detail.audioStoredFile,
  });
}

export function catalogEntryToStoredEntry(
  entry: TranscriptionRecordingCatalogEntry,
  detail?: {
    sttPrompt?: string;
    rawTranscript?: string;
    sttReplayContext?: TranscriptionSttReplayContext;
    enhancementReplayContext?: TranscriptionEnhancementReplayContext;
    frontendTiming?: unknown;
    enhancement?: TranscriptionLogEntry["enhancement"];
    audioAvailable?: boolean;
    audioBytes?: Buffer;
    audioStoredFile?: string;
  },
): StoredTranscriptionLogEntry {
  return {
    id: entry.id,
    recordingKey: entry.recordingKey,
    recordingId: entry.recordingId,
    timestamp: entry.timestamp,
    status: entry.status,
    sessionId: entry.sessionId,
    requestId: entry.requestId,
    mode: entry.mode,
    uploadDurationMs: entry.uploadDurationMs,
    sttModel: entry.sttModel,
    sttDurationMs: entry.sttDurationMs,
    sttPrompt: detail?.sttPrompt ?? "",
    sttContext: entry.sttContext,
    rawTranscript: detail?.rawTranscript ?? "",
    audioBytes: detail?.audioBytes ?? Buffer.alloc(0),
    audioAvailable: detail?.audioAvailable ?? entry.discoveryState === "ready",
    audioSizeBytes: entry.audioSizeBytes,
    audioMimeType: entry.audioMimeType,
    audioFileName: entry.audioFileName,
    audioExtension: detail?.audioStoredFile?.split(".").at(-1) || "webm",
    backend: entry.backend,
    serverTiming: entry.serverTiming as TranscriptionServerTiming | undefined,
    enhancement:
      detail !== undefined
        ? (detail.enhancement ?? null)
        : entry.enhancement
          ? {
              model: entry.enhancement.model,
              systemPrompt: "",
              userMessage: "",
              enhancedText: entry.enhancement.enhancedTextPresent ? "" : null,
              durationMs: entry.enhancement.durationMs,
              ...(entry.enhancement.skipReason ? { skipReason: entry.enhancement.skipReason } : {}),
            }
          : null,
    frontendTiming: (detail?.frontendTiming as TranscriptionFrontendTiming | undefined) ?? null,
    recordingDirectoryPath: entry.directoryPath,
    recordingManifestPath: entry.manifestPath,
    recordingStatus: entry.status,
    recordingDeletedAt: entry.recordingDeletedAt,
    discoveryState: entry.discoveryState,
    discoveryIssue: entry.discoveryIssue,
    recordingPersistenceError:
      entry.discoveryState !== "ready" && entry.discoveryState !== "deleted" ? entry.discoveryIssue : undefined,
    error: entry.error,
    sttReplayContext: detail?.sttReplayContext,
    enhancementReplayContext: detail?.enhancementReplayContext,
  };
}

export async function getCatalogEntryForLocator(
  locator: string | number,
  liveEntry?: StoredTranscriptionLogEntry,
): Promise<TranscriptionRecordingCatalogEntry | undefined> {
  const existing = await getTranscriptionRecordingCatalogEntry(liveEntry?.recordingKey ?? locator);
  if (existing) return existing;
  return liveEntry ? storedEntryToCatalogEntry(liveEntry) : undefined;
}

export function storedEntryToCatalogEntry(
  liveEntry: StoredTranscriptionLogEntry,
): TranscriptionRecordingCatalogEntry | undefined {
  if (!liveEntry.recordingKey || !liveEntry.recordingId || !liveEntry.recordingDirectoryPath) return undefined;
  return {
    id: liveEntry.id,
    recordingKey: liveEntry.recordingKey,
    recordingId: liveEntry.recordingId,
    timestamp: liveEntry.timestamp,
    status: liveEntry.status ?? "success",
    sessionId: liveEntry.sessionId,
    requestId: liveEntry.requestId,
    mode: liveEntry.mode,
    backend: liveEntry.backend,
    uploadDurationMs: liveEntry.uploadDurationMs,
    sttModel: liveEntry.sttModel,
    sttDurationMs: liveEntry.sttDurationMs,
    sttContext: liveEntry.sttContext,
    audioSizeBytes: liveEntry.audioSizeBytes,
    audioMimeType: liveEntry.audioMimeType,
    audioFileName: liveEntry.audioFileName,
    serverTiming: liveEntry.serverTiming,
    enhancement: liveEntry.enhancement
      ? {
          model: liveEntry.enhancement.model,
          durationMs: liveEntry.enhancement.durationMs,
          enhancedTextPresent: liveEntry.enhancement.enhancedText !== null,
          ...(liveEntry.enhancement.skipReason ? { skipReason: liveEntry.enhancement.skipReason } : {}),
        }
      : null,
    error: liveEntry.error,
    discoveryState: liveEntry.recordingPersistenceError ? "incomplete" : "ready",
    discoveryIssue: liveEntry.recordingPersistenceError,
    directoryPath: liveEntry.recordingDirectoryPath,
    manifestPath: liveEntry.recordingManifestPath,
  };
}

export function decodeLogIndexCursor(
  value: string | null | undefined,
): { timestamp: number; recordingKey: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    return typeof parsed[0] === "number" && typeof parsed[1] === "string"
      ? { timestamp: parsed[0], recordingKey: parsed[1] }
      : null;
  } catch {
    return null;
  }
}
