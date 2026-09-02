export interface ServerInterruptResultItem {
  sessionId: string;
  label: string;
  reasons: string[];
  detail?: string;
  diagnostics?: Record<string, string | number | boolean | null>;
}

export interface RestartPrepAttemptResult {
  attempt: number;
  interrupted: ServerInterruptResultItem[];
  skipped: ServerInterruptResultItem[];
  failures: ServerInterruptResultItem[];
  remainingBlockers: ServerInterruptResultItem[];
  timedOut: boolean;
}

export interface InterruptRestartBlockersResponse {
  ok: boolean;
  operationId: string | null;
  mode: "standalone" | "restart";
  restartRequested: boolean;
  timedOut: boolean;
  retryAttempts: RestartPrepAttemptResult[];
  interrupted: ServerInterruptResultItem[];
  skipped: ServerInterruptResultItem[];
  failures: ServerInterruptResultItem[];
  fallbacks: ServerInterruptResultItem[];
  protectedLeaders: Array<{ sessionId: string; label: string }>;
  unresolvedBlockers: ServerInterruptResultItem[];
  herdDelivery: {
    suppressed: number;
    held: number;
    trackingActive: boolean;
    countsFinal: boolean;
    detail?: string;
  };
}

export interface RestartServerResponse {
  ok: boolean;
  restartRequested: boolean;
  /** Exact prepared production build accepted for this restart request. */
  replacementBuildId: string | null;
}

export function isInterruptRestartBlockersResponse(value: unknown): value is InterruptRestartBlockersResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InterruptRestartBlockersResponse>;
  const herdDelivery =
    candidate.herdDelivery && typeof candidate.herdDelivery === "object"
      ? (candidate.herdDelivery as Partial<InterruptRestartBlockersResponse["herdDelivery"]>)
      : null;
  return (
    typeof candidate.ok === "boolean" &&
    (candidate.operationId === null || typeof candidate.operationId === "string") &&
    (candidate.mode === "standalone" || candidate.mode === "restart") &&
    typeof candidate.restartRequested === "boolean" &&
    typeof candidate.timedOut === "boolean" &&
    Array.isArray(candidate.retryAttempts) &&
    Array.isArray(candidate.interrupted) &&
    Array.isArray(candidate.skipped) &&
    Array.isArray(candidate.failures) &&
    Array.isArray(candidate.fallbacks) &&
    Array.isArray(candidate.protectedLeaders) &&
    Array.isArray(candidate.unresolvedBlockers) &&
    herdDelivery !== null &&
    typeof herdDelivery.suppressed === "number" &&
    typeof herdDelivery.held === "number" &&
    typeof herdDelivery.trackingActive === "boolean" &&
    typeof herdDelivery.countsFinal === "boolean"
  );
}
