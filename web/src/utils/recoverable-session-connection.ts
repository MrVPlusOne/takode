import type { BackendReconnectProgress } from "../types.js";

export type BrowserConnectionStatus = "connecting" | "connected" | "disconnected";

export type RecoverableSessionConnectionKind = "disconnected" | "reconnecting";

export type LauncherSessionState = "starting" | "connected" | "running" | "exited";

export type LiveSessionConnectionStatus =
  | "starting"
  | "broken"
  | "recovery-suppressed"
  | "cli-disconnected"
  | "websocket-disconnected"
  | "server-unreachable";

export interface RecoverableSessionConnectionPresentation {
  kind: RecoverableSessionConnectionKind;
  label: string;
  detail: string;
  actionLabel: string;
}

function reconnectAttemptLabel(progress: BackendReconnectProgress | null | undefined): string {
  if (!progress) return "Reconnecting";
  return `Reconnecting (${progress.attempt} of ${progress.maxAttempts})`;
}

export function getRecoverableSessionConnectionPresentation({
  backendState,
  reconnectProgress,
  browserConnectionStatus,
  cliConnected,
  cliEverConnected,
  idlePaused = false,
  serverReachable = true,
}: {
  backendState?: string | null;
  reconnectProgress?: BackendReconnectProgress | null;
  browserConnectionStatus: BrowserConnectionStatus;
  cliConnected: boolean;
  cliEverConnected: boolean;
  idlePaused?: boolean;
  serverReachable?: boolean;
}): RecoverableSessionConnectionPresentation | null {
  if (!serverReachable || browserConnectionStatus !== "connected" || cliConnected || !cliEverConnected) return null;
  if (backendState === "broken" || backendState === "recovery_suppressed") return null;

  if (backendState === "initializing" || backendState === "resuming" || backendState === "recovering") {
    const label = reconnectAttemptLabel(reconnectProgress);
    return {
      kind: "reconnecting",
      label,
      detail: reconnectProgress
        ? `Takode is reconnecting this session, attempt ${reconnectProgress.attempt} of ${reconnectProgress.maxAttempts}. You can keep typing; messages will send when it reconnects.`
        : "Takode is reconnecting this session. You can keep typing; messages will send when it reconnects.",
      actionLabel: "Reconnect now",
    };
  }

  return {
    kind: "disconnected",
    label: idlePaused ? "Paused" : "Disconnected",
    detail: idlePaused
      ? "Takode paused this inactive session. It will reconnect when you send something."
      : "This session is offline. You can keep typing; Takode will reconnect when there is something to send.",
    actionLabel: "Reconnect now",
  };
}

export function getLiveSessionConnectionStatus({
  backendState,
  browserConnectionStatus,
  cliConnected,
  cliEverConnected,
  launcherState,
  recoverableConnectionPresentation,
  archived = false,
  serverReachable = true,
}: {
  backendState?: string | null;
  browserConnectionStatus: BrowserConnectionStatus;
  cliConnected: boolean;
  cliEverConnected: boolean;
  launcherState?: LauncherSessionState;
  recoverableConnectionPresentation: RecoverableSessionConnectionPresentation | null;
  archived?: boolean;
  serverReachable?: boolean;
}): LiveSessionConnectionStatus | null {
  if (!serverReachable) return "server-unreachable";
  if (archived) return null;

  const activelyStarting =
    backendState === "initializing" ||
    backendState === "resuming" ||
    backendState === "recovering" ||
    (!cliEverConnected && launcherState === "starting");
  if (
    browserConnectionStatus === "connected" &&
    !cliConnected &&
    backendState !== "broken" &&
    backendState !== "recovery_suppressed" &&
    !recoverableConnectionPresentation &&
    activelyStarting
  ) {
    return "starting";
  }
  if (browserConnectionStatus === "connected" && !cliConnected && backendState === "broken") return "broken";
  if (browserConnectionStatus === "connected" && !cliConnected && backendState === "recovery_suppressed") {
    return "recovery-suppressed";
  }
  if (
    browserConnectionStatus === "connected" &&
    !cliConnected &&
    cliEverConnected &&
    !recoverableConnectionPresentation &&
    backendState !== "initializing" &&
    backendState !== "resuming" &&
    backendState !== "recovering"
  ) {
    return "cli-disconnected";
  }
  if (browserConnectionStatus === "disconnected") return "websocket-disconnected";
  return null;
}
