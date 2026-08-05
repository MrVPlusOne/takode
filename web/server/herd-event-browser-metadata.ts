import type { TakodeEvent, TakodeHerdBatchSnapshot, TakodeHerdEventBrowserMetadata } from "./session-types.js";

function isRoutineBrowserHerdEvent(event: TakodeEvent): boolean {
  if (event.event === "turn_end") {
    return (
      !event.data.is_error &&
      !event.data.interrupted &&
      !event.data.interrupt_source &&
      !event.data.compacted &&
      !event.data.recovery_pending &&
      !event.data.provisional &&
      !event.data.userMsgs?.count &&
      event.data.turn_source !== "user"
    );
  }
  if (event.event === "worker_stream") {
    return !event.data.userMsgs?.count && event.data.turn_source !== "user";
  }
  return false;
}

export function getTakodeHerdEventBrowserMetadata(
  batch: TakodeHerdBatchSnapshot | undefined,
): TakodeHerdEventBrowserMetadata[] | undefined {
  if (!batch?.events.length) return undefined;
  return batch.events.map((event) => ({
    event: event.event,
    sessionId: event.sessionId,
    sessionNum: event.sessionNum,
    ts: event.ts,
    routine: isRoutineBrowserHerdEvent(event),
  }));
}
