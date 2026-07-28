import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import type { TranscriptionLogIndexEntry, TranscriptionLogEntry, TranscriptionReplayVariant } from "../api.js";

const REPLAY_STT_MODELS = [
  "gpt-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
];

function timeAgo(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function resolveAbsoluteUrl(path: string): string {
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

function enhancementLabel(entry: TranscriptionLogIndexEntry): string {
  if (!entry.enhancement) return "STT only";
  if (entry.enhancement.skipReason) return `skipped: ${entry.enhancement.skipReason}`;
  if (entry.enhancement.enhancedTextPresent) return "enhanced";
  return "failed";
}

function enhancementColor(entry: TranscriptionLogIndexEntry): string {
  if (!entry.enhancement) return "text-cc-muted";
  if (entry.enhancement.skipReason) return "text-cc-warning";
  if (entry.enhancement.enhancedTextPresent) return "text-cc-success";
  return "text-cc-error";
}

function statusLabel(entry: TranscriptionLogIndexEntry): string {
  if (entry.recordingDeletedAt || entry.discoveryState === "deleted") return "deleted";
  if (entry.recordingStatus === "error" || entry.status === "error")
    return `failed: ${entry.error?.message ?? "error"}`;
  return enhancementLabel(entry);
}

function statusColor(entry: TranscriptionLogIndexEntry): string {
  if (entry.recordingDeletedAt || entry.discoveryState === "deleted") return "text-cc-warning";
  if (entry.recordingStatus === "error" || entry.status === "error") return "text-cc-error";
  return enhancementColor(entry);
}

function replayKindLabel(kind: TranscriptionReplayVariant["kind"]): string {
  return kind === "stt_replay" ? "Re-transcribe" : "Re-enhance";
}

function originalEnhancementComparisonText(entry: TranscriptionLogEntry): string {
  if (!entry.enhancement) return "Original enhancement was not attempted.";
  if (entry.enhancement.enhancedText) return entry.enhancement.enhancedText;
  if (entry.enhancement.skipReason) return "(skipped: " + entry.enhancement.skipReason + ")";
  return "(null — skipped, failed, or hallucination guard)";
}

export function TranscriptionDebugPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TranscriptionLogIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalEntries, setTotalEntries] = useState(0);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<TranscriptionLogEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedAudioUrl, setCopiedAudioUrl] = useState(false);
  const [copiedRecordingPath, setCopiedRecordingPath] = useState(false);
  const [recordingActionError, setRecordingActionError] = useState("");
  const [openingRecording, setOpeningRecording] = useState(false);
  const [deletingRecording, setDeletingRecording] = useState(false);
  const [replaySttModel, setReplaySttModel] = useState("gpt-transcribe");
  const [replayEnhancementModel, setReplayEnhancementModel] = useState("gpt-5-mini");
  const [replayEnhancementMode, setReplayEnhancementMode] = useState<"default" | "bullet">("default");
  const [replayRunning, setReplayRunning] = useState<"stt" | "enhancement" | null>(null);
  const [replayError, setReplayError] = useState("");

  const fetchIndex = useCallback(
    (append = false, refresh = false) => {
      setLoading(true);
      setError("");
      api
        .getTranscriptionLogs(append ? nextCursor : null, refresh)
        .then((data) => {
          setEntries((current) => {
            if (!append) return data.entries;
            const byKey = new Map(current.map((entry) => [entry.recordingKey ?? String(entry.id), entry]));
            for (const entry of data.entries) byKey.set(entry.recordingKey ?? String(entry.id), entry);
            return [...byKey.values()];
          });
          setNextCursor(data.nextCursor);
          setTotalEntries(data.total);
          setFetched(true);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [nextCursor],
  );

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !fetched) fetchIndex(false, false);
  };

  const handleToggle = async (id: string | number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedEntry(null);
      setCopiedAudioUrl(false);
      setCopiedRecordingPath(false);
      setRecordingActionError("");
      setReplayError("");
      return;
    }
    setExpandedId(id);
    setExpandedEntry(null);
    setCopiedAudioUrl(false);
    setCopiedRecordingPath(false);
    setRecordingActionError("");
    setReplayError("");
    setDetailLoading(true);
    try {
      const entry = await api.getTranscriptionLogEntry(id);
      setExpandedEntry(entry);
    } catch {
      setExpandedEntry(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const selectedIndexEntry = expandedId !== null ? entries.find((e) => (e.recordingKey ?? e.id) === expandedId) : null;
  const audioUrl = expandedEntry?.audioUrl ? resolveAbsoluteUrl(expandedEntry.audioUrl) : null;
  const recordingPath = expandedEntry?.recordingDirectoryPath ?? null;

  useEffect(() => {
    if (!expandedEntry) return;
    setReplaySttModel(expandedEntry.sttModel || "gpt-transcribe");
    setReplayEnhancementModel(expandedEntry.enhancement?.model || "gpt-5-mini");
    setReplayEnhancementMode("default");
  }, [expandedEntry?.id]);

  const updateEntry = (entry: TranscriptionLogEntry) => {
    setExpandedEntry(entry);
    const locator = entry.recordingKey ?? entry.id;
    setEntries((current) =>
      current.map((item) =>
        (item.recordingKey ?? item.id) === locator
          ? {
              ...item,
              status: entry.status,
              recordingStatus: entry.recordingStatus,
              recordingDeletedAt: entry.recordingDeletedAt,
              recordingPersistenceError: entry.recordingPersistenceError,
              discoveryState: entry.discoveryState,
              discoveryIssue: entry.discoveryIssue,
              error: entry.error,
              enhancement: entry.enhancement
                ? {
                    model: entry.enhancement.model,
                    durationMs: entry.enhancement.durationMs,
                    enhancedTextPresent: entry.enhancement.enhancedText !== null,
                    ...(entry.enhancement.skipReason ? { skipReason: entry.enhancement.skipReason } : {}),
                  }
                : null,
            }
          : item,
      ),
    );
  };

  const copyRecordingPath = () => {
    if (!recordingPath || !navigator.clipboard) return;
    void navigator.clipboard
      .writeText(recordingPath)
      .then(() => {
        setCopiedRecordingPath(true);
        setRecordingActionError("");
      })
      .catch((error: unknown) => setRecordingActionError(error instanceof Error ? error.message : String(error)));
  };

  const openRecordingDirectory = async () => {
    if (!expandedEntry) return;
    setOpeningRecording(true);
    setRecordingActionError("");
    try {
      await api.openTranscriptionRecordingDirectory(expandedEntry.recordingKey ?? expandedEntry.id);
    } catch (error) {
      setRecordingActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningRecording(false);
    }
  };

  const deleteRecordingDirectory = async () => {
    if (!expandedEntry) return;
    const confirmed = window.confirm("Delete this transcription recording directory? This cannot be undone.");
    if (!confirmed) return;
    setDeletingRecording(true);
    setRecordingActionError("");
    try {
      updateEntry(await api.deleteTranscriptionRecording(expandedEntry.recordingKey ?? expandedEntry.id));
    } catch (error) {
      setRecordingActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingRecording(false);
    }
  };

  const runRetranscribe = async () => {
    if (!expandedEntry) return;
    setReplayRunning("stt");
    setReplayError("");
    try {
      const result = await api.retranscribeLogEntry(expandedEntry.recordingKey ?? expandedEntry.id, replaySttModel);
      setExpandedEntry({
        ...expandedEntry,
        replayVariants: [result.variant, ...(expandedEntry.replayVariants ?? [])],
      });
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplayRunning(null);
    }
  };

  const runReenhance = async () => {
    if (!expandedEntry) return;
    setReplayRunning("enhancement");
    setReplayError("");
    try {
      const result = await api.reenhanceLogEntry(
        expandedEntry.recordingKey ?? expandedEntry.id,
        replayEnhancementModel,
        replayEnhancementMode,
      );
      setExpandedEntry({
        ...expandedEntry,
        replayVariants: [result.variant, ...(expandedEntry.replayVariants ?? [])],
      });
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplayRunning(null);
    }
  };

  // Close modal on Escape key
  useEffect(() => {
    if (expandedId === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpandedId(null);
        setExpandedEntry(null);
        setCopiedAudioUrl(false);
        setCopiedRecordingPath(false);
        setRecordingActionError("");
        setReplayError("");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedId]);

  return (
    <div>
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between text-left cursor-pointer"
      >
        <h2 className="text-sm font-semibold text-cc-fg">Transcription Debug</h2>
        <span className="text-xs text-cc-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-cc-muted">
              Durable voice transcription records.
              {fetched ? ` Showing ${entries.length}${totalEntries ? ` of ${totalEntries}` : ""}.` : ""}
            </p>
            <button
              type="button"
              onClick={() => fetchIndex(false, true)}
              disabled={loading}
              className="px-2 py-1 rounded text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {error}
            </div>
          )}

          {entries.length > 0 && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {entries.map((entry) => {
                const locator = entry.recordingKey ?? entry.id;
                return (
                  <div key={locator} className="rounded-lg border border-cc-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleToggle(locator)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-cc-hover transition-colors cursor-pointer ${expandedId === locator ? "bg-cc-hover" : ""}`}
                    >
                      <span className="text-cc-muted shrink-0 w-16">{timeAgo(entry.timestamp)}</span>
                      <span className="text-cc-muted shrink-0">Up {formatDuration(entry.uploadDurationMs)}</span>
                      <span className="text-cc-fg shrink-0 font-mono text-[10px]">{entry.sttModel}</span>
                      <span className="text-cc-muted shrink-0">{formatDuration(entry.sttDurationMs)}</span>
                      <span className={`flex-1 truncate ${statusColor(entry)}`}>{statusLabel(entry)}</span>
                      {entry.enhancement && !entry.enhancement.skipReason && (
                        <span className="text-cc-muted shrink-0">{formatDuration(entry.enhancement.durationMs)}</span>
                      )}
                      <span className="text-cc-muted shrink-0 font-mono text-[10px]">
                        {formatBytes(entry.audioSizeBytes)}
                      </span>
                      {entry.sessionId && (
                        <span
                          className="text-cc-muted shrink-0 font-mono text-[10px] w-16 truncate"
                          title={entry.sessionId}
                        >
                          {entry.sessionId.slice(0, 8)}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {nextCursor && (
            <button
              type="button"
              onClick={() => fetchIndex(true, false)}
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg border border-cc-border text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Full-screen modal for entry detail */}
      {expandedId !== null &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setExpandedId(null);
              setExpandedEntry(null);
              setCopiedAudioUrl(false);
              setCopiedRecordingPath(false);
              setRecordingActionError("");
              setReplayError("");
            }}
          >
            <div
              className="bg-cc-bg border border-cc-border rounded-xl shadow-2xl flex flex-col"
              style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", maxWidth: "1400px" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-cc-border shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-cc-fg">Transcription Detail</h3>
                  {selectedIndexEntry && (
                    <>
                      <span className={`text-xs ${statusColor(selectedIndexEntry)}`}>
                        {statusLabel(selectedIndexEntry)}
                      </span>
                      <span className="text-xs text-cc-muted">
                        {timeAgo(selectedIndexEntry.timestamp)} &middot; Up{" "}
                        {formatDuration(selectedIndexEntry.uploadDurationMs)} &middot; STT{" "}
                        {formatDuration(selectedIndexEntry.sttDurationMs)}
                        {selectedIndexEntry.enhancement && !selectedIndexEntry.enhancement.skipReason
                          ? ` &middot; Enh ${formatDuration(selectedIndexEntry.enhancement.durationMs)}`
                          : ""}
                        {selectedIndexEntry.sessionId ? ` \u00b7 ${selectedIndexEntry.sessionId.slice(0, 8)}` : ""}
                      </span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(null);
                    setExpandedEntry(null);
                    setCopiedAudioUrl(false);
                    setCopiedRecordingPath(false);
                    setRecordingActionError("");
                    setReplayError("");
                  }}
                  className="px-2 py-1 rounded text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                >
                  Close (Esc)
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {detailLoading ? (
                  <p className="text-sm text-cc-muted">Loading...</p>
                ) : expandedEntry ? (
                  <>
                    {/* STT info */}
                    <div className="text-xs text-cc-muted">
                      Upload: <span className="text-cc-fg">{formatDuration(expandedEntry.uploadDurationMs)}</span>
                      <span className="ml-3">
                        STT Model: <span className="text-cc-fg font-medium font-mono">{expandedEntry.sttModel}</span>
                      </span>
                      <span className="ml-3">
                        STT: <span className="text-cc-fg">{formatDuration(expandedEntry.sttDurationMs)}</span>
                      </span>
                      <span className="ml-3">
                        Audio: <span className="text-cc-fg">{formatBytes(expandedEntry.audioSizeBytes)}</span>
                      </span>
                      {audioUrl && (
                        <span className="ml-3 inline-flex items-center gap-2">
                          <a
                            href={audioUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cc-accent hover:underline"
                          >
                            Open source audio
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              if (navigator.clipboard) {
                                void navigator.clipboard
                                  .writeText(audioUrl)
                                  .then(() => setCopiedAudioUrl(true))
                                  .catch(() => {});
                              }
                            }}
                            className="rounded px-1.5 py-0.5 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                          >
                            {copiedAudioUrl ? "Copied" : "Copy audio link"}
                          </button>
                        </span>
                      )}
                    </div>

                    {(recordingPath ||
                      expandedEntry.recordingDeletedAt ||
                      expandedEntry.recordingPersistenceError ||
                      expandedEntry.discoveryIssue) && (
                      <div className="text-xs text-cc-muted border-t border-cc-border pt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-cc-fg">Recording folder</span>
                          {expandedEntry.recordingDeletedAt && <span className="text-cc-warning">deleted</span>}
                          {expandedEntry.recordingPersistenceError && (
                            <span className="text-cc-error">not fully persisted</span>
                          )}
                          {recordingPath && !expandedEntry.recordingDeletedAt && (
                            <>
                              <button
                                type="button"
                                onClick={copyRecordingPath}
                                className="rounded px-1.5 py-0.5 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                              >
                                {copiedRecordingPath ? "Copied" : "Copy path"}
                              </button>
                              {expandedEntry.canOpenRecordingDirectory && (
                                <button
                                  type="button"
                                  onClick={() => void openRecordingDirectory()}
                                  disabled={openingRecording}
                                  className="rounded px-1.5 py-0.5 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {openingRecording
                                    ? "Opening..."
                                    : expandedEntry.openRecordingDirectoryLabel || "Open folder"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void deleteRecordingDirectory()}
                                disabled={deletingRecording}
                                className="rounded px-1.5 py-0.5 text-[11px] text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {deletingRecording ? "Deleting..." : "Delete recording"}
                              </button>
                            </>
                          )}
                        </div>
                        {recordingPath && (
                          <div className="rounded-lg bg-cc-hover px-3 py-2 font-mono text-[11px] text-cc-fg break-all">
                            {recordingPath}
                          </div>
                        )}
                        {expandedEntry.recordingPersistenceError && (
                          <div className="text-cc-error">{expandedEntry.recordingPersistenceError}</div>
                        )}
                        {expandedEntry.discoveryIssue && !expandedEntry.recordingPersistenceError && (
                          <div className="text-cc-warning">{expandedEntry.discoveryIssue}</div>
                        )}
                        {recordingActionError && <div className="text-cc-error">{recordingActionError}</div>}
                      </div>
                    )}

                    {(expandedEntry.serverTiming || expandedEntry.frontendTiming) && (
                      <div className="text-xs text-cc-muted border-t border-cc-border pt-3 space-y-1">
                        {expandedEntry.serverTiming && (
                          <div>
                            Server timing:
                            {expandedEntry.serverTiming.bodyReadDurationMs !== undefined && (
                              <span className="ml-2">
                                Body{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.serverTiming.bodyReadDurationMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.serverTiming.contextBuildDurationMs !== undefined && (
                              <span className="ml-2">
                                Context{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.serverTiming.contextBuildDurationMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.serverTiming.resultWriteDurationMs !== undefined && (
                              <span className="ml-2">
                                Result write{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.serverTiming.resultWriteDurationMs)}
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                        {expandedEntry.frontendTiming?.recordingTiming && (
                          <div>
                            Recording:
                            {expandedEntry.frontendTiming.recordingTiming.recordingDurationMs !== undefined && (
                              <span className="ml-2">
                                Wall{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.frontendTiming.recordingTiming.recordingDurationMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.recordingTiming.encodedBlobDurationMs !== undefined && (
                              <span className="ml-2">
                                Encoded{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.frontendTiming.recordingTiming.encodedBlobDurationMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.recordingTiming.chunkCount !== undefined && (
                              <span className="ml-2">
                                Chunks{" "}
                                <span className="text-cc-fg">
                                  {expandedEntry.frontendTiming.recordingTiming.chunkCount}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.recordingTiming.stopToBlobReadyMs !== undefined && (
                              <span className="ml-2">
                                Stop to blob{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.frontendTiming.recordingTiming.stopToBlobReadyMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.recordingTiming.stopReason && (
                              <span className="ml-2">
                                Stop{" "}
                                <span className="text-cc-fg">
                                  {expandedEntry.frontendTiming.recordingTiming.stopReason}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.recordingTiming.audioTrackStatesAtStop && (
                              <span className="ml-2">
                                Track{" "}
                                <span className="text-cc-fg">
                                  {expandedEntry.frontendTiming.recordingTiming.audioTrackStatesAtStop}
                                </span>
                              </span>
                            )}
                            <span className="ml-2">
                              Blob{" "}
                              <span className="text-cc-fg">
                                {formatBytes(expandedEntry.frontendTiming.recordingTiming.blobBytes)}
                              </span>
                            </span>
                            {expandedEntry.frontendTiming.recordingTiming.blobMimeType && (
                              <span className="ml-2 font-mono text-[10px] text-cc-fg">
                                {expandedEntry.frontendTiming.recordingTiming.blobMimeType}
                              </span>
                            )}
                          </div>
                        )}
                        {expandedEntry.frontendTiming?.clientTiming && (
                          <div>
                            Client:
                            <span className="ml-2 text-cc-fg">
                              {expandedEntry.frontendTiming.clientTiming.transport}
                            </span>
                            {expandedEntry.frontendTiming.clientTiming.resultDeliverySource && (
                              <span className="ml-2">
                                Result{" "}
                                <span className="text-cc-fg">
                                  {expandedEntry.frontendTiming.clientTiming.resultDeliverySource}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.clientTiming.responseStartDelayMs !== undefined && (
                              <span className="ml-2">
                                Response{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.frontendTiming.clientTiming.responseStartDelayMs)}
                                </span>
                              </span>
                            )}
                            {expandedEntry.frontendTiming.clientTiming.resultStreamDurationMs !== undefined && (
                              <span className="ml-2">
                                Stream result{" "}
                                <span className="text-cc-fg">
                                  {formatDuration(expandedEntry.frontendTiming.clientTiming.resultStreamDurationMs)}
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                        {expandedEntry.frontendTiming?.uiTiming?.applyToNextPaintMs !== undefined && (
                          <div>
                            UI paint:{" "}
                            <span className="text-cc-fg">
                              {formatDuration(expandedEntry.frontendTiming.uiTiming.applyToNextPaintMs)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-xs text-cc-muted border-t border-cc-border pt-3 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold text-cc-fg">Replay &amp; compare</h4>
                        <p className="mt-1">
                          Reuse this source record&apos;s stored audio, transcript, and debug context. Replay calls are
                          explicit provider calls and may incur charges.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-cc-border p-3 space-y-2">
                          <div className="font-medium text-cc-fg">Re-transcribe source audio</div>
                          <label className="block">
                            <span className="block text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                              Target STT model
                            </span>
                            <input
                              list="transcription-replay-stt-models"
                              value={replaySttModel}
                              onChange={(event) => setReplaySttModel(event.target.value)}
                              className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded text-cc-fg font-mono"
                            />
                          </label>
                          <datalist id="transcription-replay-stt-models">
                            {REPLAY_STT_MODELS.map((model) => (
                              <option key={model} value={model} />
                            ))}
                          </datalist>
                          {expandedEntry.sttContext && (
                            <p>
                              Source context: prompt {expandedEntry.sttContext.promptLength} chars,{" "}
                              {expandedEntry.sttContext.keywordCount} keywords,{" "}
                              {expandedEntry.sttContext.languageHints.length} language hints.
                            </p>
                          )}
                          {expandedEntry.replayAvailability?.retranscribe.reason && (
                            <p className="text-cc-warning">{expandedEntry.replayAvailability.retranscribe.reason}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => void runRetranscribe()}
                            disabled={
                              replayRunning !== null ||
                              !replaySttModel.trim() ||
                              expandedEntry.replayAvailability?.retranscribe.available === false
                            }
                            className="px-3 py-1.5 rounded bg-cc-primary text-white text-xs hover:bg-cc-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {replayRunning === "stt" ? "Running..." : "Run re-transcribe"}
                          </button>
                        </div>

                        <div className="rounded-lg border border-cc-border p-3 space-y-2">
                          <div className="font-medium text-cc-fg">Re-enhance raw transcript</div>
                          <label className="block">
                            <span className="block text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                              Enhancement model
                            </span>
                            <input
                              value={replayEnhancementModel}
                              onChange={(event) => setReplayEnhancementModel(event.target.value)}
                              className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded text-cc-fg font-mono"
                            />
                          </label>
                          <div className="flex rounded border border-cc-border overflow-hidden w-max">
                            <button
                              type="button"
                              onClick={() => setReplayEnhancementMode("default")}
                              className={
                                "px-3 py-1.5 text-xs cursor-pointer " +
                                (replayEnhancementMode === "default"
                                  ? "bg-cc-primary text-white"
                                  : "bg-cc-input-bg text-cc-muted hover:text-cc-fg")
                              }
                            >
                              Prose
                            </button>
                            <button
                              type="button"
                              onClick={() => setReplayEnhancementMode("bullet")}
                              className={
                                "px-3 py-1.5 text-xs cursor-pointer " +
                                (replayEnhancementMode === "bullet"
                                  ? "bg-cc-primary text-white"
                                  : "bg-cc-input-bg text-cc-muted hover:text-cc-fg")
                              }
                            >
                              Bullet Points
                            </button>
                          </div>
                          {expandedEntry.replayAvailability?.reenhance.reason && (
                            <p className="text-cc-warning">{expandedEntry.replayAvailability.reenhance.reason}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => void runReenhance()}
                            disabled={
                              replayRunning !== null ||
                              !replayEnhancementModel.trim() ||
                              expandedEntry.replayAvailability?.reenhance.available === false
                            }
                            className="px-3 py-1.5 rounded bg-cc-primary text-white text-xs hover:bg-cc-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {replayRunning === "enhancement" ? "Running..." : "Run re-enhance"}
                          </button>
                        </div>
                      </div>

                      {replayError && (
                        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
                          {replayError}
                        </div>
                      )}

                      {expandedEntry.replayVariants && expandedEntry.replayVariants.length > 0 && (
                        <div className="space-y-2">
                          {expandedEntry.replayVariants.map((variant) => (
                            <div key={variant.id} className="rounded-lg bg-cc-hover p-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium text-cc-fg">{replayKindLabel(variant.kind)}</span>
                                <span className="font-mono text-cc-fg">{variant.model}</span>
                                {variant.enhancementMode && <span>{variant.enhancementMode}</span>}
                                {variant.timing?.sttDurationMs !== undefined && (
                                  <span>STT {formatDuration(variant.timing.sttDurationMs)}</span>
                                )}
                                {variant.timing?.enhancementDurationMs !== undefined && (
                                  <span>Enh {formatDuration(variant.timing.enhancementDurationMs)}</span>
                                )}
                                <span className={variant.status === "error" ? "text-cc-error" : "text-cc-success"}>
                                  {variant.status}
                                </span>
                              </div>
                              {variant.error && <div className="text-cc-error">{variant.error.message}</div>}
                              {variant.kind === "stt_replay" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                                      Original STT output
                                    </div>
                                    <pre className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                                      {expandedEntry.rawTranscript || "(empty)"}
                                    </pre>
                                  </div>
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                                      Replay STT output
                                    </div>
                                    <pre className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                                      {variant.rawTranscript || "(empty)"}
                                    </pre>
                                  </div>
                                </div>
                              )}
                              {variant.kind === "enhancement_replay" && (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                                        Original enhanced output
                                      </div>
                                      <pre className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                                        {originalEnhancementComparisonText(expandedEntry)}
                                      </pre>
                                    </div>
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                                        Replay enhanced output
                                      </div>
                                      <pre className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                                        {variant.enhancedText ?? "(null — skipped, failed, or hallucination guard)"}
                                      </pre>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">
                                      Source raw transcript context
                                    </div>
                                    <pre className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                                      {variant.rawTranscript || expandedEntry.rawTranscript || "(empty)"}
                                    </pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-cc-muted font-medium">
                        Raw Transcript (STT Output)
                      </span>
                      <pre className="mt-1 text-[12px] leading-relaxed text-cc-fg bg-cc-hover rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                        {expandedEntry.rawTranscript || "(empty)"}
                      </pre>
                    </div>

                    {expandedEntry.sttPrompt && (
                      <div>
                        <span className="text-[11px] uppercase tracking-wider text-cc-muted font-medium">
                          STT Prompt (sent to {expandedEntry.sttModel})
                        </span>
                        <pre className="mt-1 text-[12px] leading-relaxed text-cc-fg bg-cc-hover rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                          {expandedEntry.sttPrompt}
                        </pre>
                      </div>
                    )}

                    {/* Enhancement section */}
                    {expandedEntry.enhancement ? (
                      <>
                        <div className="text-xs text-cc-muted border-t border-cc-border pt-3">
                          Enhancement Model:{" "}
                          <span className="text-cc-fg font-medium font-mono">{expandedEntry.enhancement.model}</span>
                          <span className="ml-3">
                            Duration:{" "}
                            <span className="text-cc-fg">{formatDuration(expandedEntry.enhancement.durationMs)}</span>
                          </span>
                          {expandedEntry.enhancement.skipReason && (
                            <span className="ml-3">
                              Skip reason:{" "}
                              <span className="text-cc-warning">{expandedEntry.enhancement.skipReason}</span>
                            </span>
                          )}
                        </div>

                        {expandedEntry.enhancement.systemPrompt && (
                          <div>
                            <span className="text-[11px] uppercase tracking-wider text-cc-muted font-medium">
                              System Prompt
                            </span>
                            <pre className="mt-1 text-[12px] leading-relaxed text-cc-fg bg-cc-hover rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                              {expandedEntry.enhancement.systemPrompt}
                            </pre>
                          </div>
                        )}

                        {expandedEntry.enhancement.userMessage && (
                          <div>
                            <span className="text-[11px] uppercase tracking-wider text-cc-muted font-medium">
                              User Message (Context + Transcript)
                            </span>
                            <pre className="mt-1 text-[12px] leading-relaxed text-cc-fg bg-cc-hover rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                              {expandedEntry.enhancement.userMessage}
                            </pre>
                          </div>
                        )}

                        <div>
                          <span className="text-[11px] uppercase tracking-wider text-cc-muted font-medium">
                            Enhanced Result
                          </span>
                          <pre className="mt-1 text-[12px] leading-relaxed text-cc-fg bg-cc-hover rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                            {expandedEntry.enhancement.enhancedText ??
                              "(null — skipped, failed, or hallucination guard)"}
                          </pre>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-cc-muted border-t border-cc-border pt-3">
                        Enhancement was not attempted for this transcription.
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-cc-error">Failed to load details</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
