import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "../session-types.js";

export interface TurnStartFailureInfo {
  recoverable: boolean;
  message: string;
}

export type TurnSteerFailureInfo =
  | { kind: "no_active_turn"; expectedTurnId: string }
  | { kind: "active_turn_mismatch"; expectedTurnId: string; foundTurnId: string }
  | { kind: "other"; expectedTurnId: string; message: string };

/** Metadata updates adapters can emit as they initialize or reconnect. */
export interface AdapterSessionMeta {
  cliSessionId?: string;
  model?: string;
  cwd?: string;
}

/**
 * Shared backend adapter contract consumed by ws-bridge.
 * Adapters translate between backend protocols and Browser* messages.
 */
export interface BackendAdapter<TMeta extends AdapterSessionMeta = AdapterSessionMeta> {
  sendBrowserMessage(msg: BrowserOutgoingMessage): boolean;
  onBrowserMessage(cb: (msg: BrowserIncomingMessage) => void): void;
  onSessionMeta(cb: (meta: TMeta) => void): void;
  onDisconnect(cb: () => void): void;
  onInitError(cb: (error: string) => void): void;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export interface TurnStartFailedAwareAdapter {
  onTurnStartFailed(cb: (msg: BrowserOutgoingMessage, info?: TurnStartFailureInfo) => void): void;
}

export interface TurnStartedAwareAdapter {
  onTurnStarted(cb: (turnId: string, source?: "local" | "codex_goal_continuation") => void): void;
}

export interface TurnSteeredAwareAdapter {
  onTurnSteered(cb: (turnId: string, pendingInputIds: string[], clientUserMessageId?: string) => void): void;
}

export interface TurnSteerFailedAwareAdapter {
  onTurnSteerFailed(
    cb: (pendingInputIds: string[], info?: TurnSteerFailureInfo, clientUserMessageId?: string) => void,
  ): void;
}

export interface CompactRequestedAwareAdapter {
  onCompactRequested(cb: () => void): void;
}

/** Claude adapter state that lets the bridge end a turn Claude never received. */
export interface ClaudeTurnAwareAdapter {
  hasTurnInFlight(): boolean;
  discardPendingUserMessages(): number;
}

/** A background task (shell command, subagent, workflow) whose end the agent is notified about. */
export interface BackgroundTaskInfo {
  taskId: string;
  description: string;
  /** When Takode first saw the task running. */
  startedAt: number;
}

/** The backend process's live background tasks, and when that set last changed (0 if never). */
export interface BackgroundTaskSnapshot {
  tasks: readonly BackgroundTaskInfo[];
  changedAt: number;
}

export interface BackgroundTaskAwareAdapter {
  getBackgroundTasks(): BackgroundTaskSnapshot;
}

export interface PendingOutgoingAwareAdapter {
  drainPendingOutgoing(): BrowserOutgoingMessage[];
}

export interface CurrentTurnIdAwareAdapter {
  getCurrentTurnId(): string | null;
}

export interface RateLimitsAwareAdapter {
  getRateLimits(): {
    primary: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
    secondary: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
  } | null;
}
