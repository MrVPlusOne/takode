import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { getSettings } from "./settings-manager.js";

export type TranscriptionRecordingStatus = "success" | "error";

export interface TranscriptionRecordingResult {
  recordingId: string;
  directoryPath: string;
  manifestPath: string;
  status: TranscriptionRecordingStatus;
  persistenceError?: string;
}

export interface TranscriptionRecordingInput {
  status: TranscriptionRecordingStatus;
  sessionId: string | null;
  requestId: string | null;
  mode?: "dictation" | "edit" | "append";
  backend: string;
  uploadDurationMs: number;
  sttModel: string;
  sttDurationMs: number;
  sttPrompt: string;
  sttReplayContext?: TranscriptionSttReplayContext;
  sttContext?: {
    promptLength: number;
    keywordCount: number;
    droppedKeywordCount: number;
    languageHints: string[];
  };
  rawTranscript: string;
  audioBytes: Buffer;
  audioMimeType: string | null;
  audioFileName: string | null;
  audioExtension: string;
  serverTiming?: unknown;
  inputContext?: {
    threadKey?: string;
    threadTitle?: string;
    focusedContext?: string;
    composerText?: string;
  };
  enhancementReplayContext?: TranscriptionEnhancementReplayContext;
  result?: unknown;
  enhancement?: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  } | null;
  frontendTiming?: unknown;
  error?: { message: string; phase?: string };
}

export interface TranscriptionSttReplayContext {
  version: 1;
  backend: string;
  model: string;
  prompt: string;
  promptLength: number;
  usesGptTranscribeContext: boolean;
  promptIncludesCustomVocabulary: boolean;
  keywords: string[];
  droppedKeywordCount: number;
  languageHints: string[];
  inputContext?: {
    threadKey?: string;
    threadTitle?: string;
    focusedContext?: string;
    composerText?: string;
    sessionName?: string;
    activeSessionNames?: string[];
    taskTitles?: string[];
  };
}

export interface TranscriptionEnhancementReplayContext {
  version: 1;
  mode?: "dictation" | "edit" | "append";
  enhancementMode?: "default" | "bullet";
  model: string;
  conversationContext: string;
  extra?: {
    mode?: "dictation" | "edit" | "append";
    composerText?: string;
    taskTitles?: string[];
    sessionName?: string;
    threadTitle?: string;
    focusedContext?: string;
    activeSessionNames?: string[];
    customVocabulary?: string;
  };
}

export type TranscriptionReplayKind = "stt_replay" | "enhancement_replay";
export type TranscriptionReplayStatus = "success" | "error";

export interface TranscriptionReplayVariant {
  id: string;
  kind: TranscriptionReplayKind;
  status: TranscriptionReplayStatus;
  createdAt: number;
  sourceLogId: number;
  sourceRecordingId?: string;
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
  artifacts: Record<string, string>;
}

export interface WriteTranscriptionReplayVariantInput {
  kind: TranscriptionReplayKind;
  status: TranscriptionReplayStatus;
  sourceLogId: number;
  sourceRecordingId?: string;
  model: string;
  provider: "openai";
  enhancementMode?: "default" | "bullet";
  sttPrompt?: string;
  sttReplayContext?: TranscriptionSttReplayContext;
  enhancementReplayContext?: TranscriptionEnhancementReplayContext;
  rawTranscript?: string;
  enhancedText?: string | null;
  systemPrompt?: string;
  userMessage?: string;
  timing?: {
    sttDurationMs?: number;
    enhancementDurationMs?: number;
  };
  error?: {
    message: string;
    phase?: string;
  };
}

let testRecordingRoot: string | null = null;

export function getDefaultTranscriptionRecordingRoot(): string {
  const serverSlug = sanitizePathPart(getSettings().serverSlug || "local");
  return join(homedir(), ".companion", "transcription-recordings", serverSlug);
}

export async function writeTranscriptionRecording(
  input: TranscriptionRecordingInput,
): Promise<TranscriptionRecordingResult> {
  const root = getTranscriptionRecordingRoot();
  const datePart = new Date().toISOString().slice(0, 10);
  const recordingId = buildRecordingId(input.requestId);
  const directoryPath = join(root, datePart, recordingId);
  const manifestPath = join(directoryPath, "manifest.json");

  try {
    await mkdir(directoryPath, { recursive: true });
    const audioFileName = `audio.${sanitizeAudioExtension(input.audioExtension)}`;
    await writeFile(join(directoryPath, audioFileName), input.audioBytes);

    const artifacts: Record<string, string> = { audio: audioFileName, manifest: "manifest.json" };
    await writeTextArtifact(directoryPath, artifacts, "sttPrompt", "stt-prompt.txt", input.sttPrompt);
    if (input.sttReplayContext) {
      await writeJsonArtifact(directoryPath, artifacts, "sttReplayContext", "stt-context.json", input.sttReplayContext);
    }
    await writeTextArtifact(directoryPath, artifacts, "rawTranscript", "raw-transcript.txt", input.rawTranscript);
    if (input.result !== undefined) {
      const finalText = extractFinalText(input.result);
      await writeTextArtifact(directoryPath, artifacts, "finalResult", "final-result.txt", finalText);
      await writeJsonArtifact(directoryPath, artifacts, "resultJson", "result.json", input.result);
    }
    if (input.enhancement) {
      const enhancementDir = join(directoryPath, "enhancement");
      await mkdir(enhancementDir, { recursive: true });
      await writeFile(join(enhancementDir, "system-prompt.txt"), input.enhancement.systemPrompt, "utf-8");
      await writeFile(join(enhancementDir, "user-message.txt"), input.enhancement.userMessage, "utf-8");
      await writeFile(join(enhancementDir, "enhanced-result.txt"), input.enhancement.enhancedText ?? "", "utf-8");
      await writeFile(
        join(enhancementDir, "metadata.json"),
        JSON.stringify(
          {
            model: input.enhancement.model,
            durationMs: input.enhancement.durationMs,
            enhancedTextPresent: input.enhancement.enhancedText !== null,
            ...(input.enhancement.skipReason ? { skipReason: input.enhancement.skipReason } : {}),
          },
          null,
          2,
        ),
        "utf-8",
      );
      artifacts.enhancement = "enhancement/";
    }
    if (input.frontendTiming) {
      await writeJsonArtifact(directoryPath, artifacts, "frontendTiming", "frontend-timing.json", input.frontendTiming);
    }
    if (input.error) {
      await writeJsonArtifact(directoryPath, artifacts, "errorJson", "error.json", input.error);
      await writeTextArtifact(directoryPath, artifacts, "errorText", "error.txt", input.error.message);
    }

    const manifest = {
      version: 1,
      status: input.status,
      recordingId,
      createdAt: Date.now(),
      sessionId: input.sessionId,
      requestId: input.requestId,
      mode: input.mode,
      backend: input.backend,
      sttModel: input.sttModel,
      uploadDurationMs: input.uploadDurationMs,
      sttDurationMs: input.sttDurationMs,
      sttContext: input.sttContext,
      audio: {
        originalFileName: input.audioFileName,
        mimeType: input.audioMimeType,
        sizeBytes: input.audioBytes.length,
        storedFile: audioFileName,
      },
      inputContext: input.inputContext,
      enhancementReplayContext: input.enhancementReplayContext,
      serverTiming: input.serverTiming,
      artifacts,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    return { recordingId, directoryPath, manifestPath, status: input.status };
  } catch (error) {
    return {
      recordingId,
      directoryPath,
      manifestPath,
      status: input.status,
      persistenceError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeTranscriptionRecordingFrontendTiming(
  directoryPath: string | null | undefined,
  timing: unknown,
): Promise<void> {
  if (!directoryPath) return;
  await assertInsideRecordingRoot(directoryPath);
  await writeFile(join(directoryPath, "frontend-timing.json"), JSON.stringify(timing, null, 2), "utf-8");
  await updateManifestArtifacts(directoryPath, { frontendTiming: "frontend-timing.json" });
}

export async function writeTranscriptionReplayVariant(
  sourceDirectoryPath: string,
  input: WriteTranscriptionReplayVariantInput,
): Promise<TranscriptionReplayVariant> {
  await assertInsideRecordingRoot(sourceDirectoryPath);
  const replayRoot = join(sourceDirectoryPath, "replays");
  const id = buildRecordingId(input.kind + "-" + Date.now());
  const directoryPath = join(replayRoot, id);
  await mkdir(directoryPath, { recursive: true });

  const artifacts: Record<string, string> = { manifest: "replays/" + id + "/manifest.json" };
  if (input.sttPrompt) {
    await writeFile(join(directoryPath, "stt-prompt.txt"), input.sttPrompt, "utf-8");
    artifacts.sttPrompt = "replays/" + id + "/stt-prompt.txt";
  }
  if (input.sttReplayContext) {
    await writeFile(join(directoryPath, "stt-context.json"), JSON.stringify(input.sttReplayContext, null, 2), "utf-8");
    artifacts.sttReplayContext = "replays/" + id + "/stt-context.json";
  }
  if (input.rawTranscript !== undefined) {
    await writeFile(join(directoryPath, "raw-transcript.txt"), input.rawTranscript, "utf-8");
    artifacts.rawTranscript = "replays/" + id + "/raw-transcript.txt";
  }
  if (input.enhancementReplayContext) {
    await writeFile(
      join(directoryPath, "enhancement-context.json"),
      JSON.stringify(input.enhancementReplayContext, null, 2),
      "utf-8",
    );
    artifacts.enhancementReplayContext = "replays/" + id + "/enhancement-context.json";
  }
  if (input.systemPrompt !== undefined) {
    await writeFile(join(directoryPath, "system-prompt.txt"), input.systemPrompt, "utf-8");
    artifacts.systemPrompt = "replays/" + id + "/system-prompt.txt";
  }
  if (input.userMessage !== undefined) {
    await writeFile(join(directoryPath, "user-message.txt"), input.userMessage, "utf-8");
    artifacts.userMessage = "replays/" + id + "/user-message.txt";
  }
  if (input.enhancedText !== undefined) {
    await writeFile(join(directoryPath, "enhanced-result.txt"), input.enhancedText ?? "", "utf-8");
    artifacts.enhancedText = "replays/" + id + "/enhanced-result.txt";
  }
  if (input.error) {
    await writeFile(join(directoryPath, "error.json"), JSON.stringify(input.error, null, 2), "utf-8");
    await writeFile(join(directoryPath, "error.txt"), input.error.message, "utf-8");
    artifacts.errorJson = "replays/" + id + "/error.json";
    artifacts.errorText = "replays/" + id + "/error.txt";
  }

  const variant: TranscriptionReplayVariant = {
    id,
    kind: input.kind,
    status: input.status,
    createdAt: Date.now(),
    sourceLogId: input.sourceLogId,
    ...(input.sourceRecordingId ? { sourceRecordingId: input.sourceRecordingId } : {}),
    model: input.model,
    provider: input.provider,
    ...(input.enhancementMode ? { enhancementMode: input.enhancementMode } : {}),
    ...(input.sttReplayContext
      ? {
          sttContext: {
            promptLength: input.sttReplayContext.promptLength,
            keywordCount: input.sttReplayContext.keywords.length,
            droppedKeywordCount: input.sttReplayContext.droppedKeywordCount,
            languageHints: input.sttReplayContext.languageHints,
          },
        }
      : {}),
    ...(input.timing ? { timing: input.timing } : {}),
    ...(input.rawTranscript !== undefined ? { rawTranscript: input.rawTranscript } : {}),
    ...(input.enhancedText !== undefined ? { enhancedText: input.enhancedText } : {}),
    ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.userMessage !== undefined ? { userMessage: input.userMessage } : {}),
    ...(input.sttPrompt !== undefined ? { sttPrompt: input.sttPrompt } : {}),
    ...(input.error ? { error: input.error } : {}),
    artifacts,
  };

  const manifest = { version: 1, ...withoutReplayPayloads(variant), artifacts };
  await writeFile(join(directoryPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  await appendReplayIndex(sourceDirectoryPath, withoutReplayPayloads(variant));
  return variant;
}

export async function readTranscriptionReplayVariants(
  sourceDirectoryPath: string | null | undefined,
): Promise<TranscriptionReplayVariant[]> {
  if (!sourceDirectoryPath) return [];
  await assertInsideRecordingRoot(sourceDirectoryPath);
  const indexPath = join(sourceDirectoryPath, "replays", "index.json");
  let summaries: Array<
    Omit<TranscriptionReplayVariant, "rawTranscript" | "enhancedText" | "systemPrompt" | "userMessage" | "sttPrompt">
  >;
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf-8")) as unknown;
    summaries = Array.isArray(parsed) ? (parsed as typeof summaries) : [];
  } catch {
    return [];
  }
  const variants: TranscriptionReplayVariant[] = [];
  for (const summary of summaries) {
    const artifacts = summary.artifacts ?? {};
    variants.push({
      ...summary,
      artifacts,
      ...(await readOptionalTextArtifact(sourceDirectoryPath, artifacts.rawTranscript, "rawTranscript")),
      ...(await readOptionalTextArtifact(sourceDirectoryPath, artifacts.enhancedText, "enhancedText")),
      ...(await readOptionalTextArtifact(sourceDirectoryPath, artifacts.systemPrompt, "systemPrompt")),
      ...(await readOptionalTextArtifact(sourceDirectoryPath, artifacts.userMessage, "userMessage")),
      ...(await readOptionalTextArtifact(sourceDirectoryPath, artifacts.sttPrompt, "sttPrompt")),
    });
  }
  return variants.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteTranscriptionRecordingDirectory(directoryPath: string): Promise<void> {
  await assertInsideRecordingRoot(directoryPath);
  await rm(directoryPath, { recursive: true, force: true });
}

export function _setTranscriptionRecordingRootForTest(root: string | null): void {
  testRecordingRoot = root;
}

function getTranscriptionRecordingRoot(): string {
  return testRecordingRoot ?? getDefaultTranscriptionRecordingRoot();
}

function buildRecordingId(requestId: string | null): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestPart = requestId ? sanitizePathPart(requestId).slice(0, 80) : randomUUID();
  return `${timestamp}-${requestPart}`;
}

function sanitizePathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "local";
}

function sanitizeAudioExtension(extension: string): string {
  const sanitized = extension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return sanitized || "webm";
}

async function writeTextArtifact(
  directoryPath: string,
  artifacts: Record<string, string>,
  key: string,
  fileName: string,
  content: string | null | undefined,
): Promise<void> {
  if (!content) return;
  await writeFile(join(directoryPath, fileName), content, "utf-8");
  artifacts[key] = fileName;
}

async function writeJsonArtifact(
  directoryPath: string,
  artifacts: Record<string, string>,
  key: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  await writeFile(join(directoryPath, fileName), JSON.stringify(value, null, 2), "utf-8");
  artifacts[key] = fileName;
}

function extractFinalText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

async function assertInsideRecordingRoot(directoryPath: string): Promise<void> {
  const root = resolve(getTranscriptionRecordingRoot());
  const target = resolve(directoryPath);
  const rootRelative = relative(root, target);
  if (rootRelative === "" || rootRelative === ".." || rootRelative.startsWith(`..${sep}`)) {
    throw new Error("Recording path is outside the transcription recording root");
  }
}

function withoutReplayPayloads(
  variant: TranscriptionReplayVariant,
): Omit<TranscriptionReplayVariant, "rawTranscript" | "enhancedText" | "systemPrompt" | "userMessage" | "sttPrompt"> {
  const {
    rawTranscript: _rawTranscript,
    enhancedText: _enhancedText,
    systemPrompt: _systemPrompt,
    userMessage: _userMessage,
    sttPrompt: _sttPrompt,
    ...summary
  } = variant;
  return summary;
}

async function appendReplayIndex(
  sourceDirectoryPath: string,
  summary: Omit<
    TranscriptionReplayVariant,
    "rawTranscript" | "enhancedText" | "systemPrompt" | "userMessage" | "sttPrompt"
  >,
): Promise<void> {
  const indexPath = join(sourceDirectoryPath, "replays", "index.json");
  let existing: (typeof summary)[] = [];
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf-8")) as unknown;
    existing = Array.isArray(parsed) ? (parsed as typeof existing) : [];
  } catch {
    existing = [];
  }
  existing.push(summary);
  await writeFile(indexPath, JSON.stringify(existing, null, 2), "utf-8");
}

async function readOptionalTextArtifact<T extends string>(
  sourceDirectoryPath: string,
  relativePath: string | undefined,
  key: T,
): Promise<Record<T, string> | {}> {
  if (!relativePath) return {};
  const absolutePath = join(sourceDirectoryPath, relativePath);
  await assertInsideRecordingRoot(absolutePath);
  try {
    return { [key]: await readFile(absolutePath, "utf-8") } as Record<T, string>;
  } catch {
    return {};
  }
}

async function updateManifestArtifacts(directoryPath: string, artifacts: Record<string, string>): Promise<void> {
  const manifestPath = join(directoryPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { artifacts?: Record<string, string> };
  manifest.artifacts = { ...manifest.artifacts, ...artifacts };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}
