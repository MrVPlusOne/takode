export type BrowserConnectionStatus = "connecting" | "connected" | "disconnected";

export type RecoverableSessionConnectionKind = "disconnected" | "reconnecting";

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
