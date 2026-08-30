import type { SessionLifecycleEvent } from "./session-types.js";

/**
 * Keep launch-only context envelopes out of compact session projections while
 * preserving the event itself. Selected diagnostic detail may opt into the
 * event-time snapshot so later relaunches cannot rewrite historical evidence.
 */
export function projectSessionLifecycleEvents(
  events: SessionLifecycleEvent[] | undefined,
  options: { includeContextWindowDiagnostics?: boolean } = {},
): SessionLifecycleEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (options.includeContextWindowDiagnostics) return events;

  return events.map((event) => {
    if (event.type !== "compaction" || !event.contextWindowDiagnostics) return event;
    const { contextWindowDiagnostics: _contextWindowDiagnostics, ...withoutDiagnostics } = event;
    return withoutDiagnostics;
  });
}
