import type { BrowserIncomingMessage, ToolResultPreview } from "./session-types.js";
import type { TurnBoundary } from "./takode-messages.js";

export interface ContextToolSource {
  name: string;
  inputBytes: number;
  commandFamily?: string;
  commandSummary?: string;
}

export interface ContextCommandBreakdown {
  calls: number;
  inputBytes: number;
  resultBytes: number;
  hiddenResultBytes: number;
}

export interface ContextTopCommand {
  family: string;
  bytes: number;
  calls: number;
}

export interface ContextTurnSummary {
  messageBytes: number;
  toolResultBytes: number;
  hiddenToolResultBytes: number;
  totalObservableBytes: number;
  topCommands?: ContextTopCommand[];
}

export function contextByteLength(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf-8");
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf-8");
}

function truncateInline(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function bashCommandText(input: Record<string, unknown>): string {
  return typeof input.command === "string" ? input.command.trim() : "";
}

function firstBashCommandLine(command: string): string {
  return (
    command
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? command.trim()
  );
}

export function classifyBashCommand(command: string): string {
  const normalized = command.trim();
  if (!normalized) return "bash";
  const haystack = normalized.replace(/\s+/g, " ");
  const firstLine = firstBashCommandLine(normalized);
  const firstToken = firstLine.match(/(?:^|(?:&&|\|\||;|\|)\s*)([A-Za-z0-9_./:-]+)/)?.[1] ?? "bash";

  if (/\bquest\s+show\b/.test(haystack)) return "quest show";
  if (/\bquest\s+feedback\b/.test(haystack)) return "quest feedback";
  if (/\bquest\s+(list|status|grep|history|tags|quiz|inbox|mine)\b/.test(haystack)) return "quest inspect";
  if (/\bquest\b/.test(haystack)) return "quest other";
  if (/\btakode\s+scan\b/.test(haystack)) return "takode scan";
  if (/\btakode\s+peek\b/.test(haystack)) return "takode peek";
  if (/\btakode\s+read\b/.test(haystack)) return "takode read";
  if (/\btakode\s+context-doctor\b/.test(haystack)) return "context doctor";
  if (/\btakode\s+(info|board|notify|worker-stream|grep|logs)\b/.test(haystack)) return "takode inspect";
  if (/\bmemory\s+/.test(haystack)) return "memory";
  if (/\brg\b/.test(haystack)) return "search";
  if (/\b(grep|awk|sed)\b/.test(haystack)) return "text processing";
  if (/\b(cat|nl|head|tail|less)\b/.test(haystack)) return "file read";
  if (/\bgit\b/.test(haystack)) return "git";
  if (/\b(bun|npm|pnpm|yarn|make)\b/.test(haystack)) return "build/test";
  if (/\b(ls|find|du|wc)\b/.test(haystack)) return "filesystem inspect";
  if (/\b(node|python|python3|tsx|ts-node)\b/.test(haystack)) return "script";
  return firstToken.replace(/^\.\//, "") || "bash";
}

export function summarizeToolContext(name: string, input: Record<string, unknown>): ContextToolSource {
  const inputBytes = contextByteLength(input ?? {});
  if (name !== "Bash") return { name, inputBytes };

  const command = bashCommandText(input);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  return {
    name,
    inputBytes,
    commandFamily: classifyBashCommand(command || description),
    commandSummary: truncateInline(description || firstBashCommandLine(command), 120),
  };
}

export function collectToolContextSources(messages: BrowserIncomingMessage[]): Map<string, ContextToolSource> {
  const result = new Map<string, ContextToolSource>();
  for (const message of messages) {
    if (message.type !== "assistant" || !Array.isArray(message.message?.content)) continue;
    for (const block of message.message.content) {
      if (block.type !== "tool_use") continue;
      result.set(block.id, summarizeToolContext(block.name, block.input ?? {}));
    }
  }
  return result;
}

export function toolPreviewSize(preview: ToolResultPreview): {
  previewBytes: number;
  totalBytes: number;
  hiddenBytes: number;
} {
  const previewBytes = contextByteLength(preview.content);
  const totalBytes = Math.max(preview.total_size, previewBytes);
  return { previewBytes, totalBytes, hiddenBytes: Math.max(0, totalBytes - previewBytes) };
}

export function computeContextTurnSummary(
  messages: BrowserIncomingMessage[],
  turn: TurnBoundary,
  toolSources = collectToolContextSources(messages),
): ContextTurnSummary {
  const endBound = turn.endIdx >= 0 ? turn.endIdx : messages.length - 1;
  const byCommand = new Map<string, ContextTopCommand>();
  let messageBytes = 0;
  let toolResultBytes = 0;
  let hiddenToolResultBytes = 0;

  for (let i = turn.startIdx; i <= endBound; i++) {
    const message = messages[i];
    if (!message) continue;
    messageBytes += contextByteLength(message);
    if (message.type !== "tool_result_preview") continue;
    for (const preview of message.previews) {
      const sizes = toolPreviewSize(preview);
      toolResultBytes += sizes.totalBytes;
      hiddenToolResultBytes += sizes.hiddenBytes;
      const source = toolSources.get(preview.tool_use_id);
      const family = source?.commandFamily ?? source?.name ?? "unknown";
      const current = byCommand.get(family) ?? { family, bytes: 0, calls: 0 };
      current.bytes += source?.inputBytes ?? 0;
      current.bytes += sizes.totalBytes;
      current.calls += 1;
      byCommand.set(family, current);
    }
  }

  const topCommands = [...byCommand.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  return {
    messageBytes,
    toolResultBytes,
    hiddenToolResultBytes,
    totalObservableBytes: messageBytes + hiddenToolResultBytes,
    ...(topCommands.length > 0 ? { topCommands } : {}),
  };
}
