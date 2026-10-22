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
import type { GuidedReviewMeta } from "../../shared/guided-review.js";

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
      const receipt = publishSessionReport(ctx, auth.callerId, session, {
        content: body.content,
        sourcePath: body.sourcePath,
        threadKey: body.threadKey,
        sessionId: body.sessionId,
        responsibleWorkerId: body.responsibleWorkerId,
      });
      return "error" in receipt
        ? c.json({ error: receipt.error }, receipt.status)
        : c.json(
            {
              reportId: receipt.message.id,
              sessionId: session.id,
              threadKey: receipt.message.threadKey,
              sha256: receipt.message.source.sha256,
              bytes: Buffer.byteLength(receipt.message.content, "utf8"),
            },
            201,
          );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid Markdown report." }, 400);
    }
  });
  return api;
}

/**
 * Publish a report into the caller's own session: history, live browsers, and an unread result
 * for leaders. Shared by Markdown reports and guided reviews. Throws on invalid input; returns
 * an error with a status for authority problems.
 */
export function publishSessionReport(
  ctx: RouteContext,
  callerId: string,
  session: NonNullable<ReturnType<RouteContext["wsBridge"]["getSession"]>>,
  input: {
    content: string;
    sourcePath: string;
    threadKey: unknown;
    sessionId?: unknown;
    responsibleWorkerId?: unknown;
    guidedReview?: GuidedReviewMeta;
  },
): { message: MarkdownReportMessage } | { error: string; status: 403 } {
  const threadKey = readThread(input.threadKey);
  if (input.sessionId !== undefined && input.sessionId !== callerId) {
    return { error: "Reports can only be published into the caller's own session.", status: 403 };
  }
  const requestedWorker = input.responsibleWorkerId;
  const workerId = requestedWorker === undefined ? undefined : ctx.resolveId(String(requestedWorker));
  if (requestedWorker !== undefined && (!workerId || !eligibleWorker(ctx, callerId, workerId))) {
    return { error: "The responsible worker must belong to the publishing session.", status: 403 };
  }
  const id = crypto.randomUUID();
  const message: MarkdownReportMessage = {
    type: "markdown_report",
    id,
    timestamp: Date.now(),
    content: input.content,
    threadKey,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
    source: {
      sessionId: callerId,
      reportId: id,
      sourcePath: input.sourcePath,
      sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
      ...(workerId ? { responsibleWorkerId: workerId } : {}),
    },
    ...(input.guidedReview ? { guidedReview: input.guidedReview } : {}),
  };
  session.messageHistory.push(message);
  ctx.wsBridge.persistSessionById(session.id);
  ctx.wsBridge.broadcastToSession(session.id, message);
  ctx.wsBridge.refreshSessionConversation(session.id);
  if (ctx.launcher.getSession(session.id)?.isOrchestrator) {
    recordReportUnreadNotification(session, message, ctx.wsBridge.getSessionNotificationDeps());
  }
  return { message };
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
