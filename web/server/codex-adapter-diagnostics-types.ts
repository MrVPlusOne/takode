import type { JsonRpcPendingRequestSummary, JsonRpcTransportCloseDiagnostics } from "./codex-jsonrpc-transport.js";
import type { RecorderManager } from "./recorder.js";
import type { CodexSkillRefreshDiagnostics, CodexSkillRefreshStats } from "./codex-adapter-refresh-types.js";

export interface CodexSkillChangeDiagnostics {
  changeId: string;
  receivedAt: number;
  sessionId: string;
  cwd: string | null;
  currentTurnId: string | null;
  connected: boolean;
  initialized: boolean;
  payloadKeys: string[];
  payloadHasCauseMetadata: boolean;
  staleSince: number;
  action: "marked_stale_without_auto_refresh";
}

export interface CodexAdapterDisconnectDiagnostics {
  closeId: string;
  reason: "transport_close" | "process_exit";
  sessionId: string;
  capturedAt: number;
  process: {
    pid: number;
    pidAlive: boolean;
    exitCode: number | null;
    eofToExitMs: number | null;
  };
  adapter: {
    threadId: string | null;
    currentTurnId: string | null;
    model: string | null;
    cwd: string | null;
    approvalMode: string | null;
    sandbox: string | null;
    connected: boolean;
    initialized: boolean;
  };
  transport: JsonRpcTransportCloseDiagnostics | null;
  pendingRpcRequests: JsonRpcPendingRequestSummary[];
  skillRefresh: {
    inFlightCount: number;
    inFlight: CodexSkillRefreshDiagnostics[];
    last: CodexSkillRefreshDiagnostics | null;
    lastChange: CodexSkillChangeDiagnostics | null;
    stats: CodexSkillRefreshStats;
    stale: boolean;
    staleSince: number | null;
    retryCount: number;
  };
  stderrTail: string | null;
  resource: {
    rssMb: number;
    heapUsedMb: number;
  };
  recording: ReturnType<NonNullable<RecorderManager["getActiveRecorderStats"]>> | null;
}
