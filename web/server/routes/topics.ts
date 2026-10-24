import { Hono, type Context } from "hono";
import { getQuest, listQuests } from "../quest-store.js";
import { getArtifactLibrary } from "../artifact-library.js";
import type { TopicListResponse } from "../../shared/library-topics.js";
import { TopicStoreError } from "../topic-store.js";
import { PAGE_WRITER_GUIDE, type TopicService } from "../topic-service.js";
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
 * The Library's topics API, for the Library page, leaders (`quest create --topic`,
 * `takode topic`) and the space's page writer. Changes made by the page writer count as
 * automatic: they may not rename a topic the user named.
 */
export function createTopicRoutes(ctx: RouteContext, service: () => TopicService | null = getTopicService) {
  const api = new Hono();
  /** When a page was last read through `changes`, so writing it covers exactly what was read. */
  const servedThrough = new Map<string, number>();

  const caller = (c: Context): string | null => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    return auth && "callerId" in auth ? auth.callerId : null;
  };
  const isWriter = (svc: TopicService, callerId: string | null) => !!callerId && !!svc.store.spaceOfWriter(callerId);
  const callerSpace = (svc: TopicService, callerId: string | null): string | undefined => {
    if (!callerId) return undefined;
    return svc.store.spaceOfWriter(callerId) ?? ctx.launcher.getSession(callerId)?.memorySessionSpaceSlug;
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

  api.get("/topics", (c) =>
    run(c, async (svc): Promise<TopicListResponse> => {
      const space = c.req.query("space") ?? callerSpace(svc, caller(c));
      const scoped = space && space !== "all" ? space : undefined;
      const leaders = await svc.leaderStates();
      return {
        topics: svc.store.list(scoped),
        changes: svc.store.changes(scoped),
        leaders: scoped ? leaders.filter((leader) => leader.space === scoped) : leaders,
        spaces: [...new Set([...svc.store.spaces(), ...leaders.map((leader) => leader.space)])].sort(),
        paused: scoped ? svc.store.isPaused(scoped) : false,
        budget: scoped ? svc.budget(scoped) : { used: 0, limit: 0, overBudget: false },
      };
    }),
  );

  api.get("/topics/guide", (c) => c.json({ guide: PAGE_WRITER_GUIDE }));

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

  /** A leader's quests from a recent window, for filing them into topics. */
  api.get("/topics/leader-quests", (c) =>
    run(c, async (svc) => {
      const leader = ctx.resolveId(c.req.query("leader") ?? "");
      if (!leader) throw new TopicStoreError("Name the leader.", 404);
      const since = Number(c.req.query("since")) || Date.now() - 30 * 24 * 3600_000;
      const unfiled = c.req.query("unfiled") === "1";
      const quests = (await listQuests())
        .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leader)
        .filter((quest) => quest.createdAt >= since)
        .filter((quest) => !unfiled || !svc.store.topicOfQuest(quest.questId))
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
      const writer = isWriter(svc, callerId);
      const result = svc.store.assign({
        questId: quest.questId,
        space,
        name: body.topic,
        by: callerId ? "agent" : "user",
        byAgent: writer,
      });
      svc.schedule(space);
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
      const topic = svc.store.move(quest.questId, target, space, isWriter(svc, callerId));
      return topic;
    }),
  );

  api.post("/topics/changes/:changeId/undo", (c) =>
    run(c, (svc) => {
      const change = svc.store.undo(c.req.param("changeId"));
      svc.schedule(change.space);
      return change;
    }),
  );

  api.post("/topics/leaders/:sessionId", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const sessionId = ctx.resolveId(c.req.param("sessionId"));
      if (!sessionId || typeof body.enabled !== "boolean") throw new TopicStoreError("Name a leader and enabled.");
      await svc.setLeaderEnabled(sessionId, body.enabled);
      return { enabled: svc.store.isLeaderEnabled(sessionId) };
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

  api.post("/topics/spaces/:space/pause", (c) =>
    run(c, async (svc) => {
      const body = await c.req.json().catch(() => ({}));
      const space = decodeURIComponent(c.req.param("space"));
      svc.store.setPaused(space, body.paused === true);
      if (body.paused !== true) svc.schedule(space, 0);
      return { paused: svc.store.isPaused(space) };
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

  /** For the page writer: the page as it is and everything since, with what to link. */
  api.get("/topics/:id/changes", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const detail = svc.store.detail(topic.id);
      const pending = svc.store.pendingEvents(topic.id);
      const through = Math.max(detail.upToDateAt ?? 0, ...pending.map((event) => event.at));
      servedThrough.set(topic.id, through || Date.now());
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
        events: pending.map((event) => ({
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

  api.post("/topics/:id/page", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.markdown !== "string") throw new TopicStoreError("Send the page as markdown.");
      const detail = svc.store.writePage(topic.id, body.markdown, servedThrough.get(topic.id) ?? Date.now());
      servedThrough.delete(topic.id);
      svc.pageWritten(topic.space);
      return detail;
    }),
  );

  api.patch("/topics/:id", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.name !== "string") throw new TopicStoreError("Send the new name.");
      const writer = isWriter(svc, caller(c));
      const result = svc.store.rename(topic.id, body.name, writer ? "agent" : "user", writer);
      return result;
    }),
  );

  api.post("/topics/:id/merge", (c) =>
    run(c, async (svc) => {
      const from = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.into !== "string") throw new TopicStoreError("Name the topic to merge into.");
      const into = topicFor(svc, c, body.into);
      const result = svc.store.merge(
        from.id,
        into.id,
        isWriter(svc, caller(c)),
        body.fold === true ? "Folded" : "Merged",
      );
      return result;
    }),
  );

  /** Update now: ask the page writer for this topic regardless of the pause and budget. */
  api.post("/topics/:id/update", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      return { result: await svc.ask(topic.space, { force: true, topicId: topic.id }) };
    }),
  );

  /** The user's fix for a page goes to the page writer. */
  api.post("/topics/:id/feedback", (c) =>
    run(c, async (svc) => {
      const topic = topicFor(svc, c, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.text !== "string" || !body.text.trim()) throw new TopicStoreError("Write what to fix.");
      svc.feedback(topic.id, body.text.trim());
      return { ok: true };
    }),
  );

  return api;
}
