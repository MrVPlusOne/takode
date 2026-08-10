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

export function getRecoverableSessionConnectionPresentation({
  backendState,
  browserConnectionStatus,
  cliConnected,
  cliEverConnected,
  idlePaused = false,
  serverReachable = true,
}: {
  backendState?: string | null;
  browserConnectionStatus: BrowserConnectionStatus;
  cliConnected: boolean;
  cliEverConnected: boolean;
  idlePaused?: boolean;
  serverReachable?: boolean;
}): RecoverableSessionConnectionPresentation | null {
  if (!serverReachable || browserConnectionStatus !== "connected" || cliConnected || !cliEverConnected) return null;
  if (backendState === "broken" || backendState === "recovery_suppressed") return null;

  if (backendState === "initializing" || backendState === "resuming" || backendState === "recovering") {
    return {
      kind: "reconnecting",
      label: "Reconnecting",
      detail: "Takode is reconnecting this session. You can keep working while backend delivery catches up.",
      actionLabel: "Retry now",
    };
  }

  return {
    kind: "disconnected",
    label: idlePaused ? "Paused" : "Disconnected",
    detail: idlePaused
      ? "Takode paused this backend to stay within the keep-alive limit. You can keep working; it reconnects when backend delivery is needed."
      : "You can keep working normally. Takode reconnects automatically when backend delivery is needed.",
    actionLabel: "Resume",
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
