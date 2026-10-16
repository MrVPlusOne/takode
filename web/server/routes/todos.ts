import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type {
  TodoCompactItem,
  TodoItem,
  TodoItemListFilters,
  TodoLinkedQuest,
  TodoState,
  TodoStatus,
} from "../../shared/todo-types.js";
import { TODO_STATUSES } from "../../shared/todo-types.js";
import { summarizeTodoItems } from "../../shared/todo-link.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import * as questStore from "../quest-store.js";
import type { QuestmasterTask } from "../quest-types.js";
import { authorizeTodoMutation, isAdditiveTodoEdit, MAX_CITATION_LENGTH } from "../todo-authorization.js";
import {
  resolveEditMarkdown,
  TodoStoreError,
  todoStore,
  type TodoCompletionUndoSnapshot,
  type TodoStore,
} from "../todo-store.js";
import type { RouteContext } from "./context.js";

const COMPLETION_UNDO_TTL_MS = 5 * 60 * 1_000;
const MAX_COMPLETION_UNDOS = 100;

function errorStatus(error: TodoStoreError): 400 | 404 | 409 | 503 {
  switch (error.code) {
    case "invalid":
      return 400;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "corrupt_store":
    case "unsupported_schema":
      return 503;
  }
}

function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof TodoStoreError) return c.json({ error: error.message, code: error.code }, errorStatus(error));
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ error: message }, 500);
}

type QuestLookup = Map<string, QuestmasterTask>;

/** Index quests by ID, reading the quest store only when some item links one. */
async function questLookupFor(items: TodoItem[], listQuests: () => Promise<QuestmasterTask[]>): Promise<QuestLookup> {
  if (!items.some((item) => item.questIds?.length)) return new Map();
  return new Map((await listQuests()).map((quest) => [quest.questId, quest]));
}

function linkedQuests(questIds: string[], quests: QuestLookup, withTitle: boolean): TodoLinkedQuest[] {
  return questIds.map((questId) => {
    const quest = quests.get(questId);
    if (!quest) return { questId, status: "missing" };
    const status = quest.status === "done" && quest.cancelled ? "cancelled" : quest.status;
    return { questId, status, ...(withTitle ? { title: quest.title } : {}) };
  });
}

function compactItem(item: TodoItem, state: TodoState, quests: QuestLookup): TodoCompactItem {
  return {
    id: item.id,
    titleMarkdown: deriveTodoMarkdown(item.markdown).titleMarkdown,
    categoryId: item.categoryId,
    categoryName: state.categories.find((category) => category.id === item.categoryId)?.name ?? item.categoryId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    statusChangedAt: item.statusChangedAt,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
    ...(item.due ? { due: item.due } : {}),
    ...(item.questIds?.length ? { linkedQuests: linkedQuests(item.questIds, quests, false) } : {}),
  };
}

function parseCsv(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries?.length ? entries : undefined;
}

function parseStatuses(value: string | undefined): TodoStatus[] | undefined {
  const entries = parseCsv(value);
  if (!entries) return undefined;
  for (const entry of entries) {
    if (!TODO_STATUSES.includes(entry as TodoStatus)) {
      throw new TodoStoreError(`Unsupported status: ${entry}`, "invalid");
    }
  }
  return entries as TodoStatus[];
}

async function requestBody(c: Context): Promise<Record<string, any>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TodoStoreError("Request body must be an object", "invalid");
    }
    return value;
  } catch (error) {
    if (error instanceof TodoStoreError) throw error;
    throw new TodoStoreError("Request body must be valid JSON", "invalid");
  }
}

async function broadcastTodoState(ctx: RouteContext, store: TodoStore): Promise<void> {
  const state = await store.snapshot();
  ctx.wsBridge.broadcastGlobal({ type: "todo_state_updated", revision: state.revision, updatedAt: state.updatedAt });
}

async function withMutation<T>(
  c: Context,
  ctx: RouteContext,
  store: TodoStore,
  mutate: () => Promise<T>,
  status: 200 | 201 = 200,
): Promise<Response> {
  try {
    const result = await mutate();
    await broadcastTodoState(ctx, store);
    const state = await store.snapshot();
    return c.json({ state, ...(result && typeof result === "object" ? result : {}) }, status);
  } catch (error) {
    return errorResponse(c, error);
  }
}

function authorize(c: Context, ctx: RouteContext, body: Record<string, any>, { lowRisk = false } = {}) {
  return authorizeTodoMutation(c, ctx, {
    authorizedBy: body.authorizedBy,
    standingApproval: body.standingApproval,
    lowRisk,
  });
}

export function createTodoRoutes(
  ctx: RouteContext,
  store: TodoStore = todoStore,
  listQuests: () => Promise<QuestmasterTask[]> = questStore.listQuests,
) {
  const api = new Hono();

  const compactItems = async (items: TodoItem[], state: TodoState) => {
    const quests = await questLookupFor(items, listQuests);
    return items.map((item) => compactItem(item, state, quests));
  };

  /** Linking fails for quests that do not exist; unlinking never checks, so links to deleted quests can be removed. */
  const requireQuestsExist = async (questIds: unknown) => {
    if (!Array.isArray(questIds) || questIds.length === 0) return;
    const known = new Set((await listQuests()).map((quest) => quest.questId));
    const missing = questIds.find((id) => typeof id === "string" && !known.has(id.trim()));
    if (missing !== undefined) throw new TodoStoreError(`Quest not found: ${missing}`, "not_found");
  };
  const completionUndos = new Map<string, { snapshot: TodoCompletionUndoSnapshot; expiresAt: number }>();

  const pruneCompletionUndos = (now = Date.now()) => {
    for (const [token, undo] of completionUndos) {
      if (undo.expiresAt <= now) completionUndos.delete(token);
    }
    while (completionUndos.size >= MAX_COMPLETION_UNDOS) {
      const oldest = completionUndos.keys().next().value;
      if (!oldest) break;
      completionUndos.delete(oldest);
    }
  };

  api.get("/todos", async (c) => {
    try {
      return c.json(await store.snapshot());
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  /** Every quest any to-do links, with live status and title, for the To-dos UI's quest chips. */
  api.get("/todos/linked-quests", async (c) => {
    try {
      const state = await store.snapshot();
      const quests = await questLookupFor(state.items, listQuests);
      const questIds = [...new Set(state.items.flatMap((item) => item.questIds ?? []))];
      return c.json({ quests: linkedQuests(questIds, quests, true), revision: state.revision });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  /**
   * Each to-do's status, due date and archive time alone, for the status markers on to-do links
   * and the overdue count on the To-dos button. The browser decides which are overdue in the user's
   * time zone, so markers and the count stay right as time passes.
   */
  api.get("/todos/item-summaries", async (c) => {
    try {
      return c.json(summarizeTodoItems(await store.snapshot()));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/categories", async (c) => {
    try {
      const state = await store.snapshot();
      return c.json({
        categories: state.categories.map((category) => ({
          ...category,
          activeItemCount: state.items.filter((item) => !item.archivedAt && item.categoryId === category.id).length,
        })),
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/items", async (c) => {
    try {
      const filters: TodoItemListFilters = {
        statuses: parseStatuses(c.req.query("status")),
        categoryIds: parseCsv(c.req.query("category")),
        search: c.req.query("search"),
        includeArchived: c.req.query("includeArchived") === "true",
        completedOn: c.req.query("completedOn"),
        timeZone: c.req.query("timeZone"),
      };
      const state = await store.snapshot();
      const items = await store.listItems(filters);
      return c.json({ items: await compactItems(items, state), revision: state.revision });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/find", async (c) => {
    try {
      const includeArchived = c.req.query("includeArchived") === "true";
      const questId = c.req.query("quest");
      const state = await store.snapshot();
      const items = questId
        ? await store.findItemsByQuest(questId, includeArchived)
        : await store.findItemsByLink(c.req.query("link") || "", includeArchived);
      return c.json({ items: await compactItems(items, state), revision: state.revision });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/items/:id", async (c) => {
    try {
      const item = await store.getItem(c.req.param("id"));
      const state = await store.snapshot();
      return c.json({
        item,
        category: state.categories.find((category) => category.id === item.categoryId) ?? null,
        linkedQuests: linkedQuests(item.questIds ?? [], await questLookupFor([item], listQuests), true),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items", async (c) => {
    try {
      const body = await requestBody(c);
      // Adding cannot make the user lose track of anything, so agents may add on their own judgment,
      // but must say where the to-do came from.
      const auth = await authorize(c, ctx, body, { lowRisk: true });
      if (!auth.ok) return auth.response;
      const source = typeof body.source === "string" ? body.source.trim() : "";
      if (source.length > MAX_CITATION_LENGTH) {
        return c.json({ error: `--source must be at most ${MAX_CITATION_LENGTH} characters` }, 400);
      }
      if (!source && auth.provenance.authorization.kind === "agent_direct") {
        return c.json(
          {
            error:
              "Say where this to-do came from with --source (e.g. the Slack thread or message), so the user can see why it was added.",
          },
          400,
        );
      }
      const provenance = source ? { ...auth.provenance, source } : auth.provenance;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          item: await store.createItem(
            {
              markdown: body.markdown,
              titleMarkdown: body.titleMarkdown,
              ...(Object.prototype.hasOwnProperty.call(body, "detailsMarkdown")
                ? { detailsMarkdown: body.detailsMarkdown }
                : {}),
              categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
              status: body.status,
              due: body.due,
              beforeItemId: body.beforeItemId,
              afterItemId: body.afterItemId,
            },
            provenance,
          ),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.patch("/todos/items/:id", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const lowRisk = isAdditiveTodoEdit(item.markdown, resolveEditMarkdown(item.markdown, body));
      const auth = await authorize(c, ctx, body, { lowRisk });
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.editItem(
          item.id,
          {
            markdown: body.markdown,
            titleMarkdown: body.titleMarkdown,
            ...(Object.prototype.hasOwnProperty.call(body, "detailsMarkdown")
              ? { detailsMarkdown: body.detailsMarkdown }
              : {}),
          },
          auth.provenance,
        ),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/status", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      // Marking a to-do Done drops it from the active list; starting or reopening one does not.
      const auth = await authorize(c, ctx, body, {
        lowRisk: body.status !== "done",
      });
      if (!auth.ok) return auth.response;
      const result = await store.setItemStatusWithCompletionUndo(item.id, body.status, auth.provenance);
      let completionUndo;
      if (result.undo && auth.provenance.authorization.kind === "ui") {
        const now = Date.now();
        pruneCompletionUndos(now);
        const token = randomUUID();
        const expiresAt = now + COMPLETION_UNDO_TTL_MS;
        completionUndos.set(token, { snapshot: result.undo, expiresAt });
        completionUndo = { token, itemId: item.id, expiresAt };
      }
      await broadcastTodoState(ctx, store);
      return c.json({
        state: await store.snapshot(),
        item: result.item,
        ...(completionUndo ? { completionUndo } : {}),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/completion-undo", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const auth = await authorize(c, ctx, body);
      if (!auth.ok) return auth.response;
      if (auth.provenance.authorization.kind !== "ui") {
        return c.json(
          { error: "Immediate completion Undo is available only for the browser action that created it" },
          403,
        );
      }
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const now = Date.now();
      pruneCompletionUndos(now);
      const undo = token ? completionUndos.get(token) : undefined;
      if (!undo || undo.snapshot.itemId !== item.id || undo.expiresAt <= now) {
        return c.json({ error: "This completion can no longer be undone; refresh to see the current item" }, 409);
      }
      const restored = await store.undoItemCompletion(undo.snapshot, auth.provenance);
      completionUndos.delete(token);
      await broadcastTodoState(ctx, store);
      return c.json({ state: await store.snapshot(), item: restored });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/move", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const auth = await authorize(c, ctx, body);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.moveItem(
          item.id,
          {
            categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
            beforeItemId: body.beforeItemId,
            afterItemId: body.afterItemId,
          },
          auth.provenance,
        ),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/due", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      // Giving a to-do its first due date only adds; changing or clearing one could lose a deadline.
      const lowRisk = !item.due && typeof body.due === "string" && !!body.due;
      const auth = await authorize(c, ctx, body, { lowRisk });
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.setItemDue(item.id, body.due ?? null, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/items/:id/links", async (c) => {
    try {
      const body = await requestBody(c);
      const item = await store.getItem(c.req.param("id"));
      const auth = await authorize(c, ctx, body, { lowRisk: true });
      if (!auth.ok) return auth.response;
      await requireQuestsExist(body.addQuestIds);
      return withMutation(c, ctx, store, async () => ({
        item: await store.linkItemQuests(
          item.id,
          { addQuestIds: body.addQuestIds, removeQuestIds: body.removeQuestIds },
          auth.provenance,
        ),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  for (const [path, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    api.post(`/todos/items/:id/${path}`, async (c) => {
      try {
        const body = await requestBody(c);
        const item = await store.getItem(c.req.param("id"));
        // Archiving hides a to-do; restoring brings one back.
        const auth = await authorize(c, ctx, body, { lowRisk: !archived });
        if (!auth.ok) return auth.response;
        return withMutation(c, ctx, store, async () => ({
          item: await store.setItemArchived(item.id, archived, auth.provenance),
        }));
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  api.post("/todos/categories", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, body);
      if (!auth.ok) return auth.response;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          category: await store.createCategory({ name: body.name }, auth.provenance),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.patch("/todos/categories/:id", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, body);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.renameCategory(categoryId, body.name, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/categories/:id/archive", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, body);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.archiveCategory(categoryId, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/categories/:id/restore", async (c) => {
    try {
      const body = await requestBody(c);
      const categoryId = c.req.param("id");
      const auth = await authorize(c, ctx, body, { lowRisk: true });
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.restoreCategory(categoryId, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return api;
}
