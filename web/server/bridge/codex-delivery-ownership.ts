import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";

export type CodexLocalDeliveryActivityKind =
  | "reasoning"
  | "assistant_text"
  | "tool_use"
  | "tool_result"
  | "permission"
  | "result"
  | "stream";

export interface CodexLocalDeliveryActivitySummary {
  count: number;
  kinds: CodexLocalDeliveryActivityKind[];
  firstHistoryIndex: number | null;
  lastHistoryIndex: number | null;
}

export interface CodexDeliveryHistoryLike {
  messageHistory: BrowserIncomingMessage[];
  _frozenCount?: number;
}

export function getMessageAtAbsoluteHistoryIndex(
  session: CodexDeliveryHistoryLike,
  historyIndex: number,
): BrowserIncomingMessage | null {
  const localIndex = historyIndex - (session._frozenCount ?? 0);
  if (localIndex < 0 || localIndex >= session.messageHistory.length) return null;
  return session.messageHistory[localIndex] ?? null;
}

export function summarizeLocalCodexDeliveryActivity(
  session: CodexDeliveryHistoryLike,
  turn: Pick<CodexOutboundTurn, "historyIndex">,
): CodexLocalDeliveryActivitySummary {
  if (turn.historyIndex < 0) return emptySummary();
  const frozenCount = session._frozenCount ?? 0;
  const firstLocalIndex = Math.max(0, turn.historyIndex + 1 - frozenCount);
  const kinds = new Set<CodexLocalDeliveryActivityKind>();
  let count = 0;
  let firstHistoryIndex: number | null = null;
  let lastHistoryIndex: number | null = null;

  for (let localIndex = firstLocalIndex; localIndex < session.messageHistory.length; localIndex++) {
    const message = session.messageHistory[localIndex];
    if (!message) continue;
    const messageKinds = classifyLocalActivity(message);
    if (messageKinds.length === 0) continue;
    const absoluteIndex = frozenCount + localIndex;
    count += 1;
    firstHistoryIndex ??= absoluteIndex;
    lastHistoryIndex = absoluteIndex;
    for (const kind of messageKinds) kinds.add(kind);
  }

  return {
    count,
    kinds: [...kinds].slice(0, 6),
    firstHistoryIndex,
    lastHistoryIndex,
  };
}

export function summarizeCodexResumeDeliveryActivity(
  items: Array<Record<string, unknown>>,
): CodexLocalDeliveryActivitySummary {
  const kinds = new Set<CodexLocalDeliveryActivityKind>();
  let count = 0;
  for (const item of items) {
    const kind = classifyResumeActivity(item);
    if (!kind) continue;
    count += 1;
    kinds.add(kind);
  }
  return {
    count,
    kinds: [...kinds].slice(0, 6),
    firstHistoryIndex: null,
    lastHistoryIndex: null,
  };
}

export function mergeCodexDeliveryActivity(
  left: CodexLocalDeliveryActivitySummary,
  right: CodexLocalDeliveryActivitySummary,
): CodexLocalDeliveryActivitySummary {
  return {
    count: left.count + right.count,
    kinds: [...new Set([...left.kinds, ...right.kinds])].slice(0, 6),
    firstHistoryIndex: left.firstHistoryIndex ?? right.firstHistoryIndex,
    lastHistoryIndex: right.lastHistoryIndex ?? left.lastHistoryIndex,
  };
}

function classifyResumeActivity(item: Record<string, unknown>): CodexLocalDeliveryActivityKind | null {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  if (type === "reasoning") return "reasoning";
  if (type === "agentmessage") return "assistant_text";
  if (type === "result" || type.includes("taskcomplete") || type.includes("task_complete")) {
    return "result";
  }
  if (
    type.includes("command") ||
    type.includes("tool") ||
    type.includes("function") ||
    type.includes("filechange") ||
    type.includes("patch")
  ) {
    return "tool_use";
  }
  return null;
}

function classifyLocalActivity(message: BrowserIncomingMessage): CodexLocalDeliveryActivityKind[] {
  if (message.type === "codex_reasoning_detail") return ["reasoning"];
  if (message.type === "tool_result_preview") return ["tool_result"];
  if (
    message.type === "permission_request" ||
    message.type === "permission_approved" ||
    message.type === "permission_denied"
  ) {
    return ["permission"];
  }
  if (message.type === "result") return ["result"];
  if (message.type === "stream_event") return ["stream"];
  if (message.type !== "assistant") return [];

  const kinds = new Set<CodexLocalDeliveryActivityKind>();
  for (const block of message.message?.content ?? []) {
    if (block.type === "tool_use") kinds.add("tool_use");
    else if (block.type === "text" && block.text.trim()) kinds.add("assistant_text");
    else if (block.type === "thinking") kinds.add("reasoning");
  }
  return [...kinds];
}

function emptySummary(): CodexLocalDeliveryActivitySummary {
  return {
    count: 0,
    kinds: [],
    firstHistoryIndex: null,
    lastHistoryIndex: null,
  };
}

export function hasIncompleteRecoveredMessagesWithoutTerminalEvidence(
  turn: { status?: string | null; items: Array<Record<string, unknown>> },
  threadStatus?: string | null,
): boolean {
  return (
    hasInterruptedAssistantOnlyRecoveryWithoutTerminalEvidence(turn, threadStatus) ||
    hasRecoveredAssistantToolTailWithoutTerminalEvidence(turn.items)
  );
}

export function hasInterruptedAssistantOnlyRecoveryWithoutTerminalEvidence(
  turn: { status?: string | null; items: Array<Record<string, unknown>> },
  threadStatus?: string | null,
): boolean {
  if (normalizeCodexStatus(turn.status) !== "interrupted") return false;
  if (normalizeCodexStatus(threadStatus) !== "idle") return false;
  if (turn.items.some(isCodexResumeTerminalEvidenceItem)) return false;
  const nonUserItems = turn.items.filter((item) => item.type !== "userMessage");
  return nonUserItems.length > 0 && nonUserItems.every(isRecoveredAgentMessageItem);
}

export function hasOnlyRetrySafeCodexResumedItems(items: Array<Record<string, unknown>>): boolean {
  return items.length > 0 && items.every((item) => item.type === "contextCompaction");
}

function hasRecoveredAssistantToolTailWithoutTerminalEvidence(items: Array<Record<string, unknown>>): boolean {
  let lastAgentMessageIndex = -1;
  for (let i = 0; i < items.length; i++) {
    if (isRecoveredAgentMessageItem(items[i])) lastAgentMessageIndex = i;
  }
  if (lastAgentMessageIndex < 0) return false;
  const tail = items.slice(lastAgentMessageIndex + 1);
  if (!tail.some(isCodexResumeToolActivityItem)) return false;
  return !tail.some(isCodexResumeTerminalEvidenceItem);
}

function normalizeCodexStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function isRecoveredAgentMessageItem(item: Record<string, unknown>): boolean {
  return item.type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0;
}

function isCodexResumeToolActivityItem(item: Record<string, unknown>): boolean {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  return (
    type.includes("command") ||
    type.includes("tool") ||
    type.includes("function") ||
    type.includes("filechange") ||
    type.includes("patch")
  );
}

function isCodexResumeTerminalEvidenceItem(item: Record<string, unknown>): boolean {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  return (
    type === "result" ||
    type === "turnresult" ||
    type === "turn_result" ||
    type === "taskcomplete" ||
    type === "task_complete" ||
    type.includes("taskcomplete") ||
    type.includes("task_complete")
  );
}
