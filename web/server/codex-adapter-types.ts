import type { RecorderManager } from "./recorder.js";
import type { CodexResumeSnapshot } from "./codex-adapter-utils.js";

export interface CodexAdapterOptions {
  model?: string;
  cwd?: string;
  approvalMode?: string;
  askPermission?: boolean;
  uiMode?: "plan" | "agent";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  reasoningEffort?: string;
  /** Codex app-server service tier for future turns. null/undefined means Standard. */
  serviceTier?: string | null;
  /** If provided, resume an existing thread instead of starting a new one. */
  threadId?: string;
  /** If provided, initialization must resume this exact thread and must not fall back to a fresh thread. */
  requireResumeThreadId?: string;
  /** Optional recorder for raw message capture. */
  recorder?: RecorderManager;
  /** Companion instructions injected via session-scoped Codex config before thread start/resume. */
  instructions?: string;
  /** Optional stderr/context captured by the launcher for early startup failures. */
  failureContextProvider?: () => string | null;
}

export interface CodexSessionMeta {
  cliSessionId?: string;
  model?: string;
  cwd?: string;
  resumeSnapshot?: CodexResumeSnapshot | null;
}
