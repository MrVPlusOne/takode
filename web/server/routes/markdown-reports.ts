import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  MAX_MARKDOWN_REPORT_BYTES,
  validateMarkdownReportContent,
  type MarkdownReportMessage,
} from "../../shared/markdown-report.js";
import { recordReportUnreadNotification } from "../bridge/session-notification-controller.js";
import type { RouteContext } from "./context.js";

/** Publication accepts bytes already read by the authenticated agent; it never reads a server path. */
export function createMarkdownReportRoutes(ctx: RouteContext) {
  const api = new Hono();
  api.use("/takode/reports", bodyLimit({ maxSize: MAX_MARKDOWN_REPORT_BYTES * 6 + 8192 }));
  api.post("/takode/reports", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const session = ctx.wsBridge.getSession(auth.callerId);
    if (!session || auth.caller.archived) return c.json({ error: "Publishing session is unavailable." }, 409);
    try {
      const body = await c.req.json();
      validateMarkdownReportContent(body.content);
      if (typeof body.sourcePath !== "string" || !isAbsolute(body.sourcePath) || body.sourcePath.includes("\0")) {
        throw new Error("An exact absolute source path is required.");
      }
      const threadKey = readThread(body.threadKey);
      if (body.sessionId !== undefined && body.sessionId !== auth.callerId) {
        return c.json({ error: "Reports can only be published into the caller's own session." }, 403);
      }
      const workerId = body.responsibleWorkerId === undefined ? undefined : ctx.resolveId(body.responsibleWorkerId);
      if (body.responsibleWorkerId !== undefined && (!workerId || !eligibleWorker(ctx, auth.callerId, workerId))) {
        return c.json({ error: "The responsible worker must belong to the publishing session." }, 403);
      }
      const id = crypto.randomUUID();
      const message: MarkdownReportMessage = {
        type: "markdown_report",
        id,
        timestamp: Date.now(),
        content: body.content,
        threadKey,
        ...(threadKey !== "main" ? { questId: threadKey } : {}),
        source: {
          sessionId: auth.callerId,
          reportId: id,
          sourcePath: body.sourcePath,
          sha256: createHash("sha256").update(body.content, "utf8").digest("hex"),
          ...(workerId ? { responsibleWorkerId: workerId } : {}),
        },
      };
      session.messageHistory.push(message);
      ctx.wsBridge.persistSessionById(session.id);
      ctx.wsBridge.broadcastToSession(session.id, message);
      ctx.wsBridge.refreshSessionConversation(session.id);
      if (ctx.launcher.getSession(session.id)?.isOrchestrator) {
        recordReportUnreadNotification(session, message, ctx.wsBridge.getSessionNotificationDeps());
      }
      return c.json(
        {
          reportId: id,
          sessionId: session.id,
          threadKey,
          sha256: message.source.sha256,
          bytes: Buffer.byteLength(message.content, "utf8"),
        },
        201,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid Markdown report." }, 400);
    }
  });
  return api;
}

function readThread(value: unknown): string {
  if (typeof value !== "string" || !/^(main|q-[1-9]\d*)$/.test(value))
    throw new Error("Choose main or an exact quest thread.");
  return value;
}

function eligibleWorker(ctx: RouteContext, publisherId: string, workerId: string): boolean {
  const worker = ctx.launcher.getSession(workerId);
  return (
    !!worker &&
    !worker.archived &&
    !worker.isOrchestrator &&
    (workerId === publisherId || worker.herdedBy === publisherId)
  );
}
