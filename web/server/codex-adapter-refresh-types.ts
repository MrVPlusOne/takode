export type CodexSkillRefreshCause = "initialize" | "skills_changed" | "api" | "manual";

export interface CodexSkillRefreshStats {
  coalesced: number;
  deferred: number;
  executed: number;
  failed: number;
  suppressed: number;
}

export interface CodexSkillRefreshDiagnostics {
  refreshId: string;
  cause: CodexSkillRefreshCause;
  forceReload: boolean;
  cwds: string[];
  rpcId: number;
  startedAt: number;
  completedAt: number | null;
  status: "in_flight" | "succeeded" | "failed";
  error: string | null;
  inFlightAtStart: number;
}
