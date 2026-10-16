import type {
  TodoActor,
  TodoCategory,
  TodoCompactItem,
  TodoItem,
  TodoLinkedQuest,
  TodoState,
  TodoStateMutationResponse,
  TodoStatus,
} from "../shared/todo-types.js";
import { TODO_STATUSES } from "../shared/todo-types.js";
import { formatTodoMarkdownLink } from "../shared/todo-link.js";
import { isTodoOverdue, isValidTodoDue } from "../shared/todo-due.js";
import {
  apiGet,
  apiPatch,
  apiPost,
  assertKnownFlags,
  err,
  parseIntegerFlag,
  readOptionalRichTextOption,
  resolveStringFlag,
} from "./takode-core.js";

const TODO_USAGE = `Usage: takode todo <list|show|find|add|edit|status|due|move|archive|restore|link|unlink|category> ...`;
const DUE_USAGE =
  "Usage: takode todo due <td-id> (<YYYY-MM-DD> [HH:MM] | clear) [--authorized-by <message-index> | --standing-approval <citation>] [--json]";
const BOOL_FLAGS = new Set(["json", "include-archived"]);

function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (BOOL_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { positionals, flags };
}

function jsonOutput(flags: Record<string, string | boolean>, value: unknown): boolean {
  if (flags.json !== true) return false;
  console.log(JSON.stringify(value, null, 2));
  return true;
}

function titleText(markdown: string, limit = 80): string {
  const plain = markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}

function derivedTitle(markdown: string): string {
  return (
    markdown
      .split(/\r\n|\n|\r/)
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function categoryMap(state: TodoState): Map<string, TodoCategory> {
  return new Map(state.categories.map((category) => [category.id, category]));
}

async function resolveCategoryId(base: string, raw: string | undefined): Promise<string> {
  if (!raw) return "cat-inbox";
  const response = (await apiGet(base, "/todos/categories")) as {
    categories: Array<TodoCategory & { activeItemCount: number }>;
  };
  const exact = response.categories.find((category) => !category.archivedAt && category.id === raw);
  if (exact) return exact.id;
  const byName = response.categories.filter(
    (category) => !category.archivedAt && category.name.toLocaleLowerCase() === raw.toLocaleLowerCase(),
  );
  if (byName.length === 1) return byName[0]!.id;
  if (byName.length > 1) err(`Category name is ambiguous: ${raw}. Use a category id.`);
  err(`Category not found: ${raw}`);
}

function authorizationBody(flags: Record<string, string | boolean>): {
  authorizedBy?: number;
  standingApproval?: string;
} {
  const authorizedBy = parseIntegerFlag(flags, "authorized-by", "human message index");
  const standingApproval = resolveStringFlag(flags, "standing-approval", "standing approval citation");
  return {
    ...(authorizedBy === undefined ? {} : { authorizedBy }),
    ...(standingApproval === undefined ? {} : { standingApproval }),
  };
}

async function readItemInput(
  flags: Record<string, string | boolean>,
  positionalMarkdown?: string,
  options?: { requireMarkdown?: boolean },
) {
  const markdownOption = await readOptionalRichTextOption(flags, {
    inlineFlag: "markdown",
    fileFlag: "markdown-file",
    label: "Markdown",
  });
  const title = await readOptionalRichTextOption(flags, {
    inlineFlag: "title",
    fileFlag: "title-file",
    label: "Title Markdown",
  });
  const details = await readOptionalRichTextOption(flags, {
    inlineFlag: "details",
    fileFlag: "details-file",
    label: "Details Markdown",
  });
  const markdown = markdownOption ?? positionalMarkdown;
  if (markdown !== undefined && (title !== undefined || details !== undefined)) {
    err("Use --markdown/--markdown-file or legacy --title/--details inputs, not both.");
  }
  if (markdown !== undefined) {
    if (!markdown.trim()) err("Markdown needs a non-empty title line.");
    return { markdown };
  }
  if (options?.requireMarkdown && !title?.trim()) {
    err("Markdown is required. Use positional Markdown, --markdown, --markdown-file, or legacy --title/--title-file.");
  }
  return {
    ...(title !== undefined ? { titleMarkdown: title.trim() } : {}),
    ...(details !== undefined ? { detailsMarkdown: details.trim() } : {}),
  };
}

function validStatus(value: string | undefined): TodoStatus | undefined {
  if (value === undefined) return undefined;
  if (!TODO_STATUSES.includes(value as TodoStatus)) err("Status must be todo, doing, or done.");
  return value as TodoStatus;
}

/** A due date from `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`, in the user's local time. */
function parseDue(date: string, time?: string): string {
  const due = time ? `${date}T${time}` : date.replace(" ", "T");
  if (!isValidTodoDue(due)) {
    err(`Due must be YYYY-MM-DD with an optional HH:MM time, got: ${time ? `${date} ${time}` : date}`);
  }
  return due;
}

function dueFlag(flags: Record<string, string | boolean>): { due?: string } {
  const value = resolveStringFlag(flags, "due", "due date");
  return value ? { due: parseDue(value) } : {};
}

/** Due date for text output, in the user's local time. */
function dueText(item: Pick<TodoItem, "due" | "status" | "archivedAt">): string {
  if (!item.due) return "";
  return `${item.due.replace("T", " ")}${isTodoOverdue(item) ? " OVERDUE" : ""}`;
}

/** Quest IDs from positional arguments, each of which may be a comma-separated list. */
function questIdArgs(values: string[]): string[] {
  return values.flatMap((value) => value.split(",").map((entry) => entry.trim())).filter(Boolean);
}

function printItems(items: TodoCompactItem[]): void {
  if (items.length === 0) {
    console.log("No matching to-do items.");
    return;
  }
  for (const item of items) {
    const archived = item.archivedAt ? " archived" : "";
    const quests = item.linkedQuests?.length
      ? `  ↳ ${item.linkedQuests.map((quest) => `${quest.questId} ${quest.status}`).join(", ")}`
      : "";
    const due = item.due ? `  (due ${dueText(item)})` : "";
    console.log(
      `${item.id.padEnd(7)} [${item.status}${archived}] ${item.categoryName.padEnd(14)} ${titleText(item.titleMarkdown)}${due}${quests}`,
    );
  }
  const counts = Object.fromEntries(
    TODO_STATUSES.map((status) => [status, items.filter((item) => item.status === status).length]),
  );
  console.log(
    `\n${items.length} item${items.length === 1 ? "" : "s"}: ${counts.todo} Todo, ${counts.doing} Doing, ${counts.done} Done`,
  );
}

/** A ready-to-paste `[title](todo:td-N)` link, so agents can point the user at the to-do's preview. */
function itemLink(item: TodoItem): string {
  return `Link: ${formatTodoMarkdownLink(item.id, titleText(derivedTitle(item.markdown)))}`;
}

function printItem(item: TodoItem, category: TodoCategory | null, quests: TodoLinkedQuest[]): void {
  console.log(`${item.id}  ${item.status.toUpperCase()}${item.archivedAt ? "  ARCHIVED" : ""}`);
  console.log(itemLink(item));
  console.log(`Category: ${category?.name ?? item.categoryId} (${item.categoryId})`);
  if (item.due) console.log(`Due: ${dueText(item)} (local time)`);
  if (quests.length) {
    console.log("Linked quests:");
    for (const quest of quests)
      console.log(`  ${quest.questId} [${quest.status}]${quest.title ? ` ${quest.title}` : ""}`);
  }
  console.log(`Rank: ${item.rank}`);
  console.log(`Markdown:
${item.markdown}`);
  console.log(
    `Timestamps: created=${new Date(item.createdAt).toISOString()} updated=${new Date(item.updatedAt).toISOString()} statusChanged=${new Date(item.statusChangedAt).toISOString()}${item.completedAt ? ` completed=${new Date(item.completedAt).toISOString()}` : ""}${item.archivedAt ? ` archived=${new Date(item.archivedAt).toISOString()}` : ""}`,
  );
  const added = item.createdBy;
  console.log(`Added by: ${actorText(added.actor)}${added.source ? `, from ${added.source}` : ""}`);
  const last = item.lastModifiedBy;
  console.log(`Last change: ${actorText(last.actor)}, ${last.authorization.kind.replace(/_/g, " ")}`);
  if (last.authorization.userMessage) {
    const message = last.authorization.userMessage;
    console.log(`Authorized by: session=${message.sessionId} message=${message.historyIndex}`);
  }
  if (last.authorization.standingApproval) console.log(`Standing approval: ${last.authorization.standingApproval}`);
}

function actorText(actor: TodoActor): string {
  return `${actor.kind}${actor.label ? ` (${actor.label})` : ""}`;
}

async function handleList(base: string, flags: Record<string, string | boolean>) {
  assertKnownFlags(
    flags,
    new Set(["status", "category", "search", "completed-on", "timezone", "include-archived", "json"]),
    "Usage: takode todo list [--status todo,doing,done] [--category <id|name>] [--search <text>] [--completed-on YYYY-MM-DD] [--timezone <IANA>] [--include-archived] [--json]",
  );
  const params = new URLSearchParams();
  const status = resolveStringFlag(flags, "status", "status list");
  if (status) {
    for (const entry of status.split(",")) validStatus(entry.trim());
    params.set("status", status);
  }
  const category = resolveStringFlag(flags, "category", "category");
  if (category) params.set("category", await resolveCategoryId(base, category));
  const search = resolveStringFlag(flags, "search", "search text");
  if (search) params.set("search", search);
  const completedOn = resolveStringFlag(flags, "completed-on", "completion date");
  if (completedOn) params.set("completedOn", completedOn);
  const timeZone = resolveStringFlag(flags, "timezone", "IANA time zone");
  if (timeZone) params.set("timeZone", timeZone);
  if (flags["include-archived"] === true) params.set("includeArchived", "true");
  const response = (await apiGet(base, `/todos/items${params.size ? `?${params}` : ""}`)) as {
    items: TodoCompactItem[];
  };
  if (jsonOutput(flags, response.items)) return;
  printItems(response.items);
}

async function handleShow(base: string, id: string | undefined, flags: Record<string, string | boolean>) {
  if (!id) err("Usage: takode todo show <td-id> [--json]");
  assertKnownFlags(flags, new Set(["json"]), "Usage: takode todo show <td-id> [--json]");
  const response = (await apiGet(base, `/todos/items/${encodeURIComponent(id)}`)) as {
    item: TodoItem;
    category: TodoCategory | null;
    linkedQuests?: TodoLinkedQuest[];
  };
  if (jsonOutput(flags, response.item)) return;
  printItem(response.item, response.category, response.linkedQuests ?? []);
}

async function handleFind(base: string, flags: Record<string, string | boolean>) {
  const usage = "Usage: takode todo find (--link <url> | --quest <q-id>) [--include-archived] [--json]";
  assertKnownFlags(flags, new Set(["link", "quest", "include-archived", "json"]), usage);
  const link = resolveStringFlag(flags, "link", "link destination");
  const quest = resolveStringFlag(flags, "quest", "quest ID");
  if (!link === !quest) err(usage);
  const params = new URLSearchParams(quest ? { quest } : { link: link! });
  if (flags["include-archived"] === true) params.set("includeArchived", "true");
  const response = (await apiGet(base, `/todos/find?${params}`)) as { items: TodoCompactItem[] };
  if (jsonOutput(flags, response.items)) return;
  printItems(response.items);
}

async function handleAdd(
  base: string,
  positionalMarkdown: string | undefined,
  flags: Record<string, string | boolean>,
) {
  assertKnownFlags(
    flags,
    new Set([
      "markdown",
      "markdown-file",
      "title",
      "title-file",
      "details",
      "details-file",
      "category",
      "status",
      "due",
      "before",
      "after",
      "source",
      "authorized-by",
      "json",
    ]),
    "Usage: takode todo add [markdown] [--markdown-file <path|->] [--source <where it came from>] [--category <id|name>] [--status todo|doing|done] [--due <YYYY-MM-DD[THH:MM]>] [--before <td-id>|--after <td-id>] [--authorized-by <message-index>] [--json]",
  );
  const input = await readItemInput(flags, positionalMarkdown, { requireMarkdown: true });
  const category = resolveStringFlag(flags, "category", "category");
  const categoryId = category ? await resolveCategoryId(base, category) : undefined;
  const status = validStatus(resolveStringFlag(flags, "status", "status"));
  const beforeItemId = resolveStringFlag(flags, "before", "before item id");
  const afterItemId = resolveStringFlag(flags, "after", "after item id");
  if (beforeItemId && afterItemId) err("Use --before or --after, not both.");
  const source = resolveStringFlag(flags, "source", "where the to-do came from");
  const response = (await apiPost(base, "/todos/items", {
    ...input,
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
    ...dueFlag(flags),
    ...(beforeItemId ? { beforeItemId } : {}),
    ...(afterItemId ? { afterItemId } : {}),
    ...(source ? { source } : {}),
    ...authorizationBody(flags),
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(
    `Added ${response.item!.id} [${response.item!.status}] ${titleText(derivedTitle(response.item!.markdown))}\n${itemLink(response.item!)}`,
  );
}

async function handleEdit(base: string, id: string | undefined, flags: Record<string, string | boolean>) {
  if (!id)
    err(
      "Usage: takode todo edit <td-id> (--markdown <text> | --markdown-file <path|->) [--authorized-by <message-index> | --standing-approval <citation>] [--json]",
    );
  assertKnownFlags(
    flags,
    new Set([
      "markdown",
      "markdown-file",
      "title",
      "title-file",
      "details",
      "details-file",
      "authorized-by",
      "standing-approval",
      "json",
    ]),
    "Usage: takode todo edit <td-id> (--markdown <text> | --markdown-file <path|->) [--authorized-by <message-index> | --standing-approval <citation>] [--json]",
  );
  const input = await readItemInput(flags);
  if (Object.keys(input).length === 0) err("Provide --markdown/--markdown-file or a legacy --title/--details input.");
  const response = (await apiPatch(base, `/todos/items/${encodeURIComponent(id)}`, {
    ...input,
    ...authorizationBody(flags),
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(`Updated ${id}: ${titleText(derivedTitle(response.item!.markdown))}`);
}

async function simpleItemMutation(
  base: string,
  action: "status" | "move" | "archive" | "restore",
  id: string | undefined,
  value: string | undefined,
  flags: Record<string, string | boolean>,
) {
  if (!id)
    err(
      `Usage: takode todo ${action} <td-id>${action === "status" ? " <todo|doing|done>" : action === "move" ? " [category] [--before <td-id>|--after <td-id>]" : ""} [--authorized-by <message-index> | --standing-approval <citation>] [--json]`,
    );
  assertKnownFlags(
    flags,
    action === "move"
      ? new Set(["before", "after", "authorized-by", "standing-approval", "json"])
      : new Set(["authorized-by", "standing-approval", "json"]),
    TODO_USAGE,
  );
  const path = `/todos/items/${encodeURIComponent(id)}/${action}`;
  const body: Record<string, unknown> = authorizationBody(flags);
  if (action === "status") {
    body.status = validStatus(value);
  } else if (action === "move") {
    const beforeItemId = resolveStringFlag(flags, "before", "before item id");
    const afterItemId = resolveStringFlag(flags, "after", "after item id");
    if (beforeItemId && afterItemId) err("Use --before or --after, not both.");
    if (!value && !beforeItemId && !afterItemId) err("Move requires a category, --before, or --after.");
    if (value) body.categoryId = await resolveCategoryId(base, value);
    if (beforeItemId) body.beforeItemId = beforeItemId;
    if (afterItemId) body.afterItemId = afterItemId;
  }
  const response = (await apiPost(base, path, body)) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(
    `${action === "status" ? "Set" : action === "move" ? "Moved" : action === "archive" ? "Archived" : "Restored"} ${id}${action === "status" ? ` to ${response.item!.status}` : ""}.`,
  );
}

async function handleDue(
  base: string,
  id: string | undefined,
  values: string[],
  flags: Record<string, string | boolean>,
) {
  const [date, time] = values;
  if (!id || !date || values.length > 2) err(DUE_USAGE);
  assertKnownFlags(flags, new Set(["authorized-by", "standing-approval", "json"]), DUE_USAGE);
  const clear = date === "clear" && !time;
  const response = (await apiPost(base, `/todos/items/${encodeURIComponent(id)}/due`, {
    due: clear ? null : parseDue(date, time),
    ...authorizationBody(flags),
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(response.item!.due ? `Set ${id} due ${dueText(response.item!)}.` : `Cleared the due date of ${id}.`);
}

async function handleLink(
  base: string,
  action: "link" | "unlink",
  id: string | undefined,
  questArgs: string[],
  flags: Record<string, string | boolean>,
) {
  const usage = `Usage: takode todo ${action} <td-id> <q-id>... [--json]`;
  const questIds = questIdArgs(questArgs);
  if (!id || questIds.length === 0) err(usage);
  assertKnownFlags(flags, new Set(["json"]), usage);
  const response = (await apiPost(base, `/todos/items/${encodeURIComponent(id)}/links`, {
    [action === "link" ? "addQuestIds" : "removeQuestIds"]: questIds,
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  const linked = response.item!.questIds ?? [];
  console.log(`${action === "link" ? "Linked" : "Unlinked"} ${id}. Linked quests: ${linked.join(", ") || "none"}.`);
}

async function handleCategory(base: string, args: string[], flags: Record<string, string | boolean>) {
  const [action, first, second] = args;
  if (!action || action === "list") {
    assertKnownFlags(
      flags,
      new Set(["json", "include-archived"]),
      "Usage: takode todo category list [--include-archived] [--json]",
    );
    const result = (await apiGet(base, "/todos/categories")) as {
      categories: Array<TodoCategory & { activeItemCount: number }>;
    };
    const categories = result.categories.filter(
      (category) => flags["include-archived"] === true || !category.archivedAt,
    );
    if (jsonOutput(flags, categories)) return;
    for (const category of categories) {
      console.log(
        `${category.id.padEnd(12)} ${String(category.activeItemCount).padStart(3)}  ${category.name}${category.archivedAt ? " (archived)" : ""}`,
      );
    }
    return;
  }
  assertKnownFlags(
    flags,
    new Set(["authorized-by", "standing-approval", "json"]),
    "Usage: takode todo category <create|rename|archive|restore> ... [--authorized-by <message-index> | --standing-approval <citation>] [--json]",
  );
  let response: TodoStateMutationResponse;
  if (action === "create") {
    if (!first)
      err(
        "Usage: takode todo category create <name> [--authorized-by <message-index> | --standing-approval <citation>] [--json]",
      );
    response = (await apiPost(base, "/todos/categories", {
      name: first,
      ...authorizationBody(flags),
    })) as TodoStateMutationResponse;
  } else if (action === "rename") {
    if (!first || !second)
      err(
        "Usage: takode todo category rename <category> <new-name> [--authorized-by <message-index> | --standing-approval <citation>] [--json]",
      );
    const id = await resolveCategoryId(base, first);
    response = (await apiPatch(base, `/todos/categories/${encodeURIComponent(id)}`, {
      name: second,
      ...authorizationBody(flags),
    })) as TodoStateMutationResponse;
  } else if (action === "archive" || action === "restore") {
    if (!first)
      err(
        `Usage: takode todo category ${action} <category> [--authorized-by <message-index> | --standing-approval <citation>] [--json]`,
      );
    let id: string;
    if (action === "restore") {
      const categories = ((await apiGet(base, "/todos/categories")) as { categories: TodoCategory[] }).categories;
      const category = categories.find(
        (candidate) => candidate.id === first || candidate.name.toLocaleLowerCase() === first.toLocaleLowerCase(),
      );
      if (!category) err(`Category not found: ${first}`);
      id = category.id;
    } else {
      id = await resolveCategoryId(base, first);
    }
    response = (await apiPost(
      base,
      `/todos/categories/${encodeURIComponent(id)}/${action}`,
      authorizationBody(flags),
    )) as TodoStateMutationResponse;
  } else {
    err(`Unknown todo category action: ${action}`);
  }
  if (jsonOutput(flags, response!.category)) return;
  console.log(
    `${response!.category!.id}: ${response!.category!.name}${response!.category!.archivedAt ? " (archived)" : ""}`,
  );
}

export async function handleTodo(base: string, rawArgs: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(rawArgs);
  const [command, first, second, ...rest] = positionals;
  if (!command) err(TODO_USAGE);
  switch (command) {
    case "list":
      return handleList(base, flags);
    case "show":
      return handleShow(base, first, flags);
    case "find":
      return handleFind(base, flags);
    case "add":
      return handleAdd(base, first, flags);
    case "edit":
      return handleEdit(base, first, flags);
    case "status":
      return simpleItemMutation(base, "status", first, second, flags);
    case "due":
      return handleDue(
        base,
        first,
        [second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    case "move":
      return simpleItemMutation(base, "move", first, second, flags);
    case "archive":
      return simpleItemMutation(base, "archive", first, undefined, flags);
    case "restore":
      return simpleItemMutation(base, "restore", first, undefined, flags);
    case "link":
    case "unlink":
      return handleLink(
        base,
        command,
        first,
        [second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    case "category":
      return handleCategory(
        base,
        [first, second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    default:
      err(`Unknown todo command: ${command}\n${TODO_USAGE}`);
  }
}
