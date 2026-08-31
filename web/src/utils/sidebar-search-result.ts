import type { SessionSearchResult } from "../api.js";
import type { SidebarSessionItem } from "./sidebar-session-item.js";

export function buildSidebarItemFromSearchResult(result: SessionSearchResult): SidebarSessionItem | null {
  const session = result.session;
  if (!session) return null;
  return {
    id: session.sessionId,
    model: session.model ?? "",
    cwd: session.cwd ?? "",
    gitBranch: session.gitBranch ?? "",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: false,
    status: null,
    sdkState: session.state ?? "exited",
    createdAt: session.createdAt,
    archived: session.archived ?? false,
    archivedAt: session.archivedAt,
    backendType: session.backendType ?? "claude",
    repoRoot: session.repoRoot ?? "",
    permCount: 0,
    lastActivityAt: session.lastActivityAt,
    lastUserMessageAt: session.lastUserMessageAt,
    isOrchestrator: session.isOrchestrator ?? false,
    sessionNum: session.sessionNum ?? null,
    reviewerOf: session.reviewerOf,
  };
}
