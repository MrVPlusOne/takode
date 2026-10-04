import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  MAX_MARKDOWN_REPORT_BYTES,
  validateMarkdownReportContent,
  type MarkdownReportMessage,
} from "../../shared/markdown-report.js";
import { readConversationAnnotations } from "../../shared/conversation-annotations.js";
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
          ...(workerId
            ? {
                responsibleWorkerId: workerId,
                responsibleWorkerLabel: `Worker #${ctx.launcher.getSessionNum(workerId) ?? workerId}`,
              }
            : {}),
        },
      };
      session.messageHistory.push(message);
      ctx.wsBridge.persistSessionById(session.id);
      ctx.wsBridge.broadcastToSession(session.id, message);
      ctx.wsBridge.refreshSessionConversation(session.id);
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

  api.post("/sessions/:id/report-annotations", async (c) => {
    // Browser actions are human input. Session-authenticated agent calls cannot impersonate that source.
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth)
      return "response" in auth ? auth.response : c.json({ error: "Use the chat UI to send report comments." }, 403);
    const hostId = ctx.resolveId(c.req.param("id"));
    const host = hostId ? ctx.wsBridge.getSession(hostId) : undefined;
    if (!host || ctx.launcher.getSession(host.id)?.archived)
      return c.json({ error: "Report session is unavailable." }, 409);
    try {
      const body = await c.req.json();
      if (typeof body.content !== "string") throw new Error("Comment message text is required.");
      const threadKey = readThread(body.threadKey);
      const annotations = readConversationAnnotations(body.annotations);
      if (!annotations.length) throw new Error("Select a report passage before sending comments.");
      const recipientId = typeof body.recipientSessionId === "string" ? ctx.resolveId(body.recipientSessionId) : null;
      if (!recipientId) throw new Error("Choose a comment recipient.");
      const recipient = ctx.launcher.getSession(recipientId);
      if (!recipient || recipient.archived || !ctx.wsBridge.getSession(recipientId)) {
        return c.json({ error: "The selected recipient is unavailable. Your draft has been kept." }, 409);
      }
      const canonical = annotations.map((annotation) => {
        const report = host.messageHistory.find(
          (message): message is MarkdownReportMessage =>
            message.type === "markdown_report" && message.id === annotation.sourceMessageId,
        );
        if (
          !report ||
          annotation.reportSource?.sessionId !== host.id ||
          annotation.reportSource.reportId !== report.id ||
          annotation.reportSource.sha256 !== report.source.sha256
        ) {
          throw new Error("The comment source does not match a published report in this session.");
        }
        if (
          recipientId !== host.id &&
          (report.source.responsibleWorkerId !== recipientId || !eligibleWorker(ctx, host.id, recipientId))
        ) {
          throw new Error("The recorded worker is no longer eligible. Your draft has been kept.");
        }
        return { ...annotation, reportSource: report.source };
      });
      let accept!: (value: boolean) => void;
      const accepted = new Promise<boolean>((resolve) => {
        accept = resolve;
      });
      const delivery = ctx.wsBridge.injectUserMessage(
        recipientId,
        body.content,
        undefined,
        undefined,
        {
          threadKey: recipientId === host.id ? threadKey : "main",
          ...(recipientId === host.id && threadKey !== "main" ? { questId: threadKey } : {}),
        },
        {
          annotations: canonical,
          autoPauseSourceKind: "manual",
          afterAccepted: () => accept(true),
          afterRejected: () => accept(false),
        },
      );
      if (delivery === "no_session" || delivery === "dropped" || !(await accepted))
        return c.json({ error: "Comments were not accepted. Your draft has been kept." }, 409);
      return c.json({ ok: true, recipientSessionId: recipientId, delivery });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid report comments." }, 400);
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
