import { captureJson, isLargeHistory, valueDigest, type JsonValue } from "./session-history-codec.js";
import {
  SessionHistoryJournal,
  SessionHistoryError,
  readSessionHistory,
  type HistoryReference,
} from "./session-history-journal.js";
import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import { createReadStream, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { replaceSessionFile, writeFrozenHistory } from "./session-persistence-io.js";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { isReplayableBufferedEvent } from "./bridge/replay-buffer-policy.js";
import type { RecoveryDeliveryTransfer } from "./bridge/recovery-delivery-transfer.js";
import { isModelProvenanceMigrationAcknowledgementStateFile } from "./model-provenance-migration-acknowledgement-store.js";
import {
  buildCodexAutoPauseRecoverySearchText,
  CODEX_AUTO_PAUSE_RECOVERY_SEARCH_MAX_LENGTH,
  isCodexAutoPauseRecoverySummaryFinal,
} from "./codex-auto-pause-types.js";
import { deriveCodexNativeSubagentSnapshot } from "./codex-native-subagent-state.js";
import { repairRestoredCodexNativeSubagentAuthority } from "./codex-native-subagent-ownership-repair.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { restoreUnpersistedHandoffRefs } from "./leader-thread-handoff.js";
import type {
  SessionState,
  BrowserIncomingMessage,
  PermissionRequest,
  BufferedBrowserEvent,
  SessionTaskEntry,
  CodexOutboundTurn,
  PendingCodexInput,
  BoardRow,
  SessionNotification,
  SessionAttentionRecord,
  CodexPendingDeliveryProofSignal,
  ContextUsageHistoryEntry,
  LeaderThreadAnswerMetadata,
  LegacyLeaderThreadResponseRevisionMetadata,
  ThreadRef,
} from "./session-types.js";

export interface SearchExcerpt {
  type: "user_message" | "assistant" | "compact_marker" | "recovery_summary";
  content: string;
  timestamp: number;
  id?: string;
  markerKind?: "compaction" | "session_recycled";
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadRef[];
  threadAnswer?: LeaderThreadAnswerMetadata;
  threadResponse?: LegacyLeaderThreadResponseRevisionMetadata;
}

// ─── Two-Tier Persistence Design ────────────────────────────────────────────
//
// Problem: JSON.stringify(entireSession) blocked the event loop for 50-75ms on
// large sessions (8,700+ messages, 14.8MB). With 150ms debounce, this consumed
// 33-50% of event loop time during streaming, causing WebSocket disconnects.
//
// Solution: Split persistence into two files per session:
//
//   {id}.json            Hot state — session config + current turn's messages.
//                        Written every 150ms (debounced). Serialize cost is
//                        O(active payload), which has no intrinsic byte bound.
//
//   {id}.history.jsonl   Frozen log — completed turns, append-only JSONL.
//                        Appended once per turn completion. Each message is
//                        serialized exactly once when frozen.
//
// Freeze boundary: Everything up to and including the last `result` message.
// Messages after that are the current in-progress turn and stay "hot".
//
// Why append-only works despite in-place mutations:
//
// Messages in messageHistory are mutated after insertion in 6 places:
//   1. assistant content.push(block)  — CLI sends same msg ID in parts
//   2. assistant stop_reason update   — subsequent part arrives
//   3. assistant usage update         — subsequent part arrives
//   4. assistant timestamp update     — each part arrival
//   5. assistant turn_duration_ms     — set when result message arrives
//   6. compact_marker summary         — injected async after compact_boundary
//
// All mutations resolve before or at the `result` message that triggers the
// freeze. The compact marker summary always arrives before the next user
// message (CLI protocol guarantee). So by the time we freeze a completed
// turn, every message is in its final form.
//
// Edits made after a turn froze, such as thread handoffs and attachments that
// add refs to older messages, must use saveHistoryEdits(), which rewrites the
// frozen log; an ordinary save would never write them.
//
// Tool results are frozen at the same boundary. They only arrive via
// buildToolResultPreviews() inside handleResultMessage() — the same moment
// that triggers the freeze. So all tool results at freeze time belong to
// completed turns.
//
// Crash safety: JSONL is appended before the hot JSON is written. On load,
// overlap detection handles the case where JSONL has more data than the hot
// JSON expects (crash between the two writes).
//
// The in-memory session.messageHistory array is unchanged. ws-bridge.ts has
// zero changes — the split is entirely inside SessionStore.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Serializable session shape ─────────────────────────────────────────────

export interface PersistedSession {
  id: string;
  state: SessionState;
  messageHistory: BrowserIncomingMessage[];
  /** Server-only native Codex child registry, including provider identity needed for replay/history lookup. */
  codexNativeSubagents?: import("./codex-native-subagent-state.js").CodexNativeSubagentRegistry;
  pendingMessages: string[];
  forceCompactPending?: boolean;
  pendingCodexTurns?: CodexOutboundTurn[];
  /** Server-only unresolved terminal recovery audit; never grants replay authority. */
  codexTerminalRecoveries?: import("./session-types.js").CodexTurnRecoveryState[];
  pendingCodexInputs?: PendingCodexInput[];
  recoveryDeliveryTransfers?: RecoveryDeliveryTransfer[];
  pendingCodexRollback?: { numTurns: number; truncateIdx: number; clearCodexState: boolean } | null;
  pendingCodexRollbackError?: string | null;
  codexLeaderRecycleContinuation?: import("./session-types.js").CodexLeaderRecycleContinuation | null;
  pendingStartupMemoryCatalogInjection?: boolean;
  compactionMemoryCatalog?: import("./bridge/memory-catalog-prelude.js").CompactionMemoryCatalogState;
  /** Codex-only: active turn id that must finish before follow-up input may start a fresh turn. */
  codexFreshTurnRequiredUntilTurnId?: string | null;
  /** One-shot guard for suppressing expected low/normal-usage Codex model-switch migration recovery. */
  codexModelSwitchCompactionGuard?: import("./session-types.js").CodexModelSwitchCompactionGuard | null;
  /** Bounded, payload-free breadcrumbs for pending-delivery blockage diagnostics. */
  codexPendingDeliveryProofSignals?: CodexPendingDeliveryProofSignal[];
  /** Bounded, payload-free reported context usage samples for diagnostics. */
  contextUsageHistory?: ContextUsageHistoryEntry[];
  pendingPermissions: [string, PermissionRequest][];
  eventBuffer?: BufferedBrowserEvent[];
  nextEventSeq?: number;
  lastAckSeq?: number;
  processedClientMessageIds?: string[];
  archived?: boolean;
  /** Epoch ms when this session was archived */
  archivedAt?: number;
  /** Serialized Map entries for full tool results (tool_use_id → result) */
  toolResults?: [string, { content: string; is_error: boolean; timestamp: number }][];
  /** Epoch ms when the user last viewed this session (server-authoritative) */
  lastReadAt?: number;
  /** Current attention reason: why this session needs the user's attention */
  attentionReason?: "action" | "error" | "review" | null;
  /** Explicit user-owned unread marker, distinct from notification-derived review attention. */
  manualUnread?: boolean;
  /** High-level task history recognized by the session auto-namer */
  taskHistory?: SessionTaskEntry[];
  /** Accumulated search keywords from the session auto-namer */
  keywords?: string[];
  /** Leader work board rows, keyed by quest ID */
  board?: BoardRow[];
  /** Completed board items (moved from board on rm/advance) */
  completedBoard?: BoardRow[];
  /** Per-session notification inbox entries */
  notifications?: SessionNotification[];
  /** History length after the latest leader-thread outcome validation pass. */
  leaderThreadOutcomeValidatedHistoryLength?: number;
  /** Recovered Ready rejections awaiting the next normal outcome-validation boundary. */
  pendingLeaderRejectedReadyThreadKeys?: string[];
  /** Server-authoritative attention records for Main ledger rows and top chips */
  attentionRecords?: SessionAttentionRecord[];
  /** Monotonic status version for ordering notification summary updates. */
  notificationStatusVersion?: number;
  /** Epoch ms for the latest notification status mutation. */
  notificationStatusUpdatedAt?: number;

  /** Lightweight bounded excerpts extracted at archive time for user, assistant,
   *  compact-marker, and server-authored recovery-summary search. */
  _searchExcerpts?: SearchExcerpt[];

  /** Set when this session was loaded with only search-relevant data (archived
   *  sessions at startup). Full messageHistory was not loaded from disk. */
  _searchDataOnly?: boolean;

  // ── Append-only history bookkeeping (managed by SessionStore) ───────────
  /**
   * Number of messages from the beginning of the full messageHistory that
   * are persisted in the append-only JSONL frozen log. The hot JSON only
   * stores messages[_frozenCount..]. On load, frozen + hot are concatenated.
   */
  _historyRef?: HistoryReference;
  _frozenCount?: number;
  /**
   * Number of toolResults entries persisted in the frozen log.
   * The hot JSON only stores toolResults[_frozenToolResultCount..].
   */
  _frozenToolResultCount?: number;
}

function repairRestoredCodexAuthority(session: PersistedSession): { session: PersistedSession; changed: boolean } {
  if (session.state.backend_type !== "codex") return { session, changed: false };
  const repair = repairRestoredCodexNativeSubagentAuthority(
    session.id,
    session.codexNativeSubagents,
    session.messageHistory,
    session.eventBuffer,
  );
  return {
    session: {
      ...session,
      state: {
        ...session.state,
        codex_native_subagents: deriveCodexNativeSubagentSnapshot(repair.registry),
      },
      codexNativeSubagents: repair.registry,
    },
    changed: repair.changed,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(homedir(), ".companion", "sessions");

interface SessionRestoreMetrics {
  startedAt: number;
  totalSessions: number;
  activeSessions: number;
  searchOnlySessions: number;
  skippedSessions: number;
  activeHotJsonBytes: number;
  searchOnlyHotJsonBytes: number;
  frozenLogBytes: number;
  restoredHistoryMessages: number;
  restoredToolResults: number;
  eventBufferBeforeCount: number;
  eventBufferAfterCount: number;
  eventBufferBeforeBytes: number;
  eventBufferAfterBytes: number;
  sanitizedSessions: number;
  droppedEventCount: number;
  droppedEventBytes: number;
  droppedEventTypes: Map<string, { count: number; bytes: number }>;
  launcherStateCounts: Map<string, number>;
}

interface EventBufferSanitizeResult {
  eventBuffer: BufferedBrowserEvent[] | undefined;
  changed: boolean;
}

interface LauncherRestoreInfo {
  sessionId?: unknown;
  state?: unknown;
  archived?: unknown;
  archivedAt?: unknown;
}

interface LauncherRestoreState {
  archived: boolean;
  archivedAt?: number;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function serializedJsonArrayBytes(itemBytes: number, itemCount: number): number {
  if (itemCount === 0) return 2;
  return itemBytes + itemCount + 1;
}

interface SessionWriteRequest {
  run: () => Promise<void>;
  coalescible: boolean;
  done: Promise<boolean>;
  resolve: (success: boolean) => void;
  error?: unknown;
}

/**
 * Session persistence with two-tier storage:
 *
 * 1. **Hot state** (`{id}.json`) — small JSON with session state + only the
 *    current turn's messages and tool results. Written every 150ms (debounced).
 *    Serialization scales with active payload bytes; writer admission bounds simultaneous copies.
 *
 * 2. **Frozen log** (`{id}.history.jsonl`) — append-only JSONL with all
 *    completed turns. Appended once per turn completion. Each message is
 *    serialized exactly once when frozen.
 *
 * This eliminates the O(total history) serialization that previously blocked
 * the event loop for 50-75ms on large sessions (8,700+ messages, 14.8MB).
 */
export class SessionStore {
  private dir: string;
  private historyJournal: SessionHistoryJournal;
  private historyReferences = new Map<string, HistoryReference>();
  private diskHistoryHints?: Promise<Set<string>>;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingSaves = new Map<string, PersistedSession>();
  /** Track in-flight async writes so flushAll can await them. */
  private inflightWrites = new Set<Promise<unknown>>();
  private persistenceFailures = new Map<string, unknown>();
  private launcherWrite: Promise<void> = Promise.resolve();
  private writeQueues = new Map<string, SessionWriteRequest[]>();
  private activeWriters = new Set<string>();
  private readyWriters = new Set<string>();
  private requestedHistoryLengths = new Map<string, number>();
  /** Failed snapshots stay owned until a successful save or explicit removal. */
  private failedSaves = new Map<string, PersistedSession>();
  private static readonly MAX_ACTIVE_WRITERS = 2;

  /**
   * How many messages from the start of each session's messageHistory are
   * already in the frozen JSONL. Set on load(), updated on freeze.
   */
  private frozenCounts = new Map<string, number>();
  /** Same for tool results — how many entries are in the frozen JSONL. */
  private frozenToolResultCounts = new Map<string, number>();

  constructor(dir?: string, port?: number) {
    if (dir) {
      this.dir = dir;
    } else {
      this.dir = port ? join(DEFAULT_BASE_DIR, String(port)) : DEFAULT_BASE_DIR;
    }
    mkdirSync(this.dir, { recursive: true });
    this.historyJournal = new SessionHistoryJournal(this.dir);
  }

  private filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  private frozenLogPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.history.jsonl`);
  }

  private createRestoreMetrics(): SessionRestoreMetrics {
    return {
      startedAt: performance.now(),
      totalSessions: 0,
      activeSessions: 0,
      searchOnlySessions: 0,
      skippedSessions: 0,
      activeHotJsonBytes: 0,
      searchOnlyHotJsonBytes: 0,
      frozenLogBytes: 0,
      restoredHistoryMessages: 0,
      restoredToolResults: 0,
      eventBufferBeforeCount: 0,
      eventBufferAfterCount: 0,
      eventBufferBeforeBytes: 0,
      eventBufferAfterBytes: 0,
      sanitizedSessions: 0,
      droppedEventCount: 0,
      droppedEventBytes: 0,
      droppedEventTypes: new Map(),
      launcherStateCounts: new Map(),
    };
  }

  private recordDroppedBufferedEvent(metrics: SessionRestoreMetrics | undefined, event: unknown, bytes: number): void {
    if (!metrics) return;
    const type =
      event && typeof event === "object" && "message" in event
        ? ((event as { message?: { type?: unknown } }).message?.type ?? "malformed")
        : "malformed";
    const key = typeof type === "string" ? type : "malformed";
    const current = metrics.droppedEventTypes.get(key) ?? { count: 0, bytes: 0 };
    current.count++;
    current.bytes += bytes;
    metrics.droppedEventTypes.set(key, current);
  }

  private sanitizePersistedEventBuffer(
    eventBuffer: PersistedSession["eventBuffer"],
    context?: { isLeaderSession?: boolean },
    metrics?: SessionRestoreMetrics,
  ): EventBufferSanitizeResult {
    if (!Array.isArray(eventBuffer)) return { eventBuffer, changed: false };

    const sanitized: BufferedBrowserEvent[] = [];
    let beforeItemBytes = 0;
    let afterItemBytes = 0;
    let droppedBytes = 0;
    let droppedCount = 0;

    for (const event of eventBuffer) {
      const bytes = metrics ? Buffer.byteLength(JSON.stringify(event)) : 0;
      if (metrics) beforeItemBytes += bytes;
      if (isReplayableBufferedEvent(event, context)) {
        sanitized.push(event);
      } else {
        if (metrics) droppedBytes += bytes;
        droppedCount++;
        this.recordDroppedBufferedEvent(metrics, event, bytes);
      }
    }

    if (metrics) {
      afterItemBytes = beforeItemBytes - droppedBytes;
      metrics.eventBufferBeforeCount += eventBuffer.length;
      metrics.eventBufferAfterCount += sanitized.length;
      metrics.eventBufferBeforeBytes += serializedJsonArrayBytes(beforeItemBytes, eventBuffer.length);
      metrics.eventBufferAfterBytes += serializedJsonArrayBytes(afterItemBytes, sanitized.length);
      metrics.droppedEventCount += droppedCount;
      metrics.droppedEventBytes += droppedBytes;
      if (droppedCount > 0) metrics.sanitizedSessions++;
    }

    return {
      eventBuffer: sanitized,
      changed: droppedCount > 0,
    };
  }

  private async loadLauncherRestoreState(metrics: SessionRestoreMetrics): Promise<Map<string, LauncherRestoreState>> {
    const index = new Map<string, LauncherRestoreState>();
    const launcherSessions = await this.loadLauncher<LauncherRestoreInfo[]>();
    if (!Array.isArray(launcherSessions)) return index;

    for (const session of launcherSessions) {
      const state = typeof session?.state === "string" ? session.state : "unknown";
      metrics.launcherStateCounts.set(state, (metrics.launcherStateCounts.get(state) ?? 0) + 1);
      if (typeof session?.sessionId !== "string") continue;
      index.set(session.sessionId, {
        archived: session.archived === true,
        ...(typeof session.archivedAt === "number" ? { archivedAt: session.archivedAt } : {}),
      });
    }
    return index;
  }

  private buildSearchDataOnlySession(hot: PersistedSession, launcherState?: LauncherRestoreState): PersistedSession {
    const archivedAt = typeof hot.archivedAt === "number" ? hot.archivedAt : launcherState?.archivedAt;
    return {
      id: hot.id,
      state: hot.state,
      messageHistory: [],
      codexNativeSubagents: hot.codexNativeSubagents,
      pendingMessages: [],
      pendingPermissions: [],
      toolResults: [],
      eventBuffer: [],
      archived: true,
      ...(typeof archivedAt === "number" ? { archivedAt } : {}),
      lastReadAt: hot.lastReadAt,
      attentionReason: hot.attentionReason,
      ...(hot.manualUnread === true ? { manualUnread: true } : {}),
      taskHistory: hot.taskHistory,
      keywords: hot.keywords,
      board: hot.board,
      completedBoard: hot.completedBoard,
      notifications: hot.notifications,
      attentionRecords: hot.attentionRecords,
      _searchExcerpts:
        Array.isArray(hot._searchExcerpts) && hot._searchExcerpts.length > 0
          ? hot._searchExcerpts
          : SessionStore.extractSearchExcerpts(hot.messageHistory),
      _searchDataOnly: true,
      _frozenCount: 0,
      _frozenToolResultCount: 0,
    };
  }

  private formatCountMap(counts: Map<string, number>): string {
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}:${value}`)
      .join(", ");
  }

  private logRestoreMetrics(metrics: SessionRestoreMetrics): void {
    const elapsedMs = performance.now() - metrics.startedAt;
    const memory = process.memoryUsage();
    const droppedTypes = [...metrics.droppedEventTypes.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 8)
      .map(([type, value]) => `${type}:${value.count}/${formatBytes(value.bytes)}`)
      .join(", ");
    const launcherStates = this.formatCountMap(metrics.launcherStateCounts);

    console.info(
      `[session-store] Restored ${metrics.totalSessions} session(s) in ${elapsedMs.toFixed(0)}ms ` +
        `(active=${metrics.activeSessions}, searchOnly=${metrics.searchOnlySessions}, skipped=${metrics.skippedSessions}); ` +
        `${launcherStates ? `launcherStates=[${launcherStates}]; ` : ""}` +
        `loaded hot=${formatBytes(metrics.activeHotJsonBytes)}, searchOnlyHot=${formatBytes(metrics.searchOnlyHotJsonBytes)}, ` +
        `frozen=${formatBytes(metrics.frozenLogBytes)}, historyMsgs=${metrics.restoredHistoryMessages}, ` +
        `toolResults=${metrics.restoredToolResults}; eventBuffer ${metrics.eventBufferBeforeCount}->${metrics.eventBufferAfterCount} ` +
        `(${formatBytes(metrics.eventBufferBeforeBytes)}->${formatBytes(metrics.eventBufferAfterBytes)}), ` +
        `dropped=${metrics.droppedEventCount}/${formatBytes(metrics.droppedEventBytes)} ` +
        `across ${metrics.sanitizedSessions} session(s)${droppedTypes ? ` [${droppedTypes}]` : ""}; ` +
        `rss=${formatBytes(memory.rss)}, heapUsed=${formatBytes(memory.heapUsed)}, external=${formatBytes(memory.external)}`,
    );
  }

  // ─── Freeze logic ───────────────────────────────────────────────────────

  /**
   * Find the freeze boundary in messageHistory. Returns the number of
   * messages from the start that belong to completed turns (everything
   * up to and including the last `result` message). Messages after that
   * are the current in-progress turn and stay "hot".
   */
  private computeFreezeCutoff(messages: BrowserIncomingMessage[]): number {
    let cutoff = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if ((messages[i] as { type: string }).type === "result") {
        cutoff = i + 1;
        break;
      }
    }
    for (let i = 0; i < cutoff; i++) {
      const message = messages[i];
      if (
        message?.type === "codex_auto_pause_recovery_summary" &&
        !isCodexAutoPauseRecoverySummaryFinal(message.recovery)
      ) {
        return i;
      }
    }
    return cutoff;
  }

  private static toolResultPreviewReplayKey(message: BrowserIncomingMessage): string | null {
    if (message.type !== "tool_result_preview" || !Array.isArray(message.previews) || message.previews.length === 0) {
      return null;
    }
    return valueDigest(
      captureJson(
        message.previews.map((preview) => ({
          tool_use_id: preview.tool_use_id,
          content: preview.content,
          is_error: preview.is_error,
          total_size: preview.total_size,
          is_truncated: preview.is_truncated,
        })),
      ),
    );
  }

  private trimDuplicateReplayPreviewTail(messages: BrowserIncomingMessage[]): {
    messages: BrowserIncomingMessage[];
    removedCount: number;
  } {
    let suffixStart = messages.length;
    while (suffixStart > 0 && messages[suffixStart - 1]?.type === "tool_result_preview") {
      suffixStart--;
    }
    if (suffixStart === messages.length) return { messages, removedCount: 0 };

    const seen = new Set<string>();
    for (let i = 0; i < suffixStart; i++) {
      const key = SessionStore.toolResultPreviewReplayKey(messages[i]);
      if (key) seen.add(key);
    }

    const cleaned = messages.slice(0, suffixStart);
    let removedCount = 0;
    for (let i = suffixStart; i < messages.length; i++) {
      const key = SessionStore.toolResultPreviewReplayKey(messages[i]);
      if (!key) {
        cleaned.push(messages[i]);
        continue;
      }
      if (seen.has(key)) {
        removedCount++;
        continue;
      }
      seen.add(key);
      cleaned.push(messages[i]);
    }

    return removedCount > 0 ? { messages: cleaned, removedCount } : { messages, removedCount: 0 };
  }

  private enqueueWrite(sessionId: string, run: () => Promise<void>, coalescible = false): SessionWriteRequest {
    const queue = this.writeQueues.get(sessionId) ?? [];
    const last = queue.at(-1);
    // Never merge through an ownership barrier or change the running snapshot.
    if (coalescible && last?.coalescible && !(queue.length === 1 && this.activeWriters.has(sessionId))) {
      last.run = run;
      return last;
    }
    let resolve!: (success: boolean) => void;
    const done = new Promise<boolean>((settle) => {
      resolve = settle;
    });
    const request: SessionWriteRequest = { run, coalescible, done, resolve };
    queue.push(request);
    this.writeQueues.set(sessionId, queue);
    this.inflightWrites.add(done);
    if (!this.activeWriters.has(sessionId)) this.readyWriters.add(sessionId);
    this.pumpWrites();
    return request;
  }

  private pumpWrites(): void {
    while (this.activeWriters.size < SessionStore.MAX_ACTIVE_WRITERS && this.readyWriters.size > 0) {
      const sessionId = this.readyWriters.values().next().value!;
      this.readyWriters.delete(sessionId);
      const queue = this.writeQueues.get(sessionId)!;
      const request = queue[0]!;
      this.activeWriters.add(sessionId);
      void (async () => {
        try {
          await request.run();
          request.resolve(true);
        } catch (error) {
          request.error = error;
          console.error(`[session-store] Failed to persist session ${sessionId}:`, error);
          request.resolve(false);
        } finally {
          this.inflightWrites.delete(request.done);
          queue.shift();
          this.activeWriters.delete(sessionId);
          if (queue.length) this.readyWriters.add(sessionId);
          else this.writeQueues.delete(sessionId);
          // Rotate sessions after each commit so a busy writer cannot starve others.
          this.pumpWrites();
        }
      })();
    }
  }

  /**
   * Parse a JSONL frozen log into messages and tool results.
   * Skips the header line and gracefully handles corrupt/truncated lines.
   */
  private async readFrozenLog(sessionId: string): Promise<{
    messages: BrowserIncomingMessage[];
    toolResults: [string, { content: string; is_error: boolean; timestamp: number }][];
    rawBytes: number;
  }> {
    const messages: BrowserIncomingMessage[] = [];
    const toolResults: [string, { content: string; is_error: boolean; timestamp: number }][] = [];

    let rawBytes = 0;
    const input = createReadStream(this.frozenLogPath(sessionId));
    input.on("data", (chunk: Buffer) => {
      rawBytes += chunk.length;
    });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let isFirstNonEmpty = true;
    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (isFirstNonEmpty && parsed.v !== undefined) {
            isFirstNonEmpty = false;
            continue;
          }
          isFirstNonEmpty = false;
          if (parsed._toolResults) {
            for (const result of parsed._toolResults) toolResults.push(result);
          } else messages.push(parsed as BrowserIncomingMessage);
        } catch {
          console.warn(`[session-store] Skipping corrupt line in frozen log for ${sessionId}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      lines.close();
      input.destroy();
    }
    return { messages, toolResults, rawBytes };
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  private static extractAssistantText(msg: BrowserIncomingMessage): string {
    if (msg.type !== "assistant" || !msg.message?.content) return "";
    const blocks = msg.message.content;
    if (!Array.isArray(blocks)) return "";
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
    return texts.join(" ").trim();
  }

  static extractSearchExcerpts(messages: BrowserIncomingMessage[]): SearchExcerpt[] {
    const excerpts: SearchExcerpt[] = [];
    const MAX_CONTENT_LEN = 500;
    for (const msg of messages) {
      if (!isRootAgentHistoryMessage(msg)) continue;
      if (msg.type === "user_message") {
        const content = formatAnnotatedMessage(msg.content || "", msg.annotations).trim();
        if (!content) continue;
        excerpts.push({
          type: "user_message",
          content: content.slice(0, MAX_CONTENT_LEN),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0,
          id: msg.id,
        });
      } else if (msg.type === "markdown_report" || (msg.type === "leader_user_message" && msg.threadResponse)) {
        const content = (msg.content || "").trim();
        if (!content) continue;
        excerpts.push({
          type: "assistant",
          content: content.slice(0, MAX_CONTENT_LEN),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0,
          id: msg.id,
          ...(msg.threadKey ? { threadKey: msg.threadKey } : {}),
          ...(msg.questId ? { questId: msg.questId } : {}),
          ...(msg.threadRefs?.length ? { threadRefs: msg.threadRefs } : {}),
          threadResponse: msg.threadResponse,
        });
      } else if (msg.type === "compact_marker") {
        const summary = (msg.summary || (msg.markerKind === "session_recycled" ? "Session recycled" : "")).trim();
        if (!summary) continue;
        excerpts.push({
          type: "compact_marker",
          content: summary.slice(0, MAX_CONTENT_LEN),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0,
          id: msg.id,
          markerKind: msg.markerKind,
        });
      } else if (msg.type === "codex_auto_pause_recovery_summary") {
        const content = (msg.searchText || buildCodexAutoPauseRecoverySearchText(msg.recovery)).trim();
        if (!content) continue;
        excerpts.push({
          type: "recovery_summary",
          content: content.slice(0, CODEX_AUTO_PAUSE_RECOVERY_SEARCH_MAX_LENGTH),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0,
          id: msg.id,
        });
      } else if (msg.type === "assistant") {
        const text = SessionStore.extractAssistantText(msg);
        if (!text) continue;
        excerpts.push({
          type: "assistant",
          content: text.slice(0, MAX_CONTENT_LEN),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : 0,
          id: msg.message?.id,
          ...(msg.threadKey ? { threadKey: msg.threadKey } : {}),
          ...(msg.questId ? { questId: msg.questId } : {}),
          ...(msg.threadRefs?.length ? { threadRefs: msg.threadRefs } : {}),
          ...(msg.threadAnswer ? { threadAnswer: msg.threadAnswer } : {}),
          ...(msg.threadResponse ? { threadResponse: msg.threadResponse } : {}),
        });
      }
    }
    return excerpts;
  }

  /** Debounced write — batches rapid changes (e.g. multiple stream events). */
  save(session: PersistedSession): void {
    if (this.isHistoryRevert(session)) {
      // Do not let a subsequent append hide a shortened history inside debounce.
      this.saveSync(session);
      return;
    }
    this.requestedHistoryLengths.set(session.id, session.messageHistory.length);
    const existing = this.debounceTimers.get(session.id);
    if (existing) clearTimeout(existing);

    this.pendingSaves.set(session.id, session);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(session.id);
      this.pendingSaves.delete(session.id);
      this.saveSync(session);
    }, 150);
    this.debounceTimers.set(session.id, timer);
  }

  /** Queue the latest ordinary state immediately, coalescing only pending ordinary saves. */
  saveSync(session: PersistedSession): Promise<boolean> {
    this.cancelDebouncedSave(session.id);
    return this.queueSnapshot(session, true).done;
  }

  /** Persist this revision before its caller may transfer or remove pending ownership. */
  async saveImmediate(session: PersistedSession): Promise<void> {
    this.cancelDebouncedSave(session.id);
    const request = this.queueSnapshot(session, false);
    if (!(await request.done)) throw request.error;
  }

  /**
   * Persist in-place edits to existing history entries. The frozen log is
   * append-only, so an edited entry it already holds requires a rewrite;
   * otherwise this is an ordinary immediate save.
   */
  saveHistoryEdits(session: PersistedSession, editedIndices: readonly number[]): Promise<boolean> {
    if (this.isHistoryRevert(session)) return this.saveSync(session);
    this.cancelDebouncedSave(session.id);
    this.requestedHistoryLengths.set(session.id, session.messageHistory.length);
    return this.enqueueWrite(session.id, () => {
      // Decide when the write runs: earlier queued writes may freeze an edited entry.
      const frozen = this.frozenCounts.get(session.id) ?? session._frozenCount ?? 0;
      return this.writeSnapshot(session, editedIndices.some((index) => index < frozen) ? frozen : undefined);
    }).done;
  }

  /** Queue an ordered metadata repair; reject if its frozen prefix has since advanced. */
  async rewriteFrozenHistoryMetadata(session: PersistedSession, expectedFrozenCount: number): Promise<void> {
    const request = this.enqueueWrite(session.id, () => this.writeSnapshot(session, expectedFrozenCount));
    if (!(await request.done)) throw request.error;
  }

  private cancelDebouncedSave(sessionId: string): void {
    const timer = this.debounceTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.debounceTimers.delete(sessionId);
    this.pendingSaves.delete(sessionId);
  }

  private isHistoryRevert(session: PersistedSession): boolean {
    return (
      session.messageHistory.length <
      (this.requestedHistoryLengths.get(session.id) ?? this.frozenCounts.get(session.id) ?? session._frozenCount ?? 0)
    );
  }

  private queueSnapshot(session: PersistedSession, coalescible: boolean): SessionWriteRequest {
    const reverted = this.isHistoryRevert(session);
    this.requestedHistoryLengths.set(session.id, session.messageHistory.length);
    // A revert is an ordered operation, including when new input immediately
    // grows the same live array back past the old frozen count.
    const snapshot = reverted
      ? { ...session, messageHistory: session.messageHistory.slice(), toolResults: session.toolResults?.slice() }
      : session;
    return this.enqueueWrite(session.id, () => this.writeSnapshot(snapshot), coalescible && !reverted);
  }

  private async writeSnapshot(session: PersistedSession, repairCount?: number): Promise<void> {
    // Admission captures nested payload and pending ownership before any await.
    try {
      session = captureJson(session);
    } catch (error) {
      this.failedSaves.set(session.id, session);
      this.persistenceFailures.set(`hot:${session.id}`, error);
      throw error;
    }
    const cleaned = this.trimDuplicateReplayPreviewTail(session.messageHistory);
    const messages = cleaned.messages.slice();
    const toolResults = (session.toolResults ?? []).slice();
    const previous = this.frozenCounts.get(session.id) ?? session._frozenCount ?? 0;
    const previousTools = this.frozenToolResultCounts.get(session.id) ?? session._frozenToolResultCount ?? 0;
    if (
      repairCount !== undefined &&
      (!Number.isSafeInteger(repairCount) ||
        repairCount < 0 ||
        repairCount !== previous ||
        repairCount > messages.length)
    ) {
      throw new Error(
        `Frozen history metadata repair guard failed for ${session.id}: expected=${repairCount}, known=${previous}, history=${messages.length}`,
      );
    }
    const rewrite =
      repairCount !== undefined || previous > messages.length || this.persistenceFailures.has(`frozen:${session.id}`);
    const cutoff = repairCount ?? this.computeFreezeCutoff(messages);
    const frozenCount = rewrite ? cutoff : Math.max(previous, cutoff);
    let frozenTools = Math.min(previousTools, toolResults.length);
    if (repairCount === undefined && (rewrite || cutoff > previous)) {
      frozenTools = frozenCount > 0 ? toolResults.length : 0;
    }
    let failureKey = `hot:${session.id}`;
    try {
      // A caller can save an existing session without loading it through this
      // store first. A sidecar is only a hint: the hot head remains authoritative.
      const hints = await (this.diskHistoryHints ??= readdir(this.dir)
        .then(
          (files) =>
            new Set(
              files.flatMap((name) => {
                const match = /^(.*)\.history-[0-9a-f-]{36}\.data$/.exec(name);
                return match ? [match[1]] : [];
              }),
            ),
        )
        .catch((error) => {
          this.diskHistoryHints = undefined;
          throw error;
        }));
      if (hints.has(session.id) && !this.historyReferences.has(session.id)) {
        try {
          const hot = JSON.parse(await readFile(this.filePath(session.id), "utf8")) as PersistedSession;
          if (Object.hasOwn(hot, "_historyRef")) {
            if (!hot._historyRef || hot.id !== session.id)
              throw new SessionHistoryError("Invalid existing history head");
            this.historyReferences.set(session.id, hot._historyRef);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        hints.delete(session.id);
      }
      if (session._historyRef || this.historyReferences.has(session.id) || isLargeHistory([messages, toolResults])) {
        const head = await this.historyJournal.write(
          session.id,
          messages as unknown as JsonValue[],
          toolResults as unknown as JsonValue[],
          frozenCount,
          frozenTools,
          async (head) => {
            await replaceSessionFile(this.filePath(session.id), [
              this.encodeHotJson({ ...session, _historyRef: head }, [], [], frozenCount, frozenTools),
            ]);
          },
          this.historyReferences.get(session.id) ?? session._historyRef,
        );
        this.historyReferences.set(session.id, head);
        this.frozenCounts.set(session.id, frozenCount);
        this.frozenToolResultCounts.set(session.id, frozenTools);
        this.persistenceFailures.delete(`hot:${session.id}`);
        this.persistenceFailures.delete(`frozen:${session.id}`);
        this.failedSaves.delete(session.id);
        if (session.archived) this.historyJournal.release(session.id);
        return;
      }
      // Capture active state before the first await. Pending updates get their own
      // later admitted snapshot; completed records retain their existing finality contract.
      const data = this.encodeHotJson(
        session,
        messages.slice(frozenCount),
        toolResults.slice(frozenTools),
        frozenCount,
        frozenTools,
      );
      if (rewrite && repairCount === undefined) {
        // Revert/retry may replace a prefix. First commit a self-contained hot
        // snapshot so a crash cannot pair an old hot tail with a shorter log.
        await replaceSessionFile(this.filePath(session.id), [this.encodeHotJson(session, messages, toolResults, 0, 0)]);
        this.frozenCounts.set(session.id, 0);
        this.frozenToolResultCounts.set(session.id, 0);
      }
      if (rewrite || cutoff > previous) {
        failureKey = `frozen:${session.id}`;
        await writeFrozenHistory(
          this.frozenLogPath(session.id),
          session.id,
          messages.slice(rewrite ? 0 : previous, frozenCount),
          toolResults.slice(rewrite ? 0 : previousTools, frozenTools),
          !rewrite && previous > 0,
        );
        // These counts describe successfully synced history, even if the following
        // hot replacement fails. A retry must not append that prefix twice.
        this.frozenCounts.set(session.id, frozenCount);
        this.frozenToolResultCounts.set(session.id, frozenTools);
        this.persistenceFailures.delete(failureKey);
      }
      failureKey = `hot:${session.id}`;
      await replaceSessionFile(this.filePath(session.id), [data]);
      this.persistenceFailures.delete(failureKey);
      this.failedSaves.delete(session.id);
    } catch (error) {
      this.persistenceFailures.set(failureKey, error);
      this.failedSaves.set(session.id, session);
      throw error;
    }
  }

  private encodeHotJson(
    session: PersistedSession,
    hotMessages: BrowserIncomingMessage[],
    hotToolResults: PersistedSession["toolResults"],
    frozenMsgCount: number,
    frozenToolResultCount: number,
  ): string {
    const start = performance.now();
    const data = JSON.stringify({
      ...session,
      messageHistory: hotMessages,
      toolResults: hotToolResults,
      _frozenCount: frozenMsgCount,
      _frozenToolResultCount: frozenToolResultCount,
    });
    const elapsed = performance.now() - start;
    if (elapsed > 50)
      console.warn(
        `[session-store] Slow JSON.stringify: ${elapsed.toFixed(1)}ms, session=${session.id.slice(0, 8)}, hotMsgs=${hotMessages.length}, len=${data.length}`,
      );
    return data;
  }

  private async writeHotJson(
    session: PersistedSession,
    messages: BrowserIncomingMessage[],
    toolResults: PersistedSession["toolResults"],
    frozenCount: number,
    frozenTools: number,
  ): Promise<boolean> {
    try {
      await replaceSessionFile(this.filePath(session.id), [
        this.encodeHotJson(session, messages, toolResults, frozenCount, frozenTools),
      ]);
      this.persistenceFailures.delete(`hot:${session.id}`);
      return true;
    } catch (error) {
      this.persistenceFailures.set(`hot:${session.id}`, error);
      this.failedSaves.set(session.id, session);
      throw error;
    }
  }

  private async withSession<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    let result!: T;
    const request = this.enqueueWrite(sessionId, async () => {
      result = await run();
    });
    if (!(await request.done)) throw request.error;
    return result;
  }

  /** Load a single session from disk, combining frozen log + hot state. */
  async load(sessionId: string, restoreMetrics?: SessionRestoreMetrics): Promise<PersistedSession | null> {
    return this.withSession(sessionId, () => this.loadOwned(sessionId, restoreMetrics));
  }

  private async loadOwned(sessionId: string, restoreMetrics?: SessionRestoreMetrics): Promise<PersistedSession | null> {
    let hot: PersistedSession;
    let raw: string;
    try {
      raw = await readFile(this.filePath(sessionId), "utf-8");
      hot = JSON.parse(raw) as PersistedSession;
    } catch {
      return null;
    }

    const rawBytes = Buffer.byteLength(raw);
    raw = "";
    try {
      if (Object.hasOwn(hot, "_historyRef") && hot.id !== sessionId)
        throw new SessionHistoryError("Session history head identity mismatch");
      return await this.restoreSession(hot, rawBytes, restoreMetrics);
    } catch (error) {
      if (Object.hasOwn(hot, "_historyRef"))
        throw new SessionHistoryError(`Cannot restore committed history session ${sessionId}`, { cause: error });
      throw error;
    }
  }

  private async restoreSession(
    hot: PersistedSession,
    rawBytes: number,
    restoreMetrics?: SessionRestoreMetrics,
  ): Promise<PersistedSession> {
    const sessionId = hot.id;
    if (restoreMetrics) {
      restoreMetrics.activeSessions++;
      restoreMetrics.activeHotJsonBytes += rawBytes;
    }

    const sanitizedBuffer = this.sanitizePersistedEventBuffer(
      hot.eventBuffer,
      { isLeaderSession: hot.state.isOrchestrator === true },
      restoreMetrics,
    );
    if (sanitizedBuffer.changed) {
      hot = { ...hot, eventBuffer: sanitizedBuffer.eventBuffer };
    }

    const expectedFrozenMsgs = hot._frozenCount ?? 0;
    const expectedFrozenToolResults = hot._frozenToolResultCount ?? 0;

    if (Object.hasOwn(hot, "_historyRef")) {
      if (!hot._historyRef) throw new SessionHistoryError(`Invalid committed history reference for ${sessionId}`);
      const history = await readSessionHistory(this.dir, sessionId, hot._historyRef);
      this.historyReferences.set(sessionId, hot._historyRef);
      this.frozenCounts.set(sessionId, hot._historyRef.frozenCount);
      this.frozenToolResultCounts.set(sessionId, hot._historyRef.frozenToolCount);
      const restored = repairRestoredCodexAuthority({
        ...hot,
        messageHistory: history.messages as unknown as BrowserIncomingMessage[],
        toolResults: history.tools as unknown as PersistedSession["toolResults"],
        _frozenCount: hot._historyRef.frozenCount,
        _frozenToolResultCount: hot._historyRef.frozenToolCount,
      });
      // Offline-converted histories can predate persisted handoff edits.
      const restoredHandoffRefs = restoreUnpersistedHandoffRefs(restored.session.messageHistory);
      if (restoredHandoffRefs > 0) {
        console.warn(`[session-store] Restored ${restoredHandoffRefs} unpersisted handoff ref(s) for ${sessionId}`);
      }
      if (sanitizedBuffer.changed || restored.changed || restoredHandoffRefs > 0) {
        try {
          await this.writeSnapshot(restored.session, hot._historyRef.frozenCount);
        } catch (error) {
          // Same policy as the frozen-log path: keep the in-memory repair and retry on the next load.
          console.error(`[session-store] Failed to persist restored history repair for ${sessionId}:`, error);
        }
      }
      if (restoreMetrics) {
        restoreMetrics.restoredHistoryMessages += history.messages.length;
        restoreMetrics.restoredToolResults += history.tools.length;
      }
      return restored.session;
    }

    // No frozen data — either legacy format (full history in JSON) or a
    // brand-new session with no completed turns yet. Return as-is.
    if (expectedFrozenMsgs === 0) {
      this.frozenCounts.set(sessionId, 0);
      this.frozenToolResultCounts.set(sessionId, 0);
      const authorityRepair = repairRestoredCodexAuthority(hot);
      hot = authorityRepair.session;
      if (restoreMetrics) {
        restoreMetrics.restoredHistoryMessages += hot.messageHistory.length;
        restoreMetrics.restoredToolResults += hot.toolResults?.length ?? 0;
      }
      if (sanitizedBuffer.changed || authorityRepair.changed) {
        await this.writeHotJson(hot, hot.messageHistory, hot.toolResults ?? [], 0, expectedFrozenToolResults);
      }
      return hot;
    }

    // Read the frozen JSONL log
    const frozen = await this.readFrozenLog(sessionId);
    const actualFrozenMsgs = frozen.messages.length;
    if (restoreMetrics) {
      restoreMetrics.frozenLogBytes += frozen.rawBytes;
    }

    // Crash recovery: JSONL may have more lines than the hot JSON expects
    // (crash between JSONL append and hot JSON write). Trim overlap from
    // both messages and tool results to avoid duplicates.
    let hotTail = hot.messageHistory;
    let hotTailToolResults = hot.toolResults ?? [];
    if (actualFrozenMsgs > expectedFrozenMsgs) {
      const overlap = actualFrozenMsgs - expectedFrozenMsgs;
      hotTail = hot.messageHistory.slice(overlap);
    }
    if (frozen.toolResults.length > expectedFrozenToolResults) {
      const trOverlap = frozen.toolResults.length - expectedFrozenToolResults;
      hotTailToolResults = hotTailToolResults.slice(trOverlap);
    }

    // Handle JSONL truncation: if the frozen log has FEWER messages than
    // expected (e.g., JSONL was corrupted/truncated), log a warning. The
    // missing messages are lost — the frozen log is the source of truth.
    if (actualFrozenMsgs < expectedFrozenMsgs) {
      console.warn(
        `[session-store] Frozen log for ${sessionId} has ${actualFrozenMsgs} messages but expected ${expectedFrozenMsgs}. ` +
          `${expectedFrozenMsgs - actualFrozenMsgs} messages may have been lost due to JSONL corruption.`,
      );
    }

    // Merge tool results: frozen first, then hot
    const mergedToolResults: PersistedSession["toolResults"] = [...frozen.toolResults, ...hotTailToolResults];

    const mergedHistory = [...frozen.messages, ...hotTail];
    const cleanedHistory = this.trimDuplicateReplayPreviewTail(mergedHistory);
    const cleanedHotTail = cleanedHistory.messages.slice(actualFrozenMsgs);

    if (cleanedHistory.removedCount > 0) {
      console.warn(
        `[session-store] Repaired ${cleanedHistory.removedCount} duplicate replay-generated tool_result_preview messages ` +
          `from persisted hot tail for session ${sessionId.slice(0, 8)}`,
      );
    }
    let restored: PersistedSession = {
      ...hot,
      messageHistory: cleanedHistory.messages,
      toolResults: mergedToolResults,
      _frozenCount: actualFrozenMsgs,
      _frozenToolResultCount: frozen.toolResults.length,
    };
    const authorityRepair = repairRestoredCodexAuthority(restored);
    restored = authorityRepair.session;
    const restoredHandoffRefs = restoreUnpersistedHandoffRefs(restored.messageHistory);
    if (restoredHandoffRefs > 0) {
      console.warn(`[session-store] Restored ${restoredHandoffRefs} unpersisted handoff ref(s) for ${sessionId}`);
    }

    this.frozenCounts.set(sessionId, actualFrozenMsgs);
    this.frozenToolResultCounts.set(sessionId, frozen.toolResults.length);
    if (authorityRepair.changed || restoredHandoffRefs > 0) {
      try {
        await this.writeSnapshot(restored, actualFrozenMsgs);
      } catch (error) {
        // Keep the in-memory repair even if persistence fails. The same
        // repair will retry on the next load before browser subscribe.
        console.error(`[session-store] Failed to persist restored history repair for ${sessionId}:`, error);
      }
    } else if (cleanedHistory.removedCount > 0 || sanitizedBuffer.changed) {
      await this.writeHotJson(
        restored,
        cleanedHotTail,
        hotTailToolResults,
        actualFrozenMsgs,
        frozen.toolResults.length,
      );
    }
    if (restoreMetrics) {
      restoreMetrics.restoredHistoryMessages += cleanedHistory.messages.length;
      restoreMetrics.restoredToolResults += mergedToolResults.length;
    }
    return restored;
  }

  /** Load only search-relevant data for an archived session (skips JSONL frozen log). */
  async loadSearchDataOnly(sessionId: string): Promise<PersistedSession | null> {
    let hot: PersistedSession;
    try {
      const raw = await readFile(this.filePath(sessionId), "utf-8");
      hot = JSON.parse(raw) as PersistedSession;
    } catch {
      return null;
    }

    return this.buildSearchDataOnlySession(hot);
  }

  /** Load all sessions from disk. */
  async loadAll(): Promise<PersistedSession[]> {
    const sessions: PersistedSession[] = [];
    const metrics = this.createRestoreMetrics();
    try {
      const launcherRestoreState = await this.loadLauncherRestoreState(metrics);
      const files = (await readdir(this.dir)).filter(
        (f) => f !== "launcher.json" && !isModelProvenanceMigrationAcknowledgementStateFile(f) && f.endsWith(".json"),
      );
      for (const file of files) {
        const sessionId = file.replace(/\.json$/, "");
        let incremental = false;
        try {
          await this.withSession(sessionId, async () => {
            // Peek at hot JSON to check archived flag before deciding load path
            let raw: string;
            try {
              raw = await readFile(this.filePath(sessionId), "utf-8");
            } catch {
              metrics.skippedSessions++;
              return;
            }
            const hot = JSON.parse(raw) as PersistedSession;
            incremental = Object.hasOwn(hot, "_historyRef");
            if (incremental && hot.id !== sessionId)
              throw new SessionHistoryError("Session history head identity mismatch");
            const rawBytes = Buffer.byteLength(raw);
            raw = "";
            metrics.totalSessions++;

            const launcherState = launcherRestoreState.get(hot.id);
            if (hot.archived || launcherState?.archived) {
              metrics.searchOnlySessions++;
              metrics.searchOnlyHotJsonBytes += rawBytes;
              // Search-data-only: skip JSONL frozen log entirely
              sessions.push(this.buildSearchDataOnlySession(hot, launcherState));
            } else {
              const session = await this.restoreSession(hot, rawBytes, metrics);
              if (session) sessions.push(session);
            }
          });
        } catch (error) {
          if (incremental)
            throw new SessionHistoryError(`Cannot restore committed history session ${sessionId}`, { cause: error });
          if (error instanceof SessionHistoryError) throw error;
          // Skip corrupt files
          metrics.skippedSessions++;
        }
      }
    } catch (error) {
      if (error instanceof SessionHistoryError) throw error;
      // Dir doesn't exist yet
    }
    if (metrics.totalSessions > 0 || metrics.skippedSessions > 0) {
      this.logRestoreMetrics(metrics);
    }
    return sessions;
  }

  /** Set the archived flag on a persisted session. Extracts search excerpts when archiving. */
  async setArchived(sessionId: string, archived: boolean): Promise<boolean> {
    // Commit already accepted debounced state before reading and changing its
    // archived flag. A later timer must not restore an older unarchived snapshot.
    const pending = this.pendingSaves.get(sessionId);
    if (pending) this.saveSync(pending);
    return this.withSession(sessionId, async () => {
      const session = await this.loadOwned(sessionId);
      if (!session) return false;
      session.archived = archived;
      session.archivedAt = archived ? Date.now() : undefined;
      if (archived) session._searchExcerpts = SessionStore.extractSearchExcerpts(session.messageHistory);
      await this.writeSnapshot(session);
      return true;
    });
  }

  /** Flush accepted state, including writes queued while earlier saves settle. Reject on unsaved data. */
  async flushAll(): Promise<void> {
    do {
      for (const timer of this.debounceTimers.values()) clearTimeout(timer);
      const pending = [...this.pendingSaves.values()];
      this.debounceTimers.clear();
      this.pendingSaves.clear();
      for (const session of pending) this.saveSync(session);
      await Promise.allSettled([...this.inflightWrites]);
    } while (this.pendingSaves.size > 0 || this.inflightWrites.size > 0);
    if (this.persistenceFailures.size > 0) {
      throw new AggregateError(
        [...this.persistenceFailures.values()],
        `Unsaved session state: ${[...this.persistenceFailures.keys()].join(", ")}`,
      );
    }
  }

  /** Remove a session's files from disk (hot JSON + frozen log). */
  remove(sessionId: string): void {
    this.cancelDebouncedSave(sessionId);
    this.enqueueWrite(sessionId, async () => {
      const generations = (await readdir(this.dir)).filter(
        (name) =>
          name.startsWith(`${sessionId}.history-`) &&
          /^[0-9a-f-]{36}\.data$/.test(name.slice(`${sessionId}.history-`.length)),
      );
      for (const path of [
        this.filePath(sessionId),
        this.frozenLogPath(sessionId),
        ...generations.map((name) => join(this.dir, name)),
      ]) {
        try {
          await unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      this.historyJournal.release(sessionId);
      this.historyReferences.delete(sessionId);
      (await this.diskHistoryHints)?.delete(sessionId);
      this.frozenCounts.delete(sessionId);
      this.frozenToolResultCounts.delete(sessionId);
      this.requestedHistoryLengths.delete(sessionId);
      this.failedSaves.delete(sessionId);
      this.persistenceFailures.delete(`hot:${sessionId}`);
      this.persistenceFailures.delete(`frozen:${sessionId}`);
    });
  }

  /** Persist launcher state (separate file). */
  saveLauncher(data: unknown): void {
    const dataJson = JSON.stringify(data, null, 2);
    const p = this.launcherWrite
      .then(() => writeFile(join(this.dir, "launcher.json"), dataJson, "utf-8"))
      .then(() => {
        this.persistenceFailures.delete("launcher");
      })
      .catch((err) => {
        this.persistenceFailures.set("launcher", err);
        console.error("[session-store] Failed to save launcher state:", err);
      })
      .finally(() => {
        this.inflightWrites.delete(p);
      });
    this.launcherWrite = p;
    this.inflightWrites.add(p);
  }

  /** Load launcher state. */
  async loadLauncher<T>(): Promise<T | null> {
    try {
      const raw = await readFile(join(this.dir, "launcher.json"), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  get directory(): string {
    return this.dir;
  }
}
