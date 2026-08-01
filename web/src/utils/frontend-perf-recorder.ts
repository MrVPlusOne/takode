const MAX_FRONTEND_PERF_ENTRIES = 1_000;

export type FrontendPerfEntry =
  | {
      kind: "ws_message";
      timestamp: number;
      sessionId: string;
      messageType: string;
      durationMs: number;
      receiveId?: string;
      parseDurationMs?: number;
      applyDurationMs?: number;
      seq?: number;
      payloadBytes?: number;
    }
  | {
      kind: "history_receive_render";
      timestamp: number;
      sessionId: string;
      messageType: string;
      receiveId: string;
      payloadBytes: number;
      parseDurationMs: number;
      applyDurationMs: number;
      reactCommitDurationMs: number;
      nextPaintDurationMs: number;
      totalDurationMs: number;
    }
  | {
      kind: "event_replay";
      timestamp: number;
      sessionId: string;
      eventCount: number;
      processedCount: number;
      bufferedCount: number;
      durationMs: number;
    }
  | {
      kind: "seq_storage_flush";
      timestamp: number;
      sessionId?: string;
      writeCount: number;
      durationMs: number;
    }
  | {
      kind: "session_ack_flush";
      timestamp: number;
      sessionId?: string;
      ackCount: number;
      maxSeq: number;
    }
  | {
      kind: "connection_cycle";
      timestamp: number;
      sessionId: string;
      phase: "connect" | "open" | "close" | "reconnect" | "subscribe";
      lastSeq?: number;
      forceFullHistory?: boolean;
    }
  | {
      kind: "feed_render";
      timestamp: number;
      sessionId: string;
      threadKey: string;
      messageCount: number;
      entryCount: number;
      turnCount: number;
    }
  | {
      kind: "long_task";
      timestamp: number;
      durationMs: number;
      name?: string;
    }
  | {
      kind: "composer_autocomplete";
      timestamp: number;
      sessionId: string;
      threadKey: string;
      phase: "input" | "recency" | "reference_suggestions";
      durationMs: number;
      inputLength?: number;
      referenceKind?: "quest" | "session";
      queryLength?: number;
      historyEntryCount?: number;
      historyCharCount?: number;
      scannedQuestCount?: number;
      candidateCount?: number;
      suggestionCount?: number;
    }
  | {
      kind: "voice_transcription_progress";
      timestamp: number;
      sessionId: string;
      requestId: string;
      phase: string;
      source: "client" | "sse" | "websocket";
      elapsedMs: number;
      mode?: string;
      audioSizeBytes?: number;
      audioMimeType?: string | null;
      audioFileName?: string | null;
      uploadDurationMs?: number;
      sttDurationMs?: number;
      enhancementDurationMs?: number;
    }
  | {
      kind: "voice_recording_timing";
      timestamp: number;
      sessionId: string;
      requestId: string;
      chunkCount: number;
      chunkBytes: number;
      blobBytes: number;
      blobMimeType?: string | null;
      selectedMimeType?: string | null;
      recorderMimeType?: string | null;
      recordingDurationMs?: number;
      stopToBlobReadyMs?: number;
      blobBuildDurationMs?: number;
    }
  | {
      kind: "voice_transcription_client_timing";
      timestamp: number;
      sessionId: string;
      requestId: string;
      transport: "raw" | "multipart";
      requestBodyBytes: number;
      responseStartDelayMs?: number;
      firstChunkDelayMs?: number;
      resultStreamDurationMs?: number;
      resultDeliverySource?: "sse" | "websocket";
      webSocketResultAt?: number;
      apiElapsedMs?: number;
      applyToNextPaintMs?: number;
    }
  | {
      kind: "message_history_apply";
      timestamp: number;
      sessionId: string;
      rawMessageCount: number;
      chatMessageCount: number;
      frozenCount: number;
      durationMs: number;
    }
  | {
      kind: "thread_attachment_update_apply";
      timestamp: number;
      sessionId: string;
      updateCount: number;
      markerCount: number;
      changedMessageCount: number;
      affectedThreadCount: number;
      requestedHistoryWindowCount: number;
      requestedThreadWindowCount: number;
      durationMs: number;
      ok: boolean;
      deduped?: boolean;
      recoveryReason?: string;
      applicationMode?: "patched" | "refetch_only" | "deduped";
      advisoryReason?: string;
      skippedLocalPatch?: boolean;
      replayed?: boolean;
      coldBufferedReplay?: boolean;
      updateHistoryLength?: number;
      knownAuthoritativeHistoryLength?: number;
    }
  | {
      kind: "tree_groups_update_apply";
      timestamp: number;
      sessionId: string;
      groupCount: number;
      assignmentCount: number;
      nodeOrderParentCount: number;
      nodeOrderChildCount: number;
      durationMs: number;
    }
  | {
      kind: "session_created_refresh";
      timestamp: number;
      sessionId: string;
      createdSessionId: string;
      sessionCount?: number;
      durationMs: number;
      ok: boolean;
    }
  | {
      kind: "session_archived_refresh";
      timestamp: number;
      sessionId: string;
      archivedSessionId: string;
      sessionCount?: number;
      durationMs: number;
      ok: boolean;
    };

export interface FrontendPerfDebugApi {
  entries: () => FrontendPerfEntry[];
  clear: () => void;
  export: () => string;
}

declare global {
  interface Window {
    __TAKODE_FRONTEND_PERF__?: FrontendPerfDebugApi;
  }
}

const entries: FrontendPerfEntry[] = [];
const feedRenderSignatures = new Map<string, string>();
const HISTORY_RECEIVE_TYPES = new Set([
  "leader_projection_snapshot",
  "message_history",
  "history_sync",
  "history_window_sync",
  "thread_window_sync",
]);

interface PendingHistoryReceive {
  receiveId: string;
  sessionId: string;
  messageType: string;
  payloadBytes: number;
  receivedAt: number;
  parseDurationMs: number;
  appliedAt?: number;
  applyDurationMs?: number;
  committedAt?: number;
  paintScheduled?: boolean;
}

const pendingHistoryReceives = new Map<string, PendingHistoryReceive>();
const pendingHistoryReceiveIdsBySession = new Map<string, string[]>();

function perfNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => callback());
    return;
  }
  setTimeout(callback, 0);
}

function scheduleHistoryReceivePaint(pending: PendingHistoryReceive): void {
  if (pending.paintScheduled || pending.appliedAt === undefined || pending.committedAt === undefined) return;
  pending.paintScheduled = true;
  scheduleFrame(() => {
    scheduleFrame(() => {
      const paintAt = perfNow();
      const commitBase = Math.max(pending.appliedAt!, pending.committedAt!);
      recordFrontendPerfEntry({
        kind: "history_receive_render",
        timestamp: Date.now(),
        sessionId: pending.sessionId,
        messageType: pending.messageType,
        receiveId: pending.receiveId,
        payloadBytes: pending.payloadBytes,
        parseDurationMs: pending.parseDurationMs,
        applyDurationMs: pending.applyDurationMs ?? 0,
        reactCommitDurationMs: Math.max(0, pending.committedAt! - pending.appliedAt!),
        nextPaintDurationMs: Math.max(0, paintAt - commitBase),
        totalDurationMs: Math.max(0, paintAt - pending.receivedAt),
      });
      pendingHistoryReceives.delete(pending.receiveId);
      const ids = pendingHistoryReceiveIdsBySession.get(pending.sessionId) ?? [];
      const remaining = ids.filter((receiveId) => receiveId !== pending.receiveId);
      if (remaining.length > 0) pendingHistoryReceiveIdsBySession.set(pending.sessionId, remaining);
      else pendingHistoryReceiveIdsBySession.delete(pending.sessionId);
    });
  });
}

export function beginHistoryReceiveRenderTiming(input: {
  receiveId: string;
  sessionId: string;
  messageType: string;
  payloadBytes: number;
  receivedAt: number;
  parseDurationMs: number;
}): void {
  if (!HISTORY_RECEIVE_TYPES.has(input.messageType)) return;
  const pending: PendingHistoryReceive = { ...input };
  pendingHistoryReceives.set(input.receiveId, pending);
  const ids = [...(pendingHistoryReceiveIdsBySession.get(input.sessionId) ?? []), input.receiveId];
  while (ids.length > 20) {
    const staleId = ids.shift();
    if (staleId) pendingHistoryReceives.delete(staleId);
  }
  pendingHistoryReceiveIdsBySession.set(input.sessionId, ids);
}

export function completeHistoryReceiveRenderTiming(input: {
  receiveId: string;
  appliedAt: number;
  applyDurationMs: number;
}): void {
  const pending = pendingHistoryReceives.get(input.receiveId);
  if (!pending) return;
  pending.appliedAt = input.appliedAt;
  pending.applyDurationMs = input.applyDurationMs;
  scheduleHistoryReceivePaint(pending);
}

export function markHistoryReceiveRenderCommitted(sessionId: string): void {
  const committedAt = perfNow();
  for (const receiveId of pendingHistoryReceiveIdsBySession.get(sessionId) ?? []) {
    const pending = pendingHistoryReceives.get(receiveId);
    if (!pending || pending.committedAt !== undefined) continue;
    pending.committedAt = committedAt;
    scheduleHistoryReceivePaint(pending);
  }
}

export function recordFrontendPerfEntry(entry: FrontendPerfEntry): void {
  entries.push(entry);
  if (entries.length > MAX_FRONTEND_PERF_ENTRIES) {
    entries.splice(0, entries.length - MAX_FRONTEND_PERF_ENTRIES);
  }
}

export function getFrontendPerfEntries(): FrontendPerfEntry[] {
  return [...entries];
}

export function clearFrontendPerfEntries(): void {
  entries.length = 0;
  feedRenderSignatures.clear();
  pendingHistoryReceives.clear();
  pendingHistoryReceiveIdsBySession.clear();
}

export function exportFrontendPerfEntries(): string {
  return JSON.stringify(entries, null, 2);
}

export function recordFeedRenderSnapshot(snapshot: {
  sessionId: string;
  threadKey: string;
  messageCount: number;
  entryCount: number;
  turnCount: number;
}): void {
  const key = `${snapshot.sessionId}\0${snapshot.threadKey}`;
  const signature = `${snapshot.messageCount}:${snapshot.entryCount}:${snapshot.turnCount}`;
  if (feedRenderSignatures.get(key) === signature) return;
  feedRenderSignatures.set(key, signature);
  recordFrontendPerfEntry({ kind: "feed_render", timestamp: Date.now(), ...snapshot });
}

function installDebugApi(): void {
  if (typeof window === "undefined") return;
  window.__TAKODE_FRONTEND_PERF__ = {
    entries: getFrontendPerfEntries,
    clear: clearFrontendPerfEntries,
    export: exportFrontendPerfEntries,
  };
}

function installLongTaskObserver(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordFrontendPerfEntry({
          kind: "long_task",
          timestamp: Date.now(),
          durationMs: entry.duration,
          name: entry.name,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Long Task API support varies by browser; tracing still works without it.
  }
}

installDebugApi();
installLongTaskObserver();
