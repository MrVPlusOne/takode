// Builders for producer-shaped leader thread windows: one leader session whose quest
// thread holds routed user messages, explicit answers and tool rows.
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";

export const SESSION_ID = "leader-response-window";
export const QUEST_ID = "q-2024";
export const THREAD_REF = { threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const };
export const ASSOCIATED_MAIN_USER_ID = "user-main-attached";

export function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude-sdk",
    model: "claude-opus-4-20250514",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "2.1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/tmp/takode",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

export function routedFields() {
  return { threadKey: QUEST_ID, questId: QUEST_ID, threadRefs: [THREAD_REF] };
}

export function answerIdForRawUserMessage(id: string): string {
  const ids: Record<string, string> = {
    "user-first": "u1",
    "user-second": "u2",
    "user-third": "u3",
    "user-live": "u4",
    "user-quiz-owner": "u1",
    "user-later": "u2",
    "user-only": "u1",
    "user-older-pending": "u1",
    "user-later-answered": "u2",
    [ASSOCIATED_MAIN_USER_ID]: "u25",
  };
  const answerId = ids[id];
  if (!answerId) throw new Error(`Missing answer ID fixture for ${id}`);
  return answerId;
}

export function userMessage(
  id: string,
  text: string,
  timestamp: number,
  responseCoverage = true,
): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: text,
    timestamp,
    ...(responseCoverage
      ? { leaderResponseCoverageVersion: 1 as const, leaderUserMessageId: answerIdForRawUserMessage(id) }
      : {}),
    ...routedFields(),
  };
}

export function assistantMessage(
  id: string,
  text: string,
  timestamp: number,
  codexMessagePhase?: "commentary" | "final_answer",
  leaderThreadRole?: "commentary" | "answer" | "response",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    ...(codexMessagePhase ? { codexMessagePhase } : {}),
    ...(leaderThreadRole ? { leaderThreadRole } : {}),
    ...routedFields(),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

export function toolMessage(
  id: string,
  toolUseId: string,
  timestamp: number,
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...routedFields(),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command: "quest show q-2024" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

export function responseMessage(input: {
  id: string;
  coveredUserMessageIds: string[];
  content: string;
  timestamp: number;
  observedHistoryLength?: number;
}): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp: input.timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    ...routedFields(),
    threadAnswer: {
      version: 2,
      answerUserMessageIds: input.coveredUserMessageIds.map(answerIdForRawUserMessage),
      observedHistoryLength:
        input.observedHistoryLength ??
        Math.max(
          ...input.coveredUserMessageIds.map(
            (id) =>
              ({
                "user-first": 41,
                "user-second": 42,
                "user-third": 45,
                "user-quiz-owner": 41,
                "user-later": 44,
                "user-only": 41,
              })[id] ?? 0,
          ),
        ),
    },
    message: {
      id: input.id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text: input.content }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

export function quest(): QuestmasterTask {
  return {
    id: `${QUEST_ID}-v4`,
    questId: QUEST_ID,
    version: 4,
    title: "Leader thread responses",
    description: "Keep polished responses visible when Ready.",
    status: "done",
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_006_000,
    verificationItems: [],
    quizItems: [
      {
        id: "response-history",
        question: "What remains available after a response is revised?",
        answer: "The complete chronological thread history.",
      },
    ],
  };
}
