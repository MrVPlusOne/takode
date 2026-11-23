/**
 * Audio transcription service using OpenAI-compatible STT.
 *
 * Accepts raw audio as a Buffer and returns the transcription text.
 * API keys are resolved via resolveOpenAIKey() (settings → env var → namer key).
 */

import { getSettings } from "./settings-manager.js";

export interface SanitizedTranscriptionKeywords {
  keywords: string[];
  droppedKeywordCount: number;
}

export interface OpenaiTranscriptionOptions {
  sttPrompt?: string;
  fileName?: string;
  sttModel?: string;
  baseUrl?: string;
  keywords?: string[];
  languageHints?: string[];
}

type AudioUploadFormat = {
  mimeType: string;
  extension: string;
};

function normalizeMimeType(mimeType: string | null | undefined): string {
  return mimeType?.split(";")[0]?.trim().toLowerCase() || "";
}

function inferMimeTypeFromFilename(fileName: string | null | undefined): string | null {
  const lower = fileName?.trim().toLowerCase() || "";
  if (!lower) return null;
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3") || lower.endsWith(".mpga")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return null;
}

function inferMimeTypeFromBuffer(audioBuffer: Buffer): string | null {
  if (audioBuffer.length >= 12 && audioBuffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "audio/mp4";
  }
  if (
    audioBuffer.length >= 4 &&
    audioBuffer[0] === 0x1a &&
    audioBuffer[1] === 0x45 &&
    audioBuffer[2] === 0xdf &&
    audioBuffer[3] === 0xa3
  ) {
    return "audio/webm";
  }
  if (audioBuffer.length >= 4 && audioBuffer.subarray(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }
  if (audioBuffer.length >= 4 && audioBuffer.subarray(0, 4).toString("ascii") === "fLaC") {
    return "audio/flac";
  }
  if (
    audioBuffer.length >= 12 &&
    audioBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    audioBuffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return "audio/wav";
  }
  if (audioBuffer.length >= 3 && audioBuffer.subarray(0, 3).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  if (audioBuffer.length >= 2 && audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return null;
}

export function resolveAudioUploadFormat(
  audioBuffer: Buffer,
  mimeType: string | null | undefined,
  fileName?: string | null,
): AudioUploadFormat {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const normalized = (() => {
    switch (normalizedMimeType) {
      case "audio/webm":
      case "video/webm":
        return "audio/webm";
      case "audio/ogg":
      case "video/ogg":
        return "audio/ogg";
      case "audio/mp4":
      case "video/mp4":
      case "audio/m4a":
      case "audio/x-m4a":
        return "audio/mp4";
      case "audio/wav":
      case "audio/x-wav":
        return "audio/wav";
      case "audio/flac":
        return "audio/flac";
      case "audio/mpeg":
      case "audio/mp3":
      case "audio/mpga":
        return "audio/mpeg";
      default:
        return "";
    }
  })();
  const sniffed = inferMimeTypeFromBuffer(audioBuffer);
  const fromFilename = inferMimeTypeFromFilename(fileName);
  const resolvedMimeType = sniffed || normalized || fromFilename || "audio/webm";
  const wantsM4a = typeof fileName === "string" && fileName.trim().toLowerCase().endsWith(".m4a");
  const extension = (() => {
    switch (resolvedMimeType) {
      case "audio/mp4":
        return wantsM4a ? "m4a" : "mp4";
      case "audio/ogg":
        return "ogg";
      case "audio/wav":
        return "wav";
      case "audio/flac":
        return "flac";
      case "audio/mpeg":
        return "mp3";
      default:
        return "webm";
    }
  })();
  return { mimeType: resolvedMimeType, extension };
}

/**
 * Transcribe audio using OpenAI's audio transcription API (multipart form upload).
 * @param sttPrompt Optional prompt to guide the STT model's vocabulary recognition.
 */
export async function transcribeWithOpenai(
  audioBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  optionsOrPrompt?: OpenaiTranscriptionOptions | string,
  fileName?: string,
  sttModel?: string,
): Promise<string> {
  const options: OpenaiTranscriptionOptions =
    typeof optionsOrPrompt === "object" && optionsOrPrompt !== null
      ? optionsOrPrompt
      : { sttPrompt: optionsOrPrompt, fileName, sttModel };
  const resolvedModel = options.sttModel || getSettings().transcriptionConfig.sttModel || "gpt-transcribe";
  const format = resolveAudioUploadFormat(audioBuffer, mimeType, options.fileName);

  const form = new FormData();
  form.append("model", resolvedModel);
  form.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: format.mimeType }),
    `recording.${format.extension}`,
  );
  if (options.sttPrompt) {
    form.append("prompt", options.sttPrompt);
  }
  for (const keyword of options.keywords ?? []) {
    form.append("keywords[]", keyword);
  }
  for (const languageHint of options.languageHints ?? []) {
    form.append("languages[]", languageHint);
  }

  const response = await fetch(buildOpenaiTranscriptionUrl(options.baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI Whisper API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = (await response.json()) as { text?: string };
  if (!data.text) {
    throw new Error("Whisper returned no transcription text");
  }

  return data.text.trim();
}

export function sanitizeTranscriptionKeywords(
  customVocabulary: string | null | undefined,
): SanitizedTranscriptionKeywords {
  if (!customVocabulary?.trim()) return { keywords: [], droppedKeywordCount: 0 };
  const seen = new Set<string>();
  const keywords: string[] = [];
  let droppedKeywordCount = 0;
  for (const rawTerm of customVocabulary.split(",")) {
    const keyword = rawTerm.trim();
    const dedupeKey = keyword.toLocaleLowerCase();
    if (!keyword || /[<>\r\n]/.test(keyword) || seen.has(dedupeKey)) {
      droppedKeywordCount++;
      continue;
    }
    seen.add(dedupeKey);
    keywords.push(keyword);
  }
  return { keywords, droppedKeywordCount };
}

export function buildOpenaiTranscriptionUrl(baseUrl: string | null | undefined): string {
  const configuredBaseUrl = baseUrl?.trim() || getSettings().transcriptionConfig.baseUrl || "https://api.openai.com/v1";
  const withoutTrailingSlash = configuredBaseUrl.replace(/\/+$/, "");
  if (withoutTrailingSlash.endsWith("/audio/transcriptions")) return withoutTrailingSlash;
  return `${withoutTrailingSlash}/audio/transcriptions`;
}

/**
 * Resolve an OpenAI API key from multiple sources, in priority order:
 * 1. transcriptionConfig.apiKey (dedicated setting)
 * 2. OPENAI_API_KEY env var
 * 3. namerConfig.apiKey (if namer uses OpenAI — reuse existing key)
 */
export function resolveOpenAIKey(): string | null {
  const settings = getSettings();
  if (settings.transcriptionConfig.apiKey) return settings.transcriptionConfig.apiKey;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (settings.namerConfig.backend === "openai" && settings.namerConfig.apiKey) {
    return settings.namerConfig.apiKey;
  }
  return null;
}

/** Get transcription status for the new API shape. */
export function getTranscriptionStatus(): {
  available: boolean;
  enhancementEnabled: boolean;
  backend: string | null;
} {
  const key = resolveOpenAIKey();
  const settings = getSettings();
  return {
    available: !!key,
    enhancementEnabled: !!key && settings.transcriptionConfig.enhancementEnabled,
    backend: key ? "openai" : null,
  };
}
