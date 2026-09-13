import type { BrowserSessionState } from "./session-types.js";
import type { BrowserLoadReportMessage } from "../shared/browser-load-diagnostics.js";

/** Transport-only diagnostics never enter durable conversation history. */
export type BrowserConnectionIncomingMessage =
  | { type: "browser_connection_probe"; connection_id: string }
  | { type: "session_init"; session: BrowserSessionState; nextEventSeq?: number; diagnosticConnectionId?: string };

export type BrowserConnectionOutgoingMessage =
  | { type: "browser_connection_probe_ack"; connection_id: string }
  | BrowserLoadReportMessage;
