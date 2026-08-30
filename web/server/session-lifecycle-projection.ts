import type { SessionCompactionLifecycleEvent, SessionLifecycleEvent } from "./session-types.js";

/**
 * Keep launch-only context envelopes out of compact session projections while
 * preserving the event itself. Selected diagnostic detail may opt into the
 * event-time snapshot so later relaunches cannot rewrite historical evidence.
 *
 * Older builds could persist a configured limit as if it were observed
 * active context and could label an unmarked Codex item as context pressure.
 * Normalize those rows at read time so API consumers do not inherit either
 * unsupported claim.
 */
export function projectSessionLifecycleEvents(
  events: SessionLifecycleEvent[] | undefined,
  options: { includeContextWindowDiagnostics?: boolean } = {},
): SessionLifecycleEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];

  return events.map((rawEvent) => {
    const event = normalizeCodexCompactionEvent(rawEvent);
    if (options.includeContextWindowDiagnostics || !event.contextWindowDiagnostics) return event;
    const { contextWindowDiagnostics: _contextWindowDiagnostics, ...withoutDiagnostics } = event;
    return withoutDiagnostics;
  });
}

function normalizeCodexCompactionEvent(event: SessionLifecycleEvent): SessionLifecycleEvent {
  if (event.type !== "compaction" || event.backendType !== "codex") return event;

  let cause = event.cause;
  let causeSource = event.causeSource;
  if (cause === "context_pressure" && causeSource !== "producer") {
    cause = "unknown";
    causeSource = undefined;
  }

  const before = normalizeLegacyConfiguredLimitSnapshot(event.before);
  if (cause === event.cause && causeSource === event.causeSource && before === event.before) return event;

  const { causeSource: _causeSource, before: _before, ...base } = event;
  return {
    ...base,
    ...(cause ? { cause } : {}),
    ...(causeSource ? { causeSource } : {}),
    ...(before ? { before } : {}),
  };
}

function normalizeLegacyConfiguredLimitSnapshot(
  snapshot: SessionCompactionLifecycleEvent["before"],
): SessionCompactionLifecycleEvent["before"] {
  if (snapshot?.source !== "codex_auto_compact_limit") return snapshot;

  const observed = snapshot.providerReportedTotalTokens ?? snapshot.providerReportedInputTokens;
  if (typeof observed !== "number" || !Number.isFinite(observed) || observed < 0) return undefined;

  const modelContextWindow = snapshot.modelContextWindow;
  const contextUsedPercent =
    typeof modelContextWindow === "number" && Number.isFinite(modelContextWindow) && modelContextWindow > 0
      ? Math.max(0, Math.min(100, Math.round((observed / modelContextWindow) * 100)))
      : undefined;
  return {
    ...snapshot,
    contextTokensUsed: observed,
    ...(contextUsedPercent !== undefined ? { contextUsedPercent } : {}),
    source: "codex_token_details",
  };
}
