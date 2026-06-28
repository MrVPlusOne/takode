import type {
  CLIResultMessage,
  ContextUsageHistoryEntry,
  ContextUsageHistorySource,
  SessionState,
} from "../session-types.js";

const CONTEXT_USAGE_HISTORY_LIMIT = 200;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function computeContextTokensUsed(usage: TokenUsage): number | undefined {
  const inputTokens = Number(usage.input_tokens || 0);
  const cacheCreation = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const totalCache = cacheCreation + cacheRead;

  let usedInContext: number;
  if (totalCache > 0 && totalCache <= inputTokens) {
    usedInContext = inputTokens;
  } else {
    usedInContext = inputTokens + totalCache;
  }
  return usedInContext > 0 ? usedInContext : undefined;
}

export function inferContextWindowFromModel(model: string | undefined): number | undefined {
  if (!model) return undefined;
  const normalized = model.toLowerCase();
  if (normalized.includes("[1m]") || normalized.includes("context-1m")) {
    return 1_000_000;
  }
  if (normalized.startsWith("claude-")) {
    return 200_000;
  }
  return undefined;
}

export function resolveResultContextWindow(
  model: string | undefined,
  modelUsage: CLIResultMessage["modelUsage"] | undefined,
): number | undefined {
  let fromUsage = 0;
  if (modelUsage) {
    for (const usage of Object.values(modelUsage)) {
      if (usage.contextWindow > 0) {
        fromUsage = Math.max(fromUsage, usage.contextWindow);
      }
    }
  }
  const fromModel = inferContextWindowFromModel(model) ?? 0;
  const resolved = Math.max(fromUsage, fromModel);
  return resolved > 0 ? resolved : undefined;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function computeContextUsedPercent(usage: TokenUsage, contextWindow: number): number | undefined {
  const usedInContext = computeContextTokensUsed(usage);
  if (usedInContext == null || usedInContext <= 0) return undefined;

  const pct = Math.round((usedInContext / contextWindow) * 100);
  return clampPercent(pct);
}

export function computeResultContextUsedPercent(
  model: string | undefined,
  msg: CLIResultMessage,
  lastAssistantUsage: TokenUsage | undefined,
): number | undefined {
  const contextWindow = resolveResultContextWindow(model, msg.modelUsage);
  if (!contextWindow) return undefined;

  if (lastAssistantUsage) {
    const pct = computeContextUsedPercent(lastAssistantUsage, contextWindow);
    if (pct != null) return pct;
  }

  if (!msg.usage) return undefined;
  const fallbackInput = Number(msg.usage.input_tokens || 0);
  if (fallbackInput > contextWindow) return undefined;
  return computeContextUsedPercent(msg.usage, contextWindow);
}

export function extractClaudeTokenDetails(
  modelUsage: CLIResultMessage["modelUsage"],
  model?: string,
): SessionState["claude_token_details"] | undefined {
  if (!modelUsage) return undefined;
  const usage = Object.values(modelUsage).find((entry) => entry && typeof entry === "object");
  if (!usage) return undefined;

  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const cachedInputTokens = Number(usage.cacheReadInputTokens || 0) + Number(usage.cacheCreationInputTokens || 0);
  const rawContextWindow = Number(usage.contextWindow || 0);
  const inferredContextWindow = inferContextWindowFromModel(model) ?? 0;
  const modelContextWindow = Math.max(rawContextWindow, inferredContextWindow);

  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0 && modelContextWindow <= 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    modelContextWindow,
  };
}

interface ContextUsageHistorySessionLike {
  state: Pick<
    SessionState,
    "context_used_percent" | "codex_token_details" | "claude_token_details" | "codex_leader_recycle_threshold_tokens"
  >;
  contextUsageHistory?: ContextUsageHistoryEntry[];
}

function usageHistorySignature(entry: ContextUsageHistoryEntry): string {
  const { timestamp: _timestamp, source: _source, ...rest } = entry;
  return JSON.stringify(rest);
}

export function buildContextUsageHistoryEntry(
  state: ContextUsageHistorySessionLike["state"],
  source: ContextUsageHistorySource,
  timestamp = Date.now(),
): ContextUsageHistoryEntry | null {
  const codex = state.codex_token_details;
  const claude = state.claude_token_details;
  const details = source === "codex_token_usage" ? codex : claude;
  const contextUsedPercent =
    typeof state.context_used_percent === "number" && Number.isFinite(state.context_used_percent)
      ? state.context_used_percent
      : undefined;

  const entry: ContextUsageHistoryEntry = {
    timestamp,
    source,
    ...(contextUsedPercent !== undefined ? { contextUsedPercent } : {}),
  };

  if (codex && source === "codex_token_usage") {
    Object.assign(entry, {
      ...(typeof codex.contextTokensUsed === "number" ? { contextTokensUsed: codex.contextTokensUsed } : {}),
      inputTokens: codex.inputTokens,
      outputTokens: codex.outputTokens,
      cachedInputTokens: codex.cachedInputTokens,
      reasoningOutputTokens: codex.reasoningOutputTokens,
      modelContextWindow: codex.modelContextWindow,
      ...(typeof state.codex_leader_recycle_threshold_tokens === "number"
        ? { leaderRecycleThresholdTokens: state.codex_leader_recycle_threshold_tokens }
        : {}),
    });
  } else if (details) {
    Object.assign(entry, {
      inputTokens: details.inputTokens,
      outputTokens: details.outputTokens,
      cachedInputTokens: details.cachedInputTokens,
      modelContextWindow: details.modelContextWindow,
    });
  }

  return Object.keys(entry).length > 2 ? entry : null;
}

export function recordContextUsageHistory(
  session: ContextUsageHistorySessionLike,
  source: ContextUsageHistorySource,
  timestamp = Date.now(),
): boolean {
  const entry = buildContextUsageHistoryEntry(session.state, source, timestamp);
  if (!entry) return false;

  const current = Array.isArray(session.contextUsageHistory) ? session.contextUsageHistory : [];
  const last = current[current.length - 1];
  if (last && usageHistorySignature(last) === usageHistorySignature(entry)) {
    session.contextUsageHistory = current;
    return false;
  }

  session.contextUsageHistory = [...current, entry].slice(-CONTEXT_USAGE_HISTORY_LIMIT);
  return true;
}
