import type { TakodeEvent } from "./takode-event-types.js";

/**
 * A stable identity for a herd event, so a leader's inbox can drop a replayed
 * or re-emitted copy of an event it already holds or delivered. Only events
 * that can be re-emitted with the same content have one; others return null.
 */
export function getStableHerdEventKey(event: TakodeEvent): string | null {
  if (event.event === "turn_end") {
    const range = event.data.msgRange;
    if (!range) return null;
    const keyParts: unknown[] = [
      "turn_end",
      event.sessionId,
      event.data.reason,
      event.data.duration_ms,
      event.data.is_error,
      event.data.interrupted,
      event.data.interrupt_source,
      event.data.interrupt_origin,
      event.data.restart_prep_operation_id,
      event.data.compacted,
      event.data.recovery_pending,
      event.data.provisional,
      event.data.threadKey,
      event.data.questId,
      stableToolCountsPart(event.data.tools),
      truncate(typeof event.data.resultPreview === "string" ? event.data.resultPreview : "", 60),
      range.from,
      range.to,
      event.data.questChange?.questId,
      event.data.questChange?.from,
      event.data.questChange?.to,
      event.data.userMsgs?.count,
      stableNumberListPart(event.data.userMsgs?.ids),
      event.data.turn_source,
    ];
    if (event.data.awaiting_decision || event.data.resumed_after_decision) {
      keyParts.push(event.data.awaiting_decision, event.data.resumed_after_decision);
    }
    return keyParts.map(stableKeyPart).join("|");
  }
  if (event.event === "worker_stream") {
    if (event.data.report) return `worker_stream|${event.sessionId}|report|${event.data.report.id}`;
    const range = event.data.msgRange;
    if (!range) return null;
    return [
      "worker_stream",
      event.sessionId,
      event.data.reason,
      event.data.duration_ms,
      event.data.threadKey,
      event.data.questId,
      stableToolCountsPart(event.data.tools),
      truncate(typeof event.data.resultPreview === "string" ? event.data.resultPreview : "", 60),
      range.from,
      range.to,
      event.data.questChange?.questId,
      event.data.questChange?.from,
      event.data.questChange?.to,
      event.data.userMsgs?.count,
      stableNumberListPart(event.data.userMsgs?.ids),
      event.data.turn_source,
    ]
      .map(stableKeyPart)
      .join("|");
  }
  if (event.event === "board_stalled") {
    return [
      "board_stalled",
      event.sessionId,
      event.data.questId,
      event.data.stage,
      event.data.signature,
      event.data.workerStatus,
      event.data.reviewerStatus,
      event.data.reason,
      event.data.action,
    ]
      .map(stableKeyPart)
      .join("|");
  }
  if (event.event === "board_dispatchable") {
    return [
      "board_dispatchable",
      event.sessionId,
      event.data.questId,
      event.data.signature,
      event.data.rowUpdatedAt,
      event.data.summary,
      event.data.action,
    ]
      .map(stableKeyPart)
      .join("|");
  }
  // A leader on the offline host itself gets these held by the bridge while
  // the dispatcher keeps them pending, so the key is what tells it the held
  // copy is already in the leader's history.
  if (event.event === "host_offline") {
    return ["host_offline", event.sessionId, event.data.hostId, event.data.offlineSince].map(stableKeyPart).join("|");
  }
  if (event.event === "host_online") {
    return ["host_online", event.sessionId, event.data.hostId, event.data.offlineForMs].map(stableKeyPart).join("|");
  }
  return null;
}

function stableToolCountsPart(tools: Record<string, number> | undefined): string {
  if (!tools) return "";
  return Object.entries(tools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tool, count]) => `${tool}:${count}`)
    .join(",");
}

function stableNumberListPart(values: number[] | undefined): string {
  return values?.join(",") ?? "";
}

function stableKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
