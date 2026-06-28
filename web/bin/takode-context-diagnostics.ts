import type { ContextDiagnostics } from "../server/context-diagnostics.js";
import {
  apiGet,
  assertKnownFlags,
  err,
  formatTimestampCompact,
  parseFlags,
  parsePositiveIntegerFlag,
} from "./takode-core.js";

export const CONTEXT_DOCTOR_HELP = `Usage: takode context-doctor <session> [--limit N] [--history] [--json]

Analyze observable message and tool-result payload sizes for a session.

Options:
  --limit <n>  Number of top entries/turns to show (default: 10)
  --history    Include reported context-usage history in JSON, or print recent samples in text
  --json       Output compact JSON; --history explicitly reveals usage-history samples
`;

const CONTEXT_DOCTOR_ALLOWED_FLAGS = new Set(["limit", "history", "json"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatPercent(value: number | undefined): string {
  return typeof value === "number" ? `${value}%` : "n/a";
}

function printBreakdown(
  title: string,
  rows: Array<[string, { count?: number; calls?: number; bytes?: number }]>,
): void {
  if (rows.length === 0) return;
  console.log("");
  console.log(`${title}:`);
  for (const [name, value] of rows.slice(0, 8)) {
    const count = value.count ?? value.calls ?? 0;
    const bytes = value.bytes ?? 0;
    console.log(`  ${name.padEnd(22)} ${String(count).padStart(4)}  ${formatBytes(bytes)}`);
  }
}

export async function handleContextDoctor(base: string, args: string[]): Promise<void> {
  const sessionRef = args[0];
  if (!sessionRef) err(CONTEXT_DOCTOR_HELP);

  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, CONTEXT_DOCTOR_ALLOWED_FLAGS, CONTEXT_DOCTOR_HELP);
  const limit = parsePositiveIntegerFlag(flags, "limit", "entry count", 10);
  const includeHistory = flags.history === true;
  if (flags.history !== undefined && flags.history !== true) err("--history does not take a value.");

  const params = new URLSearchParams({ limit: String(limit) });
  if (includeHistory) params.set("history", "true");
  const data = (await apiGet(
    base,
    `/sessions/${encodeURIComponent(sessionRef)}/context-diagnostics?${params}`,
  )) as ContextDiagnostics;

  if (flags.json === true) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const label = data.sessionNum === null ? data.sessionId.slice(0, 8) : `#${data.sessionNum}`;
  console.log(`Context doctor for ${label}`);
  console.log(data.limitation);
  console.log("");
  console.log(
    `History: ${data.history.messageCount} messages, ${data.history.turnCount} turns, ` +
      `${formatBytes(data.history.messageJsonBytes)} message JSON`,
  );
  console.log(
    `Tool results: ${formatBytes(data.history.toolResultBytes)} observed` +
      (data.history.hiddenToolResultBytes > 0
        ? ` (${formatBytes(data.history.hiddenToolResultBytes)} hidden behind previews)`
        : ""),
  );
  console.log(`Total observable payload: ${formatBytes(data.history.totalObservableBytes)}`);

  if (data.latestContextUsage) {
    const latest = data.latestContextUsage;
    console.log(
      `Latest reported usage: ${formatPercent(latest.contextUsedPercent)} at ${formatTimestampCompact(latest.timestamp)} ` +
        `from ${latest.source}`,
    );
  } else {
    console.log("Latest reported usage: none recorded yet");
  }
  console.log(`Usage samples recorded: ${data.contextUsageHistoryCount}${includeHistory ? " (showing recent)" : ""}`);

  const messageRows = Object.entries(data.byMessageType).sort((a, b) => b[1].bytes - a[1].bytes);
  printBreakdown("Message type bytes", messageRows);

  const toolRows = Object.entries(data.byTool)
    .map(
      ([name, value]) =>
        [name, { calls: value.calls, bytes: value.inputBytes + value.resultBytes }] as [
          string,
          { calls: number; bytes: number },
        ],
    )
    .sort((a, b) => b[1].bytes - a[1].bytes);
  printBreakdown("Tool payload bytes", toolRows);

  if (data.topTurns.length > 0) {
    console.log("");
    console.log("Top turns:");
    for (const turn of data.topTurns) {
      console.log(
        `  turn ${String(turn.turn).padStart(3)}  [${turn.startIndex}]-[${turn.endIndex}]  ` +
          `${formatBytes(turn.totalObservableBytes)}  ${turn.messageCount} msgs`,
      );
    }
  }

  if (data.topEntries.length > 0) {
    console.log("");
    console.log("Top entries:");
    for (const entry of data.topEntries) {
      const turn = entry.turn === null ? "no turn" : `turn ${entry.turn}`;
      const label =
        entry.kind === "tool_result"
          ? `tool_result ${entry.toolName ?? "unknown"} ${entry.toolUseId ?? ""}`.trim()
          : `message ${entry.type ?? "unknown"}`;
      console.log(`  [${entry.messageIndex}] ${turn}  ${formatBytes(entry.bytes)}  ${label}`);
      console.log(`       read: ${entry.readCommand}`);
      console.log(`       turn: ${entry.peekCommand}`);
    }
  }

  if (includeHistory && data.contextUsageHistory?.length) {
    console.log("");
    console.log("Recent reported usage samples:");
    for (const sample of data.contextUsageHistory.slice(-10)) {
      const tokens =
        typeof sample.contextTokensUsed === "number" && typeof sample.modelContextWindow === "number"
          ? ` ${sample.contextTokensUsed}/${sample.modelContextWindow} tokens`
          : "";
      console.log(
        `  ${formatTimestampCompact(sample.timestamp)}  ${sample.source}  ` +
          `${formatPercent(sample.contextUsedPercent)}${tokens}`,
      );
    }
  }
}
