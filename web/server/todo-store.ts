import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  TODO_GRANT_ACTIONS,
  TODO_STATUSES,
  type TodoActor,
  type TodoCategory,
  type TodoCategoryCreateInput,
  type TodoGrant,
  type TodoGrantAction,
  type TodoItem,
  type TodoItemCreateInput,
  type TodoItemEditInput,
  type TodoItemListFilters,
  type TodoMutationProvenance,
  type TodoPrincipal,
  type TodoProposal,
  type TodoProposalMutation,
  type TodoState,
  type TodoStatus,
} from "../shared/todo-types.js";

const DEFAULT_FILE = join(homedir(), ".companion", "todos", "todo-list.json");
const INBOX_ID = "cat-inbox";
const MAX_TITLE_LENGTH = 500;
const MAX_DETAILS_LENGTH = 50_000;
const MAX_CATEGORY_NAME_LENGTH = 120;
const MAX_PROPOSALS = 1_000;

export class TodoStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid" | "not_found" | "conflict" | "unsupported_schema" | "corrupt_store",
  ) {
    super(message);
    this.name = "TodoStoreError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function bootstrapProvenance(at: number): TodoMutationProvenance {
  return {
    actor: { kind: "system", label: "Takode" },
    authorization: { kind: "bootstrap" },
    at,
  };
}

function emptyState(now = Date.now()): TodoState {
  const provenance = bootstrapProvenance(now);
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now,
    nextItemId: 1,
    nextCategoryId: 1,
    nextProposalId: 1,
    nextGrantId: 1,
    categories: [
      {
        id: INBOX_ID,
        name: "Inbox",
        createdAt: now,
        updatedAt: now,
        createdBy: provenance,
        lastModifiedBy: provenance,
      },
    ],
    items: [],
    proposals: [],
    grants: [],
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TodoStoreError(`${label} must be an object`, "corrupt_store");
  }
  return value as Record<string, unknown>;
}

function requireArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new TodoStoreError(`${label} must be an array`, "corrupt_store");
  return value as T[];
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TodoStoreError(`${label} must be a finite number`, "corrupt_store");
  }
  return value;
}

function normalizeLoadedState(value: unknown): TodoState {
  const raw = requireObject(value, "To-do store");
  if (raw.schemaVersion !== 1) {
    throw new TodoStoreError(`Unsupported to-do schema version: ${String(raw.schemaVersion)}`, "unsupported_schema");
  }

  const state = {
    schemaVersion: 1 as const,
    revision: requireFiniteNumber(raw.revision, "revision"),
    updatedAt: requireFiniteNumber(raw.updatedAt, "updatedAt"),
    nextItemId: requireFiniteNumber(raw.nextItemId, "nextItemId"),
    nextCategoryId: requireFiniteNumber(raw.nextCategoryId, "nextCategoryId"),
    nextProposalId: requireFiniteNumber(raw.nextProposalId, "nextProposalId"),
    nextGrantId: requireFiniteNumber(raw.nextGrantId, "nextGrantId"),
    categories: requireArray<TodoCategory>(raw.categories, "categories"),
    items: requireArray<TodoItem>(raw.items, "items"),
    proposals: requireArray<TodoProposal>(raw.proposals, "proposals"),
    grants: requireArray<TodoGrant>(raw.grants, "grants"),
  } satisfies TodoState;

  if (!state.categories.some((category) => category.id === INBOX_ID)) {
    throw new TodoStoreError("To-do store is missing the Inbox category", "corrupt_store");
  }
  return state;
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") throw new TodoStoreError("Title Markdown is required", "invalid");
  const title = value.trim();
  if (!title) throw new TodoStoreError("Title Markdown is required", "invalid");
  if (/\r|\n/.test(title)) throw new TodoStoreError("Title Markdown must stay on one line", "invalid");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TodoStoreError(`Title Markdown must be at most ${MAX_TITLE_LENGTH} characters`, "invalid");
  }
  return title;
}

function normalizeDetails(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new TodoStoreError("Details Markdown must be a string", "invalid");
  const details = value.trim();
  if (!details) return undefined;
  if (details.length > MAX_DETAILS_LENGTH) {
    throw new TodoStoreError(`Details Markdown must be at most ${MAX_DETAILS_LENGTH} characters`, "invalid");
  }
  return details;
}

function normalizeCategoryName(value: unknown): string {
  if (typeof value !== "string") throw new TodoStoreError("Category name is required", "invalid");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new TodoStoreError("Category name is required", "invalid");
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new TodoStoreError(`Category name must be at most ${MAX_CATEGORY_NAME_LENGTH} characters`, "invalid");
  }
  return name;
}

function normalizeStatus(value: unknown, fallback: TodoStatus = "todo"): TodoStatus {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus)) return value as TodoStatus;
  throw new TodoStoreError("Status must be todo, doing, or done", "invalid");
}

function normalizeGrantActions(value: unknown): TodoGrantAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TodoStoreError("At least one grant action is required", "invalid");
  }
  const actions = [...new Set(value.map(String))];
  for (const action of actions) {
    if (!TODO_GRANT_ACTIONS.includes(action as TodoGrantAction)) {
      throw new TodoStoreError(`Unsupported grant action: ${action}`, "invalid");
    }
  }
  return actions as TodoGrantAction[];
}

function normalizePrincipal(value: unknown): TodoPrincipal {
  const raw = requireObject(value, "Grant principal");
  const kind = raw.kind;
  if (kind !== "session" && kind !== "cron") {
    throw new TodoStoreError("Grant principal kind must be session or cron", "invalid");
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) throw new TodoStoreError("Grant principal id is required", "invalid");
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  return { kind, id, ...(label ? { label } : {}) };
}

function categoryById(state: TodoState, categoryId: string, options?: { allowArchived?: boolean }): TodoCategory {
  const category = state.categories.find((candidate) => candidate.id === categoryId);
  if (!category) throw new TodoStoreError(`Category not found: ${categoryId}`, "not_found");
  if (category.archivedAt && !options?.allowArchived) {
    throw new TodoStoreError(`Category is archived: ${categoryId}`, "conflict");
  }
  return category;
}

function itemById(state: TodoState, itemId: string): TodoItem {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new TodoStoreError(`To-do item not found: ${itemId}`, "not_found");
  return item;
}

function ensureUniqueCategoryName(state: TodoState, name: string, excludingId?: string): void {
  const key = name.toLocaleLowerCase();
  if (state.categories.some((category) => category.id !== excludingId && category.name.toLocaleLowerCase() === key)) {
    throw new TodoStoreError(`A category named "${name}" already exists`, "conflict");
  }
}

function touchState(state: TodoState, now: number): void {
  state.revision += 1;
  state.updatedAt = now;
}

function formatDateInTimeZone(epochMs: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(epochMs));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new TodoStoreError(`Invalid time zone: ${timeZone}`, "invalid");
  }
}

export function extractMarkdownLinkDestinations(markdown: string): string[] {
  const destinations = new Set<string>();
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    if (match[1]) destinations.add(match[1].replace(/^<|>$/g, ""));
  }
  const autoLinkPattern = /<(https?:\/\/[^>]+|(?:quest|session|file):[^>]+)>/g;
  for (const match of markdown.matchAll(autoLinkPattern)) {
    if (match[1]) destinations.add(match[1]);
  }
  return [...destinations];
}

export function markdownSearchText(markdown: string): string {
  const destinations = extractMarkdownLinkDestinations(markdown);
  const rendered = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${markdown} ${rendered} ${destinations.join(" ")}`.toLocaleLowerCase();
}

export function hashTodoAuthorizationContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class TodoStore {
  private state: TodoState | null = null;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private filePath = DEFAULT_FILE) {}

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          this.state = normalizeLoadedState(JSON.parse(await readFile(this.filePath, "utf-8")));
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            this.state = emptyState();
            return;
          }
          if (error instanceof TodoStoreError) throw error;
          if (error instanceof SyntaxError) {
            throw new TodoStoreError("To-do store contains invalid JSON; refusing to overwrite it", "corrupt_store");
          }
          throw error;
        }
      })().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private async persist(next: TodoState): Promise<void> {
    const path = this.filePath;
    const tempPath = `${path}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, JSON.stringify(next, null, 2), "utf-8");
    await rename(tempPath, path);
  }

  private async mutate<T>(fn: (draft: TodoState) => T): Promise<T> {
    let result!: T;
    let failure: unknown;
    this.mutationQueue = this.mutationQueue
      .then(async () => {
        await this.ensureLoaded();
        const draft = clone(this.state!);
        result = fn(draft);
        await this.persist(draft);
        this.state = draft;
      })
      .catch((error) => {
        failure = error;
      });
    await this.mutationQueue;
    if (failure) throw failure;
    return clone(result);
  }

  async snapshot(): Promise<TodoState> {
    await this.mutationQueue;
    await this.ensureLoaded();
    return clone(this.state!);
  }

  async listItems(filters: TodoItemListFilters = {}): Promise<TodoItem[]> {
    const state = await this.snapshot();
    const statuses = filters.statuses?.length ? new Set(filters.statuses) : null;
    const categories = filters.categoryIds?.length ? new Set(filters.categoryIds) : null;
    const query = filters.search?.trim().toLocaleLowerCase() || "";
    return state.items
      .filter((item) => (filters.includeArchived ? true : !item.archivedAt))
      .filter((item) => (statuses ? statuses.has(item.status) : true))
      .filter((item) => (categories ? categories.has(item.categoryId) : true))
      .filter((item) => {
        if (!filters.completedOn) return true;
        return !!item.completedAt && formatDateInTimeZone(item.completedAt, filters.timeZone) === filters.completedOn;
      })
      .filter((item) => {
        if (!query) return true;
        return markdownSearchText(`${item.titleMarkdown}\n${item.detailsMarkdown ?? ""}`).includes(query);
      })
      .sort((a, b) => {
        if (a.status === "done" && b.status === "done") return (b.completedAt ?? 0) - (a.completedAt ?? 0);
        if (a.status !== b.status) return TODO_STATUSES.indexOf(a.status) - TODO_STATUSES.indexOf(b.status);
        return b.updatedAt - a.updatedAt;
      });
  }

  async getItem(itemId: string): Promise<TodoItem> {
    const state = await this.snapshot();
    return clone(itemById(state, itemId));
  }

  async findItemsByLink(link: string, includeArchived = false): Promise<TodoItem[]> {
    const target = link.trim();
    if (!target) throw new TodoStoreError("Link is required", "invalid");
    const state = await this.snapshot();
    return state.items.filter((item) => {
      if (!includeArchived && item.archivedAt) return false;
      const links = extractMarkdownLinkDestinations(`${item.titleMarkdown}\n${item.detailsMarkdown ?? ""}`);
      return links.includes(target);
    });
  }

  async createItem(input: TodoItemCreateInput, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => this.createItemInState(state, input, provenance));
  }

  private createItemInState(
    state: TodoState,
    input: TodoItemCreateInput,
    provenance: TodoMutationProvenance,
    touch = true,
  ): TodoItem {
    const now = provenance.at;
    const categoryId = input.categoryId?.trim() || INBOX_ID;
    categoryById(state, categoryId);
    const status = normalizeStatus(input.status);
    const detailsMarkdown = normalizeDetails(input.detailsMarkdown);
    const item: TodoItem = {
      id: `td-${state.nextItemId++}`,
      titleMarkdown: normalizeTitle(input.titleMarkdown),
      ...(detailsMarkdown ? { detailsMarkdown } : {}),
      categoryId,
      status,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      ...(status === "done" ? { completedAt: now } : {}),
      createdBy: provenance,
      lastModifiedBy: provenance,
    };
    state.items.push(item);
    if (touch) touchState(state, now);
    return item;
  }

  async editItem(itemId: string, input: TodoItemEditInput, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, itemId);
      if (input.titleMarkdown !== undefined) item.titleMarkdown = normalizeTitle(input.titleMarkdown);
      if (input.detailsMarkdown !== undefined) {
        const details = normalizeDetails(input.detailsMarkdown);
        if (details) item.detailsMarkdown = details;
        else delete item.detailsMarkdown;
      }
      item.updatedAt = provenance.at;
      item.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return item;
    });
  }

  async setItemStatus(itemId: string, statusValue: unknown, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, itemId);
      const status = normalizeStatus(statusValue);
      if (item.status !== status) {
        item.status = status;
        item.statusChangedAt = provenance.at;
        if (status === "done") item.completedAt = provenance.at;
        else delete item.completedAt;
      }
      item.updatedAt = provenance.at;
      item.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return item;
    });
  }

  async moveItem(itemId: string, categoryId: string, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, itemId);
      categoryById(state, categoryId);
      item.categoryId = categoryId;
      item.updatedAt = provenance.at;
      item.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return item;
    });
  }

  async setItemArchived(itemId: string, archived: boolean, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, itemId);
      if (archived) item.archivedAt = provenance.at;
      else {
        categoryById(state, item.categoryId);
        delete item.archivedAt;
      }
      item.updatedAt = provenance.at;
      item.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return item;
    });
  }

  async createCategory(input: TodoCategoryCreateInput, provenance: TodoMutationProvenance): Promise<TodoCategory> {
    return this.mutate((state) => this.createCategoryInState(state, input, provenance));
  }

  private createCategoryInState(
    state: TodoState,
    input: TodoCategoryCreateInput,
    provenance: TodoMutationProvenance,
    touch = true,
  ): TodoCategory {
    const name = normalizeCategoryName(input.name);
    ensureUniqueCategoryName(state, name);
    const category: TodoCategory = {
      id: `cat-${state.nextCategoryId++}`,
      name,
      createdAt: provenance.at,
      updatedAt: provenance.at,
      createdBy: provenance,
      lastModifiedBy: provenance,
    };
    state.categories.push(category);
    if (touch) touchState(state, provenance.at);
    return category;
  }

  async renameCategory(
    categoryId: string,
    nameValue: unknown,
    provenance: TodoMutationProvenance,
  ): Promise<TodoCategory> {
    return this.mutate((state) => {
      const category = categoryById(state, categoryId);
      const name = normalizeCategoryName(nameValue);
      ensureUniqueCategoryName(state, name, categoryId);
      category.name = name;
      category.updatedAt = provenance.at;
      category.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return category;
    });
  }

  async archiveCategory(categoryId: string, provenance: TodoMutationProvenance): Promise<TodoCategory> {
    return this.mutate((state) => {
      if (categoryId === INBOX_ID) throw new TodoStoreError("Inbox cannot be archived", "conflict");
      const category = categoryById(state, categoryId);
      if (state.items.some((item) => item.categoryId === categoryId && !item.archivedAt)) {
        throw new TodoStoreError("Move or archive active items before archiving this category", "conflict");
      }
      category.archivedAt = provenance.at;
      category.updatedAt = provenance.at;
      category.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return category;
    });
  }

  async restoreCategory(categoryId: string, provenance: TodoMutationProvenance): Promise<TodoCategory> {
    return this.mutate((state) => {
      const category = categoryById(state, categoryId, { allowArchived: true });
      if (!category.archivedAt) return category;
      delete category.archivedAt;
      category.updatedAt = provenance.at;
      category.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return category;
    });
  }

  async createGrant(
    input: { principal: unknown; actions: unknown; categoryIds?: unknown },
    provenance: TodoMutationProvenance,
  ): Promise<TodoGrant> {
    return this.mutate((state) => {
      const principal = normalizePrincipal(input.principal);
      const actions = normalizeGrantActions(input.actions);
      let categoryIds: string[] | null = null;
      if (Array.isArray(input.categoryIds)) {
        categoryIds = [
          ...new Set(
            input.categoryIds
              .map(String)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
        for (const categoryId of categoryIds) categoryById(state, categoryId);
      } else if (input.categoryIds != null) {
        throw new TodoStoreError("Grant categoryIds must be an array or null", "invalid");
      }
      const duplicate = state.grants.find(
        (grant) => !grant.revokedAt && grant.principal.kind === principal.kind && grant.principal.id === principal.id,
      );
      if (duplicate) throw new TodoStoreError(`An active grant already exists for this ${principal.kind}`, "conflict");
      const grant: TodoGrant = {
        id: `tg-${state.nextGrantId++}`,
        principal,
        actions,
        categoryIds,
        createdAt: provenance.at,
        updatedAt: provenance.at,
        createdBy: provenance,
        lastModifiedBy: provenance,
      };
      state.grants.push(grant);
      touchState(state, provenance.at);
      return grant;
    });
  }

  async revokeGrant(grantId: string, provenance: TodoMutationProvenance): Promise<TodoGrant> {
    return this.mutate((state) => {
      const grant = state.grants.find((candidate) => candidate.id === grantId);
      if (!grant) throw new TodoStoreError(`Grant not found: ${grantId}`, "not_found");
      grant.revokedAt = provenance.at;
      grant.updatedAt = provenance.at;
      grant.lastModifiedBy = provenance;
      touchState(state, provenance.at);
      return grant;
    });
  }

  async matchingGrant(
    principals: TodoPrincipal[],
    action: TodoGrantAction,
    categoryIds: string[],
  ): Promise<TodoGrant | null> {
    const state = await this.snapshot();
    return (
      state.grants.find((grant) => {
        if (grant.revokedAt || !grant.actions.includes(action)) return false;
        if (
          !principals.some(
            (principal) => principal.kind === grant.principal.kind && principal.id === grant.principal.id,
          )
        ) {
          return false;
        }
        if (grant.categoryIds === null) return true;
        return categoryIds.every((categoryId) => grant.categoryIds!.includes(categoryId));
      }) ?? null
    );
  }

  async createProposal(mutation: TodoProposalMutation, requestedBy: TodoActor): Promise<TodoProposal> {
    return this.mutate((state) => {
      this.validateProposalMutation(state, mutation);
      const now = Date.now();
      const proposal: TodoProposal = {
        id: `tp-${state.nextProposalId++}`,
        mutation: clone(mutation),
        status: "pending",
        createdAt: now,
        updatedAt: now,
        requestedBy,
      };
      state.proposals.push(proposal);
      if (state.proposals.length > MAX_PROPOSALS) {
        const removable = state.proposals
          .filter((candidate) => candidate.status !== "pending")
          .sort((a, b) => a.updatedAt - b.updatedAt);
        while (state.proposals.length > MAX_PROPOSALS && removable.length > 0) {
          const next = removable.shift()!;
          state.proposals = state.proposals.filter((candidate) => candidate.id !== next.id);
        }
      }
      touchState(state, now);
      return proposal;
    });
  }

  private validateProposalMutation(state: TodoState, mutation: TodoProposalMutation): void {
    switch (mutation.action) {
      case "item:add":
        normalizeTitle(mutation.input.titleMarkdown);
        normalizeDetails(mutation.input.detailsMarkdown);
        categoryById(state, mutation.input.categoryId?.trim() || INBOX_ID);
        normalizeStatus(mutation.input.status);
        return;
      case "item:edit":
        itemById(state, mutation.itemId);
        if (mutation.input.titleMarkdown !== undefined) normalizeTitle(mutation.input.titleMarkdown);
        if (mutation.input.detailsMarkdown !== undefined) normalizeDetails(mutation.input.detailsMarkdown);
        return;
      case "item:status":
        itemById(state, mutation.itemId);
        normalizeStatus(mutation.status);
        return;
      case "item:move":
        itemById(state, mutation.itemId);
        categoryById(state, mutation.categoryId);
        return;
      case "item:archive":
      case "item:restore":
        itemById(state, mutation.itemId);
        return;
      case "category:create":
        normalizeCategoryName(mutation.input.name);
        return;
      case "category:rename":
        categoryById(state, mutation.categoryId);
        normalizeCategoryName(mutation.name);
        return;
      case "category:archive":
        categoryById(state, mutation.categoryId);
        return;
      case "category:restore":
        categoryById(state, mutation.categoryId, { allowArchived: true });
        return;
    }
  }

  async resolveProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    provenance: TodoMutationProvenance,
  ): Promise<{ proposal: TodoProposal; item?: TodoItem; category?: TodoCategory }> {
    return this.mutate((state) => {
      const proposal = state.proposals.find((candidate) => candidate.id === proposalId);
      if (!proposal) throw new TodoStoreError(`Proposal not found: ${proposalId}`, "not_found");
      if (proposal.status !== "pending") throw new TodoStoreError(`Proposal is already ${proposal.status}`, "conflict");
      const appliedProvenance: TodoMutationProvenance = {
        actor: proposal.requestedBy,
        authorization: { ...provenance.authorization, kind: "proposal_approval", proposalId },
        at: provenance.at,
      };
      let result: { item?: TodoItem; category?: TodoCategory } = {};
      if (decision === "approved")
        result = this.applyProposalMutationInState(state, proposal.mutation, appliedProvenance);
      proposal.status = decision;
      proposal.updatedAt = provenance.at;
      proposal.resolvedAt = provenance.at;
      proposal.resolution = provenance;
      touchState(state, provenance.at);
      return { proposal, ...result };
    });
  }

  private applyProposalMutationInState(
    state: TodoState,
    mutation: TodoProposalMutation,
    provenance: TodoMutationProvenance,
  ): { item?: TodoItem; category?: TodoCategory } {
    switch (mutation.action) {
      case "item:add":
        return { item: this.createItemInState(state, mutation.input, provenance, false) };
      case "item:edit": {
        const item = itemById(state, mutation.itemId);
        if (mutation.input.titleMarkdown !== undefined)
          item.titleMarkdown = normalizeTitle(mutation.input.titleMarkdown);
        if (mutation.input.detailsMarkdown !== undefined) {
          const details = normalizeDetails(mutation.input.detailsMarkdown);
          if (details) item.detailsMarkdown = details;
          else delete item.detailsMarkdown;
        }
        item.updatedAt = provenance.at;
        item.lastModifiedBy = provenance;
        return { item };
      }
      case "item:status": {
        const item = itemById(state, mutation.itemId);
        const status = normalizeStatus(mutation.status);
        if (item.status !== status) {
          item.status = status;
          item.statusChangedAt = provenance.at;
          if (status === "done") item.completedAt = provenance.at;
          else delete item.completedAt;
        }
        item.updatedAt = provenance.at;
        item.lastModifiedBy = provenance;
        return { item };
      }
      case "item:move": {
        const item = itemById(state, mutation.itemId);
        categoryById(state, mutation.categoryId);
        item.categoryId = mutation.categoryId;
        item.updatedAt = provenance.at;
        item.lastModifiedBy = provenance;
        return { item };
      }
      case "item:archive": {
        const item = itemById(state, mutation.itemId);
        item.archivedAt = provenance.at;
        item.updatedAt = provenance.at;
        item.lastModifiedBy = provenance;
        return { item };
      }
      case "item:restore": {
        const item = itemById(state, mutation.itemId);
        delete item.archivedAt;
        item.updatedAt = provenance.at;
        item.lastModifiedBy = provenance;
        return { item };
      }
      case "category:create":
        return { category: this.createCategoryInState(state, mutation.input, provenance, false) };
      case "category:rename": {
        const category = categoryById(state, mutation.categoryId);
        const name = normalizeCategoryName(mutation.name);
        ensureUniqueCategoryName(state, name, category.id);
        category.name = name;
        category.updatedAt = provenance.at;
        category.lastModifiedBy = provenance;
        return { category };
      }
      case "category:archive": {
        if (mutation.categoryId === INBOX_ID) throw new TodoStoreError("Inbox cannot be archived", "conflict");
        const category = categoryById(state, mutation.categoryId);
        if (state.items.some((item) => item.categoryId === category.id && !item.archivedAt)) {
          throw new TodoStoreError("Move or archive active items before archiving this category", "conflict");
        }
        category.archivedAt = provenance.at;
        category.updatedAt = provenance.at;
        category.lastModifiedBy = provenance;
        return { category };
      }
      case "category:restore": {
        const category = categoryById(state, mutation.categoryId, { allowArchived: true });
        delete category.archivedAt;
        category.updatedAt = provenance.at;
        category.lastModifiedBy = provenance;
        return { category };
      }
    }
  }

  async flushForTest(): Promise<void> {
    await this.mutationQueue;
  }
}

export const todoStore = new TodoStore();
export const TODO_INBOX_CATEGORY_ID = INBOX_ID;
