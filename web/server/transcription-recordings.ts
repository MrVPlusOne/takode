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
      audio: {
        originalFileName: input.audioFileName,
        mimeType: input.audioMimeType,
        sizeBytes: input.audioBytes.length,
        storedFile: audioFileName,
      },
      inputContext: input.inputContext,
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

async function updateManifestArtifacts(directoryPath: string, artifacts: Record<string, string>): Promise<void> {
  const manifestPath = join(directoryPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { artifacts?: Record<string, string> };
  manifest.artifacts = { ...manifest.artifacts, ...artifacts };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}
