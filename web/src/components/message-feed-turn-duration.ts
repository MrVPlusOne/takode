import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";

/**
 * How long an agent turn took: from the message that started it to the agent's
 * last activity in it, so far while the turn is still running.
 *
 * Earlier rules left many turns without a time: a normal turn needed a final
 * answer, and a leader thread turn ran until the next human message, so a
 * thread's latest turn never had one and older turns also counted the idle
 * time before the reply.
 */
export function getTurnSummaryDurationMs(turn: Turn): number | null {
  const boundary = turn.userEntry;
  if (!boundary || boundary.kind !== "message" || boundary.msg.role !== "user") return null;
  const end = lastAgentActivityTimestamp(turn.allEntries);
  if (end == null || end < boundary.msg.timestamp) return null;
  return end - boundary.msg.timestamp;
}

/** Latest server time of the agent's own messages, tool calls and subagent work among `entries`. */
function lastAgentActivityTimestamp(entries: FeedEntry[]): number | null {
  let latest: number | null = null;
  const consider = (timestamp: number | undefined) => {
    if (timestamp != null && (latest == null || timestamp > latest)) latest = timestamp;
  };
  for (const entry of entries) {
    if (entry.kind === "message") {
      if (entry.msg.role === "assistant") consider(entry.msg.timestamp);
    } else if (entry.kind === "tool_msg_group") {
      for (const item of entry.items) consider(item.timestamp);
    } else if (entry.kind === "subagent") {
      consider(lastAgentActivityTimestamp(entry.children) ?? undefined);
    } else {
      for (const subagent of entry.subagents) consider(lastAgentActivityTimestamp(subagent.children) ?? undefined);
    }
  }
  return latest;
}
