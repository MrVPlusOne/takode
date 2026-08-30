import type { CodexLeaderCompactionMode } from "../shared/codex-leader-compaction-mode.js";

export type CodexAutoCompactTokenLimitScope = "total" | "body_after_prefix";

export type CodexContextCapacitySource =
  | "leader_recycle_guard"
  | "configured_usable_capacity"
  | "codex_config"
  | "codex_default";

export interface CodexContextWindowDiagnostics {
  role: "leader" | "non_leader";
  leaderMode?: CodexLeaderCompactionMode;
  capacitySource: CodexContextCapacitySource;
  /** User-requested effective/usable capacity, when Takode owns one. */
  configuredUsableContextWindow?: number;
  /** Window Takode presents as the current usable/recycle denominator. */
  displayContextWindow?: number;
  /** Raw provider/catalog window passed at the final launch boundary. */
  providerRawContextWindow?: number;
  /** Selected catalog reserve applied to the raw window, when known. */
  catalogEffectiveContextWindowPercent?: number;
  /** Effective provider window derived from the selected catalog, before any recycle display rewrite. */
  providerEffectiveContextWindow?: number;
  /** Provider charge at which Codex is configured to compact. */
  autoCompactTokenLimit?: number;
  /** Charge scope used by the provider threshold, when known. */
  autoCompactTokenLimitScope?: CodexAutoCompactTokenLimitScope;
}

export type CodexCompactionCause = "context_pressure" | "manual" | "model_switch_migration";

export type CodexLeaderRecycleTrigger = "threshold" | "manual_compact" | "context_window_exhausted";

export interface CodexLeaderRecycleContinuation {
  trigger: CodexLeaderRecycleTrigger;
  requestedAt: number;
  content: string;
  threadKey?: string;
  questId?: string;
}

export interface CodexModelSwitchCompactionGuard {
  previousModel?: string;
  nextModel: string;
  createdAt: number;
  expiresAt: number;
  modelActivityObserved?: boolean;
}

export interface SessionContextLengthSnapshot {
  /** Best known context charge. Auto-compaction snapshots can be a documented lower bound. */
  contextTokensUsed?: number;
  /** Provider-reported current prompt input, which can omit retained encrypted reasoning. */
  providerReportedInputTokens?: number;
  /** Provider-reported current prompt plus current response output. */
  providerReportedTotalTokens?: number;
  contextUsedPercent?: number;
  modelContextWindow?: number;
  autoCompactTokenLimit?: number;
  autoCompactTokenLimitScope?: CodexAutoCompactTokenLimitScope;
  source: "compact_boundary" | "codex_token_details" | "codex_auto_compact_limit";
  capturedAt: number;
}

export interface SessionCompactionLifecycleEvent {
  type: "compaction";
  id: string;
  timestamp: number;
  backendType?: "claude" | "codex" | "claude-sdk";
  trigger?: "auto" | "manual";
  cause?: CodexCompactionCause;
  /** Launch-resolved policy captured at event time so later relaunches cannot rewrite history. */
  contextWindowDiagnostics?: CodexContextWindowDiagnostics;
  before?: SessionContextLengthSnapshot;
  after?: SessionContextLengthSnapshot;
  finishedAt?: number;
}

export type SessionLifecycleEvent = SessionCompactionLifecycleEvent;

export interface CodexLeaderRecycleTokenSnapshot {
  contextTokensUsed?: number;
  contextUsedPercent?: number;
  modelContextWindow?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface CodexLeaderRecycleEvent {
  trigger: CodexLeaderRecycleTrigger;
  requestedAt: number;
  previousCliSessionId?: string;
  nextCliSessionId?: string;
  tokenUsage?: CodexLeaderRecycleTokenSnapshot;
}

export interface CodexLeaderRecycleLineage {
  cliSessionIds: string[];
  recycleEvents: CodexLeaderRecycleEvent[];
}
