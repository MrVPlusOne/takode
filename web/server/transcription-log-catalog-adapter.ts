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

export type TranscriptionIndexStatusReason =
  | "recording_deleted"
  | "persistence_error"
  | "recording_incomplete"
  | "recording_malformed"
  | "recording_unsupported"
  | "recording_unsafe"
  | "transcription_error";

export type TranscriptionIndexEnhancementSkipReason =
  | "disabled"
  | "too_short"
  | "no_context"
  | "provider_error"
  | "empty_response"
  | "other";

export function getTranscriptionIndexStatusReason(
  entry: StoredTranscriptionLogEntry,
): TranscriptionIndexStatusReason | undefined {
  if (entry.recordingDeletedAt || entry.discoveryState === "deleted") return "recording_deleted";
  if (entry.recordingPersistenceError) return "persistence_error";
  if (entry.discoveryState && entry.discoveryState !== "ready") return `recording_${entry.discoveryState}`;
  if (entry.status === "error" || entry.recordingStatus === "error") return "transcription_error";
  return undefined;
}

export function getEnhancementSkipReasonCode(
  reason: string | undefined,
): TranscriptionIndexEnhancementSkipReason | undefined {
  if (!reason) return undefined;
  if (reason === "disabled") return "disabled";
  if (reason === "too short") return "too_short";
  if (reason === "no context") return "no_context";
  if (reason.startsWith("API error")) return "provider_error";
  if (reason === "Empty response from LLM") return "empty_response";
  return "other";
}

const INDEX_IDENTIFIER_MAX_LENGTH = 200;
const INDEX_AUDIO_MIME_TYPE_MAX_LENGTH = 100;
const INDEX_AUDIO_MIME_TYPE_ALIASES = new Map<string, string>([
  ["audio/webm", "audio/webm"],
  ["video/webm", "audio/webm"],
  ["audio/ogg", "audio/ogg"],
  ["video/ogg", "audio/ogg"],
  ["audio/mp4", "audio/mp4"],
  ["video/mp4", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/wav", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["audio/flac", "audio/flac"],
  ["audio/mpeg", "audio/mpeg"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/mpga", "audio/mpeg"],
]);

function containsExplicitAbsolutePath(value: string): boolean {
  return (
    /[A-Za-z]:[\\/]/.test(value) ||
    /(?:^|[\s"'`([{=,:;])(?:\\\\|\/\/)[^\s"'`\])}]+/.test(value) ||
    /(?:^|[\s"'`([{=,:;])\/[^\s"'`\])}]+/.test(value) ||
    /file:\/\//i.test(value)
  );
}

export function sanitizeIndexIdentifier(value: string | null): string | null {
  if (
    !value ||
    value.length > INDEX_IDENTIFIER_MAX_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    containsExplicitAbsolutePath(value)
  ) {
    return null;
  }
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:@+/-]*$/.test(normalized) ? normalized : null;
}

export function sanitizeIndexModelIdentifier(value: string | null): string | null {
  if (
    !value ||
    value.length > INDEX_IDENTIFIER_MAX_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    containsExplicitAbsolutePath(value)
  ) {
    return null;
  }
  const normalized = value.trim();
  const segments = normalized.split("/");
  return segments.every(
    (segment) => segment !== "." && segment !== ".." && /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/.test(segment),
  )
    ? normalized
    : null;
}

export function sanitizeIndexAudioMimeType(value: string | null): string | null {
  if (
    !value ||
    value.length > INDEX_AUDIO_MIME_TYPE_MAX_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    containsExplicitAbsolutePath(value)
  ) {
    return null;
  }
  const [baseType, ...parameters] = value.split(";");
  if (parameters.length > 1 || (parameters[0] && !/^\s*codecs=[A-Za-z0-9._-]{1,64}\s*$/i.test(parameters[0]))) {
    return null;
  }
  return INDEX_AUDIO_MIME_TYPE_ALIASES.get(baseType?.trim().toLowerCase() ?? "") ?? null;
}

export function sanitizeIndexFileName(value: string | null): string | null {
  if (!value || value.length > 500 || value.includes("/") || value.includes("\\")) return null;
  return value;
}

export function hasSafeTranscriptionAudio(entry: StoredTranscriptionLogEntry): boolean {
  if (entry.recordingDeletedAt || entry.recordingPersistenceError) return false;
  if (entry.discoveryState && entry.discoveryState !== "ready") return false;
  if (entry.audioAvailable !== undefined) return entry.audioAvailable;
  return Boolean(entry.recordingDirectoryPath && entry.audioBytes.length > 0);
}

export function buildTranscriptionAudioUrl(entry: Pick<StoredTranscriptionLogEntry, "id" | "recordingKey">): string {
  return `/api/transcription-logs/${encodeURIComponent(entry.recordingKey ?? String(entry.id))}/audio`;
}

export function transcriptionLogEntryKey(entry: { id: number; recordingKey?: string }): string {
  return entry.recordingKey ?? `legacy-${entry.id}`;
}

export type TranscriptionLogAudioLookup =
  | { state: "available"; data: Buffer; mimeType: string; fileName: string | null }
  | { state: "deleted" }
  | {
      state: "unavailable";
      reason:
        | "persistence_error"
        | "recording_incomplete"
        | "recording_malformed"
        | "recording_unsupported"
        | "recording_unsafe"
        | "audio_missing";
    }
  | { state: "not_found" };

export async function lookupTranscriptionLogAudio(
  locator: string | number,
  liveEntry?: StoredTranscriptionLogEntry,
): Promise<TranscriptionLogAudioLookup> {
  const entry = liveEntry ?? (await loadCatalogStoredEntry(locator, false));
  if (!entry) return { state: "not_found" };
  if (entry.recordingDeletedAt || entry.discoveryState === "deleted") return { state: "deleted" };
  if (entry.discoveryState && entry.discoveryState !== "ready") {
    return { state: "unavailable", reason: `recording_${entry.discoveryState}` };
  }
  if (entry.recordingPersistenceError) return { state: "unavailable", reason: "persistence_error" };
  if (liveEntry?.audioBytes.length && hasSafeTranscriptionAudio(liveEntry)) {
    return {
      state: "available",
      data: liveEntry.audioBytes,
      mimeType: liveEntry.audioMimeType || "application/octet-stream",
      fileName: liveEntry.audioFileName,
    };
  }
  const audio = await readTranscriptionRecordingCatalogAudio(locator);
  return audio ? { state: "available", ...audio } : { state: "unavailable", reason: "audio_missing" };
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
    audioAvailable: detail?.audioAvailable ?? false,
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
