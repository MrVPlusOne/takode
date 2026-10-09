import type { BackendType, PermissionRequest, PermissionUpdate } from "../session-types.js";
import { detectLongSleepBashCommand, LONG_SLEEP_DENY_MESSAGE, LONG_SLEEP_REMINDER_TEXT } from "./bash-sleep-policy.js";

export type PermissionRequestBackend = "claude-sdk" | "codex";

export interface IncomingPermissionRequest {
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  permission_suggestions?: PermissionUpdate[];
  description?: string;
  tool_use_id: string;
  agent_id?: string;
}

export interface PermissionPipelineSession {
  id: string;
  backendType: BackendType;
  state: {
    permissionMode?: string;
    cwd?: string;
    slackThreadChild?: { readOnly?: boolean } | null;
  };
  pendingPermissions: Map<string, PermissionRequest>;
}

export interface PermissionPipelineDeps<S extends PermissionPipelineSession> {
  onSessionActivityStateChanged: (sessionId: string, reason: string) => void;
  broadcastPermissionRequest: (session: S, request: PermissionRequest) => void;
  persistSession: (session: S) => void;
  setAttentionAction: (session: S) => void;
  emitTakodePermissionRequest: (session: S, request: PermissionRequest) => void;
  schedulePermissionNotification?: (session: S, request: PermissionRequest) => void;
}

export interface HandlePermissionRequestOptions {
  activityReason: string;
  enableModeAutoApprove?: boolean;
}

export type PermissionPipelineResult =
  | {
      kind: "mode_auto_approved";
      request: PermissionRequest;
    }
  | {
      kind: "hard_denied";
      request: PermissionRequest;
      message: string;
      reminder: string;
    }
  | {
      kind: "pending_human";
      request: PermissionRequest;
    };

/** Tools that require user interaction and can never be auto-approved. */
export const NEVER_AUTO_APPROVE: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Tools auto-approved in acceptEdits mode. */
export const ACCEPT_EDITS_AUTO_APPROVE: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "Read",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
  "Agent",
  "Skill",
]);

const THREAD_READ_ONLY_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "TodoWrite",
  "apply_patch",
  "functions.apply_patch",
]);

const THREAD_READ_ONLY_BASH_WRITE_RE =
  /(?:^|[;&|]\s*)(?:(?:echo|printf|cat)\b[^;&|]*>\s*|tee\b|sed\s+-i\b|perl\s+-pi\b|touch\b|rm\b|mv\b|cp\b|mkdir\b|rmdir\b|chmod\b|chown\b|ln\b|truncate\b|dd\b|install\b|bun\s+(?:add|install|update|remove)\b|npm\s+(?:install|i|update|uninstall|remove|ci)\b|pnpm\s+(?:install|add|update|remove)\b|yarn\s+(?:install|add|remove|upgrade)\b|git\s+(?:checkout|switch|reset|clean|commit|merge|rebase|pull|push|add|restore)\b)/i;

function shouldModeAutoApprove(permissionMode: string | undefined, toolName: string): boolean {
  return (
    !NEVER_AUTO_APPROVE.has(toolName) &&
    (permissionMode === "bypassPermissions" ||
      (permissionMode === "acceptEdits" && toolName !== "Bash" && ACCEPT_EDITS_AUTO_APPROVE.has(toolName)))
  );
}

function toPermissionRequest(request: IncomingPermissionRequest): PermissionRequest {
  return {
    request_id: request.request_id,
    tool_name: request.tool_name,
    input: request.input,
    permission_suggestions: request.permission_suggestions,
    description: request.description,
    tool_use_id: request.tool_use_id,
    agent_id: request.agent_id,
    timestamp: Date.now(),
  };
}

function getHardDeniedPermission<S extends PermissionPipelineSession>(
  session: S,
  perm: PermissionRequest,
): Extract<PermissionPipelineResult, { kind: "hard_denied" }> | null {
  if (session.state.slackThreadChild?.readOnly) {
    if (THREAD_READ_ONLY_MUTATING_TOOLS.has(perm.tool_name)) {
      return {
        kind: "hard_denied",
        request: perm,
        message:
          "Thread turns are read-only. Continue in the root conversation or a normal quest workflow to edit files.",
        reminder: "This Side Chat workspace is read-only for repository and file state.",
      };
    }
    if (perm.tool_name === "Bash") {
      const command = String(perm.input.command ?? "");
      if (!command.trim() || THREAD_READ_ONLY_BASH_WRITE_RE.test(command)) {
        return {
          kind: "hard_denied",
          request: perm,
          message:
            "Thread turns are read-only. This shell command may mutate repository or file state, so it cannot be allowed here.",
          reminder: "Use read-only shell commands in this thread, or move edit work to the root conversation.",
        };
      }
    }
  }
  if (perm.tool_name !== "Bash") return null;
  const command = String(perm.input.command ?? "");
  if (!detectLongSleepBashCommand(command)) return null;
  return {
    kind: "hard_denied",
    request: perm,
    message: LONG_SLEEP_DENY_MESSAGE,
    reminder: LONG_SLEEP_REMINDER_TEXT,
  };
}

export function handlePermissionRequest<S extends PermissionPipelineSession>(
  session: S,
  request: IncomingPermissionRequest,
  _backend: PermissionRequestBackend,
  deps: PermissionPipelineDeps<S>,
  options: HandlePermissionRequestOptions,
): PermissionPipelineResult {
  const perm = toPermissionRequest(request);
  const toolName = perm.tool_name;

  const hardDenied = getHardDeniedPermission(session, perm);
  if (hardDenied) return hardDenied;

  if (options.enableModeAutoApprove !== false && shouldModeAutoApprove(session.state.permissionMode, toolName)) {
    return { kind: "mode_auto_approved", request: perm };
  }

  session.pendingPermissions.set(perm.request_id, perm);
  deps.onSessionActivityStateChanged(session.id, options.activityReason);
  deps.broadcastPermissionRequest(session, perm);
  deps.emitTakodePermissionRequest(session, perm);
  deps.setAttentionAction(session);
  deps.persistSession(session);
  deps.schedulePermissionNotification?.(session, perm);
  return { kind: "pending_human", request: perm };
}
