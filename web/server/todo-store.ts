import { createHash } from "node:crypto";
import { constants, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  TODO_STATUSES,
  type TodoCategory,
  type TodoCategoryCreateInput,
  type TodoItem,
  type TodoItemCreateInput,
  type TodoItemEditInput,
  type TodoItemLinkInput,
  type TodoItemListFilters,
  type TodoItemMoveInput,
  type TodoMutationProvenance,
  type TodoState,
  type TodoStatus,
} from "../shared/todo-types.js";
import { combineLegacyTodoMarkdown, deriveTodoMarkdown, findTodoTitleBounds } from "../shared/todo-markdown.js";
import { isValidTodoDue } from "../shared/todo-due.js";

const DEFAULT_FILE = join(homedir(), ".companion", "todos", "todo-list.json");
const INBOX_ID = "cat-inbox";
const MAX_TITLE_LENGTH = 500;
const MAX_LEGACY_DETAILS_LENGTH = 50_000;
const MAX_MARKDOWN_LENGTH = MAX_TITLE_LENGTH + 1 + MAX_LEGACY_DETAILS_LENGTH;
const MAX_CATEGORY_NAME_LENGTH = 120;
const RANK_STEP = 1_024;
const QUEST_ID_PATTERN = /^q-\d+$/;

interface TodoRankSnapshot {
  id: string;
  rank: number;
}

export interface TodoCompletionUndoSnapshot {
  itemId: string;
  previous: {
    status: Exclude<TodoStatus, "done">;
    categoryId: string;
    rank: number;
    sectionRanks: TodoRankSnapshot[];
  };
  completed: {
    categoryId: string;
    rank: number;
    updatedAt: number;
    completedAt: number;
    archivedAt?: number;
    activeSectionRanks: TodoRankSnapshot[];
  };
}

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
    schemaVersion: 3,
    revision: 0,
    updatedAt: now,
    nextItemId: 1,
    nextCategoryId: 1,
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

function normalizeMarkdown(value: unknown): string {
  if (typeof value !== "string") throw new TodoStoreError("Markdown is required", "invalid");
  if (value.length > MAX_MARKDOWN_LENGTH) {
    throw new TodoStoreError(`Markdown must be at most ${MAX_MARKDOWN_LENGTH} characters`, "invalid");
  }
  const title = deriveTodoMarkdown(value).titleMarkdown;
  if (!title) throw new TodoStoreError("Markdown needs a non-empty title line", "invalid");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TodoStoreError(`The derived title must be at most ${MAX_TITLE_LENGTH} characters`, "invalid");
  }
  return value;
}

function normalizeLegacyTitle(value: unknown): string {
  if (typeof value !== "string") throw new TodoStoreError("Title Markdown is required", "invalid");
  const title = value.trim();
  if (!title) throw new TodoStoreError("Title Markdown is required", "invalid");
  if (/\r|\n/.test(title)) throw new TodoStoreError("Title Markdown must stay on one line", "invalid");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TodoStoreError(`Title Markdown must be at most ${MAX_TITLE_LENGTH} characters`, "invalid");
  }
  return title;
}

function normalizeLegacyDetails(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new TodoStoreError("Details Markdown must be a string", "invalid");
  const details = value.trim();
  if (!details) return undefined;
  if (details.length > MAX_LEGACY_DETAILS_LENGTH) {
    throw new TodoStoreError(`Details Markdown must be at most ${MAX_LEGACY_DETAILS_LENGTH} characters`, "invalid");
  }
  return details;
}

function normalizeQuestIds(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TodoStoreError(`${label} must be an array of quest IDs`, "invalid");
  const ids = value.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  const invalid = ids.find((id) => !QUEST_ID_PATTERN.test(id));
  if (invalid !== undefined) throw new TodoStoreError(`Invalid quest ID: ${invalid || "(empty)"}`, "invalid");
  return [...new Set(ids)];
}

/** A due date to store, or undefined for none. */
function normalizeDue(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (!isValidTodoDue(value)) throw new TodoStoreError("Due must be YYYY-MM-DD or YYYY-MM-DDTHH:MM", "invalid");
  return value;
}

function normalizeLinkInput(input: TodoItemLinkInput): Required<TodoItemLinkInput> {
  const addQuestIds = normalizeQuestIds(input.addQuestIds, "addQuestIds");
  const removeQuestIds = normalizeQuestIds(input.removeQuestIds, "removeQuestIds");
  if (addQuestIds.length === 0 && removeQuestIds.length === 0) {
    throw new TodoStoreError("Provide at least one quest ID to link or unlink", "invalid");
  }
  if (addQuestIds.some((id) => removeQuestIds.includes(id))) {
    throw new TodoStoreError("A quest cannot be linked and unlinked in the same change", "invalid");
  }
  return { addQuestIds, removeQuestIds };
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveCreateMarkdown(input: TodoItemCreateInput): string {
  const hasMarkdown = input.markdown !== undefined;
  const hasLegacy = input.titleMarkdown !== undefined || hasOwn(input, "detailsMarkdown");
  if (hasMarkdown && hasLegacy) {
    throw new TodoStoreError("Use markdown or legacy title/details fields, not both", "invalid");
  }
  if (hasMarkdown) return normalizeMarkdown(input.markdown);
  const title = normalizeLegacyTitle(input.titleMarkdown);
  const details = normalizeLegacyDetails(input.detailsMarkdown);
  return normalizeMarkdown(combineLegacyTodoMarkdown(title, details));
}

export function applyLegacyTodoMarkdownEdit(markdown: string, input: TodoItemEditInput): string {
  const hasTitle = input.titleMarkdown !== undefined;
  const hasDetails = hasOwn(input, "detailsMarkdown");
  if (!hasTitle && !hasDetails) throw new TodoStoreError("No Markdown edit was provided", "invalid");

  let next = markdown;
  if (hasTitle) {
    const bounds = findTodoTitleBounds(next);
    if (!bounds) throw new TodoStoreError("Stored Markdown has no title line", "corrupt_store");
    next = `${next.slice(0, bounds.start)}${normalizeLegacyTitle(input.titleMarkdown)}${next.slice(bounds.end)}`;
  }
  if (hasDetails) {
    const bounds = findTodoTitleBounds(next);
    if (!bounds) throw new TodoStoreError("Stored Markdown has no title line", "corrupt_store");
    const details = normalizeLegacyDetails(input.detailsMarkdown);
    const eol = bounds.eol || (next.includes("\r\n") ? "\r\n" : "\n");
    next = details ? `${next.slice(0, bounds.end)}${eol}${details}` : next.slice(0, bounds.end);
  }
  return normalizeMarkdown(next);
}

export function resolveEditMarkdown(current: string, input: TodoItemEditInput): string {
  const hasMarkdown = input.markdown !== undefined;
  const hasLegacy = input.titleMarkdown !== undefined || hasOwn(input, "detailsMarkdown");
  if (hasMarkdown && hasLegacy) {
    throw new TodoStoreError("Use markdown or legacy title/details fields, not both", "invalid");
  }
  if (hasMarkdown) return normalizeMarkdown(input.markdown);
  return applyLegacyTodoMarkdownEdit(current, input);
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

/**
 * Record a change to an item. Callers skip this for a change that leaves the item as it was, so a
 * no-op never shows up as someone's change in its provenance.
 */
function recordItemChange(state: TodoState, item: TodoItem, provenance: TodoMutationProvenance): void {
  item.updatedAt = provenance.at;
  item.lastModifiedBy = provenance;
  touchState(state, provenance.at);
}

function orderSection(item: Pick<TodoItem, "categoryId" | "status" | "archivedAt">): string {
  return `${item.categoryId}:${item.archivedAt ? "archived" : item.status === "done" ? "done" : "active"}`;
}

function compareRank(a: TodoItem, b: TodoItem): number {
  return a.rank - b.rank || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function sectionItems(state: TodoState, descriptor: Pick<TodoItem, "categoryId" | "status" | "archivedAt">) {
  const key = orderSection(descriptor);
  return state.items.filter((item) => orderSection(item) === key).sort(compareRank);
}

function reindexSection(state: TodoState, descriptor: Pick<TodoItem, "categoryId" | "status" | "archivedAt">): void {
  sectionItems(state, descriptor).forEach((item, index) => {
    item.rank = (index + 1) * RANK_STEP;
  });
}

function placeItem(
  state: TodoState,
  item: TodoItem,
  position: Pick<TodoItemMoveInput, "beforeItemId" | "afterItemId">,
): void {
  if (position.beforeItemId && position.afterItemId) {
    throw new TodoStoreError("Use beforeItemId or afterItemId, not both", "invalid");
  }
  if ((position.beforeItemId || position.afterItemId) && (item.archivedAt || item.status === "done")) {
    throw new TodoStoreError("Only active Todo/Doing items can be manually reordered", "conflict");
  }

  const ordered = sectionItems(state, item).filter((candidate) => candidate.id !== item.id);
  const referenceId = position.beforeItemId || position.afterItemId;
  let index = ordered.length;
  if (referenceId) {
    if (referenceId === item.id) throw new TodoStoreError("An item cannot be positioned relative to itself", "invalid");
    const reference = itemById(state, referenceId);
    if (orderSection(reference) !== orderSection(item)) {
      throw new TodoStoreError("Ordering references must be active items in the target category", "conflict");
    }
    const referenceIndex = ordered.findIndex((candidate) => candidate.id === reference.id);
    if (referenceIndex < 0) throw new TodoStoreError(`Ordering reference not found: ${reference.id}`, "not_found");
    index = referenceIndex + (position.afterItemId ? 1 : 0);
  }
  ordered.splice(index, 0, item);
  ordered.forEach((candidate, candidateIndex) => {
    candidate.rank = (candidateIndex + 1) * RANK_STEP;
  });
}

function assignLegacyRanks(items: TodoItem[]): void {
  const sections = new Map<string, TodoItem[]>();
  for (const item of items) {
    const key = orderSection(item);
    const section = sections.get(key) ?? [];
    section.push(item);
    sections.set(key, section);
  }
  for (const [key, section] of sections) {
    section.sort((a, b) => {
      if (key.endsWith(":active") && a.status !== b.status) return a.status === "doing" ? -1 : 1;
      if (key.endsWith(":done")) return (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt);
      return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    });
    section.forEach((item, index) => {
      item.rank = (index + 1) * RANK_STEP;
    });
  }
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

function migrateV1State(raw: Record<string, unknown>): TodoState {
  const categories = requireArray<TodoCategory>(raw.categories, "categories");
  const categoryIds = new Set<string>();
  for (const [index, value] of categories.entries()) {
    const category = requireObject(value, `categories[${index}]`);
    if (typeof category.id !== "string" || !category.id) {
      throw new TodoStoreError(`categories[${index}].id must be a non-empty string`, "corrupt_store");
    }
    if (categoryIds.has(category.id)) {
      throw new TodoStoreError(`Duplicate category id: ${category.id}`, "corrupt_store");
    }
    categoryIds.add(category.id);
    if (typeof category.name !== "string" || !category.name) {
      throw new TodoStoreError(`categories[${index}].name must be a non-empty string`, "corrupt_store");
    }
    requireFiniteNumber(category.createdAt, `categories[${index}].createdAt`);
    requireFiniteNumber(category.updatedAt, `categories[${index}].updatedAt`);
  }
  if (!categoryIds.has(INBOX_ID)) {
    throw new TodoStoreError("To-do store is missing the Inbox category", "corrupt_store");
  }

  const legacyItems = requireArray<unknown>(raw.items, "items");
  const itemIds = new Set<string>();
  const items = legacyItems.map((value, index) => {
    const item = requireObject(value, `items[${index}]`);
    if (typeof item.id !== "string" || !item.id) {
      throw new TodoStoreError(`items[${index}].id must be a non-empty string`, "corrupt_store");
    }
    if (itemIds.has(item.id)) throw new TodoStoreError(`Duplicate item id: ${item.id}`, "corrupt_store");
    itemIds.add(item.id);
    if (typeof item.categoryId !== "string" || !categoryIds.has(item.categoryId)) {
      throw new TodoStoreError(`items[${index}] references an unknown category`, "corrupt_store");
    }
    if (typeof item.status !== "string" || !TODO_STATUSES.includes(item.status as TodoStatus)) {
      throw new TodoStoreError(`items[${index}].status is invalid`, "corrupt_store");
    }
    requireFiniteNumber(item.createdAt, `items[${index}].createdAt`);
    requireFiniteNumber(item.updatedAt, `items[${index}].updatedAt`);
    requireFiniteNumber(item.statusChangedAt, `items[${index}].statusChangedAt`);
    if (item.completedAt != null) requireFiniteNumber(item.completedAt, `items[${index}].completedAt`);
    if (item.archivedAt != null) requireFiniteNumber(item.archivedAt, `items[${index}].archivedAt`);
    if (typeof item.titleMarkdown !== "string") {
      throw new TodoStoreError(`items[${index}].titleMarkdown must be a string`, "corrupt_store");
    }
    if (item.detailsMarkdown != null && typeof item.detailsMarkdown !== "string") {
      throw new TodoStoreError(`items[${index}].detailsMarkdown must be a string`, "corrupt_store");
    }
    const { titleMarkdown, detailsMarkdown, ...rest } = item;
    return {
      ...(clone(rest) as Omit<TodoItem, "markdown" | "rank">),
      markdown: normalizeMarkdown(
        combineLegacyTodoMarkdown(titleMarkdown, detailsMarkdown as string | null | undefined),
      ),
      rank: 0,
    } satisfies TodoItem;
  });
  assignLegacyRanks(items);

  // Proposals and grants are retired; they survive only in the pre-migration backup.
  const state = {
    schemaVersion: 3 as const,
    revision: requireFiniteNumber(raw.revision, "revision"),
    updatedAt: requireFiniteNumber(raw.updatedAt, "updatedAt"),
    nextItemId: requireFiniteNumber(raw.nextItemId, "nextItemId"),
    nextCategoryId: requireFiniteNumber(raw.nextCategoryId, "nextCategoryId"),
    categories,
    items,
  } satisfies TodoState;
  return state;
}

/**
 * Load a stored list, migrating older schemas. `migratedFrom` names the schema a migrated file had,
 * so its original is backed up before the new form replaces it. Schema 2 differs from 3 only by the
 * retired proposals and grants, which are dropped.
 */
function normalizeLoadedState(value: unknown): { state: TodoState; migratedFrom?: 1 | 2 } {
  const raw = requireObject(value, "To-do store");
  if (raw.schemaVersion === 1) return { state: migrateV1State(raw), migratedFrom: 1 };
  if (raw.schemaVersion !== 2 && raw.schemaVersion !== 3) {
    throw new TodoStoreError(`Unsupported to-do schema version: ${String(raw.schemaVersion)}`, "unsupported_schema");
  }

  const state = {
    schemaVersion: 3 as const,
    revision: requireFiniteNumber(raw.revision, "revision"),
    updatedAt: requireFiniteNumber(raw.updatedAt, "updatedAt"),
    nextItemId: requireFiniteNumber(raw.nextItemId, "nextItemId"),
    nextCategoryId: requireFiniteNumber(raw.nextCategoryId, "nextCategoryId"),
    categories: requireArray<TodoCategory>(raw.categories, "categories"),
    items: requireArray<TodoItem>(raw.items, "items"),
  } satisfies TodoState;

  const categoryIds = new Set<string>();
  for (const [index, value] of state.categories.entries()) {
    const category = requireObject(value, `categories[${index}]`);
    if (typeof category.id !== "string" || !category.id || categoryIds.has(category.id)) {
      throw new TodoStoreError(`categories[${index}].id is invalid or duplicated`, "corrupt_store");
    }
    categoryIds.add(category.id);
    if (typeof category.name !== "string" || !category.name) {
      throw new TodoStoreError(`categories[${index}].name must be a non-empty string`, "corrupt_store");
    }
    requireFiniteNumber(category.createdAt, `categories[${index}].createdAt`);
    requireFiniteNumber(category.updatedAt, `categories[${index}].updatedAt`);
  }
  if (!categoryIds.has(INBOX_ID)) {
    throw new TodoStoreError("To-do store is missing the Inbox category", "corrupt_store");
  }

  const itemIds = new Set<string>();
  for (const [index, item] of state.items.entries()) {
    const rawItem = requireObject(item, `items[${index}]`);
    if (typeof rawItem.id !== "string" || !rawItem.id || itemIds.has(rawItem.id)) {
      throw new TodoStoreError(`items[${index}].id is invalid or duplicated`, "corrupt_store");
    }
    itemIds.add(rawItem.id);
    if (typeof rawItem.categoryId !== "string" || !categoryIds.has(rawItem.categoryId)) {
      throw new TodoStoreError(`items[${index}] references an unknown category`, "corrupt_store");
    }
    if (typeof rawItem.status !== "string" || !TODO_STATUSES.includes(rawItem.status as TodoStatus)) {
      throw new TodoStoreError(`items[${index}].status is invalid`, "corrupt_store");
    }
    normalizeMarkdown(rawItem.markdown);
    requireFiniteNumber(rawItem.rank, `items[${index}].rank`);
    requireFiniteNumber(rawItem.createdAt, `items[${index}].createdAt`);
    requireFiniteNumber(rawItem.updatedAt, `items[${index}].updatedAt`);
    requireFiniteNumber(rawItem.statusChangedAt, `items[${index}].statusChangedAt`);
    if (rawItem.completedAt != null) requireFiniteNumber(rawItem.completedAt, `items[${index}].completedAt`);
    if (rawItem.archivedAt != null) requireFiniteNumber(rawItem.archivedAt, `items[${index}].archivedAt`);
    if (rawItem.due != null && !isValidTodoDue(rawItem.due)) {
      throw new TodoStoreError(`items[${index}].due is invalid`, "corrupt_store");
    }
    if (rawItem.questIds != null) {
      try {
        normalizeQuestIds(rawItem.questIds, `items[${index}].questIds`);
      } catch (error) {
        throw new TodoStoreError(`items[${index}].questIds is invalid: ${(error as Error).message}`, "corrupt_store");
      }
    }
  }
  return { state, ...(raw.schemaVersion === 2 ? { migratedFrom: 2 as const } : {}) };
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

  /** Keep an immutable copy of a file before migrating it; refuse if a different copy is already there. */
  private async ensureLegacyBackup(rawText: string, schemaVersion: number): Promise<void> {
    const backupPath = `${this.filePath}.schema-v${schemaVersion}.backup`;
    try {
      await copyFile(this.filePath, backupPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      const existing = await readFile(backupPath, "utf-8");
      if (existing !== rawText) {
        throw new TodoStoreError(
          `Legacy to-do backup already exists with different contents: ${backupPath}; refusing migration`,
          "corrupt_store",
        );
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const rawText = await readFile(this.filePath, "utf-8");
          const loaded = normalizeLoadedState(JSON.parse(rawText));
          if (loaded.migratedFrom) {
            await this.ensureLegacyBackup(rawText, loaded.migratedFrom);
            await this.persist(loaded.state);
          }
          this.state = loaded.state;
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
    const categoryOrder = new Map(state.categories.map((category, index) => [category.id, index]));
    const query = filters.search?.trim().toLocaleLowerCase() || "";
    return state.items
      .filter((item) => (filters.includeArchived ? true : !item.archivedAt))
      .filter((item) => (statuses ? statuses.has(item.status) : true))
      .filter((item) => (categories ? categories.has(item.categoryId) : true))
      .filter((item) => {
        if (!filters.completedOn) return true;
        return !!item.completedAt && formatDateInTimeZone(item.completedAt, filters.timeZone) === filters.completedOn;
      })
      .filter((item) => !query || markdownSearchText(item.markdown).includes(query))
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        if (a.status === "done" && b.status === "done") {
          const completion = (b.completedAt ?? 0) - (a.completedAt ?? 0);
          if (completion) return completion;
        }
        const category =
          (categoryOrder.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) -
          (categoryOrder.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER);
        return category || compareRank(a, b);
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
      return extractMarkdownLinkDestinations(item.markdown).includes(target);
    });
  }

  async findItemsByQuest(questId: string, includeArchived = false): Promise<TodoItem[]> {
    const [target] = normalizeQuestIds([questId], "Quest ID");
    const state = await this.snapshot();
    return state.items.filter((item) => (includeArchived || !item.archivedAt) && item.questIds?.includes(target!));
  }

  private resolveCreateCategory(state: TodoState, input: TodoItemCreateInput): string {
    const referenceId = input.beforeItemId || input.afterItemId;
    if (input.beforeItemId && input.afterItemId) {
      throw new TodoStoreError("Use beforeItemId or afterItemId, not both", "invalid");
    }
    const reference = referenceId ? itemById(state, referenceId) : null;
    const categoryId = input.categoryId?.trim() || reference?.categoryId || INBOX_ID;
    categoryById(state, categoryId);
    if (reference && reference.categoryId !== categoryId) {
      throw new TodoStoreError("Ordering reference is not in the target category", "conflict");
    }
    return categoryId;
  }

  async createItem(input: TodoItemCreateInput, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => this.createItemInState(state, input, provenance));
  }

  private createItemInState(
    state: TodoState,
    input: TodoItemCreateInput,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const now = provenance.at;
    const categoryId = this.resolveCreateCategory(state, input);
    const status = normalizeStatus(input.status);
    const due = normalizeDue(input.due);
    const item: TodoItem = {
      id: `td-${state.nextItemId++}`,
      markdown: resolveCreateMarkdown(input),
      rank: 0,
      categoryId,
      status,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      ...(status === "done" ? { completedAt: now } : {}),
      ...(due ? { due } : {}),
      createdBy: provenance,
      lastModifiedBy: provenance,
    };
    state.items.push(item);
    placeItem(state, item, input);
    touchState(state, now);
    return item;
  }

  private editItemInState(
    state: TodoState,
    itemId: string,
    input: TodoItemEditInput,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const item = itemById(state, itemId);
    const markdown = resolveEditMarkdown(item.markdown, input);
    if (markdown === item.markdown) return item;
    item.markdown = markdown;
    recordItemChange(state, item, provenance);
    return item;
  }

  private linkItemQuestsInState(
    state: TodoState,
    itemId: string,
    input: TodoItemLinkInput,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const item = itemById(state, itemId);
    const { addQuestIds, removeQuestIds } = normalizeLinkInput(input);
    const current = item.questIds ?? [];
    const next = current.filter((id) => !removeQuestIds.includes(id));
    for (const id of addQuestIds) if (!next.includes(id)) next.push(id);
    // Re-linking or unlinking what is already in place is a no-op, not an edit.
    if (next.length === current.length && next.every((id, index) => id === current[index])) return item;
    if (next.length) item.questIds = next;
    else delete item.questIds;
    recordItemChange(state, item, provenance);
    return item;
  }

  async linkItemQuests(
    itemId: string,
    input: TodoItemLinkInput,
    provenance: TodoMutationProvenance,
  ): Promise<TodoItem> {
    return this.mutate((state) => this.linkItemQuestsInState(state, itemId, input, provenance));
  }

  /** Set or clear (`null`) a to-do's due date. */
  async setItemDue(itemId: string, dueValue: unknown, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, itemId);
      const due = normalizeDue(dueValue);
      if (due === item.due) return item;
      if (due) item.due = due;
      else delete item.due;
      recordItemChange(state, item, provenance);
      return item;
    });
  }

  async editItem(itemId: string, input: TodoItemEditInput, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => this.editItemInState(state, itemId, input, provenance));
  }

  private setItemStatusInState(
    state: TodoState,
    itemId: string,
    statusValue: unknown,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const item = itemById(state, itemId);
    const status = normalizeStatus(statusValue);
    if (item.status === status) return item;
    const previous = clone(item);
    item.status = status;
    item.statusChangedAt = provenance.at;
    if (status === "done") item.completedAt = provenance.at;
    else delete item.completedAt;
    if (orderSection(previous) !== orderSection(item)) {
      reindexSection(state, previous);
      placeItem(state, item, {});
    }
    recordItemChange(state, item, provenance);
    return item;
  }

  async setItemStatus(itemId: string, statusValue: unknown, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => this.setItemStatusInState(state, itemId, statusValue, provenance));
  }

  async setItemStatusWithCompletionUndo(
    itemId: string,
    statusValue: unknown,
    provenance: TodoMutationProvenance,
  ): Promise<{ item: TodoItem; undo?: TodoCompletionUndoSnapshot }> {
    return this.mutate((state) => {
      const before = clone(itemById(state, itemId));
      const status = normalizeStatus(statusValue);
      const canUndoCompletion = status === "done" && before.status !== "done" && !before.archivedAt;
      const previousSection = canUndoCompletion
        ? sectionItems(state, before).map(({ id, rank }) => ({ id, rank }))
        : [];
      const item = this.setItemStatusInState(state, itemId, status, provenance);
      if (!canUndoCompletion || !item.completedAt) return { item };
      return {
        item,
        undo: {
          itemId,
          previous: {
            status: before.status as Exclude<TodoStatus, "done">,
            categoryId: before.categoryId,
            rank: before.rank,
            sectionRanks: previousSection,
          },
          completed: {
            categoryId: item.categoryId,
            rank: item.rank,
            updatedAt: item.updatedAt,
            completedAt: item.completedAt,
            ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
            activeSectionRanks: sectionItems(state, before).map(({ id, rank }) => ({ id, rank })),
          },
        },
      };
    });
  }

  async undoItemCompletion(
    snapshot: TodoCompletionUndoSnapshot,
    provenance: TodoMutationProvenance,
  ): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = itemById(state, snapshot.itemId);
      const expected = snapshot.completed;
      if (
        item.status !== "done" ||
        item.categoryId !== expected.categoryId ||
        item.rank !== expected.rank ||
        item.updatedAt !== expected.updatedAt ||
        item.completedAt !== expected.completedAt ||
        item.archivedAt !== expected.archivedAt
      ) {
        throw new TodoStoreError(
          "This completion changed after it was created; refresh before reopening it",
          "conflict",
        );
      }

      const activeDescriptor = {
        categoryId: snapshot.previous.categoryId,
        status: snapshot.previous.status,
      };
      const activeSection = sectionItems(state, activeDescriptor).map(({ id, rank }) => ({ id, rank }));
      if (
        activeSection.length !== expected.activeSectionRanks.length ||
        activeSection.some(
          (candidate, index) =>
            candidate.id !== expected.activeSectionRanks[index]?.id ||
            candidate.rank !== expected.activeSectionRanks[index]?.rank,
        )
      ) {
        throw new TodoStoreError(
          "The original active ordering changed after completion; refresh before reopening this item",
          "conflict",
        );
      }

      categoryById(state, snapshot.previous.categoryId);
      item.status = snapshot.previous.status;
      item.categoryId = snapshot.previous.categoryId;
      item.statusChangedAt = provenance.at;
      item.updatedAt = provenance.at;
      item.lastModifiedBy = provenance;
      delete item.completedAt;

      for (const previous of snapshot.previous.sectionRanks) {
        const sectionItem = itemById(state, previous.id);
        if (orderSection(sectionItem) !== orderSection(item)) {
          throw new TodoStoreError(
            "The original active ordering changed after completion; refresh before reopening this item",
            "conflict",
          );
        }
        sectionItem.rank = previous.rank;
      }
      item.rank = snapshot.previous.rank;
      touchState(state, provenance.at);
      return item;
    });
  }

  private moveItemInState(
    state: TodoState,
    itemId: string,
    input: TodoItemMoveInput,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const item = itemById(state, itemId);
    const previous = clone(item);
    const referenceId = input.beforeItemId || input.afterItemId;
    if (input.beforeItemId && input.afterItemId) {
      throw new TodoStoreError("Use beforeItemId or afterItemId, not both", "invalid");
    }
    const reference = referenceId ? itemById(state, referenceId) : null;
    const categoryId = input.categoryId?.trim() || reference?.categoryId || item.categoryId;
    categoryById(state, categoryId);
    if (reference && reference.categoryId !== categoryId) {
      throw new TodoStoreError("Ordering reference is not in the target category", "conflict");
    }
    item.categoryId = categoryId;
    if (orderSection(previous) !== orderSection(item)) reindexSection(state, previous);
    placeItem(state, item, input);
    item.updatedAt = provenance.at;
    item.lastModifiedBy = provenance;
    return item;
  }

  async moveItem(itemId: string, input: TodoItemMoveInput, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => {
      const item = this.moveItemInState(state, itemId, input, provenance);
      touchState(state, provenance.at);
      return item;
    });
  }

  private setItemArchivedInState(
    state: TodoState,
    itemId: string,
    archived: boolean,
    provenance: TodoMutationProvenance,
  ): TodoItem {
    const item = itemById(state, itemId);
    if (archived === !!item.archivedAt) return item;
    const previous = clone(item);
    if (archived) item.archivedAt = provenance.at;
    else {
      categoryById(state, item.categoryId);
      delete item.archivedAt;
    }
    if (orderSection(previous) !== orderSection(item)) {
      reindexSection(state, previous);
      placeItem(state, item, {});
    }
    recordItemChange(state, item, provenance);
    return item;
  }

  async setItemArchived(itemId: string, archived: boolean, provenance: TodoMutationProvenance): Promise<TodoItem> {
    return this.mutate((state) => this.setItemArchivedInState(state, itemId, archived, provenance));
  }

  async createCategory(input: TodoCategoryCreateInput, provenance: TodoMutationProvenance): Promise<TodoCategory> {
    return this.mutate((state) => this.createCategoryInState(state, input, provenance));
  }

  private createCategoryInState(
    state: TodoState,
    input: TodoCategoryCreateInput,
    provenance: TodoMutationProvenance,
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
    touchState(state, provenance.at);
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

  async flushForTest(): Promise<void> {
    await this.mutationQueue;
  }
}

export const todoStore = new TodoStore();
export const TODO_INBOX_CATEGORY_ID = INBOX_ID;
