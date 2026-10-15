import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type {
  TodoCompactItem,
  TodoDueDates,
  TodoGrantAction,
  TodoItem,
  TodoItemListFilters,
  TodoLinkedQuest,
  TodoState,
  TodoProposalMutation,
  TodoProposalStatuses,
  TodoStatus,
} from "../../shared/todo-types.js";
import { TODO_STATUSES } from "../../shared/todo-types.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import * as cronStore from "../cron-store.js";
import * as questStore from "../quest-store.js";
import type { QuestmasterTask } from "../quest-types.js";
import { authorizeTodoMutation, isAdditiveTodoEdit, todoProposalActor } from "../todo-authorization.js";
import {
  resolveEditMarkdown,
  TODO_INBOX_CATEGORY_ID,
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

async function authorize(
  c: Context,
  ctx: RouteContext,
  store: TodoStore,
  body: Record<string, any>,
  action: TodoGrantAction,
  categoryIds: string[],
  { allowGrant = true, lowRisk = false }: { allowGrant?: boolean; lowRisk?: boolean } = {},
) {
  return authorizeTodoMutation(c, ctx, store, {
    action,
    categoryIds,
    authorizedBy: body.authorizedBy,
    allowGrant,
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
   * Due dates of current Todo and Doing items, for the overdue count on the To-dos button. The
   * browser decides which are overdue in the user's time zone, so the count stays right as time passes.
   */
  api.get("/todos/due-dates", async (c) => {
    try {
      const state = await store.snapshot();
      const dues = state.items.flatMap((item) =>
        item.due && item.status !== "done" && !item.archivedAt ? [item.due] : [],
      );
      return c.json({ dues, revision: state.revision } satisfies TodoDueDates);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/principals", async (c) => {
    const sessions = ctx.launcher
      .listSessions()
      .filter((session) => !session.archived && !session.hidden)
      .map((session) => ({
        kind: "session" as const,
        id: session.sessionId,
        label: `${session.sessionNum != null ? `#${session.sessionNum} ` : ""}${session.name || session.sessionId.slice(0, 8)}`,
      }));
    const jobs = (await cronStore.listJobs()).map((job) => ({ kind: "cron" as const, id: job.id, label: job.name }));
    return c.json({ principals: [...jobs, ...sessions] });
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

  api.get("/todos/proposals", async (c) => {
    try {
      const state = await store.snapshot();
      const requestedStatus = c.req.query("status");
      return c.json({
        proposals: requestedStatus
          ? state.proposals.filter((proposal) => proposal.status === requestedStatus)
          : state.proposals,
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  /** Each proposal's status alone, for the markers on `todo:tp-N` links in messages. */
  api.get("/todos/proposal-statuses", async (c) => {
    try {
      const state = await store.snapshot();
      const statuses: TodoProposalStatuses["statuses"] = {};
      for (const proposal of state.proposals) statuses[proposal.id] = proposal.status;
      return c.json({ statuses, revision: state.revision } satisfies TodoProposalStatuses);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/proposals/:id", async (c) => {
    try {
      const state = await store.snapshot();
      const proposal = state.proposals.find((candidate) => candidate.id === c.req.param("id"));
      if (!proposal) throw new TodoStoreError(`Proposal not found: ${c.req.param("id")}`, "not_found");
      return c.json({ proposal });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/grants", async (c) => {
    try {
      const state = await store.snapshot();
      const includeRevoked = c.req.query("includeRevoked") === "true";
      return c.json({
        grants: state.grants.filter((grant) => includeRevoked || !grant.revokedAt),
        revision: state.revision,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.get("/todos/grants/:id", async (c) => {
    try {
      const state = await store.snapshot();
      const grant = state.grants.find((candidate) => candidate.id === c.req.param("id"));
      if (!grant) throw new TodoStoreError(`Grant not found: ${c.req.param("id")}`, "not_found");
      return c.json({ grant });
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
      const referenceId =
        typeof body.beforeItemId === "string" && body.beforeItemId.trim()
          ? body.beforeItemId.trim()
          : typeof body.afterItemId === "string" && body.afterItemId.trim()
            ? body.afterItemId.trim()
            : "";
      const reference = referenceId ? await store.getItem(referenceId) : null;
      const categoryId =
        typeof body.categoryId === "string" && body.categoryId.trim()
          ? body.categoryId.trim()
          : (reference?.categoryId ?? TODO_INBOX_CATEGORY_ID);
      const auth = await authorize(c, ctx, store, body, "item:add", [categoryId]);
      if (!auth.ok) return auth.response;
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
              categoryId,
              status: body.status,
              due: body.due,
              beforeItemId: body.beforeItemId,
              afterItemId: body.afterItemId,
            },
            auth.provenance,
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
      const auth = await authorize(c, ctx, store, body, "item:edit", [item.categoryId], { lowRisk });
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
      const auth = await authorize(c, ctx, store, body, "item:status", [item.categoryId], {
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
      const auth = await authorize(c, ctx, store, body, "item:status", [item.categoryId], { allowGrant: false });
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
      const referenceId =
        typeof body.beforeItemId === "string" && body.beforeItemId.trim()
          ? body.beforeItemId.trim()
          : typeof body.afterItemId === "string" && body.afterItemId.trim()
            ? body.afterItemId.trim()
            : "";
      const reference = referenceId ? await store.getItem(referenceId) : null;
      const categoryId =
        typeof body.categoryId === "string" && body.categoryId.trim()
          ? body.categoryId.trim()
          : (reference?.categoryId ?? item.categoryId);
      const auth = await authorize(c, ctx, store, body, "item:move", [item.categoryId, categoryId]);
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        item: await store.moveItem(
          item.id,
          { categoryId, beforeItemId: body.beforeItemId, afterItemId: body.afterItemId },
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
      const auth = await authorize(c, ctx, store, body, "item:edit", [item.categoryId], { lowRisk });
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
      const auth = await authorize(c, ctx, store, body, "item:link", [item.categoryId], { lowRisk: true });
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

  for (const [path, archived, action] of [
    ["archive", true, "item:archive"],
    ["restore", false, "item:restore"],
  ] as const) {
    api.post(`/todos/items/:id/${path}`, async (c) => {
      try {
        const body = await requestBody(c);
        const item = await store.getItem(c.req.param("id"));
        // Archiving hides a to-do; restoring brings one back.
        const auth = await authorize(c, ctx, store, body, action, [item.categoryId], { lowRisk: !archived });
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
      const auth = await authorize(c, ctx, store, body, "category:create", []);
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
      const auth = await authorize(c, ctx, store, body, "category:rename", [categoryId]);
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
      const auth = await authorize(c, ctx, store, body, "category:archive", [categoryId]);
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
      const auth = await authorize(c, ctx, store, body, "category:restore", [categoryId], { lowRisk: true });
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        category: await store.restoreCategory(categoryId, auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/proposals", async (c) => {
    try {
      const auth = ctx.authenticateTakodeCaller(c);
      if ("response" in auth) return auth.response;
      const body = await requestBody(c);
      const mutation = body.mutation as TodoProposalMutation;
      // Other changes are low-risk enough for agents to make, or approved by the user's reply.
      if (mutation?.action !== "item:add") {
        return c.json(
          {
            error:
              "Proposals only add new to-dos. For other changes, describe the change to the user, linking the to-do, and rerun the command with --authorized-by <their reply's message index>.",
          },
          400,
        );
      }
      const proposal = await store.createProposal(mutation, todoProposalActor(auth));
      await broadcastTodoState(ctx, store);
      return c.json({ proposal, state: await store.snapshot() }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  for (const decision of ["approve", "reject", "mark-done"] as const) {
    api.post(`/todos/proposals/:id/${decision}`, async (c) => {
      try {
        const body = await requestBody(c);
        const auth = await authorize(c, ctx, store, body, "item:edit", [], { allowGrant: false });
        if (!auth.ok) return auth.response;
        return withMutation(c, ctx, store, async () =>
          store.resolveProposal(c.req.param("id"), decision, auth.provenance),
        );
      } catch (error) {
        return errorResponse(c, error);
      }
    });
  }

  api.post("/todos/grants", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, store, body, "item:edit", [], { allowGrant: false });
      if (!auth.ok) return auth.response;
      return withMutation(
        c,
        ctx,
        store,
        async () => ({
          grant: await store.createGrant(
            { principal: body.principal, actions: body.actions, categoryIds: body.categoryIds },
            auth.provenance,
          ),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  api.post("/todos/grants/:id/revoke", async (c) => {
    try {
      const body = await requestBody(c);
      const auth = await authorize(c, ctx, store, body, "item:edit", [], { allowGrant: false });
      if (!auth.ok) return auth.response;
      return withMutation(c, ctx, store, async () => ({
        grant: await store.revokeGrant(c.req.param("id"), auth.provenance),
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return api;
}
