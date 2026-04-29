import type {
  BackendType,
  SessionContextLengthSnapshot,
  SessionLifecycleEvent,
  SessionState,
} from "../session-types.js";

const MAX_LIFECYCLE_EVENTS = 50;

export interface LifecycleEventSessionLike {
  backendType?: BackendType;
  state: Pick<SessionState, "codex_token_details" | "context_used_percent" | "lifecycle_events">;
}

export function recordCompactionStarted(
  session: LifecycleEventSessionLike,
  options: { id: string; timestamp: number; trigger?: "auto" | "manual"; before?: SessionContextLengthSnapshot },
): void {
  upsertCompactionEvent(session, options.id, {
    timestamp: options.timestamp,
    backendType: session.backendType,
    trigger: options.trigger,
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
  const beforeTokens = event.before?.contextTokensUsed;
  if (
    typeof snapshot?.contextTokensUsed === "number" &&
    typeof beforeTokens === "number" &&
    snapshot.contextTokensUsed < beforeTokens
  ) {
    event.after = snapshot;
  }
}

export function snapshotCodexContextLength(
  state: Pick<SessionState, "codex_token_details" | "context_used_percent">,
  capturedAt = Date.now(),
): SessionContextLengthSnapshot | undefined {
  const details = state.codex_token_details;
  if (typeof details?.contextTokensUsed !== "number") return undefined;
  return {
    contextTokensUsed: details.contextTokensUsed,
    ...(typeof state.context_used_percent === "number" ? { contextUsedPercent: state.context_used_percent } : {}),
    ...(typeof details.modelContextWindow === "number" ? { modelContextWindow: details.modelContextWindow } : {}),
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
