import { createHash } from "node:crypto";
import type { BrowserIncomingMessage, ContentBlock, ToolResultPreview } from "./session-types.js";
import {
  toPublicCodexNativeSubagentOwnership,
  type CodexNativeSubagentCoverage,
  type CodexNativeSubagentOwnership,
  type CodexNativeSubagentTranscriptAvailability,
} from "../shared/codex-native-subagent-types.js";

const MAX_MESSAGE_TEXT_LENGTH = 8_000;
const MAX_TOOL_INPUT_STRING_LENGTH = 2_000;
const MAX_TOOL_OUTPUT_LENGTH = 6_000;
const MAX_JSON_LENGTH = 8_000;
const MAX_STRUCTURED_DEPTH = 5;
const MAX_STRUCTURED_KEYS = 60;
const MAX_STRUCTURED_ARRAY = 40;
const MAX_CONTENT_BLOCKS = 40;
const MAX_ANCESTOR_THREADS = 16;
const MAX_ANCESTOR_TURNS = 400;

const FORBIDDEN_KEY_TOKENS = new Set([
  "absolutepath",
  "appcontext",
  "baseinstructions",
  "ciphertext",
  "codexhome",
  "config",
  "configuration",
  "connector",
  "connectorid",
  "cwd",
  "developerinstructions",
  "encrypted",
  "encryptedcontent",
  "encryptedmessage",
  "encryptedpayload",
  "env",
  "environment",
  "filepath",
  "home",
  "image",
  "imagepath",
  "images",
  "instructions",
  "mcpappresourceuri",
  "memory",
  "memoryhandoff",
  "origin",
  "originurl",
  "parentthreadid",
  "path",
  "pluginid",
  "prompt",
  "providerthreadid",
  "providerturnid",
  "recovery",
  "repository",
  "repositoryorigin",
  "repositoryurl",
  "resourceuri",
  "rollout",
  "rolloutpath",
  "savedpath",
  "sessionid",
  "systemprompt",
  "threadid",
  "turnid",
  "workingdirectory",
]);

export interface CodexNativeSubagentInspectorProjectionContext {
  ownership: CodexNativeSubagentOwnership;
  /** Known provider IDs and sensitive session paths that must be redacted even inside strings. */
  sensitiveStrings?: readonly string[];
}

export interface CodexNativeSubagentLocalHistoryPage {
  messages: BrowserIncomingMessage[];
  nextOffset: number | null;
  /** Safe projected identities used to suppress provider-backfill duplicates. */
  allMessageIds: Set<string>;
}

export interface CodexNativeSubagentProviderTurnsPage {
  data: unknown[];
  nextCursor: string | null;
}

export interface CodexNativeSubagentProviderPrefixState {
  inheritedPrefixStarted: boolean;
}

export interface CodexNativeSubagentProviderHistoryPage {
  messages: BrowserIncomingMessage[];
  nextProviderCursor: string | null;
  nextPrefixState: CodexNativeSubagentProviderPrefixState;
  availability: CodexNativeSubagentTranscriptAvailability;
  coverage: CodexNativeSubagentCoverage;
}

interface ProviderTurnListClient {
  listTurns: (
    providerThreadId: string,
    options: { cursor?: string | null; limit?: number; itemsView?: "notLoaded" | "summary" | "full" },
  ) => Promise<CodexNativeSubagentProviderTurnsPage>;
}

interface ProjectedEntry {
  index: number;
  message: BrowserIncomingMessage;
}

interface ProjectedTool {
  index: number;
  timestamp: number;
  providerItemId: string;
  rawToolId: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: string; isError: boolean };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteTimestamp(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stablePublicId(childId: string, kind: string, providerId: unknown, ordinal = 0): string {
  const digest = createHash("sha256")
    .update(`${childId}\u0000${kind}\u0000${typeof providerId === "string" ? providerId : ordinal}`)
    .digest("hex")
    .slice(0, 24);
  return `codex-native-${kind}-${digest}`;
}

function canonicalKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCredentialKeyToken(token: string): boolean {
  return (
    token === "token" ||
    token.endsWith("token") ||
    token.includes("apikey") ||
    token.includes("accesskey") ||
    token.includes("privatekey") ||
    token.includes("password") ||
    token.includes("passwd") ||
    token.includes("secret") ||
    token.includes("credential")
  );
}

function isForbiddenKey(key: string): boolean {
  const token = canonicalKey(key);
  if (FORBIDDEN_KEY_TOKENS.has(token)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(key)) return true;
  return (
    isCredentialKeyToken(token) ||
    token.includes("encrypted") ||
    token.includes("ciphertext") ||
    token.includes("rollout") ||
    token.endsWith("threadid") ||
    token.endsWith("turnid") ||
    token.endsWith("sessionid") ||
    token.endsWith("absolutepath") ||
    token.endsWith("savedpath") ||
    token === "repo" ||
    token === "repourl"
  );
}

function truncateText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n…[truncated]` : value;
}

function scrubSensitiveString(
  value: unknown,
  context: CodexNativeSubagentInspectorProjectionContext,
  limit: number,
): string {
  if (typeof value !== "string") return "";
  let result = value.replace(/\u0000/g, "").trim();
  const sensitive = [...new Set(context.sensitiveStrings ?? [])]
    .filter((item) => typeof item === "string" && item.trim().length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const item of sensitive) result = result.split(item).join("[sensitive value omitted]");

  result = result
    .replace(/\bdata:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[inline image omitted]")
    .replace(/\bfile:\/\/[^\s"'`<>]+/gi, "[filesystem location omitted]")
    .replace(/(^|[^\w/])\/(?!\/)(?:[^\s"'`<>\])},;]+\/?)+/g, (_match, prefix: string) => {
      return `${prefix}[absolute path omitted]`;
    })
    .replace(/\b[A-Za-z]:\\(?:[^\s"'`<>]+\\?)+/g, "[absolute path omitted]")
    .replace(/\b(?:git@|ssh:\/\/)[^\s"'`<>]+/gi, "[repository origin omitted]")
    .replace(/\bhttps?:\/\/[^\s"'`<>]+\.git\b/gi, "[repository origin omitted]")
    .replace(/\bhttps?:\/\/(?:www\.)?(?:github|gitlab|bitbucket)\.[^\s"'`<>]+/gi, "[repository origin omitted]")
    .replace(/\b(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/g, "[environment value omitted]")
    .replace(
      /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password|passwd|credential|config(?:uration)?|repository[_-]?url|origin[_-]?url)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[sensitive configuration omitted]",
    )
    .replace(/\b(?:system|developer)[_ -]+(?:prompt|instructions?)\s*[:=]?\s*[^\n]*/gi, "[instruction content omitted]")
    .replace(
      /\b(?:memory[_ -]+handoff|recovery[_ -]+(?:handoff|context|state))\s*[:=]?\s*[^\n]*/gi,
      "[handoff content omitted]",
    )
    .replace(
      /\b(?:encrypted(?:[_ -]+(?:payload|message|content))?|ciphertext)\s*[:=]?\s*[^\n]*/gi,
      "[encrypted content omitted]",
    )
    .replace(
      /\b(?:HOME|CODEX_HOME|PWD|OLDPWD|GIT_DIR|GIT_WORK_TREE|XDG_CONFIG_HOME|XDG_DATA_HOME)=[^\s]+/g,
      "[environment value omitted]",
    );
  return truncateText(result, limit);
}

function sanitizeStructuredValue(
  value: unknown,
  context: CodexNativeSubagentInspectorProjectionContext,
  depth = 0,
): unknown {
  if (depth > MAX_STRUCTURED_DEPTH) return "[nested value omitted]";
  if (typeof value === "string") return scrubSensitiveString(value, context, MAX_TOOL_INPUT_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_STRUCTURED_ARRAY).map((item) => sanitizeStructuredValue(item, context, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return scrubSensitiveString(String(value), context, MAX_TOOL_INPUT_STRING_LENGTH);
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, MAX_STRUCTURED_KEYS)) {
    if (isForbiddenKey(key)) continue;
    sanitized[key] = sanitizeStructuredValue(item, context, depth + 1);
  }
  return sanitized;
}

function boundedJson(value: unknown, context: CodexNativeSubagentInspectorProjectionContext): string {
  const json = JSON.stringify(sanitizeStructuredValue(value, context), null, 2) || "";
  return truncateText(json, MAX_JSON_LENGTH);
}

function safeToolName(value: unknown): string {
  if (typeof value !== "string") return "Tool";
  const name = value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120);
  if (/image/i.test(name)) return "Image interaction";
  if (/connector|mcp:|mcp$/i.test(name)) return "Connector tool";
  return name || "Tool";
}

function isImageOrConnectorTool(name: string): boolean {
  return /image|connector|mcp:|mcp$/i.test(name);
}

function sanitizedToolInput(
  name: string,
  input: unknown,
  context: CodexNativeSubagentInspectorProjectionContext,
): Record<string, unknown> {
  if (isImageOrConnectorTool(name)) return {};
  const sanitized = asRecord(sanitizeStructuredValue(input, context)) ?? {};
  const serialized = JSON.stringify(sanitized);
  return serialized.length <= MAX_JSON_LENGTH ? sanitized : { notice: "[tool input omitted: exceeds safety bound]" };
}

function sanitizedToolOutput(
  name: string,
  content: unknown,
  context: CodexNativeSubagentInspectorProjectionContext,
): string {
  if (/image/i.test(name)) return "Image content omitted.";
  if (/connector|mcp:|mcp$/i.test(name)) return "Connector content omitted.";
  if (typeof content === "string") return scrubSensitiveString(content, context, MAX_TOOL_OUTPUT_LENGTH);
  return truncateText(boundedJson(content, context), MAX_TOOL_OUTPUT_LENGTH);
}

function sourceProviderItemIdFromAssistant(message: Extract<BrowserIncomingMessage, { type: "assistant" }>): string {
  const firstTool = message.message.content.find((block) => block.type === "tool_use");
  if (firstTool?.type === "tool_use" && firstTool.id) return firstTool.id;
  const messageId = message.message.id ?? message.uuid ?? "";
  for (const prefix of ["codex-agent-", "codex-tool_use-", "codex-tool_result-"]) {
    if (messageId.startsWith(prefix)) return messageId.slice(prefix.length);
  }
  return messageId;
}

function messagePublicId(message: BrowserIncomingMessage): string | null {
  if (message.type === "assistant") return message.message.id ?? message.uuid ?? null;
  if (message.type === "user_message") return typeof message.id === "string" ? message.id : null;
  if (message.type === "codex_reasoning_detail") return message.id;
  return null;
}

function projectionContextWithMessageIdentifiers(
  messages: ReadonlyArray<BrowserIncomingMessage>,
  context: CodexNativeSubagentInspectorProjectionContext,
): CodexNativeSubagentInspectorProjectionContext {
  const ownership = toPublicCodexNativeSubagentOwnership(context.ownership);
  const sensitive = new Set(context.sensitiveStrings ?? []);
  for (const message of messages) {
    if (message.codexSubagent?.childId !== context.ownership.childId) continue;
    if (message.type === "assistant") {
      if (message.message.id) sensitive.add(message.message.id);
      if (message.uuid) sensitive.add(message.uuid);
      const providerItemId = sourceProviderItemIdFromAssistant(message);
      if (providerItemId) sensitive.add(providerItemId);
      for (const block of message.message.content) {
        if (block.type === "tool_use" && block.id) sensitive.add(block.id);
        if (block.type === "tool_result" && block.tool_use_id) sensitive.add(block.tool_use_id);
      }
    } else if (message.type === "user_message") {
      if (typeof message.id === "string") sensitive.add(message.id);
    } else if (message.type === "codex_reasoning_detail") {
      sensitive.add(message.id);
      if (message.provider_item_id) sensitive.add(message.provider_item_id);
      if (message.reasoning_turn_id) sensitive.add(message.reasoning_turn_id);
      if (message.parent_tool_use_id) sensitive.add(message.parent_tool_use_id);
    } else if (message.type === "tool_result_preview") {
      for (const preview of message.previews) {
        if (preview.tool_use_id) sensitive.add(preview.tool_use_id);
      }
    }
  }
  return { ownership, sensitiveStrings: [...sensitive] };
}

function assistantMessage(
  childId: string,
  ownership: CodexNativeSubagentOwnership,
  providerId: unknown,
  blocks: ContentBlock[],
  timestamp: number,
): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: stablePublicId(childId, "message", providerId),
      type: "message",
      role: "assistant",
      model: "",
      content: blocks,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    codexSubagent: ownership,
  };
}

function previewResult(
  preview: ToolResultPreview,
  toolName: string,
  context: CodexNativeSubagentInspectorProjectionContext,
): { content: string; isError: boolean } {
  return {
    content: sanitizedToolOutput(toolName, preview.content, context),
    isError: preview.is_error === true,
  };
}

/**
 * Projects both forward-captured and provider-reconstructed rows through one
 * allowlist. Unknown metadata and content blocks are dropped rather than
 * copied, provider identifiers are re-keyed, and every retained value is
 * bounded before it can enter the inspector DTO.
 */
export function projectCodexNativeSubagentInspectorMessages(
  messages: ReadonlyArray<BrowserIncomingMessage>,
  context: CodexNativeSubagentInspectorProjectionContext,
): BrowserIncomingMessage[] {
  const effectiveContext = projectionContextWithMessageIdentifiers(messages, context);
  const childId = effectiveContext.ownership.childId;
  const previews = new Map<string, { preview: ToolResultPreview; index: number }>();
  const tools = new Map<string, ProjectedTool>();
  const entries: ProjectedEntry[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.codexSubagent?.childId !== childId) continue;
    if (message.type === "tool_result_preview") {
      for (const preview of message.previews) {
        if (typeof preview.tool_use_id !== "string" || !preview.tool_use_id) continue;
        previews.set(preview.tool_use_id, { preview, index });
      }
    }
  }

  for (const [index, message] of messages.entries()) {
    if (message.codexSubagent?.childId !== childId) continue;
    if (message.type === "assistant") {
      const providerItemId = sourceProviderItemIdFromAssistant(message) || `${index}`;
      const timestamp = finiteTimestamp(message.timestamp, index);
      const textBlocks: ContentBlock[] = [];
      let remainingText = MAX_MESSAGE_TEXT_LENGTH;
      for (const block of message.message.content.slice(0, MAX_CONTENT_BLOCKS)) {
        if (block.type === "text") {
          const text = scrubSensitiveString(block.text, effectiveContext, remainingText);
          if (text) textBlocks.push({ type: "text", text });
          remainingText = Math.max(0, remainingText - text.length);
          continue;
        }
        if (block.type === "thinking") continue;
        if (block.type === "tool_use") {
          const rawToolId = block.id || providerItemId;
          const name = safeToolName(block.name);
          const existing = tools.get(rawToolId);
          tools.set(rawToolId, {
            index: existing?.index ?? index,
            timestamp: existing?.timestamp ?? timestamp,
            providerItemId: rawToolId,
            rawToolId,
            name,
            input: sanitizedToolInput(name, block.input, effectiveContext),
            ...(existing?.result ? { result: existing.result } : {}),
          });
          continue;
        }
        if (block.type === "tool_result") {
          const rawToolId = block.tool_use_id;
          const existing = tools.get(rawToolId);
          const name = existing?.name ?? "Tool";
          const result = {
            content: sanitizedToolOutput(name, block.content, effectiveContext),
            isError: block.is_error === true,
          };
          tools.set(rawToolId, {
            index: existing?.index ?? index,
            timestamp: existing?.timestamp ?? timestamp,
            providerItemId: existing?.providerItemId ?? rawToolId,
            rawToolId,
            name,
            input: existing?.input ?? {},
            result,
          });
        }
      }
      if (textBlocks.length > 0) {
        entries.push({
          index,
          message: assistantMessage(childId, effectiveContext.ownership, providerItemId, textBlocks, timestamp),
        });
      }
      continue;
    }

    if (message.type === "user_message") {
      const content = scrubSensitiveString(message.content, effectiveContext, MAX_MESSAGE_TEXT_LENGTH);
      if (!content) continue;
      entries.push({
        index,
        message: {
          type: "user_message",
          id: stablePublicId(childId, "user", message.id ?? index, index),
          content,
          timestamp: finiteTimestamp(message.timestamp, index),
          codexSubagent: effectiveContext.ownership,
        },
      });
      continue;
    }

    if (message.type === "codex_reasoning_detail") {
      const text = scrubSensitiveString(message.text, effectiveContext, MAX_MESSAGE_TEXT_LENGTH);
      if (!text) continue;
      const providerItemId = message.provider_item_id ?? message.id;
      entries.push({
        index,
        message: {
          type: "codex_reasoning_detail",
          id: stablePublicId(childId, `reasoning-${message.summary_index ?? 0}`, providerItemId, index),
          text,
          status: message.status === "streaming" ? "streaming" : "complete",
          timestamp: finiteTimestamp(message.timestamp, index),
          parent_tool_use_id:
            typeof message.parent_tool_use_id === "string" && message.parent_tool_use_id
              ? stablePublicId(childId, "tool", message.parent_tool_use_id)
              : null,
          ...(typeof message.summary_index === "number" ? { summary_index: message.summary_index } : {}),
          ...(typeof message.thinking_time_ms === "number" ? { thinking_time_ms: message.thinking_time_ms } : {}),
          codexSubagent: effectiveContext.ownership,
        },
      });
    }
  }

  for (const tool of tools.values()) {
    const preview = previews.get(tool.rawToolId)?.preview;
    const result = tool.result ?? (preview ? previewResult(preview, tool.name, effectiveContext) : undefined);
    const safeToolId = stablePublicId(childId, "tool", tool.rawToolId);
    const blocks: ContentBlock[] = [{ type: "tool_use", id: safeToolId, name: tool.name, input: tool.input }];
    if (result?.content) {
      blocks.push({ type: "tool_result", tool_use_id: safeToolId, content: result.content, is_error: result.isError });
    }
    entries.push({
      index: tool.index,
      message: assistantMessage(childId, effectiveContext.ownership, tool.providerItemId, blocks, tool.timestamp),
    });
  }

  entries.sort((left, right) => left.index - right.index);
  const deduped = new Map<string, BrowserIncomingMessage>();
  for (const entry of entries) {
    const id = messagePublicId(entry.message);
    if (!id) continue;
    const existing = deduped.get(id);
    if (!existing || existing.type !== "assistant" || entry.message.type !== "assistant") {
      if (!existing) deduped.set(id, entry.message);
      continue;
    }
    const blocks = [...existing.message.content];
    for (const block of entry.message.message.content) {
      const duplicate = blocks.some((candidate) => {
        if (candidate.type === "tool_use" && block.type === "tool_use") return candidate.id === block.id;
        if (candidate.type === "tool_result" && block.type === "tool_result") {
          return candidate.tool_use_id === block.tool_use_id;
        }
        return candidate.type === "text" && block.type === "text" && candidate.text === block.text;
      });
      if (!duplicate) blocks.push(block);
    }
    deduped.set(id, { ...existing, message: { ...existing.message, content: blocks } });
  }
  return [...deduped.values()];
}

export function pageForwardCapturedCodexNativeSubagentHistory(
  history: ReadonlyArray<BrowserIncomingMessage>,
  context: CodexNativeSubagentInspectorProjectionContext,
  offset: number,
  limit: number,
): CodexNativeSubagentLocalHistoryPage {
  const projected = projectCodexNativeSubagentInspectorMessages(history, context);
  const end = Math.max(0, projected.length - Math.max(0, offset));
  const start = Math.max(0, end - Math.max(1, limit));
  return {
    messages: projected.slice(start, end),
    nextOffset: start > 0 ? projected.length - start : null,
    allMessageIds: new Set(projected.map(messagePublicId).filter((id): id is string => !!id)),
  };
}

function textFromUserInput(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content.slice(0, MAX_STRUCTURED_ARRAY)) {
    if (typeof item === "string") {
      parts.push(truncateText(item, MAX_MESSAGE_TEXT_LENGTH));
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "text" || type === "input_text" || type === "userText") {
      if (typeof (record.text ?? record.content) === "string") {
        parts.push(truncateText(String(record.text ?? record.content), MAX_MESSAGE_TEXT_LENGTH));
      }
    } else if (type) {
      parts.push(`[${type} omitted]`);
    }
  }
  return parts.join("\n");
}

function rawToolMessage(
  ownership: CodexNativeSubagentOwnership,
  item: Record<string, unknown>,
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  isError: boolean,
  timestamp: number,
): BrowserIncomingMessage {
  const rawToolId = typeof item.id === "string" ? item.id : `tool-${timestamp}`;
  const blocks: ContentBlock[] = [{ type: "tool_use", id: rawToolId, name: toolName, input }];
  if (output !== undefined && output !== null && output !== "") {
    blocks.push({
      type: "tool_result",
      tool_use_id: rawToolId,
      content: typeof output === "string" ? output : "[structured output omitted]",
      is_error: isError,
    });
  }
  return {
    type: "assistant",
    message: {
      id: `codex-tool_use-${rawToolId}`,
      type: "message",
      role: "assistant",
      model: "",
      content: blocks,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    codexSubagent: ownership,
  };
}

function rawProviderItemMessages(
  itemValue: unknown,
  ownership: CodexNativeSubagentOwnership,
  timestamp: number,
  ordinal: number,
): BrowserIncomingMessage[] {
  const item = asRecord(itemValue);
  if (!item) return [];
  const type = typeof item.type === "string" ? item.type : "";
  const providerId = typeof item.id === "string" ? item.id : `ordinal-${ordinal}`;

  if (type === "userMessage") {
    const content = textFromUserInput(item.content);
    return content
      ? [
          {
            type: "user_message",
            id: providerId,
            content,
            timestamp,
            codexSubagent: ownership,
          },
        ]
      : [];
  }
  if (type === "agentMessage" || type === "plan") {
    if (typeof item.text !== "string" || !item.text.trim()) return [];
    return [
      {
        type: "assistant",
        message: {
          id: `codex-agent-${providerId}`,
          type: "message",
          role: "assistant",
          model: "",
          content: [{ type: "text", text: item.text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp,
        codexSubagent: ownership,
      },
    ];
  }
  if (type === "reasoning") {
    const summaries = Array.isArray(item.summary) ? item.summary : [];
    return summaries.flatMap((summary, index) =>
      typeof summary === "string" && summary.trim()
        ? [
            {
              type: "codex_reasoning_detail" as const,
              id: `provider-reasoning-${providerId}-${index}`,
              text: summary,
              status: "complete" as const,
              timestamp,
              parent_tool_use_id: null,
              provider_item_id: providerId,
              summary_index: index,
              codexSubagent: ownership,
            },
          ]
        : [],
    );
  }
  if (type === "commandExecution") {
    const status = typeof item.status === "string" ? item.status : "";
    return [
      rawToolMessage(
        ownership,
        item,
        "Bash",
        { command: item.command },
        item.aggregatedOutput ?? item.output ?? item.stderr ?? item.stdout,
        status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0),
        timestamp,
      ),
    ];
  }
  if (type === "fileChange") {
    return [
      rawToolMessage(
        ownership,
        item,
        "Edit",
        { changes: item.changes },
        "File changes applied",
        item.status === "failed",
        timestamp,
      ),
    ];
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    return [
      rawToolMessage(
        ownership,
        item,
        "Connector tool",
        asRecord(item.arguments ?? item.input) ?? {},
        item.error ?? item.result ?? item.output ?? item.contentItems,
        item.status === "failed" || !!item.error,
        timestamp,
      ),
    ];
  }
  if (type === "webSearch") {
    return [
      rawToolMessage(
        ownership,
        item,
        "WebSearch",
        { query: asRecord(item.action)?.query ?? item.query },
        item.result ?? item.output,
        false,
        timestamp,
      ),
    ];
  }
  if (type === "imageView") {
    return [
      rawToolMessage(ownership, item, "Image interaction", { path: item.path }, "Image viewed", false, timestamp),
    ];
  }
  if (type === "sleep") {
    return [
      rawToolMessage(ownership, item, "sleep", { durationMs: item.durationMs }, "Sleep completed", false, timestamp),
    ];
  }
  return [];
}

function turnId(turn: unknown): string | null {
  const value = asRecord(turn)?.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function turnTimestamp(turn: Record<string, unknown>): number {
  const seconds =
    typeof turn.completedAt === "number"
      ? turn.completedAt
      : typeof turn.startedAt === "number"
        ? turn.startedAt
        : undefined;
  return seconds === undefined ? 0 : seconds * 1000;
}

async function loadCompleteAncestorTurnIds(args: {
  client: ProviderTurnListClient;
  ancestorProviderThreadIds: readonly string[];
}): Promise<{ ids: Set<string>; complete: boolean }> {
  if (args.ancestorProviderThreadIds.length === 0 || args.ancestorProviderThreadIds.length > MAX_ANCESTOR_THREADS) {
    return { ids: new Set(), complete: false };
  }
  const ids = new Set<string>();
  let loaded = 0;
  for (const ancestorProviderThreadId of args.ancestorProviderThreadIds) {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const remaining = MAX_ANCESTOR_TURNS - loaded;
      if (remaining <= 0) return { ids, complete: false };
      const page = await args.client.listTurns(ancestorProviderThreadId, {
        cursor,
        limit: Math.min(50, remaining),
        itemsView: "notLoaded",
      });
      for (const turn of page.data) {
        const id = turnId(turn);
        if (!id) return { ids, complete: false };
        ids.add(id);
      }
      loaded += page.data.length;
      cursor = page.nextCursor;
      if (cursor && seenCursors.has(cursor)) return { ids, complete: false };
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
  }
  return { ids, complete: true };
}

export async function loadProviderCodexNativeSubagentHistoryPage(args: {
  client: ProviderTurnListClient;
  childProviderThreadId: string;
  ancestorProviderThreadIds: readonly string[];
  ancestorChainComplete: boolean;
  ownership: CodexNativeSubagentOwnership;
  cursor?: string | null;
  limit: number;
  prefixState?: CodexNativeSubagentProviderPrefixState;
  sensitiveStrings?: readonly string[];
  excludeMessageIds?: ReadonlySet<string>;
}): Promise<CodexNativeSubagentProviderHistoryPage> {
  const inheritedPrefixStarted = args.prefixState?.inheritedPrefixStarted === true;
  const failClosed = (availability: CodexNativeSubagentTranscriptAvailability = "partial") => ({
    messages: [],
    nextProviderCursor: null,
    nextPrefixState: { inheritedPrefixStarted },
    availability,
    coverage: "partial" as const,
  });
  if (!args.ancestorChainComplete) return failClosed("unavailable");

  const ancestorTurns = await loadCompleteAncestorTurnIds({
    client: args.client,
    ancestorProviderThreadIds: args.ancestorProviderThreadIds,
  });
  if (!ancestorTurns.complete) return failClosed();

  const childPage = await args.client.listTurns(args.childProviderThreadId, {
    cursor: args.cursor,
    limit: args.limit,
    itemsView: "full",
  });
  let prefixStarted = inheritedPrefixStarted;
  const uniqueTurns: Record<string, unknown>[] = [];
  for (const turnValue of childPage.data) {
    const turn = asRecord(turnValue);
    const id = turnId(turnValue);
    if (!turn || !id || turn.itemsView !== "full") return failClosed();
    if (ancestorTurns.ids.has(id)) {
      prefixStarted = true;
      continue;
    }
    // Descending pages must contain child-unique turns first and only the
    // inherited chronological prefix after the boundary. Any unique turn after
    // that boundary makes subtraction unsafe.
    if (prefixStarted) return failClosed("unavailable");
    uniqueTurns.push(turn);
  }

  const providerIdentifiers = new Set<string>([
    ...(args.sensitiveStrings ?? []),
    args.childProviderThreadId,
    ...args.ancestorProviderThreadIds,
  ]);
  for (const turn of childPage.data) {
    const id = turnId(turn);
    if (id) providerIdentifiers.add(id);
    for (const item of Array.isArray(asRecord(turn)?.items) ? (asRecord(turn)!.items as unknown[]) : []) {
      const itemId = asRecord(item)?.id;
      if (typeof itemId === "string") providerIdentifiers.add(itemId);
    }
  }

  const rawMessages = [...uniqueTurns].reverse().flatMap((turn, turnIndex) => {
    const timestamp = turnTimestamp(turn);
    return (Array.isArray(turn.items) ? turn.items : []).flatMap((item, itemIndex) =>
      rawProviderItemMessages(item, args.ownership, timestamp + turnIndex + itemIndex, itemIndex),
    );
  });
  const messages = projectCodexNativeSubagentInspectorMessages(rawMessages, {
    ownership: args.ownership,
    sensitiveStrings: [...providerIdentifiers],
  }).filter((message) => {
    const id = messagePublicId(message);
    return !id || !args.excludeMessageIds?.has(id);
  });

  const hasMore = childPage.nextCursor !== null;
  return {
    messages,
    nextProviderCursor: childPage.nextCursor,
    nextPrefixState: { inheritedPrefixStarted: prefixStarted },
    availability: hasMore ? "partial" : uniqueTurns.length > 0 ? "available" : "unavailable",
    coverage: hasMore ? "partial" : "complete",
  };
}
