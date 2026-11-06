import { apiGet, assertKnownFlags, err, parseFlags } from "./takode-core.js";
import type { SavedInputTraceEvent } from "../shared/input-trace.js";

export const INPUT_TRACE_HELP = `Usage: takode input-trace [<trace-prefix>] [--since time] [--until time] [--limit N] [--json]

Lists automatically saved input recordings without their events. Pass a trace prefix to
read its last 100 events (or --limit N), optionally within --since/--until timestamps.
Enabled recordings are saved incrementally and expose a rolling one-hour window.
Manual reports remain in takode logs --component input-trace.
`;

interface TraceSummary {
  trace: string;
  platform: string;
  eventCount: number;
  firstEventAt: number;
  lastEventAt: number;
}

/** Compact discovery first; event data is returned only for the selected recording. */
export async function handleInputTrace(base: string, args: string[]): Promise<void> {
  const prefix = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const flags = parseFlags(prefix ? args.slice(1) : args);
  assertKnownFlags(flags, new Set(["since", "until", "limit", "json"]), INPUT_TRACE_HELP);
  const query = new URLSearchParams();
  if (prefix) query.set("trace", prefix);
  for (const key of ["since", "until", "limit"] as const) {
    if (flags[key] !== undefined) {
      if (!prefix) err(`${key} requires a trace prefix.\n${INPUT_TRACE_HELP}`);
      if (typeof flags[key] !== "string") err(`--${key} requires a value`);
      query.set(key, String(flags[key]));
    }
  }
  if (query.has("limit") && (!Number.isInteger(Number(query.get("limit"))) || Number(query.get("limit")) < 1)) {
    err("--limit must be a positive integer");
  }
  const result = (await apiGet(base, `/diagnostics/input-trace?${query}`)) as
    | { traces: TraceSummary[] }
    | { trace: string; matchingEvents: number; events: SavedInputTraceEvent[] };
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  if ("traces" in result) {
    if (!result.traces.length) console.log("No automatically saved input events in the last hour.");
    for (const trace of result.traces) {
      console.log(
        `${trace.trace}  ${trace.platform}  ${trace.eventCount} events  ${new Date(trace.firstEventAt).toISOString()} to ${new Date(trace.lastEventAt).toISOString()}`,
      );
    }
    if (result.traces.length) console.log("Read events: takode input-trace <trace-prefix> [--since time] [--limit N]");
    return;
  }
  console.log(`${result.trace}: showing ${result.events.length} of ${result.matchingEvents} matching events`);
  for (const { t, seq: _seq, ...event } of result.events)
    console.log(`${new Date(t).toISOString()} ${JSON.stringify(event)}`);
}
