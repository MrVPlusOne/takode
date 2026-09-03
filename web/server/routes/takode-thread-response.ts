import type { Hono } from "hono";
import { normalizeSelectedFeedThreadKey } from "../../shared/thread-window.js";
import { clearLeaderThreadStatusForActivity } from "../bridge/thread-routing-reminder.js";
import {
  buildLeaderThreadResponseState,
  LeaderThreadResponseConflictError,
  LeaderThreadResponseIdempotencyConflictError,
  publishLeaderThreadResponse,
  type LeaderThreadResponseStateDetail,
} from "../leader-thread-response.js";
import { threadRouteForTarget } from "../thread-routing-metadata.js";
import type { RouteContext } from "./context.js";

function normalizeRequestedThreadKey(value: string): string | null {
  const threadKey = normalizeSelectedFeedThreadKey(value);
  return threadKey === "main" || /^q-\d+$/.test(threadKey) ? threadKey : null;
}

function authorizeLeaderSelf(c: Parameters<RouteContext["authenticateTakodeCaller"]>[0], ctx: RouteContext) {
  const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
  if ("response" in auth) return auth;
  const id = ctx.resolveId(c.req.param("id") ?? "");
  if (!id) return { response: c.json({ error: "Session not found" }, 404) };
  if (id !== auth.callerId) {
    return { response: c.json({ error: "Can only manage thread responses for your own leader session" }, 403) };
  }
  const session = ctx.wsBridge.getSession(id);
  if (!session) return { response: c.json({ error: "Session not found" }, 404) };
  return { id, session };
}

function publicResponseState(detail: LeaderThreadResponseStateDetail) {
  return {
    version: detail.projection.version,
    threadKey: detail.projection.threadKey,
    cutoverHistoryIndex: detail.projection.cutoverHistoryIndex,
    pendingMessageCount: detail.projection.pendingMessageCount,
    pendingBatches: detail.pendingBatches.map((batch) => ({
      token: batch.token,
      messageCount: batch.messageCount,
      firstAskedAt: batch.firstAskedAt,
      lastAskedAt: batch.lastAskedAt,
      previews: batch.members.map(({ preview, truncated, imageCount, timestamp }) => ({
        preview,
        truncated,
        imageCount,
        timestamp,
      })),
    })),
    responses: detail.responses.map((response) => ({
      version: response.version,
      logicalResponseId: response.logicalResponseId,
      threadKey: response.threadKey,
      ...(response.questId ? { questId: response.questId } : {}),
      batchId: response.batchId,
      currentRevisionId: response.currentRevisionId,
      currentMessageId: response.currentMessageId,
      currentHistoryIndex: response.currentHistoryIndex,
      revisionCount: response.revisionCount,
      coveredMessageCount: response.coveredUserMessageIds.length,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      revisions: response.revisions.map((revision) => ({
        revisionId: revision.revisionId,
        ...(revision.parentRevisionId ? { parentRevisionId: revision.parentRevisionId } : {}),
        revisionNumber: revision.revisionNumber,
        messageId: revision.messageId,
        historyIndex: revision.historyIndex,
        markdown: revision.markdown,
        contentHash: revision.contentHash,
        createdAt: revision.createdAt,
        ...(revision.idempotencyKey ? { idempotencyKey: revision.idempotencyKey } : {}),
      })),
    })),
    ready: detail.projection.ready,
  };
}

function rejectsMessageIds(body: Record<string, unknown>): boolean {
  return ["userMessageIds", "coveredUserMessageIds", "messageIds"].some((key) => Object.hasOwn(body, key));
}

export function registerTakodeThreadResponseRoutes(api: Hono, ctx: RouteContext): void {
  api.get("/sessions/:id/thread-responses/:threadKey", (c) => {
    const authorized = authorizeLeaderSelf(c, ctx);
    if ("response" in authorized) return authorized.response;
    const threadKey = normalizeRequestedThreadKey(c.req.param("threadKey") ?? "");
    if (!threadKey) return c.json({ error: "threadKey must be main or q-N" }, 400);
    return c.json({
      sessionId: authorized.id,
      threadKey,
      responseState: publicResponseState(buildLeaderThreadResponseState(authorized.session, threadKey)),
    });
  });

  api.put("/sessions/:id/thread-responses/:threadKey", async (c) => {
    const authorized = authorizeLeaderSelf(c, ctx);
    if ("response" in authorized) return authorized.response;
    const threadKey = normalizeRequestedThreadKey(c.req.param("threadKey") ?? "");
    if (!threadKey) return c.json({ error: "threadKey must be main or q-N" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (rejectsMessageIds(body)) {
      return c.json({ error: "Thread response membership is server-owned; user-message IDs are not accepted" }, 400);
    }
    if (body.intent !== "create" && body.intent !== "revise") {
      return c.json({ error: 'intent must be "create" or "revise"' }, 400);
    }
    if (typeof body.markdown !== "string") return c.json({ error: "markdown is required" }, 400);
    if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
      return c.json({ error: "idempotencyKey must be a string" }, 400);
    }

    const common = {
      threadKey,
      markdown: body.markdown,
      ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    };
    const input =
      body.intent === "create"
        ? body.baseRevisionId === null && typeof body.pendingBatchToken === "string"
          ? { ...common, intent: "create" as const, baseRevisionId: null, pendingBatchToken: body.pendingBatchToken }
          : null
        : typeof body.baseRevisionId === "string" && typeof body.responseId === "string"
          ? { ...common, intent: "revise" as const, baseRevisionId: body.baseRevisionId, responseId: body.responseId }
          : null;
    if (!input) {
      return c.json(
        {
          error:
            body.intent === "create"
              ? "create requires pendingBatchToken and baseRevisionId null"
              : "revise requires responseId and a string baseRevisionId",
        },
        400,
      );
    }

    try {
      const result = publishLeaderThreadResponse(authorized.session, input);
      if (result.created) {
        if (
          clearLeaderThreadStatusForActivity(authorized.session, threadRouteForTarget(threadKey), {
            messageId: result.message.id,
            timestamp: result.message.timestamp,
          })
        ) {
          ctx.wsBridge.getSyncedProjectionController().invalidateLeaderThreadTabsForSession(authorized.id);
        }
        ctx.wsBridge.broadcastToSession(authorized.id, result.message);
        ctx.wsBridge.persistSessionById(authorized.id);
        ctx.wsBridge.refreshSessionConversation(authorized.id);
      }
      return c.json({
        sessionId: authorized.id,
        threadKey,
        response: publicResponseState(result.responseState).responses.find(
          (candidate) => candidate.logicalResponseId === result.response.logicalResponseId,
        ),
        responseState: publicResponseState(result.responseState),
      });
    } catch (error) {
      if (error instanceof LeaderThreadResponseConflictError) {
        return c.json(
          {
            error: error.message,
            currentRevisionId: error.currentRevisionId,
            responseState: publicResponseState(buildLeaderThreadResponseState(authorized.session, threadKey)),
          },
          409,
        );
      }
      if (error instanceof LeaderThreadResponseIdempotencyConflictError) {
        return c.json(
          {
            error: error.message,
            responseState: publicResponseState(buildLeaderThreadResponseState(authorized.session, threadKey)),
          },
          409,
        );
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
