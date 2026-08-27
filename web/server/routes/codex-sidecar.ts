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
import { classifyQuestCommand } from "../../shared/quest-command-classification.js";
import type { MemoryRecallQuery, MemoryRepoOptions } from "../workstream-memory-types.js";
import {
  CODEX_SIDECAR_BINDING_HEADER,
  CODEX_SIDECAR_CAPABILITY_HEADER,
  normalizeCodexSidecarActor,
  type CodexSidecarActor,
  type CodexSidecarRegistry,
} from "../codex-sidecar-auth.js";
import { runCodexQuestCommand, type CodexQuestCommandRunner } from "../codex-quest-command-runner.js";
import { TodoStoreError, type TodoStore } from "../todo-store.js";
import { COMPANION_CLIENT_IP_HEADER, isLoopbackAddress } from "./auth.js";
import type { RouteContext } from "./context.js";
import { broadcastQuestUpdate } from "./quest-helpers.js";

type MemoryServiceApi = {
  recall(query?: MemoryRecallQuery, options?: MemoryRepoOptions): Promise<unknown>;
  readRecord(path: string, options?: MemoryRepoOptions): Promise<unknown>;
};

export interface CodexSidecarRouteDependencies {
  registry?: CodexSidecarRegistry;
  todoStore?: TodoStore;
  memoryService?: MemoryServiceApi;
  questCommandRunner?: CodexQuestCommandRunner;
  now?: () => number;
}

type SidecarTransport = { actor: CodexSidecarActor | null; registry: CodexSidecarRegistry };

const MAX_QUEST_COMMAND_ARGS = 256;
const MAX_QUEST_COMMAND_ARG_LENGTH = 256_000;
const MAX_QUEST_COMMAND_ARG_TOTAL = 1_000_000;
const MAX_QUEST_COMMAND_STDIN_LENGTH = 1_000_000;

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

  api.post("/integrations/codex/quest-command", async (c) => {
    const body = await authenticatedBody(c, ctx, dependencies);
    if ("response" in body) return body.response;
    if (body.actor.kind !== "codex_session") return existingQuestWorkflowResponse(c);
    try {
      const args = questCommandArgs(body.value.args);
      const stdin = questCommandStdin(body.value.stdin);
      const command = classifyQuestCommand(args);
      if (command.kind === "unknown") {
        return c.json({ error: "Unknown or unsupported Quest command" }, 400);
      }
      if (command.kind === "reassign") {
        return c.json({ error: "Direct Codex sessions cannot reassign quests; use the existing Takode workflow" }, 403);
      }
      if (
        command.kind === "mutation" &&
        command.questId &&
        !command.flatFeedbackAdd &&
        hasActiveBoardRow(ctx, command.questId)
      ) {
        return directBoardMutationResponse(c);
      }
      const result = await (dependencies.questCommandRunner ?? runCodexQuestCommand)({
        args,
        ...(stdin !== undefined ? { stdin } : {}),
        actor: body.actor,
      });
      if (result.exitCode === 0 && command.kind === "mutation") broadcastQuestUpdate(ctx.wsBridge);
      return c.json(result);
    } catch (error) {
      return sidecarError(c, error);
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

function existingQuestWorkflowResponse(c: Context): Response {
  return c.json({ error: "Takode-managed sessions must use the existing Quest workflow" }, 409);
}

function directBoardMutationResponse(c: Context): Response {
  return c.json({ error: "Direct Codex mutation is unavailable while this quest is on a Takode work board" }, 409);
}

function hasActiveBoardRow(ctx: RouteContext, questId: string): boolean {
  return ctx.launcher.listSessions().some((session) => ctx.wsBridge.getBoardRow(session.sessionId, questId) !== null);
}

function questCommandArgs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("args must be an array of strings");
  if (value.length > MAX_QUEST_COMMAND_ARGS) {
    throw new Error(`args must contain at most ${MAX_QUEST_COMMAND_ARGS} entries`);
  }
  let totalLength = 0;
  for (const arg of value) {
    if (typeof arg !== "string") throw new Error("args must be an array of strings");
    if (arg.includes("\0")) throw new Error("args cannot contain null bytes");
    if (arg.length > MAX_QUEST_COMMAND_ARG_LENGTH) {
      throw new Error(`each arg must be at most ${MAX_QUEST_COMMAND_ARG_LENGTH} characters`);
    }
    totalLength += arg.length;
  }
  if (totalLength > MAX_QUEST_COMMAND_ARG_TOTAL) {
    throw new Error(`args must contain at most ${MAX_QUEST_COMMAND_ARG_TOTAL} characters in total`);
  }
  return value;
}

function questCommandStdin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("stdin must be a string");
  if (value.length > MAX_QUEST_COMMAND_STDIN_LENGTH) {
    throw new Error(`stdin must be at most ${MAX_QUEST_COMMAND_STDIN_LENGTH} characters`);
  }
  return value;
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveLimit(raw: string | undefined, fallback: number, maximum: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
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
