import { randomUUID } from "node:crypto";
import type { BrowserIncomingMessage } from "../session-types.js";
import { inferContextWindowFromModel } from "./context-usage.js";
import type {
  AdapterBrowserRoutingDeps,
  AdapterBrowserRoutingSessionLike,
} from "./adapter-browser-routing-controller.js";
import { clearActionAttentionIfNoPermissions as clearActionAttentionIfNoPermissionsSessionRegistryController } from "./session-registry-controller.js";

export function handleSetModel(
  session: AdapterBrowserRoutingSessionLike,
  model: string,
  deps: Pick<
    AdapterBrowserRoutingDeps,
    "sendToCLI" | "getLauncherSessionInfo" | "broadcastToBrowsers" | "persistSession"
  >,
): void {
  if (session.backendType === "claude-sdk" && session.claudeSdkAdapter) {
    session.claudeSdkAdapter.sendBrowserMessage({ type: "set_model", model } as any);
  } else {
    deps.sendToCLI(
      session,
      JSON.stringify({
        type: "control_request",
        request_id: randomUUID(),
        request: { subtype: "set_model", model },
      }),
    );
  }
  session.state.model = model;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) launchInfo.model = model;
  const inferredWindow = inferContextWindowFromModel(model);
  if (inferredWindow) {
    if (session.state.claude_token_details) {
      session.state.claude_token_details.modelContextWindow = inferredWindow;
    } else {
      session.state.claude_token_details = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        modelContextWindow: inferredWindow,
      };
    }
  }
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { model, claude_token_details: session.state.claude_token_details },
  });
  deps.persistSession(session);
}

export function handleSetPermissionMode(
  session: AdapterBrowserRoutingSessionLike,
  mode: string,
  deps: AdapterBrowserRoutingDeps,
): void {
  if (session.backendType === "claude-sdk" && session.claudeSdkAdapter) {
    session.claudeSdkAdapter.sendBrowserMessage({ type: "set_permission_mode", mode });
  } else {
    deps.sendToCLI(
      session,
      JSON.stringify({
        type: "control_request",
        request_id: randomUUID(),
        request: { subtype: "set_permission_mode", mode },
      }),
    );
  }
  const uiMode = mode === "plan" ? "plan" : "agent";
  session.state.permissionMode = mode;
  session.state.uiMode = uiMode;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) launchInfo.permissionMode = mode;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { permissionMode: mode, uiMode },
  });
  deps.persistSession(session);
}

export function handleCodexSetPermissionMode(
  session: AdapterBrowserRoutingSessionLike,
  mode: string,
  deps: AdapterBrowserRoutingDeps,
): void {
  const nextProfile = normalizeCodexPermissionProfile(mode, session.state.permissionMode);
  if (!nextProfile) return;
  const currentUiMode = session.state.uiMode === "plan" ? "plan" : "agent";
  const nextUiMode = resolveCodexUiModeForPermissionMessage(mode, currentUiMode);
  if (session.state.permissionMode === nextProfile && session.state.uiMode === nextUiMode) return;
  const isFullAccessMode = nextProfile === "codex-full-access";
  if (session.pendingPermissions.size > 0) {
    const approve = isFullAccessMode;
    for (const [reqId, perm] of session.pendingPermissions) {
      if (session.codexAdapter) {
        session.codexAdapter.sendBrowserMessage({
          type: "permission_response",
          request_id: reqId,
          behavior: approve ? "allow" : "deny",
        });
      }
      if (approve) {
        const approvedMsg: BrowserIncomingMessage = {
          type: "permission_approved",
          id: `approval-${reqId}`,
          request_id: reqId,
          tool_name: perm.tool_name,
          tool_use_id: perm.tool_use_id,
          summary: `${perm.tool_name}`,
          timestamp: Date.now(),
        };
        session.messageHistory.push(approvedMsg);
        deps.broadcastToBrowsers(session, approvedMsg);
      } else {
        deps.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
      }
      deps.abortAutoApproval(session, reqId);
      deps.sessionNotificationDeps.cancelPermissionNotification?.(session.id, reqId);
      deps.emitTakodeEvent(session.id, "permission_resolved", {
        tool_name: perm.tool_name,
        outcome: approve ? "approved" : "denied",
      });
    }
    session.pendingPermissions.clear();
    clearActionAttentionIfNoPermissionsSessionRegistryController(session, deps.sessionNotificationDeps);
  }
  const codexUiMode = nextUiMode;
  const codexAskPermission = !isFullAccessMode;
  session.state.permissionMode = nextProfile;
  session.state.uiMode = codexUiMode;
  session.state.askPermission = codexAskPermission;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) {
    launchInfo.permissionMode = nextProfile;
    launchInfo.askPermission = codexAskPermission;
    launchInfo.uiMode = codexUiMode;
    setLauncherCodexSandbox(launchInfo, nextProfile);
  }
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { permissionMode: nextProfile, uiMode: codexUiMode, askPermission: codexAskPermission },
  });
  deps.persistSession(session);
  deps.requestCodexIntentionalRelaunch(session, "set_permission_mode", 100);
}

function normalizeCodexPermissionProfile(mode: string, currentMode?: string): string | null {
  switch (mode) {
    case "codex-default":
    case "codex-auto-review":
    case "codex-full-access":
    case "codex-custom":
      return mode;
    case "bypassPermissions":
      return "codex-full-access";
    case "suggest":
    case "acceptEdits":
    case "default":
      return "codex-default";
    case "plan":
      if (isCodexProfilePermissionMode(currentMode)) return currentMode;
      return "codex-default";
    default:
      return null;
  }
}

function isCodexProfilePermissionMode(
  mode?: string,
): mode is "codex-default" | "codex-auto-review" | "codex-full-access" | "codex-custom" {
  return (
    mode === "codex-default" || mode === "codex-auto-review" || mode === "codex-full-access" || mode === "codex-custom"
  );
}

function resolveCodexUiModeForPermissionMessage(mode: string, currentUiMode: "plan" | "agent"): "plan" | "agent" {
  switch (mode) {
    case "plan":
      return "plan";
    case "suggest":
    case "acceptEdits":
    case "default":
    case "bypassPermissions":
      return "agent";
    default:
      return currentUiMode;
  }
}

function resolveCodexSandboxForPermissionProfile(
  mode: string,
): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  switch (mode) {
    case "codex-custom":
      return undefined;
    case "codex-full-access":
      return "danger-full-access";
    case "codex-default":
    case "codex-auto-review":
    default:
      return "workspace-write";
  }
}

function setLauncherCodexSandbox(
  launchInfo: { codexSandbox?: "read-only" | "workspace-write" | "danger-full-access" },
  mode: string,
): void {
  const sandbox = resolveCodexSandboxForPermissionProfile(mode);
  if (sandbox) {
    launchInfo.codexSandbox = sandbox;
  } else {
    delete launchInfo.codexSandbox;
  }
}

export function handleCodexSetUiMode(
  session: AdapterBrowserRoutingSessionLike,
  uiMode: "plan" | "agent",
  deps: AdapterBrowserRoutingDeps,
): void {
  const nextProfile = normalizeCodexPermissionProfile(session.state.permissionMode ?? "codex-default", undefined);
  if (!nextProfile) return;
  const codexAskPermission = nextProfile !== "codex-full-access";
  if (
    session.state.permissionMode === nextProfile &&
    session.state.uiMode === uiMode &&
    session.state.askPermission === codexAskPermission
  ) {
    return;
  }

  session.state.permissionMode = nextProfile;
  session.state.uiMode = uiMode;
  session.state.askPermission = codexAskPermission;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) {
    launchInfo.permissionMode = nextProfile;
    launchInfo.askPermission = codexAskPermission;
    launchInfo.uiMode = uiMode;
    setLauncherCodexSandbox(launchInfo, nextProfile);
  }
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { permissionMode: nextProfile, uiMode, askPermission: codexAskPermission },
  });
  deps.persistSession(session);
  deps.requestCodexIntentionalRelaunch(session, "set_codex_ui_mode", 100);
}

export function handleCodexSetModel(
  session: AdapterBrowserRoutingSessionLike,
  model: string,
  deps: Pick<
    AdapterBrowserRoutingDeps,
    "getLauncherSessionInfo" | "broadcastToBrowsers" | "persistSession" | "requestCodexIntentionalRelaunch"
  >,
): void {
  const nextModel = model.trim();
  if (!nextModel || session.state.model === nextModel) return;
  session.state.model = nextModel;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) launchInfo.model = nextModel;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { model: nextModel },
  });
  deps.persistSession(session);
  deps.requestCodexIntentionalRelaunch(session, "set_model");
}

export function handleCodexSetReasoningEffort(
  session: AdapterBrowserRoutingSessionLike,
  effort: string,
  deps: Pick<
    AdapterBrowserRoutingDeps,
    "getLauncherSessionInfo" | "broadcastToBrowsers" | "persistSession" | "requestCodexIntentionalRelaunch"
  >,
): void {
  const normalized = effort.trim();
  const next = normalized || undefined;
  if (session.state.codex_reasoning_effort === next) return;
  session.state.codex_reasoning_effort = next;
  const launchInfo = deps.getLauncherSessionInfo(session.id);
  if (launchInfo) launchInfo.codexReasoningEffort = next;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { codex_reasoning_effort: next },
  });
  deps.persistSession(session);
  deps.requestCodexIntentionalRelaunch(session, "set_codex_reasoning_effort");
}

export function handleSetAskPermission(
  session: AdapterBrowserRoutingSessionLike,
  askPermission: boolean,
  deps: AdapterBrowserRoutingDeps,
): void {
  if (session.backendType === "codex") {
    const uiMode = session.state.uiMode === "plan" ? "plan" : "agent";
    const newMode = uiMode === "plan" ? "plan" : askPermission ? "suggest" : "bypassPermissions";
    if (session.state.askPermission === askPermission && session.state.permissionMode === newMode) return;
    session.state.askPermission = askPermission;
    session.state.permissionMode = newMode;
    session.state.uiMode = uiMode;
    const launchInfo = deps.getLauncherSessionInfo(session.id);
    if (launchInfo) {
      launchInfo.permissionMode = newMode;
      launchInfo.askPermission = askPermission;
    }
    deps.broadcastToBrowsers(session, {
      type: "session_update",
      session: { askPermission, permissionMode: newMode, uiMode },
    });
    deps.persistSession(session);
    deps.requestCodexIntentionalRelaunch(session, "set_ask_permission");
    return;
  }
  session.state.askPermission = askPermission;
  const uiMode = session.state.uiMode ?? "agent";
  const newMode = uiMode === "plan" ? "plan" : askPermission ? "acceptEdits" : "bypassPermissions";
  session.state.permissionMode = newMode;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { askPermission, permissionMode: newMode, uiMode },
  });
  deps.persistSession(session);
  if (session.backendType === "claude-sdk" && session.claudeSdkAdapter) {
    session.claudeSdkAdapter.sendBrowserMessage({ type: "set_permission_mode", mode: newMode });
    const launchInfo = deps.getLauncherSessionInfo(session.id);
    if (launchInfo) launchInfo.permissionMode = newMode;
  } else {
    deps.onPermissionModeChanged?.(session.id, newMode);
  }
}
