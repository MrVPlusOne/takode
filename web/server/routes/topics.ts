import { Hono, type Context } from "hono";
import { getQuest, listQuests } from "../quest-store.js";
import { getArtifactLibrary } from "../artifact-library.js";
import type { TopicListResponse } from "../../shared/library-topics.js";
import { TopicStoreError } from "../topic-store.js";
import type { TopicService } from "../topic-service.js";
import { SCRIBE_BRIEF } from "../scribe-brief.js";
import type { RouteContext } from "./context.js";

let activeService: TopicService | null = null;

/** The server's topic service, once started; null in tests and before startup. */
export function getTopicService(): TopicService | null {
  return activeService;
}

export function setTopicService(service: TopicService | null): void {
  activeService = service;
}

/**
 * The Library's topics API, for the topic panel, leaders (`quest create --topic`, `takode topic`)
 * and their Scribes (`/scribe/...`, `takode scribe`). A caller that is a Scribe acts for its
 * leader: its changes count as automatic (a rename of a topic the user named becomes a
 * suggestion), and it reads its leader's events.
 */
export function createTopicRoutes(ctx: RouteContext, service: () => TopicService | null = getTopicService) {
  const api = new Hono();
  /** Per topic and caller: the page revision and event time last read through `changes`. */
  const served = new Map<string, { revision: number; through: number }>();

  const caller = (c: Context): string | null => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    return auth && "callerId" in auth ? auth.callerId : null;
  };
  /** The leader a Scribe works for, when the caller is one. */
  const scribeLeader = (svc: TopicService, callerId: string | null) =>
    callerId ? svc.store.leaderOfScribe(callerId) : undefined;
  /** The leader a request is about: `leader` in the query, else the caller's leader or the caller. */
  const leaderFor = (svc: TopicService, c: Context, explicit?: string): string | undefined => {
    const named = explicit ?? c.req.query("leader");
    if (named) return ctx.resolveId(named) ?? undefined;
    const callerId = caller(c);
    if (!callerId) return undefined;
    return scribeLeader(svc, callerId) ?? (ctx.launcher.getSession(callerId)?.isOrchestrator ? callerId : undefined);
  };
  const callerSpace = (svc: TopicService, callerId: string | null): string | undefined => {
    if (!callerId) return undefined;
    const sessionId = scribeLeader(svc, callerId) ?? callerId;
    return ctx.launcher.getSession(sessionId)?.memorySessionSpaceSlug;
  };
  const run = async <T>(c: Context, body: (svc: TopicService) => Promise<T> | T) => {
    const svc = service();
    if (!svc) return c.json({ error: "Topics are not available on this server." }, 503);
    try {
      const result = await body(svc);
      await svc.store.flush();
      return c.json(result as object);
    } catch (error) {
      if (error instanceof TopicStoreError) return c.json({ error: error.message }, error.status);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  };
  const topicFor = (svc: TopicService, c: Context, ref: string) => {
    const topic = svc.store.resolve(decodeURIComponent(ref), callerSpace(svc, caller(c)) ?? c.req.query("space"));
    if (!topic) throw new TopicStoreError(`No topic "${decodeURIComponent(ref)}".`, 404);
    return topic;
  };
  const leaderQuestIds = async (leaderId: string) =>
    new Set(
      (await listQuests())
        .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
        .map((quest) => quest.questId),
    );

  api.get("/topics", (c) =>
    run(c, async (svc): Promise<TopicListResponse> => {
      const leaderId = c.req.query("leader") ? leaderFor(svc, c) : undefined;
      const leaderInfo = leaderId ? ctx.launcher.getSession(leaderId) : undefined;
      // A leader's panel shows the topics of its space that hold its quests.
      const space =
        (leaderId ? leaderInfo?.memorySessionSpaceSlug : undefined) ??
        c.req.query("space") ??
        callerSpace(svc, caller(c));
      const scoped = space && space !== "all" ? space : undefined;
      const leaders = await svc.leaderStates();
      let topics = svc.store.list(scoped);
      if (leaderId) {
        const own = await leaderQuestIds(leaderId);
        topics = topics.filter((topic) => topic.questIds.some((questId) => own.has(questId)));
      }
      return {
        topics,
        changes: svc.store.changes(scoped),
        leaders: leaderId
          ? leaders.filter((leader) => leader.sessionId === leaderId)
          : scoped
            ? leaders.filter((leader) => leader.space === scoped)
            : leaders,
        spaces: [...new Set([...svc.store.spaces(), ...leaders.map((leader) => leader.space)])].sort(),
        suggestions: svc.store.suggestions(scoped),
        ...(leaderId ? { scribe: await svc.overview(leaderId) } : {}),
      };
    }),
  );

  // ─── Scribes ──────────────────────────────────────────────────────────────

  api.get("/scribe/brief", (c) => c.json({ brief: SCRIBE_BRIEF }));

  /** For a leader or its Scribe: the Scribe's activity and settings, and renames waiting for the user. */
  api.get("/scribe/status", (c) =>
    run(c, async (svc) => {
      const leaderId = leaderFor(svc, c);
      if (!leaderId) throw new TopicStoreError("Name the leader (--leader).", 404);
      const space = ctx.launcher.getSession(leaderId)?.memorySessionSpaceSlug;
      const own = await leaderQuestIds(leaderId);
      const topics = space ? svc.store.list(space).filter((topic) => topic.questIds.some((id) => own.has(id))) : [];
      return {
        leader: { sessionId: leaderId, sessionNum: ctx.launcher.getSessionNum(leaderId) ?? null, space: space ?? null },
        enabled: svc.store.isLeaderEnabled(leaderId),
        topics: topics.length,
        scribe: await svc.overview(leaderId),
        suggestions: svc.store
          .suggestions(space)
          .filter((suggestion) => topics.some((topic) => topic.id === suggestion.topicId)),
      };
    }),
  );

  /** For a leader's tab bar: whether it has topics on, and the topic of each named quest. */
  api.get("/topics/quest-map", (c) =>
    run(c, (svc) => {
      const leader = ctx.resolveId(c.req.query("leader") ?? "") ?? "";
      const quests = (c.req.query("quests") ?? "").split(",").filter(Boolean);
      return { enabled: svc.store.isLeaderEnabled(leader), map: svc.store.questTopicMap(quests) };
    }),
  );

  /** For `quest create`: whether the caller files quests under topics, and the topics to choose from. */
  api.get("/topics/caller-status", (c) =>
    run(c, (svc) => {
      const callerId = caller(c);
      const space = callerSpace(svc, callerId);
      return {
        enabled: !!callerId && svc.store.isLeaderEnabled(callerId),
        space: space ?? null,
        topics: space ? svc.store.list(space).map((topic) => topic.name) : [],
      };
    }),
  );

  /** A leader's quests from a recent window, for sorting them into topics; a Scribe gets its leader's. */
  api.get("/scribe/quests", (c) =>
    run(c, async (svc) => {
      const leader = leaderFor(svc, c);
      if (!leader) throw new TopicStoreError("Name the leader.", 404);
      const since = Number(c.req.query("since")) || Date.now() - 30 * 24 * 3600_000;
      const unsorted = c.req.query("unsorted") === "1";
      const quests = (await listQuests())
        .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leader)
        .filter((quest) => quest.createdAt >= since)
        .filter((quest) => !unsorted || !svc.store.topicOfQuest(quest.questId))
        .sort((a, b) => a.createdAt - b.createdAt);
      return {
        quests: quests.map((quest) => ({
          questId: quest.questId,
          title: quest.title,
          status: quest.status,
          createdAt: quest.createdAt,
          tldr: (quest.tldr ?? "").slice(0, 200),
          topic: svc.store.topicOfQuest(quest.questId)?.name ?? null,
        })),
      };
    }),
  );

  api.post("/topics/assign", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const quest = typeof body.questId === "string" ? await getQuest(body.questId) : null;
      if (!quest) throw new TopicStoreError("Quest not found.", 404);
      if (typeof body.topic !== "string") throw new TopicStoreError("Name the topic.");
      const callerId = caller(c);
      const space = quest.sessionSpaceSlug ?? callerSpace(svc, callerId);
      if (!space) throw new TopicStoreError("The quest has no session space.");
      // Filing is an event for the Scribe of the quest's leader.
      const questLeader = (quest as { leaderSessionId?: string }).leaderSessionId;
      const result = svc.store.assign({
        questId: quest.questId,
        space,
        name: body.topic,
        by: callerId ? "agent" : "user",
        byAgent: !!scribeLeader(svc, callerId),
        ...(questLeader ? { leaderId: questLeader } : {}),
      });
      if (questLeader) svc.changed(questLeader);
      return result;
    }),
  );

  api.post("/topics/move", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const quest = typeof body.questId === "string" ? await getQuest(body.questId) : null;
      if (!quest) throw new TopicStoreError("Quest not found.", 404);
      const callerId = caller(c);
      const space = quest.sessionSpaceSlug ?? callerSpace(svc, callerId) ?? "";
      const target =
        typeof body.topic === "string"
          ? { topicId: svc.store.resolve(body.topic, space)?.id, name: body.topic }
          : { topicId: undefined, name: undefined };
      return svc.store.move(quest.questId, target, space, !!scribeLeader(svc, callerId));
    }),
  );

  api.post("/topics/changes/:changeId/undo", (c) =>
    run(c, (svc) => {
      const change = svc.store.undo(c.req.param("changeId"));
      svc.undone(change.space);
      return change;
    }),
  );

  /** The user's answer to a Scribe's rename suggestion. */
  api.post("/topics/suggestions/:id", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.accept !== "boolean") throw new TopicStoreError("Send accept: true or false.");
      return { topic: svc.store.answerSuggestion(c.req.param("id"), body.accept) };
    }),
  );

  api.post("/topics/leaders/:sessionId", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const sessionId = ctx.resolveId(c.req.param("sessionId"));
      if (!sessionId) throw new TopicStoreError(`No session ${c.req.param("sessionId")}.`, 404);
      if (typeof body.enabled !== "boolean") throw new TopicStoreError("Send enabled: true or false.");
      await svc.setLeaderEnabled(sessionId, body.enabled);
      return { enabled: svc.store.isLeaderEnabled(sessionId) };
    }),
  );

  /** The user's instructions for how a leader's Scribe groups topics; the leader may set them for the user. */
  api.post("/scribe/:leader/instructions", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const sessionId = ctx.resolveId(c.req.param("leader"));
      if (!sessionId || typeof body.text !== "string") throw new TopicStoreError("Name a leader and send text.");
      svc.store.setScribeInstructions(sessionId, body.text);
      svc.changed(sessionId);
      return { instructions: svc.store.scribeInstructions(sessionId)?.text ?? "" };
    }),
  );

  /** Pauses or resumes a leader's Scribe ("Keep pages up to date"); resuming asks it for what waited. */
  api.post("/scribe/:leader/pause", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const sessionId = ctx.resolveId(c.req.param("leader"));
      if (!sessionId) throw new TopicStoreError("Leader not found.", 404);
      svc.store.setScribePaused(sessionId, body.paused === true);
      if (body.paused !== true) svc.changed(sessionId);
      return { paused: svc.store.isScribePaused(sessionId) };
    }),
  );

  api.post("/topics/leaders/:sessionId/dismiss-hint", (c) =>
    run(c, (svc) => {
      const sessionId = ctx.resolveId(c.req.param("sessionId"));
      if (!sessionId) throw new TopicStoreError("Leader not found.", 404);
      svc.store.dismissHint(sessionId);
      return { ok: true };
    }),
  );

  api.get("/topics/:id", (c) =>
    run(c, async (svc) => {
      const detail = svc.store.detail(topicFor(svc, c, c.req.param("id")).id);
      const quests = await Promise.all(detail.questIds.map((questId) => getQuest(questId)));
      return {
        ...detail,
        quests: quests.flatMap((quest) =>
          quest ? [{ questId: quest.questId, title: quest.title, status: quest.status }] : [],
        ),
      };
    }),
  );

  /** For a Scribe: the page as it is and its leader's events since its last write, with what to link. */
  api.get("/scribe/topics/:id/changes", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const callerId = caller(c);
      const leaderId = scribeLeader(svc, callerId);
      const detail = svc.store.detail(topic.id);
      const pending = svc.store.pendingEvents(topic.id, leaderId);
      const through = Math.max(detail.upToDateAt ?? 0, ...pending.map((event) => event.at));
      served.set(`${topic.id}|${callerId ?? ""}`, {
        revision: svc.store.pageRevision(topic.id),
        through: through || Date.now(),
      });
      const quests = await Promise.all(detail.questIds.map((questId) => getQuest(questId)));
      const threads = new Set(detail.questIds);
      const artifacts = (getArtifactLibrary()?.store.list({ limit: 500 }).artifacts ?? [])
        .filter((artifact) => threads.has(artifact.threadKey))
        .slice(0, 30);
      return {
        topic: {
          id: detail.id,
          name: detail.name,
          space: detail.space,
          nameSource: detail.nameSource,
          tentative: detail.tentative,
        },
        page: detail.page,
        upToDateAt: detail.upToDateAt,
        events: pending.map(({ leaderId: _leaderId, ...event }) => ({
          ...event,
          ...(event.sessionId ? { sessionNum: ctx.launcher.getSessionNum(event.sessionId) ?? null } : {}),
        })),
        quests: quests
          .filter((quest) => !!quest)
          .map((quest) => ({ questId: quest!.questId, title: quest!.title, status: quest!.status })),
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id.slice(0, 8),
          kind: artifact.kind,
          title: artifact.title,
          versions: artifact.versionCount,
          questId: artifact.threadKey,
          updatedAt: artifact.updatedAt,
        })),
      };
    }),
  );

  /**
   * Saves a page, or with `unchanged` marks what the Scribe read through `changes` as needing no
   * change. A Scribe's write covers what it read and is refused when another Scribe saved the page
   * since, so no Scribe's work is lost. A quote that isn't in the message it links to is saved
   * anyway and reported back as a warning.
   */
  api.post("/scribe/topics/:id/page", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      const callerId = caller(c);
      const leaderId = scribeLeader(svc, callerId);
      const key = `${topic.id}|${callerId ?? ""}`;
      const read = served.get(key);
      if (body.unchanged === true) {
        if (!leaderId || !read) throw new TopicStoreError("Read the topic with `takode scribe changes` first.");
        svc.store.markCovered(topic.id, read.through, leaderId);
        served.delete(key);
        svc.pageSaved();
        return { ...svc.store.detail(topic.id), warnings: [] };
      }
      if (typeof body.markdown !== "string") throw new TopicStoreError("Send the page as markdown.");
      const detail = svc.store.writePage(topic.id, body.markdown, read?.through ?? Date.now(), {
        ...(leaderId ? { leaderId } : {}),
        ...(read ? { revision: read.revision } : {}),
      });
      served.delete(key);
      svc.pageSaved();
      return {
        ...detail,
        warnings: svc.checkQuotes(body.markdown).map((problem) => `${problem}: fix the quote or its link`),
      };
    }),
  );

  /** Renames a topic; a Scribe's rename of a topic the user named becomes a suggestion for the user. */
  api.patch("/topics/:id", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.name !== "string") throw new TopicStoreError("Send the new name.");
      const scribe = scribeLeader(svc, caller(c));
      if (scribe && topic.nameSource === "user") {
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        const suggested = svc.store.suggestRename(topic.id, body.name, scribe, reason);
        return "skipped" in suggested ? suggested : { suggested };
      }
      return svc.store.rename(topic.id, body.name, scribe ? "agent" : "user", !!scribe);
    }),
  );

  api.post("/topics/:id/merge", (c) =>
    run(c, async (svc) => {
      const from = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.into !== "string") throw new TopicStoreError("Name the topic to merge into.");
      const into = topicFor(svc, c, body.into);
      const byScribe = !!scribeLeader(svc, caller(c));
      // A Scribe isn't stopped by an error here: it is told the user undid this before, and nothing changes.
      if (byScribe && svc.store.userUndidMerge(from.id)) {
        return { skipped: `The user undid merging "${from.name}" before, so it stays its own topic.` };
      }
      return svc.store.merge(from.id, into.id, byScribe, body.fold === true ? "Folded" : "Merged");
    }),
  );

  /** Update now: ask the Scribe of the panel's leader for this topic regardless of the pause and budget. */
  api.post("/topics/:id/update", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      const leaderId = leaderFor(svc, c, typeof body.leader === "string" ? body.leader : undefined);
      if (!leaderId) throw new TopicStoreError("Name the leader whose Scribe should update it.");
      return { result: await svc.requestUpdate(leaderId, topic.id) };
    }),
  );

  return api;
}
