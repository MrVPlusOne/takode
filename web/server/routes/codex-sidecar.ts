import { Hono, type Context } from "hono";
import type {
  TodoCompactItem,
  TodoItem,
  TodoItemListFilters,
  TodoMutationProvenance,
  TodoStatus,
} from "../../shared/todo-types.js";
import { TODO_STATUSES } from "../../shared/todo-types.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import { getQuestDisplayOwner, getQuestOwner, sameQuestOwner, type QuestOwnerRef } from "../../shared/quest-owner.js";
import type { QuestFeedbackEntry, QuestInvocationProvenance, QuestmasterTask } from "../quest-types.js";
import type { MemoryRecallQuery, MemoryRepoOptions } from "../workstream-memory-types.js";
import {
  CODEX_SIDECAR_BINDING_HEADER,
  CODEX_SIDECAR_CAPABILITY_HEADER,
  normalizeCodexSidecarActor,
  type CodexSidecarActor,
  type CodexSidecarRegistry,
} from "../codex-sidecar-auth.js";
import { TodoStoreError, type TodoStore } from "../todo-store.js";
import { COMPANION_CLIENT_IP_HEADER, isLoopbackAddress } from "./auth.js";
import type { RouteContext } from "./context.js";
import { broadcastQuestUpdate } from "./quest-helpers.js";

type QuestStoreApi = {
  listQuests(): Promise<QuestmasterTask[]>;
  getQuest(questId: string): Promise<QuestmasterTask | null>;
  createQuest(input: Record<string, unknown>): Promise<QuestmasterTask>;
  patchQuestForOwner(
    questId: string,
    owner: QuestOwnerRef,
    patch: Record<string, unknown>,
  ): Promise<QuestmasterTask | null>;
  appendQuestFeedback(
    questId: string,
    entry: QuestFeedbackEntry,
    options?: { lastModifiedBy?: QuestInvocationProvenance },
  ): Promise<QuestmasterTask | null>;
  claimQuest(questId: string, sessionId: string, options?: Record<string, unknown>): Promise<QuestmasterTask | null>;
  transitionQuest(questId: string, input: Record<string, unknown>): Promise<QuestmasterTask | null>;
  cancelQuestForOwner(
    questId: string,
    owner: QuestOwnerRef,
    notes?: string,
    options?: Record<string, unknown>,
  ): Promise<QuestmasterTask | null>;
};

type MemoryServiceApi = {
  recall(query?: MemoryRecallQuery, options?: MemoryRepoOptions): Promise<unknown>;
  readRecord(path: string, options?: MemoryRepoOptions): Promise<unknown>;
};

export interface CodexSidecarRouteDependencies {
  registry?: CodexSidecarRegistry;
  todoStore?: TodoStore;
  questStore?: QuestStoreApi;
  memoryService?: MemoryServiceApi;
  now?: () => number;
}

type SidecarTransport = { actor: CodexSidecarActor | null; registry: CodexSidecarRegistry };

/** Additive API used by the Codex plugin without changing existing Takode routes. */
export function createCodexSidecarRoutes(ctx: RouteContext, dependencies: CodexSidecarRouteDependencies = {}) {
  const api = new Hono();
  const now = dependencies.now ?? Date.now;

  api.post("/integrations/codex/bind", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    const body = await requestBody(c);
    if ("response" in body) return body.response;
    try {
      const actor = transport.actor ?? normalizeCodexSidecarActor(body.value.actor);
      if (!transport.actor && actor.kind !== "codex_session") {
        return c.json({ error: "Only verified Companion credentials can bind a Takode session identity" }, 403);
      }
      return c.json({ binding: transport.registry.bind(actor) }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  api.get("/integrations/codex/todos", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const filters: TodoItemListFilters = {
        statuses: parseTodoStatuses(c.req.query("status")),
        categoryIds: parseCsv(c.req.query("category")),
        search: c.req.query("search"),
        includeArchived: c.req.query("includeArchived") === "true",
      };
      const state = await store.snapshot();
      const items = await store.listItems(filters);
      return c.json({ items: items.map((item) => compactTodo(item, state.categories)), revision: state.revision });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/todos/:id", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const item = await store.getItem(c.req.param("id"));
      const state = await store.snapshot();
      return c.json({ item, category: state.categories.find((entry) => entry.id === item.categoryId) ?? null });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/todos", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const item = await store.createItem(
        {
          markdown: body.value.markdown as string,
          categoryId: optionalString(body.value.categoryId),
          status: optionalTodoStatus(body.value.status),
        },
        todoProvenance(body.actor, now()),
      );
      await broadcastTodoUpdate(ctx, store);
      return c.json({ item }, 201);
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.patch("/integrations/codex/todos/:id", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const item = await store.editItem(
        c.req.param("id"),
        { markdown: body.value.markdown as string },
        todoProvenance(body.actor, now()),
      );
      await broadcastTodoUpdate(ctx, store);
      return c.json({ item });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/todos/:id/status", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const item = await store.setItemStatus(
        c.req.param("id"),
        requiredTodoStatus(body.value.status),
        todoProvenance(body.actor, now()),
      );
      await broadcastTodoUpdate(ctx, store);
      return c.json({ item });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/todos/:id/archive", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    try {
      const store = await resolveTodoStore(dependencies);
      const item = await store.setItemArchived(c.req.param("id"), true, todoProvenance(body.actor, now()));
      await broadcastTodoUpdate(ctx, store);
      return c.json({ item });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/quests/search", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    try {
      const query = (c.req.query("q") ?? "").trim().toLocaleLowerCase();
      const limit = positiveLimit(c.req.query("limit"), 20, 50);
      const store = await resolveQuestStore(dependencies);
      const quests = (await store.listQuests())
        .filter((quest) => !query || searchableQuestText(quest).includes(query))
        .sort((left, right) => questTimestamp(right) - questTimestamp(left))
        .slice(0, limit)
        .map(compactQuest);
      return c.json({ quests });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/quests/:id", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    try {
      const store = await resolveQuestStore(dependencies);
      const quest = await store.getQuest(c.req.param("id"));
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      const noteLimit = optionalBoundedInteger(c.req.query("noteLimit"), 1, 20);
      const noteOffset = optionalBoundedInteger(c.req.query("noteOffset"), 0, Number.MAX_SAFE_INTEGER) ?? 0;
      return c.json({ quest: compactQuestDetail(quest, { noteOffset, noteLimit }) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/quests", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    try {
      const store = await resolveQuestStore(dependencies);
      const provenance = questProvenance(body.actor, now());
      const quest = await store.createQuest({
        title: body.value.title,
        description: optionalString(body.value.description),
        tldr: optionalString(body.value.tldr),
        tags: optionalStringArray(body.value.tags),
        status: "idea",
        createdBy: provenance,
        lastModifiedBy: provenance,
      });
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest) }, 201);
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.patch("/integrations/codex/quests/:id", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    if (hasActiveBoardRow(ctx, c.req.param("id").toLowerCase())) return directBoardMutationResponse(c);
    try {
      const patch = questContentPatch(body.value, questProvenance(body.actor, now()));
      const store = await resolveQuestStore(dependencies);
      const quest = await store.patchQuestForOwner(c.req.param("id"), actorOwner(body.actor), patch);
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/quests/:id/notes", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    try {
      const text = requiredString(body.value.text, "text", 200_000);
      const store = await resolveQuestStore(dependencies);
      const entry: QuestFeedbackEntry = {
        author: "agent",
        kind: noteKind(body.value.kind),
        text,
        ...(optionalString(body.value.tldr) ? { tldr: optionalString(body.value.tldr) } : {}),
        ts: now(),
        provenance: questProvenance(body.actor, now()),
      };
      const quest = await store.appendQuestFeedback(c.req.param("id"), entry, { lastModifiedBy: entry.provenance });
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest), note: entry }, 201);
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/quests/:id/claim", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    const questId = c.req.param("id").toLowerCase();
    if (hasActiveBoardRow(ctx, questId)) {
      return directBoardMutationResponse(c);
    }
    try {
      const store = await resolveQuestStore(dependencies);
      const quest = await store.claimQuest(questId, body.actor.sessionId, {
        ownerKind: "codex",
        provenance: questProvenance(body.actor, now()),
      });
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/quests/:id/complete", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    try {
      const store = await resolveQuestStore(dependencies);
      const current = await store.getQuest(c.req.param("id"));
      if (!current) return c.json({ error: "Quest not found" }, 404);
      const owner = actorOwner(body.actor);
      if (!sameQuestOwner(getQuestOwner(current), owner))
        return c.json({ error: "Only the current Codex owner can complete this quest" }, 409);
      const debrief = requiredString(body.value.debrief, "debrief", 200_000);
      const debriefTldr = requiredString(body.value.debriefTldr, "debriefTldr", 50_000);
      const quest = await store.transitionQuest(current.questId, {
        status: "done",
        sessionId: owner.sessionId,
        ownerKind: "codex",
        verificationItems: [],
        ...(optionalString(body.value.notes) ? { notes: optionalString(body.value.notes) } : {}),
        debrief,
        debriefTldr,
        lastModifiedBy: questProvenance(body.actor, now()),
      });
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.post("/integrations/codex/quests/:id/cancel", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    if (hasActiveBoardRow(ctx, c.req.param("id").toLowerCase())) return directBoardMutationResponse(c);
    try {
      const store = await resolveQuestStore(dependencies);
      const quest = await store.cancelQuestForOwner(
        c.req.param("id"),
        actorOwner(body.actor),
        optionalString(body.value.notes),
        { provenance: questProvenance(body.actor, now()) },
      );
      if (!quest) return c.json({ error: "Quest not found" }, 404);
      broadcastQuestUpdate(ctx.wsBridge);
      return c.json({ quest: compactQuestDetail(quest) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/memory/recall", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    try {
      const service = await resolveMemoryService(dependencies);
      return c.json(
        await service.recall(
          { query: c.req.query("q"), limit: positiveLimit(c.req.query("limit"), 10, 50), includeContent: false },
          { readOnly: true },
        ),
      );
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/memory/read", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    const path = c.req.query("path")?.trim();
    if (!path) return c.json({ error: "path query parameter is required" }, 400);
    try {
      const service = await resolveMemoryService(dependencies);
      return c.json(await service.readRecord(path, { readOnly: true }));
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  api.get("/integrations/codex/leases/:resourceKey", async (c) => {
    const transport = authorizeTransport(c, ctx, dependencies);
    if ("response" in transport) return transport.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);
    try {
      return c.json({ resource: await ctx.resourceLeaseManager.getStatus(c.req.param("resourceKey")) });
    } catch (error) {
      return sidecarError(c, error);
    }
  });

  return api;
}

function authorizeTransport(
  c: Context,
  ctx: RouteContext,
  dependencies: CodexSidecarRouteDependencies,
): SidecarTransport | { response: Response } {
  const registry = dependencies.registry ?? ctx.options?.codexSidecarRegistry;
  if (!registry) return { response: c.json({ error: "Codex sidecar is not configured" }, 503) };
  if (!isLoopbackAddress(c.req.header(COMPANION_CLIENT_IP_HEADER))) {
    return { response: c.json({ error: "Codex sidecar accepts only loopback requests" }, 403) };
  }
  if (!registry.verifyCapability(c.req.header(CODEX_SIDECAR_CAPABILITY_HEADER))) {
    return { response: c.json({ error: "Invalid Codex sidecar capability" }, 403) };
  }
  const auth = ctx.authenticateCompanionCallerOptional(c);
  if (auth && "response" in auth) return { response: auth.response };
  return {
    registry,
    actor: auth ? { kind: "takode_session", sessionId: auth.callerId } : null,
  };
}

async function authenticatedBody(
  c: Context,
  ctx: RouteContext,
  dependencies: CodexSidecarRouteDependencies,
): Promise<{ actor: CodexSidecarActor; value: Record<string, unknown> } | { response: Response }> {
  const transport = authorizeTransport(c, ctx, dependencies);
  if ("response" in transport) return transport;
  const body = await requestBody(c);
  if ("response" in body) return body;
  if (transport.actor) return { actor: transport.actor, value: body.value };
  const binding = transport.registry.resolveBinding(c.req.header(CODEX_SIDECAR_BINDING_HEADER));
  if (!binding) return { response: c.json({ error: "A current Codex sidecar binding is required" }, 401) };
  if (body.value.actor !== undefined) {
    try {
      if (!sameActor(binding.actor, normalizeCodexSidecarActor(body.value.actor))) {
        return { response: c.json({ error: "Request actor does not match the sidecar binding" }, 409) };
      }
    } catch (error) {
      return { response: c.json({ error: errorMessage(error) }, 400) };
    }
  }
  return { actor: binding.actor, value: body.value };
}

async function requestBody(c: Context): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { response: c.json({ error: "Request body must be an object" }, 400) };
    }
    return { value: value as Record<string, unknown> };
  } catch {
    return { response: c.json({ error: "Request body must be valid JSON" }, 400) };
  }
}

async function resolveTodoStore(dependencies: CodexSidecarRouteDependencies): Promise<TodoStore> {
  return dependencies.todoStore ?? (await import("../todo-store.js")).todoStore;
}

async function resolveQuestStore(dependencies: CodexSidecarRouteDependencies): Promise<QuestStoreApi> {
  return dependencies.questStore ?? ((await import("../quest-store.js")) as unknown as QuestStoreApi);
}

async function resolveMemoryService(dependencies: CodexSidecarRouteDependencies): Promise<MemoryServiceApi> {
  return dependencies.memoryService ?? (await import("../workstream-memory-service.js")).workstreamMemoryService;
}

async function broadcastTodoUpdate(ctx: RouteContext, store: TodoStore): Promise<void> {
  const state = await store.snapshot();
  ctx.wsBridge.broadcastGlobal({ type: "todo_state_updated", revision: state.revision, updatedAt: state.updatedAt });
}

function todoProvenance(actor: CodexSidecarActor, at: number): TodoMutationProvenance {
  return {
    actor: {
      kind: "session",
      provider: actor.kind === "codex_session" ? "codex" : "takode",
      sessionId: actor.sessionId,
      label: `${actor.kind === "codex_session" ? "Codex" : "Takode"} ${actor.sessionId.slice(0, 8)}`,
    },
    authorization: { kind: "agent_direct" },
    at,
  };
}

function questProvenance(actor: CodexSidecarActor, recordedAt: number): QuestInvocationProvenance {
  return {
    owner: actorOwner(actor),
    ...(actor.turnId ? { turnId: actor.turnId } : {}),
    ...(actor.toolUseId ? { toolUseId: actor.toolUseId } : {}),
    ...(actor.cwd ? { cwd: actor.cwd } : {}),
    recordedAt,
  };
}

function actorOwner(actor: CodexSidecarActor): QuestOwnerRef {
  return { kind: actor.kind === "codex_session" ? "codex" : "takode", sessionId: actor.sessionId };
}

function existingQuestWorkflowResponse(c: Context): Response {
  return c.json({ error: "Takode-managed sessions must use the existing Quest workflow" }, 409);
}

function directBoardMutationResponse(c: Context): Response {
  return c.json({ error: "Direct Codex mutation is unavailable while this quest is on a Takode work board" }, 409);
}

function hasActiveBoardRow(ctx: RouteContext, questId: string): boolean {
  return ctx.launcher.listSessions().some((session) => ctx.wsBridge.getBoardRow(session.sessionId, questId) !== null);
}

function compactTodo(item: TodoItem, categories: Array<{ id: string; name: string }>): TodoCompactItem {
  return {
    id: item.id,
    titleMarkdown: deriveTodoMarkdown(item.markdown).titleMarkdown,
    categoryId: item.categoryId,
    categoryName: categories.find((category) => category.id === item.categoryId)?.name ?? item.categoryId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    statusChangedAt: item.statusChangedAt,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
  };
}

function compactQuest(quest: QuestmasterTask) {
  const owner = getQuestOwner(quest);
  const displayOwner = getQuestDisplayOwner(quest);
  return {
    questId: quest.questId,
    title: quest.title,
    status: quest.status,
    ...(quest.tldr ? { tldr: quest.tldr } : {}),
    ...(quest.tags?.length ? { tags: quest.tags } : {}),
    ...(owner ? { owner } : {}),
    ...(!owner && displayOwner ? { lastOwner: displayOwner } : {}),
    ...(quest.status === "done" && quest.cancelled ? { cancelled: true } : {}),
    createdAt: quest.createdAt,
    updatedAt: questTimestamp(quest),
  };
}

function compactQuestDetail(quest: QuestmasterTask, notePage: { noteOffset?: number; noteLimit?: number } = {}) {
  const feedback = quest.feedback ?? [];
  const indexedFeedback = feedback.map((entry, index) => ({ ...entry, index }));
  const noteOffset = notePage.noteOffset ?? 0;
  const notes = notePage.noteLimit ? indexedFeedback.slice(noteOffset, noteOffset + notePage.noteLimit) : undefined;
  return {
    ...compactQuest(quest),
    ...(quest.createdBy ? { createdBy: quest.createdBy } : {}),
    ...(quest.lastModifiedBy ? { lastModifiedBy: quest.lastModifiedBy } : {}),
    ...(quest.sessionSpaceSlug ? { sessionSpaceSlug: quest.sessionSpaceSlug } : {}),
    ...("description" in quest && quest.description ? { description: quest.description } : {}),
    ...(quest.status === "done" && quest.debrief ? { debrief: quest.debrief } : {}),
    ...(quest.status === "done" && quest.debriefTldr ? { debriefTldr: quest.debriefTldr } : {}),
    ...(quest.status === "done" && quest.notes ? { notes: quest.notes } : {}),
    feedbackCount: feedback.length,
    latestNotes: indexedFeedback.slice(-5).map((entry) => ({
      index: entry.index,
      author: entry.author,
      kind: entry.kind ?? "comment",
      ...(entry.tldr ? { tldr: entry.tldr } : {}),
      preview: preview(entry.text, 500),
      ts: entry.ts,
      ...(entry.provenance ? { provenance: entry.provenance } : {}),
    })),
    ...(notes
      ? {
          noteEntries: notes,
          noteOffset,
          nextNoteOffset: noteOffset + notes.length < feedback.length ? noteOffset + notes.length : null,
        }
      : {}),
  };
}

function questContentPatch(body: Record<string, unknown>, lastModifiedBy: QuestInvocationProvenance) {
  const patch: Record<string, unknown> = { lastModifiedBy };
  if (body.title !== undefined) patch.title = requiredString(body.title, "title", 500);
  if (body.description !== undefined) patch.description = requiredString(body.description, "description", 200_000);
  if (body.tldr !== undefined) patch.tldr = optionalString(body.tldr) ?? "";
  if (body.tags !== undefined) patch.tags = optionalStringArray(body.tags) ?? [];
  if (Object.keys(patch).length === 1) throw new Error("At least one content field is required");
  return patch;
}

function searchableQuestText(quest: QuestmasterTask): string {
  return [
    quest.questId,
    quest.title,
    quest.tldr,
    "description" in quest ? quest.description : undefined,
    quest.status === "done" ? quest.debrief : undefined,
    ...(quest.feedback ?? []).map((entry) => `${entry.tldr ?? ""} ${entry.text}`),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();
}

function questTimestamp(quest: QuestmasterTask): number {
  return Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

function parseCsv(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries?.length ? entries : undefined;
}

function parseTodoStatuses(value: string | undefined): TodoStatus[] | undefined {
  const entries = parseCsv(value);
  if (!entries) return undefined;
  for (const entry of entries) {
    if (!TODO_STATUSES.includes(entry as TodoStatus)) throw new Error(`Unsupported status: ${entry}`);
  }
  return entries as TodoStatus[];
}

function optionalTodoStatus(value: unknown): TodoStatus | undefined {
  return value === undefined || value === null || value === "" ? undefined : requiredTodoStatus(value);
}

function requiredTodoStatus(value: unknown): TodoStatus {
  if (typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus)) return value as TodoStatus;
  throw new Error("status must be todo, doing, or done");
}

function noteKind(value: unknown): QuestFeedbackEntry["kind"] {
  if (value === undefined || value === null || value === "") return "comment";
  if (value === "comment" || value === "artifact" || value === "system") return value;
  throw new Error("kind must be comment, artifact, or system");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters`);
  return normalized;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("tags must be an array of strings");
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function positiveLimit(raw: string | undefined, fallback: number, maximum: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function optionalBoundedInteger(raw: string | undefined, minimum: number, maximum: number): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function preview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function sameActor(left: CodexSidecarActor, right: CodexSidecarActor): boolean {
  return (
    left.kind === right.kind &&
    left.sessionId === right.sessionId &&
    left.turnId === right.turnId &&
    left.toolUseId === right.toolUseId &&
    left.cwd === right.cwd
  );
}

function sidecarError(c: Context, error: unknown): Response {
  if (error instanceof TodoStoreError) {
    const status =
      error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "invalid" ? 400 : 503;
    return c.json({ error: error.message, code: error.code }, status);
  }
  const message = errorMessage(error);
  const status = /not found/i.test(message) ? 404 : /already|owner|conflict/i.test(message) ? 409 : 400;
  return c.json({ error: message }, status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
