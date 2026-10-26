import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import type { SessionNotification } from "../types.js";
import { observedThreadMonitorResultId } from "../utils/thread-monitoring.js";

const BASE = "/api";

async function request<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(typeof err.error === "string" && err.error ? err.error : res.statusText);
  }
  return res.json();
}

const post = <T>(path: string, body: object = {}) => request<T>(path, body);
const get = <T>(path: string) => request<T>(path);

/** Session notification endpoints: resolving, muting, snoozing and answering needs-input prompts. */
export const notificationApi = {
  markNotificationDone: (sessionId: string, notifId: string, done = true) =>
    post<{ ok: boolean }>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/done`,
      { done },
    ),

  setNotificationMuted: (sessionId: string, notifId: string, muted: boolean) =>
    post<{ ok: boolean; muted: boolean; changed: boolean; notification: SessionNotification }>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/muted`,
      { muted },
    ),

  snoozeNotification: (sessionId: string, notifId: string, durationMs: number) =>
    post<{ ok: boolean; notification: SessionNotification }>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/snooze`,
      { durationMs },
    ),

  sendNeedsInputResponse: (
    sessionId: string,
    notifId: string,
    response: { content: string; threadKey?: string; questId?: string; annotations?: ConversationAnnotation[] },
  ) =>
    post<{ ok: boolean; sessionId: string; notificationId: string; delivery: "sent" | "queued" | "already_done" }>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/response`,
      {
        ...response,
        threadMonitorResultId: observedThreadMonitorResultId(sessionId, response.threadKey ?? response.questId),
      },
    ),

  /** `visible` returns only what the browser's own list holds: read results and closed tabs left out. */
  getSessionNotifications: (sessionId: string, options: { visible?: boolean } = {}) =>
    get<SessionNotification[]>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications${options.visible ? "?visible=1" : ""}`,
    ),

  getNotificationReplies: (sessionId: string, notifId: string) =>
    get<{ replies: Array<{ content: string }> }>(
      `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/replies`,
    ),

  fetchNotificationContext: async (sessionId: string, notifId: string): Promise<string | null> => {
    try {
      const data = await get<{ context: string | null }>(
        `/sessions/${encodeURIComponent(sessionId)}/notifications/${encodeURIComponent(notifId)}/context`,
      );
      return data.context ?? null;
    } catch (error) {
      console.warn("Failed to fetch notification context", error);
      return null;
    }
  },

  markAllNotificationsDone: (sessionId: string, done = true) =>
    post<{ ok: boolean; count: number }>(`/sessions/${encodeURIComponent(sessionId)}/notifications/done-all`, { done }),
};
