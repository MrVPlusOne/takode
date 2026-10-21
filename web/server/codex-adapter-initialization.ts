import type { BrowserOutgoingMessage, SessionState } from "./session-types.js";
import type { TurnStartFailureInfo } from "./bridge/adapter-interface.js";
import type { CodexAdapterOptions } from "./codex-adapter-types.js";
import { isRecoverableCodexTurnStartError, normalizeCodexServiceTier } from "./codex-adapter-utils.js";
import { CODEX_GOAL_UNKNOWN_CAPABILITY } from "./codex-goal.js";
import { CODEX_LOCAL_SLASH_COMMANDS } from "../shared/codex-slash-commands.js";
import {
  codexEffectiveReasoningEffortPatch,
  type CodexReasoningEffortReport,
} from "../shared/codex-reasoning-effort.js";

interface ConfigWriter {
  call(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

/**
 * Open the JSON-RPC connection. An app-server a previous coordinator already
 * initialized (`reattach`) answers "Already initialized" and is ready as it is.
 */
export async function initializeCodexConnection(
  transport: ConfigWriter & { notify(method: string, params: Record<string, unknown>): Promise<void> },
  reattach: boolean,
): Promise<void> {
  try {
    await transport.call("initialize", {
      clientInfo: { name: "thecompanion", title: "The Companion", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
  } catch (error) {
    if (reattach && error instanceof Error && error.message === "Already initialized") return;
    throw error;
  }
  await transport.notify("initialized", {});
}

/** The session state a newly connected Codex adapter announces in `session_init`. */
export function buildCodexInitialSessionState(
  sessionId: string,
  options: CodexAdapterOptions,
  runtimeReasoningEffort: CodexReasoningEffortReport,
): SessionState {
  return {
    session_id: sessionId,
    backend_type: "codex",
    model: options.model || "",
    codex_service_tier: normalizeCodexServiceTier(options.serviceTier),
    codex_goal: null,
    codex_goal_capability: CODEX_GOAL_UNKNOWN_CAPABILITY,
    cwd: options.cwd || "",
    tools: [],
    permissionMode: options.approvalMode || "suggest",
    ...(options.uiMode ? { uiMode: options.uiMode } : {}),
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [...CODEX_LOCAL_SLASH_COMMANDS],
    skills: [],
    skill_metadata: [],
    apps: [],
    skills_stale: false,
    apps_stale: false,
    skills_stale_since: null,
    skills_last_changed_at: null,
    skills_last_change_reason: null,
    skills_change_count: 0,
    total_cost_usd: 0,
    user_turn_count: 0,
    agent_turn_count: 0,
    num_turns: 0,
    context_used_percent: 0,
    codex_retained_payload_bytes: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...(options.reasoningEffort ? { codex_reasoning_effort: options.reasoningEffort } : {}),
    ...codexEffectiveReasoningEffortPatch(runtimeReasoningEffort),
  };
}

export async function configureCodexDeveloperInstructions(
  transport: ConfigWriter,
  instructions: string | undefined,
): Promise<void> {
  if (!instructions?.trim()) return;
  await transport.call("config/value/write", {
    keyPath: "developer_instructions",
    value: instructions,
    mergeStrategy: "replace",
  });
}

export function handleCodexTurnStartDispatchFailure(
  callback: ((msg: BrowserOutgoingMessage, info?: TurnStartFailureInfo) => void) | null,
  message: BrowserOutgoingMessage,
  error: unknown,
): boolean {
  if (!callback) return false;
  const recoverable = isRecoverableCodexTurnStartError(error);
  if (recoverable) callback(message);
  else callback(message, { recoverable, message: String(error) });
  return true;
}

export async function forkCodexThread(
  transport: ConfigWriter,
  params: Record<string, unknown>,
  rollbackTurns?: number,
): Promise<string> {
  const result = (await transport.call("thread/fork", params)) as { thread: { id: string } };
  const threadId = result.thread.id;
  if (rollbackTurns) {
    try {
      await revertCodexThreadTurns(transport, threadId, rollbackTurns);
    } catch (error) {
      throw new Error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return threadId;
}

/**
 * Drop the last `numTurns` turns from a Codex thread's history. Codex's
 * `thread/revert` cuts history before a turn ID, so the cut turn is found by
 * listing turns newest first. Asking for more turns than the thread holds
 * clears the whole thread. Only `paginated` threads can be reverted; threads
 * from older Codex versions keep the `legacy` history format and are refused.
 */
export async function revertCodexThreadTurns(
  transport: ConfigWriter,
  threadId: string,
  numTurns: number,
): Promise<void> {
  let beforeTurnId: string | undefined;
  let remaining = numTurns;
  let cursor: string | null = null;
  do {
    const page = (await transport.call("thread/turns/list", {
      threadId,
      cursor,
      limit: remaining,
      sortDirection: "desc",
      itemsView: "notLoaded",
    })) as { data: Array<{ id: string }>; nextCursor: string | null };
    const turns = page.data.slice(0, remaining);
    if (turns.length > 0) beforeTurnId = turns[turns.length - 1].id;
    remaining -= turns.length;
    cursor = page.nextCursor;
  } while (remaining > 0 && cursor);
  if (!beforeTurnId) return;

  try {
    await transport.call("thread/revert", { threadId, beforeTurnId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("only supports paginated threads")) throw error;
    throw new Error(
      "Codex can't revert this conversation: it was created by an older Codex version, and the current Codex only reverts conversations in its newer history format. New Codex sessions can be reverted.",
    );
  }
}
