import { findTurnBoundaries } from "./takode-messages.js";
import type { BrowserIncomingMessage, ContextUsageHistoryEntry, ToolResultPreview } from "./session-types.js";

export interface ContextDiagnosticsToolResult {
  toolUseId: string;
  toolName: string;
  messageIndex: number;
  turn: number | null;
  previewBytes: number;
  totalBytes: number;
  hiddenBytes: number;
  truncated: boolean;
  readCommand: string;
  peekCommand: string;
}

export interface ContextDiagnosticsHeavyEntry {
  kind: "message" | "tool_result";
  bytes: number;
  messageIndex: number;
  turn: number | null;
  type?: string;
  toolUseId?: string;
  toolName?: string;
  readCommand: string;
  peekCommand: string;
}

export interface ContextDiagnosticsTurnTotal {
  turn: number;
  startIndex: number;
  endIndex: number;
  messageCount: number;
  messageBytes: number;
  toolResultBytes: number;
  hiddenToolResultBytes: number;
  totalObservableBytes: number;
}

export interface ContextDiagnostics {
  sessionId: string;
  sessionNum: number | null;
  history: {
    messageCount: number;
    turnCount: number;
    messageJsonBytes: number;
    toolResultBytes: number;
    hiddenToolResultBytes: number;
    totalObservableBytes: number;
  };
  byMessageType: Record<string, { count: number; bytes: number }>;
  byTool: Record<string, { calls: number; inputBytes: number; resultBytes: number; hiddenResultBytes: number }>;
  topEntries: ContextDiagnosticsHeavyEntry[];
  topTurns: ContextDiagnosticsTurnTotal[];
  contextUsageHistoryCount: number;
  latestContextUsage: ContextUsageHistoryEntry | null;
  contextUsageHistory?: ContextUsageHistoryEntry[];
  limitation: string;
}

interface IndexedToolResultPayload {
  content: string;
}

interface ContextDiagnosticsSession {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  toolResults: Map<string, IndexedToolResultPayload>;
  contextUsageHistory?: ContextUsageHistoryEntry[];
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf-8");
}

function commandSessionRef(sessionNum: number | null, sessionId: string): string {
  return sessionNum === null ? sessionId : String(sessionNum);
}

function findTurnForMessage(
  turnRanges: Array<{ startIdx: number; endIdx: number }>,
  messageIndex: number,
): number | null {
  const idx = turnRanges.findIndex((turn) => {
    const end = turn.endIdx >= 0 ? turn.endIdx : Number.MAX_SAFE_INTEGER;
    return messageIndex >= turn.startIdx && messageIndex <= end;
  });
  return idx >= 0 ? idx : null;
}

function addBreakdownBytes(record: Record<string, { count: number; bytes: number }>, key: string, bytes: number): void {
  const current = record[key] ?? { count: 0, bytes: 0 };
  current.count += 1;
  current.bytes += bytes;
  record[key] = current;
}

function collectToolNames(messages: BrowserIncomingMessage[]): Map<string, { name: string; inputBytes: number }> {
  const result = new Map<string, { name: string; inputBytes: number }>();
  for (const message of messages) {
    if (message.type !== "assistant" || !Array.isArray(message.message?.content)) continue;
    for (const block of message.message.content) {
      if (block.type !== "tool_use") continue;
      result.set(block.id, { name: block.name, inputBytes: byteLength(block.input ?? {}) });
    }
  }
  return result;
}

function toolResultTotalBytes(
  preview: ToolResultPreview,
  toolResults: Map<string, IndexedToolResultPayload>,
): { totalBytes: number; previewBytes: number; hiddenBytes: number } {
  const previewBytes = byteLength(preview.content);
  const indexed = toolResults.get(preview.tool_use_id);
  const totalBytes = indexed ? byteLength(indexed.content) : Math.max(preview.total_size, previewBytes);
  return {
    previewBytes,
    totalBytes,
    hiddenBytes: Math.max(0, totalBytes - previewBytes),
  };
}

export function buildContextDiagnostics(
  session: ContextDiagnosticsSession,
  options: { sessionNum?: number | null; limit?: number; includeHistory?: boolean } = {},
): ContextDiagnostics {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 10)));
  const sessionNum = typeof options.sessionNum === "number" ? options.sessionNum : null;
  const sessionRef = commandSessionRef(sessionNum, session.id);
  const messages = session.messageHistory;
  const turns = findTurnBoundaries(messages);
  const byMessageType: ContextDiagnostics["byMessageType"] = {};
  const byTool: ContextDiagnostics["byTool"] = {};
  const toolNames = collectToolNames(messages);
  const heavyEntries: ContextDiagnosticsHeavyEntry[] = [];
  const turnTotals = turns.map((turn, turnIndex) => ({
    turn: turnIndex,
    startIndex: turn.startIdx,
    endIndex: turn.endIdx >= 0 ? turn.endIdx : messages.length - 1,
    messageCount: 0,
    messageBytes: 0,
    toolResultBytes: 0,
    hiddenToolResultBytes: 0,
    totalObservableBytes: 0,
  }));

  let messageJsonBytes = 0;
  let toolResultBytes = 0;
  let hiddenToolResultBytes = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const bytes = byteLength(message);
    const turn = findTurnForMessage(turns, i);
    const readCommand = `takode read ${sessionRef} ${i}`;
    const peekCommand = `takode peek ${sessionRef} --turn-containing ${i}`;

    messageJsonBytes += bytes;
    addBreakdownBytes(byMessageType, message.type, bytes);
    heavyEntries.push({ kind: "message", bytes, messageIndex: i, turn, type: message.type, readCommand, peekCommand });

    if (turn !== null && turnTotals[turn]) {
      const total = turnTotals[turn];
      total.messageCount += 1;
      total.messageBytes += bytes;
      total.totalObservableBytes += bytes;
    }

    if (message.type !== "tool_result_preview") continue;
    for (const preview of message.previews) {
      const sizes = toolResultTotalBytes(preview, session.toolResults);
      const tool = toolNames.get(preview.tool_use_id);
      const toolName = tool?.name ?? "unknown";
      const toolRecord = byTool[toolName] ?? { calls: 0, inputBytes: 0, resultBytes: 0, hiddenResultBytes: 0 };
      toolRecord.calls += 1;
      toolRecord.inputBytes += tool?.inputBytes ?? 0;
      toolRecord.resultBytes += sizes.totalBytes;
      toolRecord.hiddenResultBytes += sizes.hiddenBytes;
      byTool[toolName] = toolRecord;

      toolResultBytes += sizes.totalBytes;
      hiddenToolResultBytes += sizes.hiddenBytes;
      heavyEntries.push({
        kind: "tool_result",
        bytes: sizes.totalBytes,
        messageIndex: i,
        turn,
        toolUseId: preview.tool_use_id,
        toolName,
        readCommand,
        peekCommand,
      });
      if (turn !== null && turnTotals[turn]) {
        const total = turnTotals[turn];
        total.toolResultBytes += sizes.totalBytes;
        total.hiddenToolResultBytes += sizes.hiddenBytes;
        total.totalObservableBytes += sizes.hiddenBytes;
      }
    }
  }

  const contextUsageHistory = session.contextUsageHistory ?? [];
  return {
    sessionId: session.id,
    sessionNum,
    history: {
      messageCount: messages.length,
      turnCount: turns.length,
      messageJsonBytes,
      toolResultBytes,
      hiddenToolResultBytes,
      totalObservableBytes: messageJsonBytes + hiddenToolResultBytes,
    },
    byMessageType,
    byTool,
    topEntries: heavyEntries.sort((a, b) => b.bytes - a.bytes).slice(0, limit),
    topTurns: turnTotals.sort((a, b) => b.totalObservableBytes - a.totalObservableBytes).slice(0, limit),
    contextUsageHistoryCount: contextUsageHistory.length,
    latestContextUsage: contextUsageHistory[contextUsageHistory.length - 1] ?? null,
    ...(options.includeHistory ? { contextUsageHistory } : {}),
    limitation:
      "Diagnostics use observable Takode message/tool-result payload bytes plus reported context usage samples. Hidden reasoning and provider-side state are not directly measured.",
  };
}
