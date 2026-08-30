import type {
  BackendType,
  CodexCompactionCause,
  CodexCompactionCauseSource,
  CodexContextWindowDiagnostics,
  SessionContextLengthSnapshot,
  SessionLifecycleEvent,
  SessionState,
} from "../session-types.js";

const MAX_LIFECYCLE_EVENTS = 50;

export interface LifecycleEventSessionLike {
  backendType?: BackendType;
  state: Pick<
    SessionState,
    "codex_token_details" | "codex_context_window_diagnostics" | "context_used_percent" | "lifecycle_events"
  >;
}

export function recordCompactionStarted(
  session: LifecycleEventSessionLike,
  options: {
    id: string;
    timestamp: number;
    trigger?: "auto" | "manual";
    cause?: CodexCompactionCause;
    causeSource?: CodexCompactionCauseSource;
    before?: SessionContextLengthSnapshot;
  },
): void {
  upsertCompactionEvent(session, options.id, {
    timestamp: options.timestamp,
    backendType: session.backendType,
    trigger: options.trigger,
    cause: options.cause,
    causeSource: options.causeSource,
    contextWindowDiagnostics: cloneContextWindowDiagnostics(session.state.codex_context_window_diagnostics),
    before: options.before ?? snapshotCodexContextLength(session.state, options.timestamp),
  });
}

export function recordCompactionBoundary(
  session: LifecycleEventSessionLike,
  options: { id: string; timestamp: number; trigger?: "auto" | "manual"; preTokens?: number },
): void {
  upsertCompactionEvent(session, options.id, {
    timestamp: options.timestamp,
    backendType: session.backendType,
    trigger: options.trigger,
    before:
      typeof options.preTokens === "number"
        ? {
            contextTokensUsed: options.preTokens,
            source: "compact_boundary",
            capturedAt: options.timestamp,
          }
        : undefined,
  });
}

export function recordCompactionFinished(session: LifecycleEventSessionLike, finishedAt = Date.now()): void {
  const event = findLatestUnfinishedCompactionEvent(session.state.lifecycle_events);
  if (!event) return;
  event.finishedAt = finishedAt;

  const snapshot = snapshotCodexContextLength(session.state, finishedAt);
  if (!snapshot) return;

  const beforeProviderTotal = event.before?.providerReportedTotalTokens;
  const afterProviderTotal = snapshot.providerReportedTotalTokens;
  const beforeTokens = event.before?.contextTokensUsed;
  const afterTokens = snapshot.contextTokensUsed;
  const isReduced =
    typeof beforeProviderTotal === "number" && typeof afterProviderTotal === "number"
      ? afterProviderTotal < beforeProviderTotal
      : typeof beforeTokens === "number" && typeof afterTokens === "number" && afterTokens < beforeTokens;
  if (isReduced) {
    event.after = snapshot;
  }
}

export function snapshotCodexContextLength(
  state: Pick<SessionState, "codex_token_details" | "codex_context_window_diagnostics" | "context_used_percent">,
  capturedAt = Date.now(),
): SessionContextLengthSnapshot | undefined {
  const details = state.codex_token_details;
  const providerReportedInputTokens = finiteNumber(details?.contextTokensUsed);
  const providerReportedTotalTokens = finiteNumber(details?.providerReportedTotalTokens);
  if (providerReportedInputTokens === undefined && providerReportedTotalTokens === undefined) return undefined;

  const diagnostics = state.codex_context_window_diagnostics;
  const modelContextWindow = resolveCompactionContextWindow(details?.modelContextWindow, diagnostics);
  const autoCompactTokenLimit = positiveFiniteNumber(diagnostics?.autoCompactTokenLimit);
  const contextTokensUsed = providerReportedTotalTokens ?? providerReportedInputTokens!;

  const recomputedPercent =
    modelContextWindow !== undefined
      ? clampPercent(Math.round((contextTokensUsed / modelContextWindow) * 100))
      : undefined;
  const contextUsedPercent =
    recomputedPercent ??
    (typeof state.context_used_percent === "number" && Number.isFinite(state.context_used_percent)
      ? state.context_used_percent
      : undefined);

  return {
    contextTokensUsed,
    ...(providerReportedInputTokens !== undefined ? { providerReportedInputTokens } : {}),
    ...(providerReportedTotalTokens !== undefined ? { providerReportedTotalTokens } : {}),
    ...(contextUsedPercent !== undefined ? { contextUsedPercent } : {}),
    ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
    ...(autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit } : {}),
    ...(diagnostics?.autoCompactTokenLimitScope
      ? { autoCompactTokenLimitScope: diagnostics.autoCompactTokenLimitScope }
      : {}),
    source: "codex_token_details",
    capturedAt,
  };
}

function upsertCompactionEvent(
  session: LifecycleEventSessionLike,
  id: string,
  patch: Partial<Extract<SessionLifecycleEvent, { type: "compaction" }>> & { timestamp: number },
): void {
  const events = getLifecycleEvents(session);
  const existing = events.find((event) => event.type === "compaction" && event.id === id);
  if (existing) {
    if (patch.backendType) existing.backendType = patch.backendType;
    if (patch.trigger) existing.trigger = patch.trigger;
    if (patch.cause) existing.cause = patch.cause;
    if (patch.causeSource) existing.causeSource = patch.causeSource;
    if (patch.contextWindowDiagnostics) existing.contextWindowDiagnostics = patch.contextWindowDiagnostics;
    if (patch.before) existing.before = patch.before;
    if (patch.after) existing.after = patch.after;
    if (typeof patch.finishedAt === "number") existing.finishedAt = patch.finishedAt;
    return;
  }

  events.push({
    type: "compaction",
    id,
    timestamp: patch.timestamp,
    ...(patch.backendType ? { backendType: patch.backendType } : {}),
    ...(patch.trigger ? { trigger: patch.trigger } : {}),
    ...(patch.cause ? { cause: patch.cause } : {}),
    ...(patch.causeSource ? { causeSource: patch.causeSource } : {}),
    ...(patch.contextWindowDiagnostics ? { contextWindowDiagnostics: patch.contextWindowDiagnostics } : {}),
    ...(patch.before ? { before: patch.before } : {}),
    ...(patch.after ? { after: patch.after } : {}),
    ...(typeof patch.finishedAt === "number" ? { finishedAt: patch.finishedAt } : {}),
  });
  trimLifecycleEvents(session);
}

function getLifecycleEvents(session: LifecycleEventSessionLike): SessionLifecycleEvent[] {
  if (!Array.isArray(session.state.lifecycle_events)) {
    session.state.lifecycle_events = [];
  }
  return session.state.lifecycle_events;
}

function trimLifecycleEvents(session: LifecycleEventSessionLike): void {
  const events = getLifecycleEvents(session);
  if (events.length <= MAX_LIFECYCLE_EVENTS) return;
  session.state.lifecycle_events = events.slice(-MAX_LIFECYCLE_EVENTS);
}

function findLatestUnfinishedCompactionEvent(
  events: SessionLifecycleEvent[] | undefined,
): Extract<SessionLifecycleEvent, { type: "compaction" }> | undefined {
  if (!events) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "compaction" && typeof event.finishedAt !== "number") {
      return event;
    }
  }
  return undefined;
}

function cloneContextWindowDiagnostics(
  diagnostics: CodexContextWindowDiagnostics | undefined,
): CodexContextWindowDiagnostics | undefined {
  return diagnostics ? { ...diagnostics } : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveCompactionContextWindow(
  runtimeWindow: unknown,
  diagnostics: CodexContextWindowDiagnostics | undefined,
): number | undefined {
  if (diagnostics?.role === "leader" && diagnostics.leaderMode === "recycle") {
    return (
      positiveFiniteNumber(diagnostics.providerEffectiveContextWindow) ??
      positiveFiniteNumber(runtimeWindow) ??
      positiveFiniteNumber(diagnostics.displayContextWindow)
    );
  }
  return (
    positiveFiniteNumber(runtimeWindow) ??
    positiveFiniteNumber(diagnostics?.providerEffectiveContextWindow) ??
    positiveFiniteNumber(diagnostics?.displayContextWindow)
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
