import type { TakodeHerdEventLifecycle } from "../shared/herd-event-lifecycle.js";
import type { TakodeEvent, TakodeHerdBatchSnapshot, TakodeHerdEventBrowserMetadata } from "./session-types.js";

export function getHerdEventLifecycle(event: TakodeEvent): TakodeHerdEventLifecycle[] {
  if (event.event === "turn_end") {
    const lifecycle: TakodeHerdEventLifecycle[] = [];
    if (event.data.awaiting_decision) lifecycle.push("waiting_for_decision");
    if (event.data.resumed_after_decision) lifecycle.push("resumed_after_decision");
    if (event.data.compacted && !event.data.interrupted && !event.data.is_error) lifecycle.push("context_continued");
    if (event.data.interrupted) lifecycle.push("interrupted");
    else if (event.data.is_error) lifecycle.push("failed");
    return lifecycle;
  }
  if (event.event === "permission_request" || event.event === "notification_needs_input") {
    return ["waiting_for_decision"];
  }
  if (event.event === "permission_resolved") return ["decision_resolved"];
  if (event.event === "compaction_finished") return ["context_continued"];
  if (event.event === "session_disconnected") {
    return [event.data.wasGenerating ? "interrupted" : "idle_disconnected"];
  }
  if (event.event === "session_error") return ["failed"];
  return [];
}

function isRoutineBrowserHerdEvent(event: TakodeEvent): boolean {
  if (event.event === "turn_end") {
    return (
      !event.data.is_error &&
      !event.data.interrupted &&
      !event.data.interrupt_source &&
      !event.data.compacted &&
      !event.data.awaiting_decision &&
      !event.data.resumed_after_decision &&
      !event.data.recovery_pending &&
      !event.data.provisional &&
      !event.data.userMsgs?.count &&
      event.data.turn_source !== "user"
    );
  }
  if (event.event === "worker_stream") {
    return !event.data.userMsgs?.count && event.data.turn_source !== "user";
  }
  if (event.event === "board_stalled") {
    return true;
  }
  return false;
}

export function getTakodeHerdEventBrowserMetadata(
  batch: TakodeHerdBatchSnapshot | undefined,
): TakodeHerdEventBrowserMetadata[] | undefined {
  if (!batch?.events.length) return undefined;
  return batch.events.map((event) => {
    const lifecycle = getHerdEventLifecycle(event);
    return {
      event: event.event,
      sessionId: event.sessionId,
      sessionNum: event.sessionNum,
      ts: event.ts,
      routine: isRoutineBrowserHerdEvent(event),
      ...(lifecycle.length > 0 ? { lifecycle } : {}),
    };
  });
}
