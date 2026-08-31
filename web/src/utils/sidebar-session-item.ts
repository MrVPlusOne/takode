import type { SdkSessionInfo } from "../types.js";

export type SidebarSessionItem = Partial<SdkSessionInfo> & {
  id: string;
  claimedQuestStatus?: string;
  model: string;
  cwd: string;
  gitBranch: string;
  isContainerized: boolean;
  gitAhead: number;
  gitBehind: number;
  linesAdded: number;
  linesRemoved: number;
  isConnected: boolean;
  status: "idle" | "running" | "compacting" | "reverting" | null;
  sdkState: SdkSessionInfo["state"] | null;
  createdAt: number;
  archived: boolean;
  backendType: NonNullable<SdkSessionInfo["backendType"]>;
  repoRoot: string;
  permCount: number;
  idleKilled?: boolean;
};

/** Normalize the canonical session-list row for sidebar-only consumers. */
export function toSidebarSessionItem(session: SdkSessionInfo): SidebarSessionItem {
  const status =
    session.status !== undefined
      ? session.status
      : session.state === "running"
        ? "running"
        : session.state === "connected"
          ? "idle"
          : null;

  return {
    ...session,
    id: session.sessionId,
    claimedQuestStatus: session.claimedQuestStatus ?? undefined,
    model: session.model ?? "",
    gitBranch: session.gitBranch ?? "",
    isContainerized: session.isContainerized ?? !!session.containerId,
    gitAhead: session.gitAhead ?? 0,
    gitBehind: session.gitBehind ?? 0,
    linesAdded: session.totalLinesAdded ?? 0,
    linesRemoved: session.totalLinesRemoved ?? 0,
    diffStatsSkippedReason: session.diffStatsSkippedReason ?? null,
    gitStatusRefreshError: session.gitStatusRefreshError ?? null,
    isConnected: session.cliConnected ?? false,
    status,
    sdkState: session.state,
    archived: session.archived ?? false,
    backendType: session.backendType ?? "claude",
    treeGroupId: session.treeGroupId ?? null,
    memorySessionSpaceSlug: session.memorySessionSpaceSlug ?? null,
    repoRoot: session.repoRoot ?? "",
    permCount: session.pendingPermissionCount ?? 0,
    pendingTimerCount: session.pendingTimerCount ?? 0,
    notificationUrgency: session.notificationUrgency ?? null,
    activeNotificationCount: session.activeNotificationCount ?? 0,
    activeNeedsInputNotificationCount: session.activeNeedsInputNotificationCount ?? 0,
    activeReviewNotificationCount: session.activeReviewNotificationCount ?? 0,
    mutedNeedsInputNotificationCount: session.mutedNeedsInputNotificationCount ?? 0,
    pause: session.pause ?? null,
    paused: session.paused ?? !!session.pause?.pausedAt,
    pausedInputQueueCount: session.pausedInputQueueCount ?? session.pause?.queuedMessages.length ?? 0,
    isWorktree: session.isWorktree ?? false,
    idleKilled: session.killedByIdleManager === true,
    isOrchestrator: session.isOrchestrator ?? false,
    leaderProfilePortraitId: session.leaderProfilePortraitId ?? null,
    sessionNum: session.sessionNum ?? null,
  };
}
