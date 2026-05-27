import type { Hono } from "hono";
import {
  markAllNotificationsDone as markAllNotificationsDoneController,
  markNotificationDone as markNotificationDoneController,
} from "../bridge/session-registry-controller.js";
import type { RouteContext } from "./context.js";

type NotificationPersistDeps = Parameters<typeof markNotificationDoneController>[3];

export function registerTakodeNotificationInboxRoutes(
  api: Hono,
  ctx: RouteContext,
  notificationPersistDeps: NotificationPersistDeps,
) {
  const { wsBridge, authenticateTakodeCaller, resolveId } = ctx;

  api.post("/sessions/:id/notifications/needs-input/:notificationId/resolve", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;

    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (id !== auth.callerId) {
      return c.json({ error: "Can only resolve notifications for your own session" }, 403);
    }

    const numericId = Number.parseInt(c.req.param("notificationId"), 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return c.json({ error: "notificationId must be a positive integer" }, 400);
    }

    const session = wsBridge.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);

    const rawNotificationId = `n-${numericId}`;
    const notification = session.notifications.find(
      (entry) => entry.id === rawNotificationId && entry.category === "needs-input",
    );
    if (!notification) return c.json({ error: "Notification not found" }, 404);
    const wasDone = notification.done;
    markNotificationDoneController(session, rawNotificationId, true, notificationPersistDeps);
    return c.json({ ok: true, notificationId: numericId, rawNotificationId, changed: !wasDone });
  });

  api.post("/sessions/:id/notifications/:notifId/done", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const notifId = c.req.param("notifId");
    const body = await c.req.json().catch(() => ({}));
    const done = body.done !== false;
    const session = wsBridge.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const ok = markNotificationDoneController(session, notifId, done, notificationPersistDeps, {
      ...(done ? { resolutionNotice: "pending" as const, resolutionNoticeSource: "manual" as const } : {}),
    });
    if (!ok) return c.json({ error: "Notification not found" }, 404);
    return c.json({ ok: true });
  });

  api.post("/sessions/:id/notifications/done-all", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const done = body.done !== false;
    const session = wsBridge.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const count = markAllNotificationsDoneController(session, done, notificationPersistDeps, {
      ...(done ? { resolutionNotice: "pending" as const, resolutionNoticeSource: "manual" as const } : {}),
    });
    return c.json({ ok: true, count });
  });

  api.get("/sessions/:id/notifications", (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const notifications = (wsBridge.getSession(id)?.notifications ?? []).filter(
      (notification: { category?: unknown }) =>
        notification.category === "needs-input" || notification.category === "review",
    );
    return c.json(notifications);
  });
}
