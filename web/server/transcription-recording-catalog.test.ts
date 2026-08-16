import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _getTranscriptionRecordingCatalogDiscoveryCountForTest,
  _resetTranscriptionRecordingCatalogForTest,
  getRecentTranscriptionRecordingCatalogPage,
  getTranscriptionRecordingCatalogEntry,
  getTranscriptionRecordingCatalogPage,
  getTranscriptionRecordingKey,
  listTranscriptionRecordingCatalog,
  readTranscriptionRecordingCatalogAudio,
  readTranscriptionRecordingCatalogDetail,
  tombstoneAndDeleteTranscriptionRecording,
  TRANSCRIPTION_RECENT_PAGE_CURSOR,
} from "./transcription-recording-catalog.js";
import {
  _resetTranscriptionLogForTest,
  addTranscriptionLogEntry,
  deleteTranscriptionLogRecording,
  getTranscriptionLogIndexPage,
} from "./transcription-enhancer.js";
import { _setTranscriptionRecordingRootForTest, writeTranscriptionRecording } from "./transcription-recordings.js";
import { TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES } from "./transcription-preview.js";

describe("transcription recording catalog", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "transcription-catalog-"));
    _setTranscriptionRecordingRootForTest(root);
    _resetTranscriptionLogForTest();
    _resetTranscriptionRecordingCatalogForTest();
  });

  afterEach(async () => {
    _resetTranscriptionLogForTest();
    _resetTranscriptionRecordingCatalogForTest();
    _setTranscriptionRecordingRootForTest(null);
    await rm(root, { recursive: true, force: true });
  });

  it("reconstructs stable metadata, detail, audio, and numeric aliases after reset", async () => {
    const written = await writeRecording("restart-source");
    const expectedKey = getTranscriptionRecordingKey(written.directoryPath);

    _resetTranscriptionRecordingCatalogForTest();
    const first = await listTranscriptionRecordingCatalog({ refresh: true });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      recordingKey: expectedKey,
      requestId: "restart-source",
      discoveryState: "ready",
      previewText: "stored transcript",
    });

    const detail = await readTranscriptionRecordingCatalogDetail(expectedKey);
    expect(detail).toMatchObject({
      sttPrompt: "stored prompt",
      rawTranscript: "stored transcript",
      audioAvailable: true,
    });
    await expect(readTranscriptionRecordingCatalogAudio(expectedKey)).resolves.toMatchObject({
      data: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });

    const compatibilityId = first[0].id;
    await expect(getTranscriptionRecordingCatalogEntry(compatibilityId)).resolves.toMatchObject({
      recordingKey: expectedKey,
    });
    _resetTranscriptionRecordingCatalogForTest();
    const second = await listTranscriptionRecordingCatalog({ refresh: true });
    expect(second[0].recordingKey).toBe(expectedKey);
  });

  it("keeps adversarial preview-prefix cases identical before and after restart", async () => {
    const lateUnsafePrefix = "Visible ".padEnd(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES, "x");
    const cases = [
      {
        requestId: "leading-whitespace",
        rawTranscript: `${" ".repeat(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES)}late raw text`,
        enhancedText: undefined,
      },
      {
        requestId: "enhanced-after-prefix",
        rawTranscript: "raw fallback",
        enhancedText: `${" ".repeat(TRANSCRIPTION_PREVIEW_INPUT_MAX_BYTES)}late enhanced text`,
      },
      {
        requestId: "unsafe-after-prefix",
        rawTranscript: `${lateUnsafePrefix} /Users/private/result.txt\u0000`,
        enhancedText: undefined,
      },
    ];
    for (const entry of cases) await addPreviewCase(entry);

    const liveEntries = await getTranscriptionLogIndexPage({ refresh: true });
    const livePreviews = new Map(liveEntries.entries.map((entry) => [entry.requestId, entry.previewText]));

    // Resetting both hot state and the catalog simulates restart discovery from the same isolated artifacts.
    _resetTranscriptionLogForTest();
    _resetTranscriptionRecordingCatalogForTest();
    const restartedEntries = await getTranscriptionLogIndexPage({ refresh: true });
    const restartedPreviews = new Map(restartedEntries.entries.map((entry) => [entry.requestId, entry.previewText]));

    expect(restartedPreviews).toEqual(livePreviews);
    expect(livePreviews.get("leading-whitespace")).toBeUndefined();
    expect(livePreviews.get("enhanced-after-prefix")).toBe("raw fallback");
    expect(livePreviews.get("unsafe-after-prefix")).toEqual(expect.stringMatching(/^Visible x+…$/));
  });

  it("bounds first-open discovery and defers the authoritative archive scan until older records are requested", async () => {
    // Recording directory names are producer-shaped ISO timestamps, so the recent page can discover a bounded newest
    // candidate window without reading preview/enhancement artifacts across the whole durable archive.
    for (let index = 0; index < 45; index += 1) {
      await writeIsoNamedManifest(index);
    }

    const recent = await getRecentTranscriptionRecordingCatalogPage({ limit: 15, refresh: true });
    expect(recent.entries).toHaveLength(15);
    expect(recent.nextCursor).toBe(TRANSCRIPTION_RECENT_PAGE_CURSOR);
    expect(recent.total).toBe(0);
    expect(_getTranscriptionRecordingCatalogDiscoveryCountForTest()).toBe(30);

    // A detail open for an already surfaced recent record should use the bounded snapshot instead of forcing a full scan.
    await expect(getTranscriptionRecordingCatalogEntry(recent.entries[0].recordingKey)).resolves.toBeDefined();
    expect(_getTranscriptionRecordingCatalogDiscoveryCountForTest()).toBe(30);

    const full = await getTranscriptionRecordingCatalogPage({ limit: 50, cursor: recent.nextCursor });
    expect(full.entries).toHaveLength(45);
    expect(full.total).toBe(45);
    expect(full.nextCursor).toBeNull();
    expect(_getTranscriptionRecordingCatalogDiscoveryCountForTest()).toBe(75);
  });

  it("keyset-pages more than fifty records with deterministic timestamp/key ordering", async () => {
    for (let index = 0; index < 55; index += 1) {
      await writeMinimalManifest(index, 10_000 + Math.floor(index / 2));
    }

    const first = await getTranscriptionRecordingCatalogPage({ limit: 50, refresh: true });
    expect(first.entries).toHaveLength(50);
    expect(first.total).toBe(55);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await getTranscriptionRecordingCatalogPage({ limit: 50, cursor: first.nextCursor });
    expect(second.entries).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.recordingKey)).size).toBe(55);

    const sorted = [...first.entries, ...second.entries];
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      expect(
        previous.timestamp > current.timestamp ||
          (previous.timestamp === current.timestamp && previous.recordingKey > current.recordingKey),
      ).toBe(true);
    }
  });

  it("surfaces incomplete, malformed, unsupported, and symlinked entries without following unsafe paths", async () => {
    const dateRoot = join(root, "2026-07-28");
    await mkdir(join(dateRoot, "incomplete"), { recursive: true });
    await mkdir(join(dateRoot, "malformed"), { recursive: true });
    await writeFile(join(dateRoot, "malformed", "manifest.json"), "{not-json", "utf-8");
    await mkdir(join(dateRoot, "unsupported"), { recursive: true });
    await writeFile(join(dateRoot, "unsupported", "manifest.json"), JSON.stringify({ version: 2 }), "utf-8");
    const outside = join(root, "outside-recording");
    await mkdir(outside);
    await symlink(outside, join(dateRoot, "symlinked"));

    const states = (await listTranscriptionRecordingCatalog({ refresh: true })).map((entry) => entry.discoveryState);
    expect(states).toEqual(expect.arrayContaining(["incomplete", "malformed", "unsupported", "unsafe"]));
    for (const entry of await listTranscriptionRecordingCatalog()) {
      if (entry.discoveryState === "ready") continue;
      expect(entry.previewText).toBeUndefined();
      const detail = await readTranscriptionRecordingCatalogDetail(entry.recordingKey);
      expect(detail).toMatchObject({ rawTranscript: "", sttPrompt: "", audioAvailable: false });
    }
  });

  it("keeps traversal artifacts detail-only and unreadable", async () => {
    const directory = join(root, "2026-07-28", "traversal");
    await mkdir(directory, { recursive: true });
    await writeFile(join(root, "outside.txt"), "must not load", "utf-8");
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        version: 1,
        status: "success",
        recordingId: "traversal",
        createdAt: 1,
        backend: "openai",
        sttModel: "legacy",
        audio: { sizeBytes: 0 },
        artifacts: { rawTranscript: "../../outside.txt" },
      }),
      "utf-8",
    );

    const [entry] = await listTranscriptionRecordingCatalog({ refresh: true });
    const detail = await readTranscriptionRecordingCatalogDetail(entry.recordingKey);
    expect(detail?.rawTranscript).toBe("");
  });

  it("loads legacy detail artifacts while exposing only the bounded enhanced preview", async () => {
    const directory = join(root, "2026-07-28", "legacy-v1");
    await mkdir(join(directory, "enhancement"), { recursive: true });
    await writeFile(join(directory, "stt-prompt.txt"), "legacy private prompt", "utf-8");
    await writeFile(join(directory, "raw-transcript.txt"), "legacy private transcript", "utf-8");
    await writeFile(join(directory, "enhancement", "system-prompt.txt"), "legacy system", "utf-8");
    await writeFile(join(directory, "enhancement", "user-message.txt"), "legacy user", "utf-8");
    await writeFile(join(directory, "enhancement", "enhanced-result.txt"), "legacy enhanced result", "utf-8");
    await writeFile(
      join(directory, "enhancement", "metadata.json"),
      JSON.stringify({ model: "legacy-enhancer", durationMs: 12, enhancedTextPresent: true }),
      "utf-8",
    );
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        version: 1,
        status: "success",
        recordingId: "legacy-v1",
        createdAt: 123,
        backend: "openai",
        sttModel: "legacy-stt",
        audio: { sizeBytes: 0 },
        artifacts: {
          sttPrompt: "stt-prompt.txt",
          rawTranscript: "raw-transcript.txt",
          enhancement: "enhancement/",
        },
      }),
      "utf-8",
    );

    const [entry] = await listTranscriptionRecordingCatalog({ refresh: true });
    expect(entry.enhancement).toEqual({
      model: "legacy-enhancer",
      durationMs: 12,
      enhancedTextPresent: true,
    });
    expect(entry.previewText).toBe("legacy enhanced result");
    expect(JSON.stringify(entry)).not.toContain("legacy private transcript");
    const detail = await readTranscriptionRecordingCatalogDetail(entry.recordingKey);
    expect(detail).toMatchObject({
      sttPrompt: "legacy private prompt",
      rawTranscript: "legacy private transcript",
      enhancement: { enhancedText: "legacy enhanced result" },
    });
    expect(detail?.sttReplayContext).toBeUndefined();
    expect(detail?.enhancementReplayContext).toBeUndefined();

    _resetTranscriptionLogForTest();
    const page = await getTranscriptionLogIndexPage({ refresh: true });
    expect(page.entries[0].enhancement).toEqual({
      model: "legacy-enhancer",
      durationMs: 12,
      enhancedTextPresent: true,
    });
    expect(page.entries[0].previewText).toBe("legacy enhanced result");
  });

  it("persists a metadata-only tombstone so deleted directories do not resurrect", async () => {
    const written = await writeRecording("delete-source");
    const [entry] = await listTranscriptionRecordingCatalog({ refresh: true });
    const deleted = await tombstoneAndDeleteTranscriptionRecording(entry);
    expect(deleted).toMatchObject({ discoveryState: "deleted", recordingDeletedAt: expect.any(Number) });
    await expect(access(written.directoryPath)).rejects.toThrow();

    _resetTranscriptionRecordingCatalogForTest();
    const afterRestart = await listTranscriptionRecordingCatalog({ refresh: true });
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]).toMatchObject({ recordingKey: entry.recordingKey, discoveryState: "deleted" });
    expect(afterRestart[0].previewText).toBeUndefined();
    const tombstoneText = await readFile(join(root, ".tombstones", `${entry.recordingKey}.json`), "utf-8");
    expect(tombstoneText).not.toContain("stored transcript");
    expect(tombstoneText).not.toContain("stored prompt");
  });

  it("rejects a symlinked tombstone directory outside the recording root", async () => {
    await writeRecording("symlinked-tombstone-root");
    const outside = await mkdtemp(join(tmpdir(), "transcription-tombstones-outside-"));
    try {
      await symlink(outside, join(root, ".tombstones"));
      await expect(listTranscriptionRecordingCatalog({ refresh: true })).rejects.toThrow(
        /tombstone directory is unsafe/i,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("ignores malformed version-one tombstones and filename/key mismatches", async () => {
    await writeRecording("invalid-tombstone");
    const [entry] = await listTranscriptionRecordingCatalog({ refresh: true });
    const tombstoneRoot = join(root, ".tombstones");
    await mkdir(tombstoneRoot);
    await writeFile(
      join(tombstoneRoot, `${entry.recordingKey}.json`),
      JSON.stringify({ version: 1, recordingKey: entry.recordingKey, recordingId: "bad/id", deletedAt: -1 }),
      "utf-8",
    );
    expect((await listTranscriptionRecordingCatalog({ refresh: true }))[0].discoveryState).toBe("ready");

    await writeFile(
      join(tombstoneRoot, `${entry.recordingKey}.json`),
      JSON.stringify({ ...makeTombstone(entry), recordingKey: "r_bWlzbWF0Y2gvcmVjb3Jk" }),
      "utf-8",
    );
    expect((await listTranscriptionRecordingCatalog({ refresh: true }))[0].discoveryState).toBe("ready");
  });

  it("ignores symlinked tombstone entries even when their payload is otherwise valid", async () => {
    await writeRecording("symlinked-tombstone-entry");
    const [entry] = await listTranscriptionRecordingCatalog({ refresh: true });
    const tombstoneRoot = join(root, ".tombstones");
    await mkdir(tombstoneRoot);
    const outsideDirectory = await mkdtemp(join(tmpdir(), "transcription-tombstone-file-"));
    const outsideFile = join(outsideDirectory, "entry.json");
    try {
      await writeFile(outsideFile, JSON.stringify(makeTombstone(entry)), "utf-8");
      await symlink(outsideFile, join(tombstoneRoot, `${entry.recordingKey}.json`));
      expect((await listTranscriptionRecordingCatalog({ refresh: true }))[0].discoveryState).toBe("ready");
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("drops injected paths from valid tombstones and cannot delete another record", async () => {
    await writeRecording("tombstone-source");
    await writeRecording("protected-source");
    const entries = await listTranscriptionRecordingCatalog({ refresh: true });
    const source = entries.find((entry) => entry.requestId === "tombstone-source")!;
    const protectedEntry = entries.find((entry) => entry.requestId === "protected-source")!;
    const tombstoneRoot = join(root, ".tombstones");
    await mkdir(tombstoneRoot);
    await writeFile(
      join(tombstoneRoot, `${source.recordingKey}.json`),
      JSON.stringify({
        ...makeTombstone(source),
        summary: {
          ...makeTombstone(source).summary,
          directoryPath: protectedEntry.directoryPath,
          manifestPath: protectedEntry.manifestPath,
          error: { message: protectedEntry.directoryPath },
        },
      }),
      "utf-8",
    );

    _resetTranscriptionLogForTest();
    const tombstoned = await getTranscriptionRecordingCatalogEntry(source.recordingKey);
    expect(tombstoned).toMatchObject({ discoveryState: "deleted" });
    expect(tombstoned).not.toHaveProperty("directoryPath");
    expect(tombstoned).not.toHaveProperty("manifestPath");
    await expect(deleteTranscriptionLogRecording(source.recordingKey)).resolves.toBeUndefined();
    await access(protectedEntry.directoryPath!);
  });

  async function writeRecording(requestId: string) {
    return writeTranscriptionRecording({
      status: "success",
      sessionId: "session-1",
      requestId,
      mode: "dictation",
      backend: "openai",
      uploadDurationMs: 12,
      sttModel: "gpt-transcribe",
      sttDurationMs: 34,
      sttPrompt: "stored prompt",
      rawTranscript: "stored transcript",
      audioBytes: Buffer.from([1, 2, 3]),
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioExtension: "wav",
      enhancement: null,
    });
  }

  async function addPreviewCase(input: {
    requestId: string;
    rawTranscript: string;
    enhancedText: string | undefined;
  }): Promise<void> {
    await addTranscriptionLogEntry({
      status: "success",
      sessionId: "session-1",
      requestId: input.requestId,
      mode: "dictation",
      backend: "openai",
      uploadDurationMs: 1,
      sttModel: "gpt-transcribe",
      sttDurationMs: 2,
      rawTranscript: input.rawTranscript,
      audioBytes: Buffer.from([1]),
      audioSizeBytes: 1,
      audioMimeType: "audio/wav",
      audioFileName: "recording.wav",
      audioExtension: "wav",
      sttPrompt: "",
      enhancement:
        input.enhancedText === undefined
          ? null
          : {
              model: "gpt-5-mini",
              systemPrompt: "",
              userMessage: "",
              enhancedText: input.enhancedText,
              durationMs: 3,
            },
      frontendTiming: null,
    });
  }

  async function writeIsoNamedManifest(index: number): Promise<void> {
    const createdAt = Date.UTC(2026, 7, 1, 0, 0, index, 0);
    const directoryName = new Date(createdAt).toISOString().replace(/[:.]/g, "-") + `-request-${index}`;
    const directory = join(root, "2026-08-01", directoryName);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        version: 1,
        status: "success",
        recordingId: directoryName,
        createdAt,
        sessionId: null,
        requestId: `request-${index}`,
        backend: "openai",
        sttModel: "gpt-transcribe",
        uploadDurationMs: index,
        sttDurationMs: index,
        audio: { originalFileName: null, mimeType: null, sizeBytes: 0 },
        artifacts: {},
      }),
      "utf-8",
    );
  }

  async function writeMinimalManifest(index: number, createdAt: number): Promise<void> {
    const directory = join(root, "2026-07-28", `recording-${index.toString().padStart(2, "0")}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        version: 1,
        status: "success",
        recordingId: `recording-${index}`,
        createdAt,
        sessionId: null,
        requestId: `request-${index}`,
        backend: "openai",
        sttModel: "gpt-transcribe",
        uploadDurationMs: index,
        sttDurationMs: index,
        audio: { originalFileName: null, mimeType: null, sizeBytes: 0 },
        artifacts: {},
      }),
      "utf-8",
    );
  }

  function makeTombstone(entry: Awaited<ReturnType<typeof listTranscriptionRecordingCatalog>>[number]) {
    return {
      version: 1,
      recordingKey: entry.recordingKey,
      recordingId: entry.recordingId,
      deletedAt: Date.now(),
      summary: {
        timestamp: entry.timestamp,
        status: entry.status,
        sessionId: entry.sessionId,
        requestId: entry.requestId,
        mode: entry.mode,
        backend: entry.backend,
        uploadDurationMs: entry.uploadDurationMs,
        sttModel: entry.sttModel,
        sttDurationMs: entry.sttDurationMs,
        sttContext: entry.sttContext,
        audioSizeBytes: entry.audioSizeBytes,
        audioMimeType: entry.audioMimeType,
        audioFileName: entry.audioFileName,
        enhancement: entry.enhancement,
      },
    };
  }
});
