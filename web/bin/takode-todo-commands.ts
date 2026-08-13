import type {
  TodoCategory,
  TodoCompactItem,
  TodoGrant,
  TodoGrantAction,
  TodoItem,
  TodoProposal,
  TodoProposalMutation,
  TodoState,
  TodoStateMutationResponse,
  TodoStatus,
} from "../shared/todo-types.js";
import { TODO_GRANT_ACTIONS, TODO_STATUSES } from "../shared/todo-types.js";
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

const TODO_USAGE = `Usage: takode todo <list|show|find|add|edit|status|move|archive|restore|category|propose|proposal|grant> ...`;
const BOOL_FLAGS = new Set(["json", "include-archived", "all-categories"]);

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

function authorizationBody(flags: Record<string, string | boolean>): { authorizedBy?: number } {
  const authorizedBy = parseIntegerFlag(flags, "authorized-by", "human message index");
  return authorizedBy === undefined ? {} : { authorizedBy };
}

async function readItemInput(
  flags: Record<string, string | boolean>,
  positionalTitle?: string,
  options?: { requireTitle?: boolean },
) {
  const title =
    (await readOptionalRichTextOption(flags, {
      inlineFlag: "title",
      fileFlag: "title-file",
      label: "Title Markdown",
    })) ?? positionalTitle;
  if (options?.requireTitle && !title?.trim())
    err("Title Markdown is required. Use a positional title, --title, or --title-file.");
  const details = await readOptionalRichTextOption(flags, {
    inlineFlag: "details",
    fileFlag: "details-file",
    label: "Details Markdown",
  });
  return { titleMarkdown: title?.trim(), detailsMarkdown: details?.trim() };
}

function validStatus(value: string | undefined): TodoStatus | undefined {
  if (value === undefined) return undefined;
  if (!TODO_STATUSES.includes(value as TodoStatus)) err("Status must be todo, doing, or done.");
  return value as TodoStatus;
}

function printItems(items: TodoCompactItem[]): void {
  if (items.length === 0) {
    console.log("No matching to-do items.");
    return;
  }
  for (const item of items) {
    const archived = item.archivedAt ? " archived" : "";
    console.log(
      `${item.id.padEnd(7)} [${item.status}${archived}] ${item.categoryName.padEnd(14)} ${titleText(item.titleMarkdown)}`,
    );
  }
  const counts = Object.fromEntries(
    TODO_STATUSES.map((status) => [status, items.filter((item) => item.status === status).length]),
  );
  console.log(
    `\n${items.length} item${items.length === 1 ? "" : "s"}: ${counts.todo} Todo, ${counts.doing} Doing, ${counts.done} Done`,
  );
}

function printItem(item: TodoItem, category: TodoCategory | null): void {
  console.log(`${item.id}  ${item.status.toUpperCase()}${item.archivedAt ? "  ARCHIVED" : ""}`);
  console.log(`Category: ${category?.name ?? item.categoryId} (${item.categoryId})`);
  console.log(`Title: ${item.titleMarkdown}`);
  if (item.detailsMarkdown) console.log(`Details:\n${item.detailsMarkdown}`);
  console.log(
    `Timestamps: created=${new Date(item.createdAt).toISOString()} updated=${new Date(item.updatedAt).toISOString()} statusChanged=${new Date(item.statusChangedAt).toISOString()}${item.completedAt ? ` completed=${new Date(item.completedAt).toISOString()}` : ""}${item.archivedAt ? ` archived=${new Date(item.archivedAt).toISOString()}` : ""}`,
  );
  console.log(
    `Last actor: ${item.lastModifiedBy.actor.kind}${item.lastModifiedBy.actor.label ? ` (${item.lastModifiedBy.actor.label})` : ""}`,
  );
  console.log(`Authorization: ${item.lastModifiedBy.authorization.kind}`);
  if (item.lastModifiedBy.authorization.userMessage) {
    const source = item.lastModifiedBy.authorization.userMessage;
    console.log(`Authorized by: session=${source.sessionId} message=${source.historyIndex}`);
  }
  if (item.lastModifiedBy.authorization.grantId) console.log(`Grant: ${item.lastModifiedBy.authorization.grantId}`);
  if (item.lastModifiedBy.authorization.proposalId)
    console.log(`Proposal: ${item.lastModifiedBy.authorization.proposalId}`);
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
  };
  if (jsonOutput(flags, response.item)) return;
  printItem(response.item, response.category);
}

async function handleFind(base: string, flags: Record<string, string | boolean>) {
  assertKnownFlags(
    flags,
    new Set(["link", "include-archived", "json"]),
    "Usage: takode todo find --link <url> [--include-archived] [--json]",
  );
  const link = resolveStringFlag(flags, "link", "link destination");
  if (!link) err("Usage: takode todo find --link <url> [--include-archived] [--json]");
  const params = new URLSearchParams({ link });
  if (flags["include-archived"] === true) params.set("includeArchived", "true");
  const response = (await apiGet(base, `/todos/find?${params}`)) as { items: TodoCompactItem[] };
  if (jsonOutput(flags, response.items)) return;
  printItems(response.items);
}

async function handleAdd(base: string, positionalTitle: string | undefined, flags: Record<string, string | boolean>) {
  assertKnownFlags(
    flags,
    new Set(["title", "title-file", "details", "details-file", "category", "status", "authorized-by", "json"]),
    "Usage: takode todo add [title] [--title-file <path|->] [--details-file <path|->] [--category <id|name>] [--status todo|doing|done] [--authorized-by <message-index>] [--json]",
  );
  const input = await readItemInput(flags, positionalTitle, { requireTitle: true });
  const categoryId = await resolveCategoryId(base, resolveStringFlag(flags, "category", "category"));
  const status = validStatus(resolveStringFlag(flags, "status", "status"));
  const response = (await apiPost(base, "/todos/items", {
    ...input,
    categoryId,
    ...(status ? { status } : {}),
    ...authorizationBody(flags),
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(`Added ${response.item!.id} [${response.item!.status}] ${titleText(response.item!.titleMarkdown)}`);
}

async function handleEdit(base: string, id: string | undefined, flags: Record<string, string | boolean>) {
  if (!id)
    err(
      "Usage: takode todo edit <td-id> --title-file <path|->|--details-file <path|-> [--authorized-by <message-index>] [--json]",
    );
  assertKnownFlags(
    flags,
    new Set(["title", "title-file", "details", "details-file", "authorized-by", "json"]),
    "Usage: takode todo edit <td-id> --title-file <path|->|--details-file <path|-> [--authorized-by <message-index>] [--json]",
  );
  const input = await readItemInput(flags);
  if (input.titleMarkdown === undefined && input.detailsMarkdown === undefined)
    err("Provide --title/--title-file or --details/--details-file.");
  const response = (await apiPatch(base, `/todos/items/${encodeURIComponent(id)}`, {
    ...input,
    ...authorizationBody(flags),
  })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(`Updated ${id}: ${titleText(response.item!.titleMarkdown)}`);
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
      `Usage: takode todo ${action} <td-id>${action === "status" ? " <todo|doing|done>" : action === "move" ? " <category>" : ""} [--authorized-by <message-index>] [--json]`,
    );
  assertKnownFlags(flags, new Set(["authorized-by", "json"]), TODO_USAGE);
  let path = `/todos/items/${encodeURIComponent(id)}/${action}`;
  let body: Record<string, unknown> = authorizationBody(flags);
  if (action === "status") {
    body.status = validStatus(value);
  } else if (action === "move") {
    body.categoryId = await resolveCategoryId(base, value);
  }
  const response = (await apiPost(base, path, body)) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.item)) return;
  console.log(
    `${action === "status" ? "Set" : action === "move" ? "Moved" : action === "archive" ? "Archived" : "Restored"} ${id}${action === "status" ? ` to ${response.item!.status}` : ""}.`,
  );
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
    new Set(["authorized-by", "json"]),
    "Usage: takode todo category <create|rename|archive|restore> ... [--authorized-by <message-index>] [--json]",
  );
  let response: TodoStateMutationResponse;
  if (action === "create") {
    if (!first) err("Usage: takode todo category create <name> [--authorized-by <message-index>] [--json]");
    response = (await apiPost(base, "/todos/categories", {
      name: first,
      ...authorizationBody(flags),
    })) as TodoStateMutationResponse;
  } else if (action === "rename") {
    if (!first || !second)
      err("Usage: takode todo category rename <category> <new-name> [--authorized-by <message-index>] [--json]");
    const id = await resolveCategoryId(base, first);
    response = (await apiPatch(base, `/todos/categories/${encodeURIComponent(id)}`, {
      name: second,
      ...authorizationBody(flags),
    })) as TodoStateMutationResponse;
  } else if (action === "archive" || action === "restore") {
    if (!first) err(`Usage: takode todo category ${action} <category> [--authorized-by <message-index>] [--json]`);
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

function proposalSummary(proposal: TodoProposal): string {
  const mutation = proposal.mutation;
  switch (mutation.action) {
    case "item:add":
      return `add ${titleText(mutation.input.titleMarkdown)}`;
    case "item:edit":
      return `edit ${mutation.itemId}`;
    case "item:status":
      return `set ${mutation.itemId} ${mutation.status}`;
    case "item:move":
      return `move ${mutation.itemId} to ${mutation.categoryId}`;
    case "item:archive":
    case "item:restore":
      return `${mutation.action.split(":")[1]} ${mutation.itemId}`;
    case "category:create":
      return `create category ${mutation.input.name}`;
    case "category:rename":
      return `rename ${mutation.categoryId} to ${mutation.name}`;
    case "category:archive":
      return `archive category ${mutation.categoryId}`;
    case "category:restore":
      return `restore category ${mutation.categoryId}`;
  }
}

async function buildProposalMutation(
  base: string,
  action: string,
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<TodoProposalMutation> {
  if (action === "add") {
    const input = await readItemInput(flags, args[0], { requireTitle: true });
    return {
      action: "item:add",
      input: {
        titleMarkdown: input.titleMarkdown!,
        ...(input.detailsMarkdown ? { detailsMarkdown: input.detailsMarkdown } : {}),
        categoryId: await resolveCategoryId(base, resolveStringFlag(flags, "category", "category")),
        ...(validStatus(resolveStringFlag(flags, "status", "status"))
          ? { status: validStatus(resolveStringFlag(flags, "status", "status")) }
          : {}),
      },
    };
  }
  if (action === "edit") {
    if (!args[0]) err("Usage: takode todo propose edit <td-id> --title-file|--details-file ...");
    const input = await readItemInput(flags);
    return { action: "item:edit", itemId: args[0], input };
  }
  if (action === "status") {
    if (!args[0] || !args[1]) err("Usage: takode todo propose status <td-id> <todo|doing|done>");
    return { action: "item:status", itemId: args[0], status: validStatus(args[1])! };
  }
  if (action === "move") {
    if (!args[0] || !args[1]) err("Usage: takode todo propose move <td-id> <category>");
    return { action: "item:move", itemId: args[0], categoryId: await resolveCategoryId(base, args[1]) };
  }
  if (action === "archive" || action === "restore") {
    if (!args[0]) err(`Usage: takode todo propose ${action} <td-id>`);
    return { action: action === "archive" ? "item:archive" : "item:restore", itemId: args[0] };
  }
  if (action === "category-create") {
    if (!args[0]) err("Usage: takode todo propose category-create <name>");
    return { action: "category:create", input: { name: args[0] } };
  }
  if (action === "category-rename") {
    if (!args[0] || !args[1]) err("Usage: takode todo propose category-rename <category> <new-name>");
    return { action: "category:rename", categoryId: await resolveCategoryId(base, args[0]), name: args[1] };
  }
  if (action === "category-archive" || action === "category-restore") {
    if (!args[0]) err(`Usage: takode todo propose ${action} <category>`);
    if (action === "category-archive") {
      return { action: "category:archive", categoryId: await resolveCategoryId(base, args[0]) };
    }
    const categories = ((await apiGet(base, "/todos/categories")) as { categories: TodoCategory[] }).categories;
    const category = categories.find(
      (candidate) => candidate.id === args[0] || candidate.name.toLocaleLowerCase() === args[0]!.toLocaleLowerCase(),
    );
    if (!category) err(`Category not found: ${args[0]}`);
    return { action: "category:restore", categoryId: category.id };
  }
  err(`Unknown proposal action: ${action}`);
}

async function handleProposal(
  base: string,
  args: string[],
  flags: Record<string, string | boolean>,
  directAlias = false,
) {
  const [subcommand, ...rest] = args;
  const action = directAlias ? subcommand : subcommand;
  if (!action || action === "list") {
    assertKnownFlags(flags, new Set(["json"]), "Usage: takode todo proposal list [--json]");
    const proposals = ((await apiGet(base, "/todos/proposals?status=pending")) as { proposals: TodoProposal[] })
      .proposals;
    if (jsonOutput(flags, proposals)) return;
    if (proposals.length === 0) return console.log("No pending to-do proposals.");
    for (const proposal of proposals) console.log(`${proposal.id.padEnd(7)} ${proposalSummary(proposal)}`);
    return;
  }
  if (action === "show") {
    const id = rest[0];
    if (!id) err("Usage: takode todo proposal show <tp-id> [--json]");
    assertKnownFlags(flags, new Set(["json"]), "Usage: takode todo proposal show <tp-id> [--json]");
    const proposal = ((await apiGet(base, `/todos/proposals/${encodeURIComponent(id)}`)) as { proposal: TodoProposal })
      .proposal;
    if (jsonOutput(flags, proposal)) return;
    console.log(
      `${proposal.id}  ${proposal.status}\n${proposalSummary(proposal)}\nRequested by: ${proposal.requestedBy.kind}${proposal.requestedBy.label ? ` (${proposal.requestedBy.label})` : ""}`,
    );
    return;
  }
  if (action === "approve" || action === "reject") {
    const id = rest[0];
    if (!id) err(`Usage: takode todo proposal ${action} <tp-id> [--authorized-by <message-index>] [--json]`);
    assertKnownFlags(flags, new Set(["authorized-by", "json"]), TODO_USAGE);
    const response = (await apiPost(
      base,
      `/todos/proposals/${encodeURIComponent(id)}/${action}`,
      authorizationBody(flags),
    )) as TodoStateMutationResponse;
    if (jsonOutput(flags, response.proposal)) return;
    console.log(`${action === "approve" ? "Approved" : "Rejected"} ${id}.`);
    return;
  }

  assertKnownFlags(
    flags,
    new Set(["title", "title-file", "details", "details-file", "category", "status", "json"]),
    "Usage: takode todo propose <add|edit|status|move|archive|restore|category-create|category-rename|category-archive|category-restore> ... [--json]",
  );
  const mutation = await buildProposalMutation(base, action, rest, flags);
  const response = (await apiPost(base, "/todos/proposals", { mutation })) as TodoStateMutationResponse;
  if (jsonOutput(flags, response.proposal)) return;
  console.log(`Proposed ${response.proposal!.id}: ${proposalSummary(response.proposal!)}`);
}

function grantSummary(grant: TodoGrant, categories: Map<string, TodoCategory>): string {
  const scope =
    grant.categoryIds === null
      ? "all categories"
      : grant.categoryIds.map((id) => categories.get(id)?.name ?? id).join(", ");
  return `${grant.principal.kind}:${grant.principal.id}  ${grant.actions.join(",")}  [${scope}]${grant.revokedAt ? " revoked" : ""}`;
}

async function handleGrant(base: string, args: string[], flags: Record<string, string | boolean>) {
  const [action, id] = args;
  if (!action || action === "list") {
    assertKnownFlags(
      flags,
      new Set(["json", "include-archived"]),
      "Usage: takode todo grant list [--include-archived] [--json]",
    );
    const grants = (
      (await apiGet(base, `/todos/grants${flags["include-archived"] === true ? "?includeRevoked=true" : ""}`)) as {
        grants: TodoGrant[];
      }
    ).grants;
    const categoryList = ((await apiGet(base, "/todos/categories")) as { categories: TodoCategory[] }).categories;
    if (jsonOutput(flags, grants)) return;
    if (grants.length === 0) return console.log("No active to-do workflow grants.");
    const categories = new Map(categoryList.map((category) => [category.id, category]));
    for (const grant of grants) console.log(`${grant.id.padEnd(7)} ${grantSummary(grant, categories)}`);
    return;
  }
  if (action === "show") {
    if (!id) err("Usage: takode todo grant show <tg-id> [--json]");
    assertKnownFlags(flags, new Set(["json"]), "Usage: takode todo grant show <tg-id> [--json]");
    const grant = ((await apiGet(base, `/todos/grants/${encodeURIComponent(id)}`)) as { grant: TodoGrant }).grant;
    const categoryList = ((await apiGet(base, "/todos/categories")) as { categories: TodoCategory[] }).categories;
    if (jsonOutput(flags, grant)) return;
    console.log(
      `${grant.id}\n${grantSummary(grant, new Map(categoryList.map((category) => [category.id, category])))}`,
    );
    return;
  }
  if (action === "create") {
    assertKnownFlags(
      flags,
      new Set([
        "principal-kind",
        "principal",
        "label",
        "actions",
        "categories",
        "all-categories",
        "authorized-by",
        "json",
      ]),
      TODO_USAGE,
    );
    const kind = resolveStringFlag(flags, "principal-kind", "principal kind");
    if (kind !== "session" && kind !== "cron") err("--principal-kind must be session or cron.");
    const principalId = resolveStringFlag(flags, "principal", "principal id");
    const actionsRaw = resolveStringFlag(flags, "actions", "grant actions");
    if (!principalId || !actionsRaw) err("Grant create requires --principal and --actions.");
    const actions = [
      ...new Set(
        actionsRaw
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    for (const grantAction of actions) {
      if (!TODO_GRANT_ACTIONS.includes(grantAction as TodoGrantAction)) err(`Unsupported grant action: ${grantAction}`);
    }
    if (flags["all-categories"] === true && flags.categories !== undefined)
      err("Use --all-categories or --categories, not both.");
    const categoriesRaw = resolveStringFlag(flags, "categories", "category list");
    const categoryIds =
      flags["all-categories"] === true || !categoriesRaw
        ? null
        : await Promise.all(categoriesRaw.split(",").map((entry) => resolveCategoryId(base, entry.trim())));
    const response = (await apiPost(base, "/todos/grants", {
      principal: {
        kind,
        id: principalId,
        ...(resolveStringFlag(flags, "label", "principal label")
          ? { label: resolveStringFlag(flags, "label", "principal label") }
          : {}),
      },
      actions,
      categoryIds,
      ...authorizationBody(flags),
    })) as TodoStateMutationResponse;
    if (jsonOutput(flags, response.grant)) return;
    console.log(`Created ${response.grant!.id}: ${grantSummary(response.grant!, categoryMap(response.state))}`);
    return;
  }
  if (action === "revoke") {
    if (!id) err("Usage: takode todo grant revoke <tg-id> [--authorized-by <message-index>] [--json]");
    assertKnownFlags(flags, new Set(["authorized-by", "json"]), TODO_USAGE);
    const response = (await apiPost(
      base,
      `/todos/grants/${encodeURIComponent(id)}/revoke`,
      authorizationBody(flags),
    )) as TodoStateMutationResponse;
    if (jsonOutput(flags, response.grant)) return;
    console.log(`Revoked ${id}.`);
    return;
  }
  err(`Unknown todo grant action: ${action}`);
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
    case "move":
      return simpleItemMutation(base, "move", first, second, flags);
    case "archive":
      return simpleItemMutation(base, "archive", first, undefined, flags);
    case "restore":
      return simpleItemMutation(base, "restore", first, undefined, flags);
    case "category":
      return handleCategory(
        base,
        [first, second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    case "propose":
      return handleProposal(
        base,
        [first, second, ...rest].filter((value): value is string => !!value),
        flags,
        true,
      );
    case "proposal":
      return handleProposal(
        base,
        [first, second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    case "grant":
      return handleGrant(
        base,
        [first, second, ...rest].filter((value): value is string => !!value),
        flags,
      );
    default:
      err(`Unknown todo command: ${command}\n${TODO_USAGE}`);
  }
}
