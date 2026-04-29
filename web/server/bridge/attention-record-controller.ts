import type { BrowserIncomingMessage, SessionAttentionRecord } from "../session-types.js";

export interface AttentionRecordSessionLike {
  attentionRecords?: SessionAttentionRecord[];
}

export interface AttentionRecordDeps {
  broadcastToBrowsers?: (session: AttentionRecordSessionLike, msg: BrowserIncomingMessage) => void;
  persistSession: (session: AttentionRecordSessionLike) => void;
}

export function buildAttentionRecordsUpdateMessage(session: AttentionRecordSessionLike): BrowserIncomingMessage {
  return {
    type: "attention_records_update",
    attentionRecords: session.attentionRecords ?? [],
  } as BrowserIncomingMessage;
}

export function replaceAttentionRecords(
  session: AttentionRecordSessionLike,
  attentionRecords: SessionAttentionRecord[],
  deps: AttentionRecordDeps,
): void {
  session.attentionRecords = attentionRecords;
  deps.broadcastToBrowsers?.(session, buildAttentionRecordsUpdateMessage(session));
  deps.persistSession(session);
}
