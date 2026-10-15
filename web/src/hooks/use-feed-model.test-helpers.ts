// Message builders and entry-id readers shared by the useFeedModel test files.
import type { ChatMessage, SessionAttentionRecord } from "../types.js";
import { buildFeedModel } from "./use-feed-model.js";

export function makeMessage(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage["role"] }): ChatMessage {
  return {
    content: "",
    timestamp: 1,
    ...overrides,
  };
}

/** Create a herd event user message (injected by the herd dispatcher). */
export function makeHerdEvent(id: string, content: string, timestamp = 1): ChatMessage {
  return makeMessage({
    id,
    role: "user",
    content,
    timestamp,
    agentSource: { sessionId: "herd-events" } as ChatMessage["agentSource"],
  });
}

export function makeInjectedUserMessage(
  id: string,
  content: string,
  timestamp: number,
  sessionId: string,
  sessionLabel?: string,
): ChatMessage {
  return makeMessage({
    id,
    role: "user",
    content,
    timestamp,
    agentSource: { sessionId, ...(sessionLabel ? { sessionLabel } : {}) } as ChatMessage["agentSource"],
  });
}

export function makeNotifyToolMessage(id: string, timestamp: number): ChatMessage {
  return makeMessage({
    id,
    role: "assistant",
    content: "",
    timestamp,
    contentBlocks: [
      {
        type: "tool_use",
        id: `${id}-tool`,
        name: "Bash",
        input: { command: 'takode notify needs-input "confirm proposal"' },
      },
    ],
  });
}

export function makeVisibleLeaderMessage(id: string, content: string, timestamp: number): ChatMessage {
  return makeMessage({
    id,
    role: "assistant",
    content,
    timestamp,
    metadata: { leaderUserMessage: true },
  });
}

export function makeThreadReadyStatus(messageId: string, timestamp: number) {
  return {
    kind: "ready" as const,
    label: "Thread Ready" as const,
    threadKey: "q-1814",
    questId: "q-1814",
    summary: "revised Slack draft ready",
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

export function makeAssistantMessage(id: string, content: string, timestamp: number): ChatMessage {
  return makeMessage({
    id,
    role: "assistant",
    content,
    timestamp,
    contentBlocks: [{ type: "text", text: content }],
  });
}

export function makePhasedAssistant(
  id: string,
  content: string,
  timestamp: number,
  phase: "commentary" | "final_answer" | null,
  metadata: ChatMessage["metadata"] = {},
): ChatMessage {
  return makeMessage({
    id,
    role: "assistant",
    content,
    timestamp,
    contentBlocks: [{ type: "text", text: content }],
    metadata: { ...metadata, ...(phase === null ? {} : { codexMessagePhase: phase }) },
  });
}

export function makeRoutedLeaderAssistant(
  id: string,
  content: string,
  timestamp: number,
  role: "commentary" | "answer",
): ChatMessage {
  return makeMessage({
    id,
    role: "assistant",
    content,
    timestamp,
    contentBlocks: [{ type: "text", text: content }],
    metadata: { leaderThreadRole: role },
  });
}

export function makeReworkMilestoneRecord(overrides: Partial<SessionAttentionRecord> = {}): SessionAttentionRecord {
  const createdAt = overrides.createdAt ?? 4;
  return {
    id: "message-rework:q-1151",
    leaderSessionId: "leader-1",
    type: "quest_reopened_or_rework",
    source: { kind: "message", id: "rework-message", questId: "q-1151" },
    questId: "q-1151",
    threadKey: "q-1151",
    title: "Rework requested",
    summary: "Keep attention milestones ordered",
    actionLabel: "Open",
    priority: "milestone",
    state: "reopened",
    createdAt,
    updatedAt: createdAt,
    route: { threadKey: "q-1151", questId: "q-1151" },
    chipEligible: false,
    ledgerEligible: true,
    dedupeKey: "message-rework:q-1151",
    ...overrides,
  };
}

/** Helper to extract the message IDs from a turn's entries. */
export function entryIds(entries: { kind: string; msg?: { id: string } }[]): string[] {
  return entries.filter((e) => e.kind === "message").map((e) => (e as { msg: { id: string } }).msg.id);
}

export function collapsedEntryIds(turn: {
  collapsedEntries?: NonNullable<ReturnType<typeof buildFeedModel>["turns"][number]["collapsedEntries"]>;
}): string[] {
  return (turn.collapsedEntries ?? []).map((entry) => {
    if (entry.kind === "activity") return "activity";
    if (entry.entry.kind === "message") return entry.entry.msg.id;
    return entry.entry.kind;
  });
}
