import type {
  BoardRowSessionStatus,
  LeaderProjectionSnapshot,
  SdkSessionInfo,
  SessionAttentionRecord,
  SessionNotification,
  ThreadWindowState,
} from "../types.js";

interface ChatViewMockSessionState {
  backend_state?:
    | "initializing"
    | "resuming"
    | "recovering"
    | "connected"
    | "disconnected"
    | "broken"
    | "recovery_suppressed";
  backend_error?: string | null;
  isOrchestrator?: boolean;
  claimedQuestId?: string | null;
  claimedQuestTitle?: string | null;
  claimedQuestStatus?: string | null;
  claimedQuestLeaderSessionId?: string | null;
}

export interface ChatViewMockStoreState {
  pendingPermissions: Map<string, Map<string, { tool_name?: string; request_id?: string }>>;
  connectionStatus: Map<string, "connecting" | "connected" | "disconnected">;
  sessions: Map<string, ChatViewMockSessionState>;
  cliConnected: Map<string, boolean>;
  cliEverConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | "recovery_suppressed" | null>;
  serverReachable: boolean;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  sdkSessions: Array<Partial<SdkSessionInfo> & Pick<SdkSessionInfo, "sessionId">>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionNotifications: Map<string, SessionNotification[]>;
  sessionAttentionRecords: Map<string, SessionAttentionRecord[]>;
  sessionBoards: Map<string, unknown[]>;
  sessionCompletedBoards: Map<string, unknown[]>;
  sessionBoardRowStatuses: Map<string, Record<string, BoardRowSessionStatus>>;
  leaderProjections: Map<string, LeaderProjectionSnapshot>;
  syncedProjectionValues: Map<string, unknown>;
  syncedProjectionKeys: Set<string>;
  sessionTaskHistory: Map<string, Array<{ title: string; triggerMessageId: string }>>;
  messages: Map<string, unknown[]>;
  historyLoading: Map<string, boolean>;
  threadWindows: Map<string, Map<string, ThreadWindowState>>;
  quests: Array<Record<string, unknown> & { questId: string; title: string; status: string }>;
  zoomLevel: number;
  openQuestOverlay: (questId: string) => void;
}
