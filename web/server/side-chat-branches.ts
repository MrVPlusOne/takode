import type { BrowserIncomingMessage, ContentBlock, SideChatRecord } from "./session-types.js";

const THREAD_ID_RANDOM_BYTES = 6;
const PREVIEW_LIMIT = 140;
export const SIDE_CHAT_SEED_MAX_CHARS = 120_000;

export function createSideChatId(randomUUID: () => string = () => crypto.randomUUID()): string {
  const compact = randomUUID()
    .replace(/-/g, "")
    .slice(0, THREAD_ID_RANDOM_BYTES * 2);
  return `sc-${compact || Date.now().toString(36)}`;
}

export function extractMessageText(message: BrowserIncomingMessage): string {
  if (message.type === "user_message" || message.type === "leader_user_message") return message.content;
  if (message.type === "assistant") return extractTextFromBlocks(message.message.content);
  if (message.type === "result") return message.data.result ?? "";
  return "";
}

export function previewText(text: string, limit = PREVIEW_LIMIT): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

export function findRootAssistantAnchor(
  history: BrowserIncomingMessage[],
  anchorMessageId: string,
): { message: Extract<BrowserIncomingMessage, { type: "assistant" }>; historyIndex: number; preview: string } | null {
  const historyIndex = history.findIndex((entry) => entry.type === "assistant" && entry.message.id === anchorMessageId);
  if (historyIndex < 0) return null;
  const message = history[historyIndex] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
  if ((message as { slackThreadId?: string }).slackThreadId) return null;
  if (message.threadKey && message.threadKey.toLowerCase() !== "main") return null;
  return { message, historyIndex, preview: previewText(extractMessageText(message)) };
}

export function buildSideChatSeedPrompt(
  rootHistory: BrowserIncomingMessage[],
  anchorHistoryIndex: number,
  anchorMessageId: string,
): string {
  return buildBoundedSideChatSeedPrompt(rootHistory, anchorHistoryIndex, anchorMessageId).prompt;
}

export function buildBoundedSideChatSeedPrompt(
  rootHistory: BrowserIncomingMessage[],
  anchorHistoryIndex: number,
  anchorMessageId: string,
  maxChars = SIDE_CHAT_SEED_MAX_CHARS,
): { prompt: string; truncated: boolean; omittedChars: number } {
  const rawTranscript = rootHistory
    .slice(0, anchorHistoryIndex + 1)
    .flatMap((message, index) => {
      if (message.type === "user_message") return [`[root user ${index}]\n${message.content}`];
      if (message.type === "leader_user_message") return [`[root assistant ${index}]\n${message.content}`];
      if (message.type === "assistant") {
        const text = extractMessageText(message);
        if (!text.trim()) return [];
        const anchorSuffix = message.message.id === anchorMessageId ? " (Side Chat anchor)" : "";
        return [`[root assistant ${index}${anchorSuffix}]\n${text}`];
      }
      return [];
    })
    .join("\n\n");
  const omittedChars = Math.max(0, rawTranscript.length - maxChars);
  const transcript =
    omittedChars > 0
      ? `[Earlier root branch context omitted: ${omittedChars} chars. Fallback replay is bounded; ask the user to continue in the root session if omitted context matters.]\n\n${rawTranscript.slice(-maxChars)}`
      : rawTranscript;

  const prompt = [
    "You are continuing a Side Chat in Takode.",
    "This hidden child backend session is read-only for repository and file state.",
    omittedChars > 0
      ? "Use the bounded root transcript below as partial branch context. Do not assume omitted or later root messages exist."
      : "Use the root transcript below as the complete branch context. Do not assume later root messages exist.",
    "If an edit or other mutation is needed, explain the needed change and ask the user to continue in the root session or a normal quest workflow.",
    "",
    "Root branch context:",
    transcript || "(No readable root transcript was available.)",
    "",
    "Now answer the user's Side Chat message.",
  ].join("\n");
  return { prompt, truncated: omittedChars > 0, omittedChars };
}

export function computeCodexSideChatForkPlan(
  history: BrowserIncomingMessage[],
  anchorMessageId: string,
): { ok: true; rollbackTurns: number } | { ok: false; reason: string } {
  const segments: Array<{ completed: boolean; assistantIds: string[] }> = [];
  let current: { completed: boolean; assistantIds: string[] } | null = null;
  for (const message of history) {
    if (message.type === "user_message" || message.type === "leader_user_message") {
      if (current) segments.push(current);
      current = { completed: false, assistantIds: [] };
      continue;
    }
    if (!current) continue;
    if (message.type === "assistant") current.assistantIds.push(message.message.id);
    if (message.type === "result") {
      current.completed = true;
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);

  const targetIndex = segments.findIndex((segment) => segment.assistantIds.includes(anchorMessageId));
  if (targetIndex < 0) return { ok: false, reason: "anchor is not in a Codex turn segment" };
  const target = segments[targetIndex];
  if (!target.completed) return { ok: false, reason: "anchor turn is not complete" };
  if (target.assistantIds[target.assistantIds.length - 1] !== anchorMessageId) {
    return { ok: false, reason: "anchor is not the final assistant message in its Codex turn" };
  }
  const later = segments.slice(targetIndex + 1);
  if (later.some((segment) => !segment.completed)) return { ok: false, reason: "later Codex turn is still incomplete" };
  return { ok: true, rollbackTurns: later.length };
}

export function updateSideChatRecordFromChildHistory(
  record: SideChatRecord,
  childHistory: BrowserIncomingMessage[],
): SideChatRecord {
  const visibleMessages = childHistory.filter(
    (message) => message.type === "user_message" || message.type === "assistant",
  );
  const lastPreviewSource = [...visibleMessages].reverse().find((message) => extractMessageText(message).trim());
  return {
    ...record,
    messageCount: visibleMessages.length,
    updatedAt: Date.now(),
    ...(lastPreviewSource ? { lastMessagePreview: previewText(extractMessageText(lastPreviewSource)) } : {}),
  };
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
