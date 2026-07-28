import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  TranscriptionEnhancementReplayContext,
  TranscriptionRecordingStatus,
  TranscriptionSttReplayContext,
} from "./transcription-recordings.js";
import { getTranscriptionRecordingRoot } from "./transcription-recordings.js";

const SCAN_CACHE_MS = 30_000;
const DISCOVERY_CONCURRENCY = 8;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TOMBSTONE_DIRECTORY = ".tombstones";

export type TranscriptionRecordingDiscoveryState =
  | "ready"
  | "incomplete"
  | "malformed"
  | "unsupported"
  | "unsafe"
  | "deleted";

export interface TranscriptionRecordingCatalogEnhancement {
  model: string;
  durationMs: number;
  enhancedTextPresent: boolean;
  skipReason?: string;
}

export interface TranscriptionRecordingCatalogEntry {
  id: number;
  recordingKey: string;
  recordingId: string;
  timestamp: number;
  status: TranscriptionRecordingStatus;
  sessionId: string | null;
  requestId: string | null;
  mode?: "dictation" | "edit" | "append";
  backend: string;
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
  audioMimeType: string | null;
  audioFileName: string | null;
  serverTiming?: unknown;
  enhancement: TranscriptionRecordingCatalogEnhancement | null;
  error?: { message: string; phase?: string };
  discoveryState: TranscriptionRecordingDiscoveryState;
  discoveryIssue?: string;
  directoryPath?: string;
  manifestPath?: string;
  recordingDeletedAt?: number;
  deletionError?: string;
}

export interface TranscriptionRecordingCatalogDetail {
  entry: TranscriptionRecordingCatalogEntry;
  sttPrompt: string;
  rawTranscript: string;
  sttReplayContext?: TranscriptionSttReplayContext;
  enhancementReplayContext?: TranscriptionEnhancementReplayContext;
  frontendTiming?: unknown;
  enhancement: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    enhancedText: string | null;
    durationMs: number;
    skipReason?: string;
  } | null;
  audioAvailable: boolean;
  audioStoredFile?: string;
}

export interface TranscriptionRecordingCatalogPage {
  entries: TranscriptionRecordingCatalogEntry[];
  nextCursor: string | null;
  total: number;
}

interface RecordingManifest {
  version?: unknown;
  status?: unknown;
  recordingId?: unknown;
  createdAt?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  mode?: unknown;
  backend?: unknown;
  sttModel?: unknown;
  uploadDurationMs?: unknown;
  sttDurationMs?: unknown;
  sttContext?: unknown;
  audio?: unknown;
  serverTiming?: unknown;
  enhancementReplayContext?: unknown;
  artifacts?: unknown;
}

interface RecordingTombstone {
  version: 1;
  recordingKey: string;
  recordingId: string;
  deletedAt: number;
  deletionError?: string;
  summary: Omit<
    TranscriptionRecordingCatalogEntry,
    | "id"
    | "recordingKey"
    | "recordingId"
    | "directoryPath"
    | "manifestPath"
    | "discoveryState"
    | "discoveryIssue"
    | "recordingDeletedAt"
    | "deletionError"
  >;
}

let catalogSnapshot = new Map<string, TranscriptionRecordingCatalogEntry>();
let catalogScanPromise: Promise<Map<string, TranscriptionRecordingCatalogEntry>> | null = null;
let catalogScannedAt = 0;
let compatibilityIdCounter = 0;
const compatibilityIdByKey = new Map<string, number>();
const keyByCompatibilityId = new Map<number, string>();

export function getTranscriptionRecordingKey(directoryPath: string): string {
  const root = resolve(getTranscriptionRecordingRoot());
  const target = resolve(directoryPath);
  const rootRelative = relative(root, target);
  if (!isContainedRelativePath(rootRelative)) {
    throw new Error("Recording path is outside the transcription recording root");
  }
  const normalized = rootRelative.split(sep).join("/");
  return `r_${Buffer.from(normalized, "utf-8").toString("base64url")}`;
}

export function registerTranscriptionRecordingCompatibilityId(recordingKey: string, id: number): void {
  const existingKey = keyByCompatibilityId.get(id);
  if (existingKey && existingKey !== recordingKey) {
    throw new Error(`Transcription log compatibility ID ${id} is already registered`);
  }
  const existingId = compatibilityIdByKey.get(recordingKey);
  if (existingId !== undefined && existingId !== id) keyByCompatibilityId.delete(existingId);
  compatibilityIdByKey.set(recordingKey, id);
  keyByCompatibilityId.set(id, recordingKey);
  compatibilityIdCounter = Math.max(compatibilityIdCounter, id);
}

export function getTranscriptionRecordingCompatibilityId(recordingKey: string): number {
  return getOrCreateCompatibilityId(recordingKey);
}

export async function listTranscriptionRecordingCatalog(options?: {
  refresh?: boolean;
}): Promise<TranscriptionRecordingCatalogEntry[]> {
  await ensureCatalogScanned(Boolean(options?.refresh));
  return sortCatalogEntries([...catalogSnapshot.values()]);
}

export async function getTranscriptionRecordingCatalogPage(options?: {
  limit?: number;
  cursor?: string | null;
  refresh?: boolean;
}): Promise<TranscriptionRecordingCatalogPage> {
  const all = await listTranscriptionRecordingCatalog({ refresh: options?.refresh });
  const limit = Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 50)));
  const cursor = decodeCursor(options?.cursor);
  const eligible = cursor
    ? all.filter(
        (entry) =>
          entry.timestamp < cursor.timestamp ||
          (entry.timestamp === cursor.timestamp && entry.recordingKey < cursor.recordingKey),
      )
    : all;
  const entries = eligible.slice(0, limit);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: eligible.length > entries.length && last ? encodeCursor(last) : null,
    total: all.length,
  };
}

export async function getTranscriptionRecordingCatalogEntry(
  locator: string | number,
): Promise<TranscriptionRecordingCatalogEntry | undefined> {
  await ensureCatalogScanned(false);
  const key = resolveLocatorToKey(locator);
  return key ? catalogSnapshot.get(key) : undefined;
}

export async function readTranscriptionRecordingCatalogDetail(
  locator: string | number,
): Promise<TranscriptionRecordingCatalogDetail | undefined> {
  const entry = await getTranscriptionRecordingCatalogEntry(locator);
  if (!entry) return undefined;
  if (entry.discoveryState !== "ready" || !entry.directoryPath || !entry.manifestPath) {
    return {
      entry,
      sttPrompt: "",
      rawTranscript: "",
      enhancement: null,
      audioAvailable: false,
    };
  }

  const manifest = await readManifest(entry.directoryPath);
  if (!manifest) return { entry, sttPrompt: "", rawTranscript: "", enhancement: null, audioAvailable: false };
  const artifacts = normalizeArtifacts(manifest.artifacts);
  const audioStoredFile = getAudioStoredFile(manifest, artifacts);
  const audioPath = audioStoredFile
    ? await resolveSafeArtifactPath(entry.directoryPath, audioStoredFile, "file")
    : undefined;
  const sttPrompt = await readOptionalText(entry.directoryPath, artifacts.sttPrompt);
  const rawTranscript = await readOptionalText(entry.directoryPath, artifacts.rawTranscript);
  const sttReplayContext = normalizeSttReplayContext(
    await readOptionalJson(entry.directoryPath, artifacts.sttReplayContext),
  );
  const enhancementReplayContext = normalizeEnhancementReplayContext(manifest.enhancementReplayContext);
  const frontendTiming = await readOptionalJson(entry.directoryPath, artifacts.frontendTiming);
  const enhancement = await readEnhancementDetail(entry.directoryPath, artifacts.enhancement);

  return {
    entry,
    sttPrompt,
    rawTranscript,
    ...(sttReplayContext ? { sttReplayContext } : {}),
    ...(enhancementReplayContext ? { enhancementReplayContext } : {}),
    ...(frontendTiming !== undefined ? { frontendTiming } : {}),
    enhancement,
    audioAvailable: Boolean(audioPath),
    ...(audioStoredFile ? { audioStoredFile } : {}),
  };
}

export async function readTranscriptionRecordingCatalogAudio(
  locator: string | number,
): Promise<{ data: Buffer; mimeType: string; fileName: string | null } | undefined> {
  const detail = await readTranscriptionRecordingCatalogDetail(locator);
  if (!detail?.entry.directoryPath || !detail.audioStoredFile || !detail.audioAvailable) return undefined;
  const audioPath = await resolveSafeArtifactPath(detail.entry.directoryPath, detail.audioStoredFile, "file");
  if (!audioPath) return undefined;
  return {
    data: await readFile(audioPath),
    mimeType: detail.entry.audioMimeType || "application/octet-stream",
    fileName: detail.entry.audioFileName,
  };
}

export async function tombstoneAndDeleteTranscriptionRecording(
  entry: TranscriptionRecordingCatalogEntry,
): Promise<TranscriptionRecordingCatalogEntry> {
  if (!entry.directoryPath) throw new Error("Recording directory is not available");
  await assertSafeRecordDirectory(entry.directoryPath);
  const deletedAt = Date.now();
  const tombstone = buildTombstone(entry, deletedAt);
  await writeTombstone(tombstone);
  try {
    await rm(entry.directoryPath, { recursive: true, force: true });
  } catch (error) {
    tombstone.deletionError = error instanceof Error ? error.message : String(error);
    await writeTombstone(tombstone);
    const deletedEntry = catalogEntryFromTombstone(tombstone);
    catalogSnapshot.set(entry.recordingKey, deletedEntry);
    throw error;
  }
  const deletedEntry = catalogEntryFromTombstone(tombstone);
  catalogSnapshot.set(entry.recordingKey, deletedEntry);
  return deletedEntry;
}

export function invalidateTranscriptionRecordingCatalog(): void {
  catalogScannedAt = 0;
}

export function upsertTranscriptionRecordingCatalogEntry(entry: TranscriptionRecordingCatalogEntry): void {
  catalogSnapshot.set(entry.recordingKey, entry);
}

export function _resetTranscriptionRecordingCatalogForTest(): void {
  catalogSnapshot = new Map();
  catalogScanPromise = null;
  catalogScannedAt = 0;
  compatibilityIdCounter = 0;
  compatibilityIdByKey.clear();
  keyByCompatibilityId.clear();
}

async function ensureCatalogScanned(refresh: boolean): Promise<void> {
  if (!refresh && catalogScannedAt > 0 && Date.now() - catalogScannedAt < SCAN_CACHE_MS) return;
  if (!catalogScanPromise) {
    catalogScanPromise = scanCatalog().finally(() => {
      catalogScanPromise = null;
    });
  }
  catalogSnapshot = await catalogScanPromise;
  catalogScannedAt = Date.now();
}

async function scanCatalog(): Promise<Map<string, TranscriptionRecordingCatalogEntry>> {
  const root = resolve(getTranscriptionRecordingRoot());
  const rootEntries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (rootEntries.length === 0) return new Map();
  const realRoot = await realpath(root);
  const relativeDirectories: string[] = [];
  for (const dateEntry of rootEntries) {
    if (!dateEntry.isDirectory() || dateEntry.name.startsWith(".")) continue;
    const datePath = join(root, dateEntry.name);
    const recordingEntries = await readdir(datePath, { withFileTypes: true }).catch(() => []);
    for (const recordingEntry of recordingEntries) {
      if (recordingEntry.name.startsWith(".")) continue;
      relativeDirectories.push(join(dateEntry.name, recordingEntry.name));
    }
  }
  relativeDirectories.sort();
  const discovered = await mapWithConcurrency(relativeDirectories, DISCOVERY_CONCURRENCY, async (rootRelative) =>
    discoverDirectory(root, realRoot, rootRelative),
  );
  const snapshot = new Map<string, TranscriptionRecordingCatalogEntry>();
  for (const entry of discovered) {
    if (entry) snapshot.set(entry.recordingKey, entry);
  }
  const tombstones = await readTombstones(root);
  for (const tombstone of tombstones) snapshot.set(tombstone.recordingKey, tombstone);
  return snapshot;
}

async function discoverDirectory(
  root: string,
  realRoot: string,
  rootRelative: string,
): Promise<TranscriptionRecordingCatalogEntry | undefined> {
  const directoryPath = resolve(root, rootRelative);
  const recordingKey = getTranscriptionRecordingKey(directoryPath);
  const id = getOrCreateCompatibilityId(recordingKey);
  const fallbackTimestamp = deriveTimestamp(rootRelative);
  const unsafe = await validateDirectoryRealPath(directoryPath, realRoot);
  if (!unsafe.ok) {
    return createIssueEntry({
      id,
      recordingKey,
      recordingId: basename(directoryPath),
      timestamp: fallbackTimestamp,
      discoveryState: "unsafe",
      discoveryIssue: unsafe.issue,
    });
  }

  const manifestPath = join(directoryPath, "manifest.json");
  const manifestRead = await readJsonFile<RecordingManifest>(manifestPath);
  if (!manifestRead.ok) {
    return createIssueEntry({
      id,
      recordingKey,
      recordingId: basename(directoryPath),
      timestamp: fallbackTimestamp,
      directoryPath,
      manifestPath,
      discoveryState: manifestRead.missing ? "incomplete" : "malformed",
      discoveryIssue: manifestRead.issue,
    });
  }
  const manifest = manifestRead.value;
  if (manifest.version !== 1) {
    return createIssueEntry({
      id,
      recordingKey,
      recordingId: normalizeRecordingId(manifest.recordingId, basename(directoryPath)),
      timestamp: asFiniteNumber(manifest.createdAt) ?? fallbackTimestamp,
      directoryPath,
      manifestPath,
      discoveryState: "unsupported",
      discoveryIssue: `Unsupported recording manifest version: ${String(manifest.version ?? "missing")}`,
    });
  }
  const artifacts = normalizeArtifacts(manifest.artifacts);
  const enhancement = await readEnhancementSummary(directoryPath, artifacts.enhancement);
  const error = await readOptionalJson<{ message?: unknown; phase?: unknown }>(directoryPath, artifacts.errorJson);
  const audio = normalizeAudio(manifest.audio);
  return {
    id,
    recordingKey,
    recordingId: normalizeRecordingId(manifest.recordingId, basename(directoryPath)),
    timestamp: asFiniteNumber(manifest.createdAt) ?? fallbackTimestamp,
    status: manifest.status === "error" ? "error" : "success",
    sessionId: typeof manifest.sessionId === "string" ? manifest.sessionId : null,
    requestId: typeof manifest.requestId === "string" ? manifest.requestId : null,
    ...(normalizeMode(manifest.mode) ? { mode: normalizeMode(manifest.mode) } : {}),
    backend: asString(manifest.backend) || "unknown",
    uploadDurationMs: asFiniteNumber(manifest.uploadDurationMs) ?? 0,
    sttModel: asString(manifest.sttModel) || "unknown",
    sttDurationMs: asFiniteNumber(manifest.sttDurationMs) ?? 0,
    ...(normalizeSttContext(manifest.sttContext) ? { sttContext: normalizeSttContext(manifest.sttContext) } : {}),
    audioSizeBytes: audio.sizeBytes,
    audioMimeType: audio.mimeType,
    audioFileName: audio.originalFileName,
    ...(manifest.serverTiming !== undefined ? { serverTiming: manifest.serverTiming } : {}),
    enhancement,
    ...(typeof error?.message === "string"
      ? { error: { message: error.message, ...(typeof error.phase === "string" ? { phase: error.phase } : {}) } }
      : {}),
    discoveryState: "ready",
    directoryPath,
    manifestPath,
  };
}

function createIssueEntry(input: {
  id: number;
  recordingKey: string;
  recordingId: string;
  timestamp: number;
  directoryPath?: string;
  manifestPath?: string;
  discoveryState: Exclude<TranscriptionRecordingDiscoveryState, "ready" | "deleted">;
  discoveryIssue: string;
}): TranscriptionRecordingCatalogEntry {
  return {
    ...input,
    status: "error",
    sessionId: null,
    requestId: null,
    backend: "unknown",
    uploadDurationMs: 0,
    sttModel: "unknown",
    sttDurationMs: 0,
    audioSizeBytes: 0,
    audioMimeType: null,
    audioFileName: null,
    enhancement: null,
    error: { message: input.discoveryIssue, phase: "discovery" },
  };
}

async function readEnhancementSummary(
  directoryPath: string,
  enhancementRelativePath: string | undefined,
): Promise<TranscriptionRecordingCatalogEnhancement | null> {
  if (!enhancementRelativePath) return null;
  const metadata = await readOptionalJson<Record<string, unknown>>(
    directoryPath,
    join(enhancementRelativePath, "metadata.json"),
  );
  if (!metadata) return null;
  return {
    model: asString(metadata.model) || "unknown",
    durationMs: asFiniteNumber(metadata.durationMs) ?? 0,
    enhancedTextPresent: metadata.enhancedTextPresent === true,
    ...(typeof metadata.skipReason === "string" ? { skipReason: metadata.skipReason } : {}),
  };
}

async function readEnhancementDetail(
  directoryPath: string,
  enhancementRelativePath: string | undefined,
): Promise<TranscriptionRecordingCatalogDetail["enhancement"]> {
  const summary = await readEnhancementSummary(directoryPath, enhancementRelativePath);
  if (!summary || !enhancementRelativePath) return null;
  return {
    model: summary.model,
    systemPrompt: await readOptionalText(directoryPath, join(enhancementRelativePath, "system-prompt.txt")),
    userMessage: await readOptionalText(directoryPath, join(enhancementRelativePath, "user-message.txt")),
    enhancedText: summary.enhancedTextPresent
      ? await readOptionalText(directoryPath, join(enhancementRelativePath, "enhanced-result.txt"))
      : null,
    durationMs: summary.durationMs,
    ...(summary.skipReason ? { skipReason: summary.skipReason } : {}),
  };
}

async function readManifest(directoryPath: string): Promise<RecordingManifest | undefined> {
  const result = await readJsonFile<RecordingManifest>(join(directoryPath, "manifest.json"));
  return result.ok && result.value.version === 1 ? result.value : undefined;
}

async function readOptionalText(directoryPath: string, relativePath: string | undefined): Promise<string> {
  if (!relativePath) return "";
  const artifactPath = await resolveSafeArtifactPath(directoryPath, relativePath, "file");
  if (!artifactPath) return "";
  const info = await stat(artifactPath).catch(() => null);
  if (!info || info.size > MAX_TEXT_BYTES) return "";
  return readFile(artifactPath, "utf-8").catch(() => "");
}

async function readOptionalJson<T = unknown>(
  directoryPath: string,
  relativePath: string | undefined,
): Promise<T | undefined> {
  if (!relativePath) return undefined;
  const artifactPath = await resolveSafeArtifactPath(directoryPath, relativePath, "file");
  if (!artifactPath) return undefined;
  const result = await readJsonFile<T>(artifactPath);
  return result.ok ? result.value : undefined;
}

async function resolveSafeArtifactPath(
  directoryPath: string,
  artifactRelativePath: string,
  expected: "file" | "directory",
): Promise<string | undefined> {
  if (!artifactRelativePath || isAbsolute(artifactRelativePath)) return undefined;
  const recordRoot = resolve(directoryPath);
  const candidate = resolve(recordRoot, artifactRelativePath);
  const recordRelative = relative(recordRoot, candidate);
  if (!isContainedRelativePath(recordRelative)) return undefined;
  const info = await lstat(candidate).catch(() => null);
  if (!info || info.isSymbolicLink()) return undefined;
  if (expected === "file" && !info.isFile()) return undefined;
  if (expected === "directory" && !info.isDirectory()) return undefined;
  const realCandidate = await realpath(candidate).catch(() => null);
  const realRecordRoot = await realpath(recordRoot).catch(() => null);
  if (!realCandidate || !realRecordRoot) return undefined;
  const realRelative = relative(realRecordRoot, realCandidate);
  return isContainedRelativePath(realRelative) ? realCandidate : undefined;
}

async function assertSafeRecordDirectory(directoryPath: string): Promise<void> {
  const root = resolve(getTranscriptionRecordingRoot());
  const rootRelative = relative(root, resolve(directoryPath));
  if (!isContainedRelativePath(rootRelative))
    throw new Error("Recording path is outside the transcription recording root");
  const realRoot = await realpath(root);
  const validation = await validateDirectoryRealPath(directoryPath, realRoot);
  if (!validation.ok) throw new Error(validation.issue);
}

async function validateDirectoryRealPath(
  directoryPath: string,
  realRoot: string,
): Promise<{ ok: true } | { ok: false; issue: string }> {
  const info = await lstat(directoryPath).catch(() => null);
  if (!info) return { ok: false, issue: "Recording directory is missing" };
  if (info.isSymbolicLink()) return { ok: false, issue: "Symlinked recording directories are not supported" };
  if (!info.isDirectory()) return { ok: false, issue: "Recording entry is not a directory" };
  const target = await realpath(directoryPath).catch(() => null);
  if (!target) return { ok: false, issue: "Recording directory cannot be resolved" };
  const realRelative = relative(realRoot, target);
  if (!isContainedRelativePath(realRelative))
    return { ok: false, issue: "Recording directory escapes the recording root" };
  return { ok: true };
}

function isContainedRelativePath(value: string): boolean {
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

async function readJsonFile<T>(
  filePath: string,
): Promise<{ ok: true; value: T } | { ok: false; missing: boolean; issue: string }> {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      return { ok: false, missing: false, issue: "Artifact is not a regular file" };
    }
    if (info.size > MAX_JSON_BYTES) return { ok: false, missing: false, issue: "JSON artifact is too large" };
    return { ok: true, value: JSON.parse(await readFile(filePath, "utf-8")) as T };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      missing: code === "ENOENT",
      issue: code === "ENOENT" ? "Recording manifest is missing" : "Recording manifest is malformed or unreadable",
    };
  }
}

async function readTombstones(root: string): Promise<TranscriptionRecordingCatalogEntry[]> {
  const tombstoneRoot = join(root, TOMBSTONE_DIRECTORY);
  const files = await readdir(tombstoneRoot, { withFileTypes: true }).catch(() => []);
  const tombstones = await mapWithConcurrency(files, DISCOVERY_CONCURRENCY, async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return undefined;
    const parsed = await readJsonFile<RecordingTombstone>(join(tombstoneRoot, entry.name));
    if (!parsed.ok || parsed.value.version !== 1) return undefined;
    return catalogEntryFromTombstone(parsed.value);
  });
  return tombstones.filter((entry): entry is TranscriptionRecordingCatalogEntry => Boolean(entry));
}

function buildTombstone(entry: TranscriptionRecordingCatalogEntry, deletedAt: number): RecordingTombstone {
  const {
    id: _id,
    recordingKey: _recordingKey,
    recordingId: _recordingId,
    directoryPath: _directoryPath,
    manifestPath: _manifestPath,
    discoveryState: _discoveryState,
    discoveryIssue: _discoveryIssue,
    recordingDeletedAt: _recordingDeletedAt,
    deletionError: _deletionError,
    ...summary
  } = entry;
  return {
    version: 1,
    recordingKey: entry.recordingKey,
    recordingId: entry.recordingId,
    deletedAt,
    summary,
  };
}

function catalogEntryFromTombstone(tombstone: RecordingTombstone): TranscriptionRecordingCatalogEntry {
  return {
    ...tombstone.summary,
    id: getOrCreateCompatibilityId(tombstone.recordingKey),
    recordingKey: tombstone.recordingKey,
    recordingId: tombstone.recordingId,
    discoveryState: "deleted",
    discoveryIssue: tombstone.deletionError || "Source recording was deleted",
    recordingDeletedAt: tombstone.deletedAt,
    ...(tombstone.deletionError ? { deletionError: tombstone.deletionError } : {}),
  };
}

async function writeTombstone(tombstone: RecordingTombstone): Promise<void> {
  const root = resolve(getTranscriptionRecordingRoot());
  const tombstoneRoot = join(root, TOMBSTONE_DIRECTORY);
  await mkdir(tombstoneRoot, { recursive: true });
  const tombstoneInfo = await lstat(tombstoneRoot);
  if (tombstoneInfo.isSymbolicLink() || !tombstoneInfo.isDirectory()) {
    throw new Error("Transcription tombstone directory is unsafe");
  }
  const realRoot = await realpath(root);
  const realTombstoneRoot = await realpath(tombstoneRoot);
  if (!isContainedRelativePath(relative(realRoot, realTombstoneRoot))) {
    throw new Error("Transcription tombstone directory escapes the recording root");
  }
  const target = join(tombstoneRoot, `${tombstone.recordingKey}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(tombstone, null, 2), "utf-8");
  await rename(temporary, target);
}

function getOrCreateCompatibilityId(recordingKey: string): number {
  const existing = compatibilityIdByKey.get(recordingKey);
  if (existing !== undefined) return existing;
  let id = ++compatibilityIdCounter;
  while (keyByCompatibilityId.has(id)) id = ++compatibilityIdCounter;
  registerTranscriptionRecordingCompatibilityId(recordingKey, id);
  return id;
}

function resolveLocatorToKey(locator: string | number): string | undefined {
  if (typeof locator === "number") return keyByCompatibilityId.get(locator);
  if (locator.startsWith("r_")) return locator;
  const numeric = Number(locator);
  return Number.isInteger(numeric) && numeric > 0 ? keyByCompatibilityId.get(numeric) : undefined;
}

function sortCatalogEntries(entries: TranscriptionRecordingCatalogEntry[]): TranscriptionRecordingCatalogEntry[] {
  return entries.sort(
    (a, b) =>
      b.timestamp - a.timestamp || (a.recordingKey === b.recordingKey ? 0 : a.recordingKey < b.recordingKey ? 1 : -1),
  );
}

function encodeCursor(entry: Pick<TranscriptionRecordingCatalogEntry, "timestamp" | "recordingKey">): string {
  return Buffer.from(JSON.stringify([entry.timestamp, entry.recordingKey]), "utf-8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): { timestamp: number; recordingKey: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [timestamp, recordingKey] = parsed;
    return typeof timestamp === "number" && typeof recordingKey === "string" ? { timestamp, recordingKey } : null;
  } catch {
    return null;
  }
}

function normalizeArtifacts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeAudio(value: unknown): {
  originalFileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  storedFile?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { originalFileName: null, mimeType: null, sizeBytes: 0 };
  }
  const audio = value as Record<string, unknown>;
  return {
    originalFileName: typeof audio.originalFileName === "string" ? audio.originalFileName : null,
    mimeType: typeof audio.mimeType === "string" ? audio.mimeType : null,
    sizeBytes: asFiniteNumber(audio.sizeBytes) ?? 0,
    ...(typeof audio.storedFile === "string" ? { storedFile: audio.storedFile } : {}),
  };
}

function getAudioStoredFile(manifest: RecordingManifest, artifacts: Record<string, string>): string | undefined {
  return artifacts.audio || normalizeAudio(manifest.audio).storedFile;
}

function normalizeMode(value: unknown): "dictation" | "edit" | "append" | undefined {
  return value === "dictation" || value === "edit" || value === "append" ? value : undefined;
}

function normalizeSttContext(value: unknown): TranscriptionRecordingCatalogEntry["sttContext"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const context = value as Record<string, unknown>;
  return {
    promptLength: asFiniteNumber(context.promptLength) ?? 0,
    keywordCount: asFiniteNumber(context.keywordCount) ?? 0,
    droppedKeywordCount: asFiniteNumber(context.droppedKeywordCount) ?? 0,
    languageHints: Array.isArray(context.languageHints)
      ? context.languageHints.filter((hint): hint is string => typeof hint === "string")
      : [],
  };
}

function normalizeEnhancementReplayContext(value: unknown): TranscriptionEnhancementReplayContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const context = value as Partial<TranscriptionEnhancementReplayContext>;
  if (context.version !== 1 || typeof context.model !== "string" || typeof context.conversationContext !== "string") {
    return undefined;
  }
  return context as TranscriptionEnhancementReplayContext;
}

function normalizeSttReplayContext(value: unknown): TranscriptionSttReplayContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const context = value as Partial<TranscriptionSttReplayContext>;
  if (
    context.version !== 1 ||
    typeof context.backend !== "string" ||
    typeof context.model !== "string" ||
    typeof context.prompt !== "string" ||
    typeof context.promptLength !== "number" ||
    typeof context.usesGptTranscribeContext !== "boolean" ||
    typeof context.promptIncludesCustomVocabulary !== "boolean" ||
    !Array.isArray(context.keywords) ||
    !context.keywords.every((keyword) => typeof keyword === "string") ||
    typeof context.droppedKeywordCount !== "number" ||
    !Array.isArray(context.languageHints) ||
    !context.languageHints.every((hint) => typeof hint === "string")
  ) {
    return undefined;
  }
  return context as TranscriptionSttReplayContext;
}

function deriveTimestamp(rootRelative: string): number {
  const recordingName = basename(rootRelative);
  const match = recordingName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (match) {
    const parsed = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const date = Date.parse(dirname(rootRelative));
  return Number.isFinite(date) ? date : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeRecordingId(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,200}$/.test(value) ? value : fallback;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
