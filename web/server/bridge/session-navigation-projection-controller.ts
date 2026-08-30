import { formatReplyContentForPreview } from "../../shared/reply-context.js";
import {
  SESSION_NAVIGATION_PREVIEW_MAX_LENGTH,
  type SessionNavigationStatus,
} from "../../shared/session-navigation-projection.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { SdkSessionInfo } from "../session-info.js";
import { getLastActualHumanUserMessageTimestamp, isActualHumanUserMessage } from "../user-message-classification.js";
import { sendToBrowser, type BrowserTransportSocketLike } from "./browser-transport-controller.js";
import type { Session } from "./ws-bridge-session.js";

type SessionActivityUpdate = Extract<BrowserIncomingMessage, { type: "session_activity_update" }>;

type HistoryActivityCacheEntry = {
  history: Session["messageHistory"];
  length: number;
  tail: BrowserIncomingMessage | undefined;
  lastUserMessageAt: number | undefined;
};

type PreviewOwnerCacheEntry = {
  preview: string | undefined;
  timestamp: number | undefined;
  history: Session["messageHistory"];
  historyLength: number;
  historyTail: BrowserIncomingMessage | undefined;
  pendingInputs: Session["pendingCodexInputs"];
  pendingLength: number;
  pendingTail: Session["pendingCodexInputs"][number] | undefined;
};

type LauncherActivityCacheEntry = {
  bucket: number | null;
  value: number | undefined;
};

const NAVIGATION_ACTIVITY_BUCKET_MS = 1_000;
const EMPTY_PENDING_CODEX_INPUTS: Session["pendingCodexInputs"] = [];

function launcherActivityValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function launcherActivityBucket(value: number | undefined): number | null {
  return value === undefined ? null : Math.floor(value / NAVIGATION_ACTIVITY_BUCKET_MS);
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function previewMessageSource(message: BrowserIncomingMessage): { preview: string; timestamp: number } | undefined {
  if (message.type !== "user_message" || message.codexSubagent) return undefined;
  const timestamp = finiteTimestamp(message.timestamp);
  if (timestamp === undefined) return undefined;
  return {
    preview: formatReplyContentForPreview(message.content, message.replyContext).slice(
      0,
      SESSION_NAVIGATION_PREVIEW_MAX_LENGTH,
    ),
    timestamp,
  };
}

export interface SessionNavigationProjectionSourceDeps {
  getSession: (sessionId: string) => Session | undefined;
  getLauncherSessionInfo: (sessionId: string) => SdkSessionInfo | null | undefined;
  getStoredSessionName: (sessionId: string) => string | undefined;
  getPendingTimerCount: (sessionId: string) => number;
  getBackendConnected: (session: Session) => boolean;
  deriveSessionStatus: (session: Session) => SessionNavigationStatus;
}

/**
 * Owns the bridge-only inputs that do not live directly on SessionState.
 *
 * The history-derived timestamp cache advances over append-only history deltas,
 * so unrelated projection invalidations do not repeatedly scan long histories.
 * Replaced or truncated histories fall back to one exact repair scan.
 */
export class SessionNavigationProjectionSourceController {
  private readonly statuses = new Map<string, SessionNavigationStatus>();
  private readonly historyActivity = new WeakMap<Session, HistoryActivityCacheEntry>();
  private readonly previewOwners = new WeakMap<Session, PreviewOwnerCacheEntry>();
  private readonly launcherActivity = new Map<string, LauncherActivityCacheEntry>();

  constructor(private readonly deps: SessionNavigationProjectionSourceDeps) {}

  getLauncherSessionInfo(sessionId: string): SdkSessionInfo | null | undefined {
    return this.deps.getLauncherSessionInfo(sessionId);
  }

  getSessionName(sessionId: string): string | undefined {
    return this.deps.getStoredSessionName(sessionId) ?? this.deps.getLauncherSessionInfo(sessionId)?.name;
  }

  getPendingTimerCount(sessionId: string): number {
    return this.deps.getPendingTimerCount(sessionId);
  }

  getBackendConnected(sessionId: string): boolean {
    const session = this.deps.getSession(sessionId);
    return session ? this.deps.getBackendConnected(session) : false;
  }

  getSessionStatus(sessionId: string): SessionNavigationStatus {
    if (this.statuses.has(sessionId)) return this.statuses.get(sessionId) ?? null;
    const session = this.deps.getSession(sessionId);
    return session ? this.deps.deriveSessionStatus(session) : null;
  }

  getLastActivityAt(sessionId: string): number | undefined {
    const cached = this.launcherActivity.get(sessionId);
    if (cached) return cached.value;
    const value = launcherActivityValue(this.deps.getLauncherSessionInfo(sessionId)?.lastActivityAt);
    this.launcherActivity.set(sessionId, { bucket: launcherActivityBucket(value), value });
    return value;
  }

  /** Publish launcher activity at most once per bucket while preserving its exact sampled timestamp. */
  captureLauncherActivity(sessionId: string): boolean {
    const value = launcherActivityValue(this.deps.getLauncherSessionInfo(sessionId)?.lastActivityAt);
    const bucket = launcherActivityBucket(value);
    const cached = this.launcherActivity.get(sessionId);
    if (cached?.bucket === bucket) return false;
    this.launcherActivity.set(sessionId, { bucket, value });
    return cached?.value !== value;
  }

  getLastUserMessageAt(sessionId: string): number | undefined {
    const session = this.deps.getSession(sessionId);
    if (!session) return undefined;
    return this.getHistoryActivity(session).lastUserMessageAt;
  }

  getLastMessagePreviewAt(sessionId: string): number | undefined {
    const session = this.deps.getSession(sessionId);
    if (!session) return undefined;
    const preview = session.lastUserMessage;
    const history = session.messageHistory;
    const pendingInputs = session.pendingCodexInputs ?? EMPTY_PENDING_CODEX_INPUTS;
    const cached = this.previewOwners.get(session);
    if (
      cached &&
      cached.preview === preview &&
      cached.history === history &&
      cached.historyLength === history.length &&
      cached.historyTail === history.at(-1) &&
      cached.pendingInputs === pendingInputs &&
      cached.pendingLength === pendingInputs.length &&
      cached.pendingTail === pendingInputs.at(-1)
    ) {
      return cached.timestamp;
    }

    for (let index = pendingInputs.length - 1; index >= 0; index -= 1) {
      const pending = pendingInputs[index];
      const pendingPreview = formatReplyContentForPreview(pending.content || "", pending.replyContext).slice(
        0,
        SESSION_NAVIGATION_PREVIEW_MAX_LENGTH,
      );
      if (pendingPreview === preview) {
        return this.rememberPreviewOwner(session, preview, finiteTimestamp(pending.timestamp), pendingInputs);
      }
    }

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const historySource = previewMessageSource(history[index]);
      if (historySource && historySource.preview === preview) {
        return this.rememberPreviewOwner(session, preview, historySource.timestamp, pendingInputs);
      }
    }

    return this.rememberPreviewOwner(
      session,
      preview,
      cached && cached.preview === preview ? cached.timestamp : undefined,
      pendingInputs,
    );
  }

  private rememberPreviewOwner(
    session: Session,
    preview: string | undefined,
    timestamp: number | undefined,
    pendingInputs: Session["pendingCodexInputs"],
  ): number | undefined {
    const history = session.messageHistory;
    this.previewOwners.set(session, {
      preview,
      timestamp,
      history,
      historyLength: history.length,
      historyTail: history.at(-1),
      pendingInputs,
      pendingLength: pendingInputs.length,
      pendingTail: pendingInputs.at(-1),
    });
    return timestamp;
  }

  private getHistoryActivity(session: Session): HistoryActivityCacheEntry {
    const history = session.messageHistory;
    const cached = this.historyActivity.get(session);
    const tail = history.at(-1);

    if (cached?.history === history && cached.length === history.length && cached.tail === tail) {
      return cached;
    }

    let lastUserMessageAt: number | undefined;
    const appendOnly =
      cached?.history === history &&
      history.length > cached.length &&
      (cached.length === 0 || history[cached.length - 1] === cached.tail);
    if (appendOnly) {
      lastUserMessageAt = cached.lastUserMessageAt;
      for (let index = cached.length; index < history.length; index += 1) {
        const message = history[index];
        if (isActualHumanUserMessage(message)) {
          const timestamp = finiteTimestamp(message.timestamp);
          if (timestamp !== undefined) lastUserMessageAt = timestamp;
        }
      }
    } else {
      lastUserMessageAt = getLastActualHumanUserMessageTimestamp(history);
    }

    const entry = {
      history,
      length: history.length,
      tail,
      lastUserMessageAt,
    };
    this.historyActivity.set(session, entry);
    return entry;
  }

  captureSourceMessage(session: Session, msg: BrowserIncomingMessage): boolean {
    if (msg.type === "status_change") {
      this.statuses.set(session.id, msg.status);
    } else if (msg.type === "backend_connected" || msg.type === "backend_disconnected") {
      // Connection state is authoritative after reconnect/disconnect. Drop an
      // older transient status so a prior running value cannot outlive it.
      this.statuses.delete(session.id);
    }

    return (
      msg.type === "status_change" ||
      msg.type === "session_update" ||
      msg.type === "session_name_update" ||
      msg.type === "session_quest_claimed" ||
      msg.type === "timer_update" ||
      msg.type === "backend_connected" ||
      msg.type === "backend_disconnected" ||
      msg.type === "user_message" ||
      msg.type === "codex_pending_inputs" ||
      msg.type === "result" ||
      msg.type === "permission_request" ||
      msg.type === "permission_approved" ||
      msg.type === "permission_denied" ||
      msg.type === "permission_cancelled" ||
      msg.type === "permissions_cleared"
    );
  }

  removeSession(sessionId: string): void {
    this.statuses.delete(sessionId);
    this.launcherActivity.delete(sessionId);
  }
}

/** Remove only fields whose authority moved into the subscribed navigation projection. */
export function suppressProjectedSessionNavigationActivityFields(
  msg: SessionActivityUpdate,
): SessionActivityUpdate | null {
  const { status: _status, pendingPermissionCount: _pendingPermissionCount, ...session } = msg.session;
  return Object.keys(session).length > 0 ? { ...msg, session } : null;
}

/** Preserve legacy activity fields for sockets that have not subscribed to the migration projection. */
export function broadcastSessionActivityUpdateWithProjectionSuppression(params: {
  sessions: Iterable<Session>;
  msg: SessionActivityUpdate;
  hasNavigationSubscription: (socket: BrowserTransportSocketLike, sessionId: string) => boolean;
}): void {
  for (const session of params.sessions) {
    for (const ws of session.browserSockets) {
      const socket = ws as BrowserTransportSocketLike;
      const outgoing = params.hasNavigationSubscription(socket, params.msg.session_id)
        ? suppressProjectedSessionNavigationActivityFields(params.msg)
        : params.msg;
      if (outgoing) sendToBrowser(socket, outgoing);
    }
  }
}
