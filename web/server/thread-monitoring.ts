import type { ThreadMonitoringState, MonitoredThreadResult } from "../shared/thread-monitoring.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import type { LeaderThreadStatus } from "../shared/thread-status-marker.js";
import type { BrowserIncomingMessage } from "./session-types.js";

export interface ThreadMonitoringSession {
  state: {
    threadMonitoring?: ThreadMonitoringState;
    leaderThreadStatuses?: Record<string, LeaderThreadStatus>;
  };
  messageHistory: readonly BrowserIncomingMessage[];
}

/**
 * Enable or stop a named-thread watch without changing notifications, read state, or tab order.
 * Enabling shows the thread's current Ready result at once unless `captureCurrentResult` is
 * false: a side quest's Ready is not a result for the user, whose answer comes where they asked.
 */
export function setThreadMonitoring(
  session: ThreadMonitoringSession,
  threadKey: string,
  enabled: boolean,
  { now = Date.now(), captureCurrentResult = true }: { now?: number; captureCurrentResult?: boolean } = {},
): boolean {
  if (!/^q-\d+$/.test(threadKey)) return false;
  const current = session.state.threadMonitoring ?? { revision: 0, alertVersion: 0, threads: {} };
  if (Boolean(current.threads[threadKey]) === enabled) return false;
  const threads = { ...current.threads };
  if (enabled) {
    const ready = session.state.leaderThreadStatuses?.[threadKey];
    threads[threadKey] = {
      trackedAt: now,
      afterHistoryIndex: latestAcceptedReadyIndex(session, threadKey),
      pending: captureCurrentResult && ready?.kind === "ready" ? pendingResult(ready, current.revision + 1) : null,
    };
  } else {
    delete threads[threadKey];
  }
  session.state.threadMonitoring = { ...current, revision: current.revision + 1, threads };
  return true;
}

/** Capture one accepted result; persisted source position fences replay after acknowledgement or restart. */
export function recordMonitoredThreadResult(session: ThreadMonitoringSession, record: LeaderThreadStatus): boolean {
  const current = session.state.threadMonitoring;
  const monitor = current?.threads[record.threadKey];
  if (!current || !monitor || record.kind !== "ready") return false;
  const sourceIndex = session.messageHistory.findIndex(
    (entry) => entry.type === "assistant" && entry.message.id === record.messageId,
  );
  if (sourceIndex <= monitor.afterHistoryIndex) return false;
  const revision = current.revision + 1;
  session.state.threadMonitoring = {
    revision,
    alertVersion: current.alertVersion + 1,
    threads: {
      ...current.threads,
      [record.threadKey]: { ...monitor, afterHistoryIndex: sourceIndex, pending: pendingResult(record, revision) },
    },
  };
  return true;
}

/** A stale acknowledgement is a no-op and can never consume a newer result. */
export function acknowledgeMonitoredThreadResult(
  session: Pick<ThreadMonitoringSession, "state">,
  threadKey: string,
  observedResultId: unknown,
): boolean {
  const current = session.state.threadMonitoring;
  const monitor = current?.threads[threadKey];
  if (!current || !monitor?.pending || monitor.pending.id !== observedResultId) return false;
  const threads = { ...current.threads, [threadKey]: { ...monitor, pending: null } };
  // Notify Me does not track Main: its monitor exists only while a reminder waits to be acknowledged.
  if (threadKey === "main") delete threads.main;
  session.state.threadMonitoring = { ...current, revision: current.revision + 1, threads };
  return true;
}

/**
 * A "Remind me later" came due: the thread enters Notify Me with a result to acknowledge,
 * pointing at its latest Ready result when it has one. A quest thread stays tracked after
 * that; Main stops once acknowledged. Returns false when a result already waits there.
 */
export function recordReminderResult(
  session: Pick<ThreadMonitoringSession, "state" | "messageHistory">,
  threadKey: string,
  summary: string,
  now = Date.now(),
  messageId?: string,
): boolean {
  const current = session.state.threadMonitoring ?? { revision: 0, alertVersion: 0, threads: {} };
  const monitor = current.threads[threadKey];
  if (monitor?.pending) return false;
  const revision = current.revision + 1;
  const ready = session.state.leaderThreadStatuses?.[threadKey];
  session.state.threadMonitoring = {
    revision,
    alertVersion: current.alertVersion + 1,
    threads: {
      ...current.threads,
      [threadKey]: {
        trackedAt: monitor?.trackedAt ?? now,
        afterHistoryIndex: monitor?.afterHistoryIndex ?? latestAcceptedReadyIndex(session, threadKey),
        pending: {
          id: String(revision),
          // The message the reminder was set from, else the thread's latest Ready result.
          messageId: messageId ?? (ready?.kind === "ready" ? ready.messageId : ""),
          timestamp: now,
          summary: summary.slice(0, 200),
          reminder: true,
        },
      },
    },
  };
  return true;
}

/**
 * Where a pending result opens: the thread's latest answer or report at or before its message,
 * back to the thread's previous Ready result. A Ready result's message is the one holding the
 * marker, and leaders often put that in a closing commentary line ("The result is reported
 * above...") after the answer the user waits for. When nothing was answered since the previous
 * result, or the message is gone from history, the result opens at its own message. A reminder
 * set from an answer opens at that answer.
 */
export function monitoredResultMessageId(
  session: Pick<ThreadMonitoringSession, "messageHistory">,
  threadKey: string,
  result: Pick<MonitoredThreadResult, "messageId">,
): string {
  const history = session.messageHistory;
  // Results are recent, so search from the end.
  const start = history.findLastIndex((entry) => historyMessageId(entry) === result.messageId);
  for (let index = start; index >= 0; index--) {
    const entry = history[index]!;
    if (index < start && isReadyFor(entry, threadKey)) break;
    const isResult =
      entry.type === "markdown_report" ||
      (entry.type === "assistant" && (!!entry.threadAnswer || entry.leaderThreadRole === "answer"));
    if (isResult && leaderMessageThreadKey(entry) === threadKey) return historyMessageId(entry)!;
  }
  return result.messageId;
}

function historyMessageId(entry: BrowserIncomingMessage): string | undefined {
  if (entry.type === "assistant") return entry.message.id;
  if (entry.type === "markdown_report") return entry.id;
  return undefined;
}

function isReadyFor(entry: BrowserIncomingMessage, threadKey: string): boolean {
  return (
    entry.type === "assistant" &&
    !!entry.threadStatusMarkers?.some((marker) => marker.kind === "ready" && marker.threadKey === threadKey)
  );
}

function pendingResult(record: LeaderThreadStatus, revision: number): MonitoredThreadResult {
  return {
    id: String(revision),
    messageId: record.messageId,
    timestamp: record.timestamp,
    summary: record.summary.slice(0, 200),
  };
}

function latestAcceptedReadyIndex(session: ThreadMonitoringSession, threadKey: string): number {
  return session.messageHistory.findLastIndex((entry) => isReadyFor(entry, threadKey));
}
