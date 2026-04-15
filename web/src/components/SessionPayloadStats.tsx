import { Fragment } from "react";
import { formatContextWindowLabel } from "../utils/token-format.js";

const MESSAGE_HISTORY_TITLE = "Server-tracked message history size";
const REPLAY_HISTORY_TITLE = "Server-tracked browser replay history size";
const CODEX_RETAINED_PAYLOAD_TITLE =
  "Estimated Codex retained payload, including full tool results hidden behind replay previews";

function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatPayloadBytes(bytes: number, label: string): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB ${label}`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB ${label}`;
  return `${bytes} B ${label}`;
}

interface SessionPayloadStatsProps {
  turns: number;
  contextPercent: number;
  contextWindow: number;
  historyBytes: number;
  codexRetainedPayloadBytes: number;
  isCodexSession: boolean;
  lastActivityAt?: number;
  className?: string;
  highlightHighHistoryBytes?: boolean;
}

export function SessionPayloadStats({
  turns,
  contextPercent,
  contextWindow,
  historyBytes,
  codexRetainedPayloadBytes,
  isCodexSession,
  lastActivityAt,
  className = "flex items-center gap-2 text-[11px] text-cc-muted",
  highlightHighHistoryBytes = false,
}: SessionPayloadStatsProps) {
  const items: Array<{ key: string; text: string; title?: string; className?: string }> = [];

  if (turns > 0) {
    items.push({
      key: "turns",
      text: `${turns} ${turns === 1 ? "turn" : "turns"}`,
    });
  }

  if (contextPercent > 0) {
    items.push({
      key: "context",
      text: `${Math.round(contextPercent)}% context`,
    });
  }

  if (contextWindow > 0) {
    items.push({
      key: "context-window",
      text: formatContextWindowLabel(contextWindow),
    });
  }

  if (historyBytes > 0) {
    items.push({
      key: "history-bytes",
      text: formatPayloadBytes(historyBytes, isCodexSession ? "replay" : "history"),
      title: isCodexSession ? REPLAY_HISTORY_TITLE : MESSAGE_HISTORY_TITLE,
      className: highlightHighHistoryBytes
        ? historyBytes > 16 * 1024 * 1024
          ? "text-red-400"
          : historyBytes > 10 * 1024 * 1024
            ? "text-amber-400"
            : undefined
        : undefined,
    });
  }

  if (isCodexSession && codexRetainedPayloadBytes > 0) {
    items.push({
      key: "retained-payload",
      text: formatPayloadBytes(codexRetainedPayloadBytes, "retained"),
      title: CODEX_RETAINED_PAYLOAD_TITLE,
    });
  }

  if (lastActivityAt) {
    items.push({
      key: "last-activity",
      text: `active ${formatRelativeTime(lastActivityAt)}`,
      title: new Date(lastActivityAt).toLocaleString(),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className={className}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <span className="text-cc-muted/40">&middot;</span>}
          <span title={item.title} className={item.className}>
            {item.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
