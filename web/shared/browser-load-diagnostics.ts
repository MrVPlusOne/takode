/** Metadata-only browser stages; timestamps are relative to the document's time origin. */
export const BROWSER_LOAD_STAGES = [
  "module_started",
  "app_commit",
  "app_frame",
  "foreground",
  "foreground_frame",
  "page_show",
  "connect",
  "open",
  "subscribe",
  "sync_marker",
  "view_request",
  "message_received",
  "message_applied",
  "feed_commit",
  "feed_frame",
] as const;
export const BROWSER_LOAD_MESSAGE_TYPES = [
  "session_init",
  "history_window_sync",
  "thread_window_sync",
  "history_sync",
  "leader_projection_snapshot",
  "event_replay",
  "state_snapshot",
] as const;
export const BROWSER_LOAD_WINDOW_MS = 90_000;
export const BROWSER_LOAD_MAX_STAGES = 64;
export const BROWSER_LOAD_BATCH_SIZE = 16;

export interface BrowserLoadStage {
  stage: (typeof BROWSER_LOAD_STAGES)[number];
  atMs: number;
  view?: string;
  windowHash?: string;
  messageType?: (typeof BROWSER_LOAD_MESSAGE_TYPES)[number];
  receiveId?: number;
  parseMs?: number;
  applyMs?: number;
  loading?: boolean;
  persisted?: boolean;
}

export interface BrowserLoadReport {
  documentId: string;
  lifecycleId: number;
  lifecycle: "startup" | "foreground" | "connection";
  timeOrigin: number;
  startedAtMs: number;
  moduleStartedAtMs: number;
  hiddenMs?: number;
  displayMode: "standalone" | "browser";
  visibility: "visible" | "hidden";
  frontendBuildId: string | null;
  navigation?: {
    type: "navigate" | "reload" | "back_forward" | "prerender";
    requestStart: number;
    responseStart: number;
    responseEnd: number;
    domInteractive: number;
    domContentLoadedEventEnd: number;
    loadEventEnd: number;
  };
  stages: BrowserLoadStage[];
}

export interface BrowserLoadReportMessage {
  type: "browser_load_report";
  connection_id: string;
  report: BrowserLoadReport;
}
