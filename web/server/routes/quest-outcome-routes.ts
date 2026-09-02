import { Hono, type Context } from "hono";
import type { BrowserIncomingMessage } from "../session-types.js";
import type {
  QuestOutcomeActor,
  QuestOutcomeAnchor,
  QuestOutcomeMessageSource,
  QuestOutcomeRevision,
  QuestOutcomeSource,
  QuestmasterTask,
} from "../quest-types.js";
import * as questStore from "../quest-store.js";
import {
  QuestOutcomeConflictError,
  QuestOutcomeIdempotencyConflictError,
  currentQuestOutcomeRevision,
  normalizeQuestOutcomeMarkdown,
  questOutcomeContentHash,
} from "../quest-outcome.js";
import { buildProjectedThreadEntries, normalizeSelectedFeedThreadKey } from "../../shared/thread-window.js";
import type { OptionalAuthResult, RouteContext } from "./context.js";
import { broadcastQuestUpdate } from "./quest-helpers.js";

interface QuestOutcomeUpdateBody {
  baseRevisionId?: unknown;
  markdown?: unknown;
  summaryMarkdown?: unknown;
  mode?: unknown;
  source?: {
    sessionId?: unknown;
    messageId?: unknown;
    historyIndex?: unknown;
  };
  advanceThroughSessionId?: unknown;
  idempotencyKey?: unknown;
}

interface ResolvedOutcomeSource {
  markdown: string;
  source: QuestOutcomeMessageSource;
  anchor?: QuestOutcomeAnchor;
}

function badRequest(c: Context, error: string) {
  return c.json({ error }, 400);
}

function resolveSessionId(ctx: RouteContext, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return ctx.resolveId(value.trim()) ?? (ctx.launcher.getSession(value.trim()) ? value.trim() : null);
}

function rawMessageId(message: BrowserIncomingMessage, historyIndex: number): string {
  if (message.type === "assistant" && typeof message.message.id === "string" && message.message.id.trim()) {
    return message.message.id;
  }
  if ("id" in message && typeof message.id === "string" && message.id.trim()) return message.id;
  return `history-${historyIndex}`;
}

function messageThreadKeys(message: BrowserIncomingMessage): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    keys.add(normalizeSelectedFeedThreadKey(value));
  };
  add(message.threadKey);
  add(message.questId);
  for (const ref of message.threadRefs ?? []) {
    add(ref.threadKey);
    add(ref.questId);
  }
  if (keys.size === 0) keys.add("main");
  return [...keys];
}

function messageHasEligibleTargetRoute(message: BrowserIncomingMessage, questId: string): boolean {
  const target = questId.toLowerCase();
  const matchingRefs = (message.threadRefs ?? []).filter(
    (ref) =>
      normalizeSelectedFeedThreadKey(ref.threadKey) === target ||
      normalizeSelectedFeedThreadKey(ref.questId ?? "") === target,
  );
  if (matchingRefs.length > 0) return matchingRefs.some((ref) => ref.source !== "inferred");
  return (
    normalizeSelectedFeedThreadKey(message.threadKey ?? "main") === target ||
    normalizeSelectedFeedThreadKey(message.questId ?? "main") === target
  );
}

function assistantOutcomeMarkdown(message: BrowserIncomingMessage): string {
  if (message.type !== "assistant") return "";
  return normalizeQuestOutcomeMarkdown(
    message.message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .filter((text) => text.trim())
      .join("\n\n"),
  );
}

function projectedMessageBelongsToQuest(
  history: ReadonlyArray<BrowserIncomingMessage>,
  questId: string,
  historyIndex: number,
  messageId: string,
): boolean {
  return buildProjectedThreadEntries(history, questId).some(
    (entry) => entry.history_index === historyIndex && rawMessageId(entry.message, entry.history_index) === messageId,
  );
}

function authorizeOutcomeMutation(
  c: Context,
  auth: OptionalAuthResult,
  quest: QuestmasterTask,
): QuestOutcomeActor | Response {
  if (auth && "response" in auth) return auth.response;
  if (!auth) return { kind: "human", label: "User" };
  if (auth.caller.isOrchestrator !== true || quest.leaderSessionId !== auth.callerId) {
    return c.json({ error: "Only the direct user or recorded quest leader may publish a Quest Outcome." }, 403);
  }
  return {
    kind: "leader",
    sessionId: auth.callerId,
    ...(typeof auth.caller.sessionNum === "number" ? { sessionNum: auth.caller.sessionNum } : {}),
    ...(auth.caller.name ? { label: auth.caller.name } : {}),
  };
}

function resolveSourceMessage(
  ctx: RouteContext,
  quest: QuestmasterTask,
  actor: QuestOutcomeActor,
  sourceInput: NonNullable<QuestOutcomeUpdateBody["source"]>,
): ResolvedOutcomeSource {
  const sourceSessionId = resolveSessionId(ctx, sourceInput.sessionId);
  const messageId = typeof sourceInput.messageId === "string" ? sourceInput.messageId.trim() : "";
  const requestedHistoryIndex =
    typeof sourceInput.historyIndex === "number" && Number.isInteger(sourceInput.historyIndex)
      ? sourceInput.historyIndex
      : null;
  if (!sourceSessionId || !messageId)
    throw new Error("Outcome message imports require a valid sessionId and messageId.");
  if (actor.kind === "leader" && actor.sessionId !== sourceSessionId) {
    throw new Error("A recorded leader may import only from its own leader session.");
  }
  const sourceSession = ctx.launcher.getSession(sourceSessionId);
  if (sourceSession?.isOrchestrator !== true)
    throw new Error("Quest Outcome message imports require a leader session.");
  const bridgeSession = ctx.wsBridge.getSession(sourceSessionId);
  if (!bridgeSession) throw new Error("Outcome source session is unavailable.");

  const candidates = bridgeSession.messageHistory.flatMap((message, historyIndex) => {
    if (requestedHistoryIndex !== null && historyIndex !== requestedHistoryIndex) return [];
    return rawMessageId(message, historyIndex) === messageId ? [{ message, historyIndex }] : [];
  });
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0 ? "Outcome source message was not found." : "Outcome source message is ambiguous.",
    );
  }
  const [{ message, historyIndex }] = candidates;
  if (message.type !== "assistant" || message.codexSubagent || message.parent_tool_use_id) {
    throw new Error("Only root leader assistant prose can seed a Quest Outcome.");
  }
  const markdown = assistantOutcomeMarkdown(message);
  if (!markdown) throw new Error("Outcome source message has no eligible user-facing Markdown.");

  const sourceThreadKeys = messageThreadKeys(message);
  const targetQuestId = quest.questId.toLowerCase();
  const belongsToTarget =
    messageHasEligibleTargetRoute(message, targetQuestId) &&
    projectedMessageBelongsToQuest(bridgeSession.messageHistory, targetQuestId, historyIndex, messageId);
  const nonMainQuestKeys = sourceThreadKeys.filter((key) => /^q-\d+$/.test(key));
  const mainOnly = nonMainQuestKeys.length === 0;
  if (!belongsToTarget && !mainOnly) {
    throw new Error("Outcome source belongs to another quest; cross-quest relevance is never inferred.");
  }

  // A Main-only import still owns an exact chronological boundary. The source
  // message is absent from the quest projection, so feed placement falls back
  // to its authoritative history index and keeps later quest activity below it.
  const anchor = { sessionId: sourceSessionId, historyIndex, messageId };
  return {
    markdown,
    source: {
      kind: "message",
      sessionId: sourceSessionId,
      messageId,
      historyIndex,
      targetQuestId,
      sourceThreadKeys,
      ...(mainOnly && !belongsToTarget ? { crossDestinationCopy: true } : {}),
      contentHash: questOutcomeContentHash(markdown),
    },
    ...(anchor ? { anchor } : {}),
  };
}

function latestQuestAnchor(
  ctx: RouteContext,
  questId: string,
  sessionIdInput: unknown,
): QuestOutcomeAnchor | undefined {
  const sessionId = resolveSessionId(ctx, sessionIdInput);
  if (!sessionId) throw new Error("--advance-through requires a valid leader session.");
  const session = ctx.launcher.getSession(sessionId);
  if (session?.isOrchestrator !== true)
    throw new Error("Outcome boundaries can advance only through a leader session.");
  const history = ctx.wsBridge.getSession(sessionId)?.messageHistory;
  if (!history) throw new Error("Outcome boundary session is unavailable.");
  const latest = buildProjectedThreadEntries(history, questId).at(-1);
  if (!latest) return undefined;
  return {
    sessionId,
    historyIndex: latest.history_index,
    messageId: rawMessageId(latest.message, latest.history_index),
  };
}

function mergedAnchor(current: QuestOutcomeAnchor | undefined, incoming: QuestOutcomeAnchor): QuestOutcomeAnchor {
  if (current?.sessionId === incoming.sessionId && current.historyIndex > incoming.historyIndex) return current;
  return incoming;
}

function outcomeRevisionById(quest: QuestmasterTask, revisionId: string | null): QuestOutcomeRevision | null {
  if (!revisionId) return null;
  return quest.outcome?.revisions.find((revision) => revision.revisionId === revisionId) ?? null;
}

function requestIdempotencyHash(
  body: QuestOutcomeUpdateBody,
  baseRevisionId: string | null,
  mode: "replace" | "append",
): string {
  return questOutcomeContentHash(
    JSON.stringify({
      baseRevisionId,
      mode,
      markdown: body.markdown,
      summaryMarkdown: body.summaryMarkdown,
      source: body.source,
      advanceThroughSessionId: body.advanceThroughSessionId,
    }),
  );
}

export function createQuestOutcomeRoutes(ctx: RouteContext) {
  const api = new Hono();

  api.get("/quests/:questId/outcome", async (c) => {
    const quest = await questStore.getQuest(c.req.param("questId"));
    if (!quest) return c.json({ error: "Quest not found" }, 404);
    return c.json({ questId: quest.questId, outcome: quest.outcome ?? null });
  });

  api.put("/quests/:questId/outcome", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as QuestOutcomeUpdateBody;
    const quest = await questStore.getQuest(c.req.param("questId"));
    if (!quest) return c.json({ error: "Quest not found" }, 404);
    const actor = authorizeOutcomeMutation(c, auth, quest);
    if (actor instanceof Response) return actor;
    if (!("baseRevisionId" in body))
      return badRequest(c, "baseRevisionId is required; use null for the first revision.");
    const baseRevisionId = body.baseRevisionId === null ? null : body.baseRevisionId;
    if (baseRevisionId !== null && typeof baseRevisionId !== "string") {
      return badRequest(c, "baseRevisionId must be a revision id or null.");
    }
    const mode =
      body.mode === undefined || body.mode === "replace" ? "replace" : body.mode === "append" ? "append" : null;
    if (!mode) return badRequest(c, 'mode must be "replace" or "append".');
    const hasMarkdown = typeof body.markdown === "string";
    if (hasMarkdown && mode === "append") {
      return badRequest(c, "Direct Outcome edits must submit the complete replacement Markdown.");
    }
    const hasSource = !!body.source;
    if (hasMarkdown === hasSource) {
      return badRequest(c, "Provide exactly one of markdown or source message identity.");
    }

    try {
      const baseRevision = outcomeRevisionById(quest, baseRevisionId);
      const idempotencyKey =
        typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : undefined;
      const idempotencyHash = requestIdempotencyHash(body, baseRevisionId, mode);
      const duplicate = idempotencyKey
        ? quest.outcome?.revisions.find((revision) => revision.idempotencyKey === idempotencyKey)
        : undefined;
      if (duplicate?.idempotencyHash) {
        if (duplicate.idempotencyHash !== idempotencyHash) throw new QuestOutcomeIdempotencyConflictError();
        return c.json({ quest, outcome: quest.outcome });
      }

      let markdown: string;
      let anchor = baseRevision?.anchor;
      let sources: QuestOutcomeSource[];
      if (body.source) {
        const resolved = resolveSourceMessage(ctx, quest, actor, body.source);
        markdown =
          mode === "append" && baseRevision ? `${baseRevision.markdown}\n\n${resolved.markdown}` : resolved.markdown;
        if (resolved.anchor) {
          anchor =
            mode === "append" && baseRevision?.anchor
              ? mergedAnchor(baseRevision.anchor, resolved.anchor)
              : resolved.anchor;
        }
        // Revision sources are deltas. Parent links retain prior provenance
        // without copying cumulative source arrays into every snapshot.
        sources = [resolved.source];
      } else {
        markdown = body.markdown as string;
        const manualSource: QuestOutcomeSource = {
          kind: "manual",
          targetQuestId: quest.questId.toLowerCase(),
          contentHash: questOutcomeContentHash(normalizeQuestOutcomeMarkdown(markdown)),
        };
        sources = [manualSource];
      }
      if (body.advanceThroughSessionId !== undefined) {
        if (actor.kind === "leader" && actor.sessionId !== resolveSessionId(ctx, body.advanceThroughSessionId)) {
          throw new Error("A recorded leader may advance an Outcome only through its own leader session.");
        }
        anchor = latestQuestAnchor(ctx, quest.questId, body.advanceThroughSessionId);
      }
      const summaryMarkdown =
        body.summaryMarkdown === undefined
          ? undefined
          : typeof body.summaryMarkdown === "string"
            ? body.summaryMarkdown
            : (() => {
                throw new Error("summaryMarkdown must be a string when provided.");
              })();
      const updated = await questStore.updateQuestOutcome(quest.questId, {
        baseRevisionId,
        markdown,
        summaryMarkdown,
        actor,
        anchor,
        sources,
        ...(idempotencyKey ? { idempotencyKey, idempotencyHash } : {}),
      });
      if (!updated) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge, updated);
      return c.json({ quest: updated, outcome: updated.outcome });
    } catch (error) {
      if (error instanceof QuestOutcomeConflictError) {
        return c.json({ error: error.message, currentRevisionId: error.currentRevisionId }, 409);
      }
      if (error instanceof QuestOutcomeIdempotencyConflictError) {
        return c.json({ error: error.message }, 409);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return api;
}
