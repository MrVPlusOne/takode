import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type {
  CodexNativeSubagentCoverage,
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatus,
  CodexNativeSubagentSummary,
  CodexNativeSubagentTranscriptAvailability,
} from "../../shared/codex-native-subagent-types.js";
import type { BrowserIncomingMessage, ChatMessage } from "../types.js";
import { useStore } from "../store.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { fetchCodexNativeSubagentHistory, type CodexNativeSubagentHistoryPage } from "../api/codex-native-subagents.js";
import { CodexSubagentTranscript } from "./CodexSubagentTranscript.js";

const HISTORY_PAGE_SIZE = 30;
const MAX_CACHED_HISTORY_MESSAGES = 180;
const MAX_CACHED_HISTORY_PAGES = 6;
const MAX_CACHED_HISTORY_CHILDREN = 12;
const HISTORY_REFRESH_DEBOUNCE_MS = 150;

const ACTIVE_STATUSES = new Set<CodexNativeSubagentStatus>(["starting", "working", "waiting"]);
const UNRESOLVED_STATUSES = new Set<CodexNativeSubagentStatus>(["failed", "interrupted", "unknown"]);

const STATUS_LABELS: Record<CodexNativeSubagentStatus, string> = {
  starting: "Starting",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  unknown: "Unknown",
};

const STATUS_CLASSES: Record<CodexNativeSubagentStatus, string> = {
  starting: "border-cc-info/25 bg-cc-info/10 text-cc-info",
  working: "border-cc-success/25 bg-cc-success/10 text-cc-success",
  waiting: "border-cc-warning/25 bg-cc-warning/10 text-cc-warning",
  done: "border-cc-border bg-cc-hover text-cc-muted",
  failed: "border-cc-error/25 bg-cc-error/10 text-cc-error",
  interrupted: "border-cc-warning/25 bg-cc-warning/10 text-cc-warning",
  unknown: "border-cc-border bg-cc-hover text-cc-muted",
};

type ChildGroup = {
  title: "Active" | "Unresolved" | "History";
  description: string;
  children: CodexNativeSubagentSummary[];
};

interface HistoryCacheEntry {
  version: string;
  messages: BrowserIncomingMessage[];
  chatMessages: ChatMessage[];
  nextCursor: string | null;
  availability: CodexNativeSubagentTranscriptAvailability;
  coverage: CodexNativeSubagentCoverage;
  pageCount: number;
  bounded: boolean;
}

type HistoryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; entry: HistoryCacheEntry; loadingMore?: boolean }
  | { phase: "error"; entry?: HistoryCacheEntry };

function childVersion(child: CodexNativeSubagentSummary): string {
  return [child.lastActivityAt ?? "", child.endedAt ?? "", child.statusObservedAt, child.transcriptAvailability].join(
    ":",
  );
}

function stableChildSort(a: CodexNativeSubagentSummary, b: CodexNativeSubagentSummary): number {
  return a.spawnOrder - b.spawnOrder || a.depth - b.depth || a.agentPath.localeCompare(b.agentPath);
}

export function groupCodexNativeSubagents(children: CodexNativeSubagentSummary[]): ChildGroup[] {
  const sorted = [...children].sort(stableChildSort);
  return [
    {
      title: "Active",
      description: "Starting, working, or explicitly waiting",
      children: sorted.filter((child) => ACTIVE_STATUSES.has(child.status)),
    },
    {
      title: "Unresolved",
      description: "Failed, interrupted, or lacking safe terminal proof",
      children: sorted.filter((child) => UNRESOLVED_STATUSES.has(child.status)),
    },
    {
      title: "History",
      description: "Completed child tasks",
      children: sorted.filter((child) => child.status === "done"),
    },
  ];
}

function formatRelativeTime(timestamp: number | undefined, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "No activity time";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 10_000) return "Just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function transcriptLabel(availability: CodexNativeSubagentTranscriptAvailability): string {
  if (availability === "available") return "Transcript available";
  if (availability === "partial") return "Transcript partial";
  return "Transcript unavailable";
}

function mergeAvailability(
  current: CodexNativeSubagentTranscriptAvailability,
  next: CodexNativeSubagentTranscriptAvailability,
  hasMessages: boolean,
): CodexNativeSubagentTranscriptAvailability {
  if (current === "available" && next === "available") return "available";
  if (!hasMessages && current === "unavailable" && next === "unavailable") return "unavailable";
  return "partial";
}

function normalizeHistoryMessages(messages: BrowserIncomingMessage[], offset: number): ChatMessage[] {
  const normalized = messages.flatMap((message, index) =>
    normalizeHistoryMessageToChatMessages(message, message.history_index ?? offset + index, {
      includeSuccessfulResult: true,
      fallbackTimestamp: Date.now(),
    }),
  );
  const seen = new Set<string>();
  return normalized.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function mergeHistoryPage(
  current: HistoryCacheEntry | null,
  page: CodexNativeSubagentHistoryPage,
  version: string,
): HistoryCacheEntry {
  const priorMessages = current?.messages ?? [];
  const availableSlots = Math.max(0, MAX_CACHED_HISTORY_MESSAGES - priorMessages.length);
  // History cursors move toward older records. When a server page exceeds the
  // remaining local budget, retain the records nearest the already-loaded page.
  const acceptedPageMessages = page.messages.slice(Math.max(0, page.messages.length - availableSlots));
  const combinedMessages = current ? [...acceptedPageMessages, ...priorMessages] : acceptedPageMessages;
  const messages = combinedMessages.every((message) => typeof message.history_index === "number")
    ? [...combinedMessages].sort((a, b) => a.history_index! - b.history_index!)
    : combinedMessages;
  const pageCount = (current?.pageCount ?? 0) + 1;
  const locallyTruncated = acceptedPageMessages.length < page.messages.length;
  const reachedLocalBound = pageCount >= MAX_CACHED_HISTORY_PAGES || messages.length >= MAX_CACHED_HISTORY_MESSAGES;
  const stoppedWithMore = locallyTruncated || (reachedLocalBound && page.nextCursor !== null);
  const chatMessages = normalizeHistoryMessages(messages, 0);
  const availability = current
    ? mergeAvailability(current.availability, page.availability, messages.length > 0)
    : page.availability;

  return {
    version,
    messages,
    chatMessages,
    nextCursor: stoppedWithMore ? null : page.nextCursor,
    availability,
    coverage: current?.coverage === "partial" || page.coverage === "partial" ? "partial" : "complete",
    pageCount,
    bounded: stoppedWithMore,
  };
}

function historyMessageIdentity(message: BrowserIncomingMessage, fallbackIndex: number): string {
  if (message.type === "assistant") {
    return `assistant:${message.message.id || fallbackIndex}`;
  }
  if (message.type === "user_message") {
    return `user:${message.id ?? message.client_msg_id ?? fallbackIndex}`;
  }
  if (message.type === "codex_reasoning_detail") {
    return `reasoning:${message.id ?? fallbackIndex}`;
  }
  const historyIndex = (message as { history_index?: unknown }).history_index;
  return `${message.type}:${typeof historyIndex === "number" ? historyIndex : fallbackIndex}`;
}

/** Merge a refreshed newest page without discarding older pages already loaded by the user. */
function mergeRefreshedHistoryHead(
  current: HistoryCacheEntry,
  page: CodexNativeSubagentHistoryPage,
  version: string,
): HistoryCacheEntry {
  const currentIds = new Set(current.messages.map((message, index) => historyMessageIdentity(message, index)));
  const refreshedById = new Map(
    page.messages.map((message, index) => [historyMessageIdentity(message, index), message] as const),
  );
  const combined = current.messages.map(
    (message, index) => refreshedById.get(historyMessageIdentity(message, index)) ?? message,
  );
  for (let index = 0; index < page.messages.length; index++) {
    const message = page.messages[index]!;
    if (!currentIds.has(historyMessageIdentity(message, index))) combined.push(message);
  }
  const sorted = combined.every((message) => typeof message.history_index === "number")
    ? [...combined].sort((left, right) => left.history_index! - right.history_index!)
    : combined;
  const locallyTruncated = sorted.length > MAX_CACHED_HISTORY_MESSAGES;
  const messages = locallyTruncated ? sorted.slice(-MAX_CACHED_HISTORY_MESSAGES) : sorted;
  return {
    ...current,
    version,
    messages,
    chatMessages: normalizeHistoryMessages(messages, 0),
    availability: mergeAvailability(current.availability, page.availability, messages.length > 0),
    coverage: current.coverage === "partial" || page.coverage === "partial" ? "partial" : "complete",
    bounded: current.bounded || locallyTruncated,
  };
}

function cacheHistoryEntry(cache: Map<string, HistoryCacheEntry>, key: string, entry: HistoryCacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHED_HISTORY_CHILDREN) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function readCachedHistoryEntry(cache: Map<string, HistoryCacheEntry>, key: string): HistoryCacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]",
    ),
  ].filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      element.tabIndex >= 0 &&
      element.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });
}

function ScopeSummary({
  snapshot,
  scopeTurnId,
}: {
  snapshot: CodexNativeSubagentSnapshot | undefined;
  scopeTurnId: string | undefined;
}) {
  if (!snapshot) return <span>Availability unknown</span>;
  const aggregate = scopeTurnId ? snapshot.turns[scopeTurnId] : null;
  const total = aggregate?.total ?? (scopeTurnId ? 0 : snapshot.session.total);
  const coverage = aggregate?.coverage ?? snapshot.coverage;
  if (coverage === "partial") {
    return <span>{total > 0 ? `${total}+ verified` : "Partial coverage"}</span>;
  }
  return <span>{`${total} ${scopeTurnId ? "in this turn" : "session-wide"}`}</span>;
}

function StatusBadge({ status }: { status: CodexNativeSubagentStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ChildRow({
  child,
  selected,
  onSelect,
  onNavigate,
  buttonRef,
}: {
  child: CodexNativeSubagentSummary;
  selected: boolean;
  onSelect: () => void;
  onNavigate: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const indent = Math.min(Math.max(child.depth, 0), 3) * 12;
  const recentAt = child.lastActivityAt ?? child.endedAt ?? child.startedAt ?? child.statusObservedAt;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      onKeyDown={onNavigate}
      className={`group flex min-h-14 w-full min-w-0 items-start gap-2 border-l-2 py-2.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cc-primary/45 ${
        selected
          ? "border-l-cc-primary bg-cc-primary/8"
          : "border-l-transparent hover:border-l-cc-border hover:bg-cc-hover"
      }`}
      style={{ paddingLeft: `${12 + indent}px` }}
      aria-current={selected ? "true" : undefined}
      aria-label={`${child.displayName}, ${STATUS_LABELS[child.status]}, ${transcriptLabel(child.transcriptAvailability)}`}
      data-codex-child-row="true"
      data-child-depth={child.depth}
    >
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cc-primary/10 text-cc-primary">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
          <path d="M3 3.5h3A2.5 2.5 0 018.5 6v4A2.5 2.5 0 0011 12.5h2" />
          <circle cx="3" cy="3.5" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="13" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold text-cc-fg">{child.displayName}</span>
          <StatusBadge status={child.status} />
        </span>
        <span className="mt-0.5 block truncate font-mono-code text-[10px] text-cc-muted">{child.agentPath}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-cc-muted">
          <span>{formatRelativeTime(recentAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{transcriptLabel(child.transcriptAvailability)}</span>
          {child.depth > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>Nested level {child.depth}</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function EmptyListState({
  snapshot,
  scopeTurnId,
}: {
  snapshot: CodexNativeSubagentSnapshot | undefined;
  scopeTurnId: string | undefined;
}) {
  if (!snapshot) {
    return (
      <div className="m-4 rounded-xl border border-dashed border-cc-border bg-cc-hover/40 px-4 py-8 text-center">
        <p className="text-sm font-medium text-cc-fg">Native child activity unavailable</p>
        <p className="mt-1 text-xs leading-relaxed text-cc-muted">
          This session has not provided a browser-safe Codex subagent snapshot.
        </p>
      </div>
    );
  }

  const scopedAggregate = scopeTurnId ? snapshot.turns[scopeTurnId] : null;
  const coverage = scopedAggregate?.coverage ?? snapshot.coverage;
  if (coverage === "partial") {
    return (
      <div className="m-4 rounded-xl border border-cc-warning/25 bg-cc-warning/8 px-4 py-8 text-center">
        <p className="text-sm font-medium text-cc-fg">No verified subagents in this view</p>
        <p className="mt-1 text-xs leading-relaxed text-cc-muted">
          Coverage is partial, so this is not an authoritative zero.
        </p>
      </div>
    );
  }

  return (
    <div className="m-4 rounded-xl border border-dashed border-cc-border bg-cc-hover/40 px-4 py-8 text-center">
      <p className="text-sm font-medium text-cc-fg">No native Codex subagents</p>
      <p className="mt-1 text-xs leading-relaxed text-cc-muted">
        {scopeTurnId ? "No native child was recorded for this turn." : "No native child was recorded for this session."}
      </p>
    </div>
  );
}

function TranscriptNotice({
  availability,
  coverage,
}: {
  availability: CodexNativeSubagentTranscriptAvailability;
  coverage: CodexNativeSubagentCoverage;
}) {
  if (availability === "available" && coverage === "complete") return null;
  const unavailable = availability === "unavailable";
  return (
    <div
      className={`mx-3 mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
        unavailable
          ? "border-cc-border bg-cc-hover/60 text-cc-muted"
          : "border-cc-warning/25 bg-cc-warning/8 text-cc-warning"
      }`}
      role="status"
    >
      <span className="font-semibold">{unavailable ? "Transcript unavailable." : "Transcript partial."}</span>{" "}
      {unavailable
        ? "No safe child-owned history can be shown."
        : "Only the identity-proven child-owned subset is shown; inherited or legacy-flattened content is omitted."}
    </div>
  );
}

function HistoryContent({
  sessionId,
  child,
  history,
  onRetry,
  onLoadMore,
}: {
  sessionId: string;
  child: CodexNativeSubagentSummary;
  history: HistoryState;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (child.transcriptAvailability === "unavailable") {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-medium text-cc-fg">Transcript unavailable</p>
          <p className="mt-1 text-xs leading-relaxed text-cc-muted">
            Takode could not prove a safe child-only history boundary. Existing flattened activity remains in the main
            feed.
          </p>
        </div>
      </div>
    );
  }

  if (history.phase === "loading" || history.phase === "idle") {
    return (
      <div className="flex flex-1 items-center justify-center p-6" role="status" aria-label="Loading child history">
        <div className="flex items-center gap-2 text-xs text-cc-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cc-border border-t-cc-primary" />
          Loading bounded history…
        </div>
      </div>
    );
  }

  if (history.phase === "error" && !history.entry) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-medium text-cc-fg">Child history could not be loaded</p>
          <p className="mt-1 text-xs leading-relaxed text-cc-muted">
            The summary remains available. Backend diagnostics are intentionally not echoed here.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-10 rounded-lg border border-cc-border bg-cc-card px-3 text-xs font-medium text-cc-fg hover:bg-cc-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const entry = history.entry;
  if (!entry) return null;

  if (entry.availability === "unavailable") {
    return (
      <div className="flex flex-1 flex-col">
        <TranscriptNotice availability={entry.availability} coverage={entry.coverage} />
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="max-w-sm text-xs leading-relaxed text-cc-muted">
            No safe child-owned records are available for this subagent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TranscriptNotice availability={entry.availability} coverage={entry.coverage} />
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 sm:px-4"
        data-testid="codex-subagent-history"
      >
        {entry.chatMessages.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center text-center">
            <div className="max-w-sm">
              <p className="text-sm font-medium text-cc-fg">
                {entry.coverage === "complete" ? "No child-owned messages" : "No verified child-owned messages"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-cc-muted">
                {entry.coverage === "complete"
                  ? "The bounded transcript is authoritatively empty."
                  : "Coverage is partial, so inherited or legacy-flattened content may exist outside this view."}
              </p>
            </div>
          </div>
        ) : (
          <CodexSubagentTranscript sessionId={sessionId} messages={entry.chatMessages} />
        )}
        {history.phase === "error" && (
          <div className="mt-3 rounded-lg border border-cc-warning/25 bg-cc-warning/8 px-3 py-2 text-center text-[11px] text-cc-warning">
            More history could not be loaded. The records already shown are unchanged.
          </div>
        )}
        {entry.nextCursor && !entry.bounded && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={history.phase === "ready" && history.loadingMore}
              className="min-h-10 rounded-lg border border-cc-border bg-cc-card px-4 text-xs font-medium text-cc-fg hover:bg-cc-hover disabled:cursor-wait disabled:opacity-60"
            >
              {history.phase === "ready" && history.loadingMore
                ? "Loading…"
                : history.phase === "error"
                  ? "Retry older history"
                  : "Load older history"}
            </button>
          </div>
        )}
        {entry.bounded && (
          <p className="px-3 py-4 text-center text-[10px] leading-relaxed text-cc-muted">
            This read-only view reached its {MAX_CACHED_HISTORY_MESSAGES}-record safety bound. More history remains on
            the server.
          </p>
        )}
      </div>
    </div>
  );
}

export function CodexSubagentInspector({ sessionId }: { sessionId: string }) {
  const inspector = useStore((state) => state.codexSubagentInspector);
  const snapshot = useStore((state) => state.sessions.get(sessionId)?.codex_native_subagents);
  const closeInspector = useStore((state) => state.closeCodexSubagentInspector);
  const openInspector = useStore((state) => state.openCodexSubagentInspector);
  const selectChild = useStore((state) => state.selectCodexSubagentInspectorChild);
  const requestScrollToTurn = useStore((state) => state.requestScrollToTurn);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const isOpen = inspector?.sessionId === sessionId;
  const scopeTurnId = isOpen ? inspector.scopeTurnId : undefined;
  const selectedChildId = isOpen ? inspector.selectedChildId : undefined;
  const visibleChildren = useMemo(
    () => (snapshot?.children ?? []).filter((child) => !scopeTurnId || child.rootTurnId === scopeTurnId),
    [scopeTurnId, snapshot],
  );
  const groups = useMemo(() => groupCodexNativeSubagents(visibleChildren), [visibleChildren]);
  const selectedChild = useMemo(
    () => visibleChildren.find((child) => child.childId === selectedChildId),
    [selectedChildId, visibleChildren],
  );
  const childById = useMemo(
    () => new Map((snapshot?.children ?? []).map((child) => [child.childId, child])),
    [snapshot],
  );
  const breadcrumb = useMemo(() => {
    if (!selectedChild) return [];
    const lineage: CodexNativeSubagentSummary[] = [];
    const visited = new Set<string>();
    let cursor: CodexNativeSubagentSummary | undefined = selectedChild;
    while (cursor && !visited.has(cursor.childId)) {
      lineage.unshift(cursor);
      visited.add(cursor.childId);
      cursor = cursor.parentChildId ? childById.get(cursor.parentChildId) : undefined;
    }
    return lineage;
  }, [childById, selectedChild]);
  const [history, setHistory] = useState<HistoryState>({ phase: "idle" });
  const historyCacheRef = useRef(new Map<string, HistoryCacheEntry>());
  const requestRef = useRef<AbortController | null>(null);
  const refreshRequestRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedChildRef = useRef<CodexNativeSubagentSummary | undefined>(selectedChild);
  selectedChildRef.current = selectedChild;
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileBackButtonRef = useRef<HTMLButtonElement>(null);
  const childRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousSelectedChildIdRef = useRef<string | undefined>(undefined);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const fetchFirstPage = useCallback(
    async (child: CodexNativeSubagentSummary, force = false) => {
      const key = `${sessionId}:${child.childId}`;
      const version = childVersion(child);
      const cached = readCachedHistoryEntry(historyCacheRef.current, key);
      if (!force && cached) {
        // Show cached pages immediately. If activity advanced, a debounced head
        // refresh below will merge new records without throwing older pages away.
        setHistory({ phase: "ready", entry: cached });
        return;
      }

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setHistory({ phase: "loading" });
      try {
        const page = await fetchCodexNativeSubagentHistory({
          sessionId,
          childId: child.childId,
          limit: HISTORY_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const conservativePage =
          child.transcriptAvailability === "partial" && page.availability === "available"
            ? { ...page, availability: "partial" as const }
            : page;
        const entry = mergeHistoryPage(null, conservativePage, version);
        cacheHistoryEntry(historyCacheRef.current, key, entry);
        setHistory({ phase: "ready", entry });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setHistory({ phase: "error" });
      }
    },
    [sessionId],
  );

  const selectedChildHistoryKey = selectedChild
    ? `${selectedChild.childId}:${selectedChild.transcriptAvailability}`
    : null;

  useEffect(() => {
    const child = selectedChildRef.current;
    if (!isOpen || !child || child.transcriptAvailability === "unavailable") {
      requestRef.current?.abort();
      refreshRequestRef.current?.abort();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      setHistory({ phase: "idle" });
      return;
    }
    void fetchFirstPage(child);
    return () => {
      requestRef.current?.abort();
      refreshRequestRef.current?.abort();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchFirstPage, isOpen, selectedChildHistoryKey]);

  const refreshFirstPage = useCallback(
    async (child: CodexNativeSubagentSummary) => {
      const key = `${sessionId}:${child.childId}`;
      const cached = readCachedHistoryEntry(historyCacheRef.current, key);
      const version = childVersion(child);
      if (!cached || cached.version === version) return;

      refreshRequestRef.current?.abort();
      const controller = new AbortController();
      refreshRequestRef.current = controller;
      try {
        const page = await fetchCodexNativeSubagentHistory({
          sessionId,
          childId: child.childId,
          limit: HISTORY_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted || selectedChildRef.current?.childId !== child.childId) return;
        const conservativePage =
          child.transcriptAvailability === "partial" && page.availability === "available"
            ? { ...page, availability: "partial" as const }
            : page;
        setHistory((current) => {
          const currentEntry = current.phase === "ready" || current.phase === "error" ? current.entry : undefined;
          if (!currentEntry) return current;
          const entry = mergeRefreshedHistoryHead(currentEntry, conservativePage, version);
          cacheHistoryEntry(historyCacheRef.current, key, entry);
          return { phase: "ready", entry };
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        // A background refresh must never replace already-readable cached history
        // with an error state. The next authoritative activity update can retry.
      }
    },
    [sessionId],
  );

  const selectedChildVersion = selectedChild ? childVersion(selectedChild) : null;
  useEffect(() => {
    if (
      !isOpen ||
      !selectedChild ||
      selectedChild.transcriptAvailability === "unavailable" ||
      (history.phase !== "ready" && history.phase !== "error") ||
      !history.entry ||
      history.entry.version === selectedChildVersion
    ) {
      return;
    }
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshFirstPage(selectedChild);
    }, HISTORY_REFRESH_DEBOUNCE_MS);
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [history, isOpen, refreshFirstPage, selectedChild?.childId, selectedChildVersion]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeInspector();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.body.style.overflow = previousOverflow;
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, [closeInspector, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousSelectedChildId = previousSelectedChildIdRef.current;
    previousSelectedChildIdRef.current = selectedChildId;
    const singlePane =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 1023px)").matches
        : window.innerWidth < 1024;
    if (!singlePane) return;
    const frame = requestAnimationFrame(() => {
      if (selectedChildId) {
        mobileBackButtonRef.current?.focus();
      } else if (previousSelectedChildId) {
        childRowRefs.current.get(previousSelectedChildId)?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, selectedChildId]);

  const loadMore = useCallback(async () => {
    if (
      !selectedChild ||
      (history.phase !== "ready" && history.phase !== "error") ||
      !history.entry?.nextCursor ||
      history.entry.bounded
    )
      return;
    const current = history.entry;
    const key = `${sessionId}:${selectedChild.childId}`;
    const controller = new AbortController();
    requestRef.current = controller;
    setHistory({ phase: "ready", entry: current, loadingMore: true });
    try {
      const page = await fetchCodexNativeSubagentHistory({
        sessionId,
        childId: selectedChild.childId,
        cursor: current.nextCursor,
        limit: HISTORY_PAGE_SIZE,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const conservativePage =
        selectedChild.transcriptAvailability === "partial" && page.availability === "available"
          ? { ...page, availability: "partial" as const }
          : page;
      setHistory((state) => {
        const latest = state.phase === "ready" || state.phase === "error" ? (state.entry ?? current) : current;
        const entry = mergeHistoryPage(latest, conservativePage, childVersion(selectedChild));
        cacheHistoryEntry(historyCacheRef.current, key, entry);
        return { phase: "ready", entry };
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setHistory((state) => {
        const latest = state.phase === "ready" || state.phase === "error" ? (state.entry ?? current) : current;
        return { phase: "error", entry: latest };
      });
    }
  }, [history, selectedChild, sessionId]);

  const navigateRows = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.parentElement) return;
    const panel = event.currentTarget.closest<HTMLElement>("[data-codex-subagent-list]");
    if (!panel) return;
    const rows = [...panel.querySelectorAll<HTMLButtonElement>("[data-codex-child-row='true']")];
    const index = rows.indexOf(event.currentTarget);
    if (index < 0) return;
    let target: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") target = rows[(index + 1) % rows.length];
    if (event.key === "ArrowUp") target = rows[(index - 1 + rows.length) % rows.length];
    if (event.key === "Home") target = rows[0];
    if (event.key === "End") target = rows[rows.length - 1];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, []);

  const jumpToParentTurn = useCallback(() => {
    if (!selectedChild) return;
    setActiveTab("chat");
    closeInspector();
    requestScrollToTurn(sessionId, selectedChild.rootTurnId);
  }, [closeInspector, requestScrollToTurn, selectedChild, sessionId, setActiveTab]);

  if (!isOpen) return null;

  const hasChildren = visibleChildren.length > 0;
  const aggregate = scopeTurnId ? snapshot?.turns[scopeTurnId] : null;
  const effectiveCoverage = aggregate?.coverage ?? snapshot?.coverage;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end overflow-hidden bg-black/25"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeInspector();
      }}
      data-testid="codex-subagent-inspector-overlay"
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-subagent-inspector-title"
        className="flex h-full w-full min-w-0 flex-col overflow-x-hidden border-l border-cc-border bg-cc-bg text-cc-fg shadow-2xl sm:max-w-[48rem] lg:w-[min(48rem,70vw)]"
        data-testid="codex-subagent-inspector"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-[3.5rem] shrink-0 items-center gap-3 border-b border-cc-border bg-cc-card px-3 py-2 sm:px-4">
          {selectedChild && (
            <button
              ref={mobileBackButtonRef}
              type="button"
              onClick={() => selectChild(null)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg lg:hidden"
              aria-label="Back to Codex subagent list"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
                <path d="M10.5 3.5L6 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="codex-subagent-inspector-title" className="truncate text-sm font-semibold">
              Codex subagents
            </h2>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-cc-muted">
              <span>{scopeTurnId ? "Turn scope" : "Session scope"}</span>
              <span aria-hidden="true">·</span>
              <ScopeSummary snapshot={snapshot} scopeTurnId={scopeTurnId} />
              <span aria-hidden="true">·</span>
              <span>Read-only</span>
            </p>
          </div>
          {scopeTurnId && (
            <button
              type="button"
              onClick={() => openInspector(sessionId)}
              className="min-h-10 shrink-0 rounded-lg border border-cc-border px-2.5 text-[11px] font-medium text-cc-fg hover:bg-cc-hover"
            >
              Show all
            </button>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeInspector}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/45"
            aria-label="Close Codex subagents inspector"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {effectiveCoverage === "partial" && (
          <div
            className="shrink-0 border-b border-cc-warning/20 bg-cc-warning/8 px-3 py-2 text-[11px] leading-relaxed text-cc-warning sm:px-4"
            role="status"
          >
            <span className="font-semibold">Partial coverage.</span> Counts and rows include only verified native Codex
            children; legacy flattened activity is not reconstructed.
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={`${selectedChild ? "hidden lg:flex" : "flex"} min-h-0 w-full min-w-0 flex-col border-r-cc-border bg-cc-card/45 lg:w-[20rem] lg:shrink-0 lg:border-r`}
            aria-label="Codex subagent list"
            data-codex-subagent-list="true"
          >
            {hasChildren ? (
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2">
                {groups.map((group) => (
                  <section key={group.title} aria-labelledby={`codex-subagent-group-${group.title.toLowerCase()}`}>
                    <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-2">
                      <div className="min-w-0">
                        <h3
                          id={`codex-subagent-group-${group.title.toLowerCase()}`}
                          className="text-[11px] font-semibold uppercase tracking-[0.09em] text-cc-muted"
                        >
                          {group.title}
                        </h3>
                        <p className="sr-only">{group.description}</p>
                      </div>
                      <span
                        className="font-mono-code text-[10px] text-cc-muted"
                        aria-label={`${group.children.length} rows`}
                      >
                        {group.children.length}
                      </span>
                    </div>
                    {group.children.length > 0 ? (
                      group.children.map((child) => (
                        <ChildRow
                          key={child.childId}
                          child={child}
                          selected={selectedChildId === child.childId}
                          onSelect={() => selectChild(child.childId)}
                          onNavigate={navigateRows}
                          buttonRef={(node) => {
                            if (node) childRowRefs.current.set(child.childId, node);
                            else childRowRefs.current.delete(child.childId);
                          }}
                        />
                      ))
                    ) : (
                      <p className="px-3 pb-3 pt-1 text-[11px] text-cc-muted">None</p>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <EmptyListState snapshot={snapshot} scopeTurnId={scopeTurnId} />
            )}
          </aside>

          <main
            className={`${selectedChild ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-cc-bg`}
            aria-label="Codex subagent detail"
          >
            {selectedChild ? (
              <>
                <div className="shrink-0 border-b border-cc-border bg-cc-card/60 px-3 py-3 sm:px-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      {breadcrumb.length > 1 && (
                        <p className="mb-1 truncate text-[10px] text-cc-muted" aria-label="Subagent nesting path">
                          {breadcrumb.map((item) => item.displayName).join(" › ")}
                        </p>
                      )}
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-cc-fg">
                          {selectedChild.displayName}
                        </h3>
                        <StatusBadge status={selectedChild.status} />
                      </div>
                      <p className="mt-1 break-words font-mono-code text-[11px] text-cc-muted">
                        {selectedChild.agentPath}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-cc-muted">
                        {selectedChild.nickname && (
                          <span className="rounded bg-cc-hover px-1.5 py-0.5">Nickname: {selectedChild.nickname}</span>
                        )}
                        {selectedChild.role && (
                          <span className="rounded bg-cc-hover px-1.5 py-0.5">Role: {selectedChild.role}</span>
                        )}
                        <span className="rounded bg-cc-hover px-1.5 py-0.5">
                          {transcriptLabel(selectedChild.transcriptAvailability)}
                        </span>
                        {selectedChild.followUpAvailable !== undefined && (
                          <span className="rounded bg-cc-hover px-1.5 py-0.5">
                            Follow-up {selectedChild.followUpAvailable ? "available" : "unavailable"}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={jumpToParentTurn}
                      className="min-h-10 shrink-0 rounded-lg border border-cc-border bg-cc-card px-2.5 text-[11px] font-medium text-cc-fg hover:bg-cc-hover"
                    >
                      Jump to parent turn
                    </button>
                  </div>
                </div>
                <HistoryContent
                  sessionId={sessionId}
                  child={selectedChild}
                  history={history}
                  onRetry={() => void fetchFirstPage(selectedChild, true)}
                  onLoadMore={() => void loadMore()}
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-cc-primary/10 text-cc-primary">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-5 w-5">
                      <path d="M3 3.5h3A2.5 2.5 0 018.5 6v4A2.5 2.5 0 0011 12.5h2" />
                      <circle cx="3" cy="3.5" r="1.25" fill="currentColor" stroke="none" />
                      <circle cx="13" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
                    </svg>
                  </div>
                  <p className="mt-3 text-sm font-medium text-cc-fg">Choose a Codex subagent</p>
                  <p className="mt-1 text-xs leading-relaxed text-cc-muted">
                    Inspect bounded child-owned conversation, tool activity, and official reasoning summaries. This view
                    cannot steer or resume the child.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}
