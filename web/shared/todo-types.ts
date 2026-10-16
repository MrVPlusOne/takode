export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoActor {
  kind: "user" | "session" | "workflow" | "system";
  /** Session provider when the actor is an agent session. */
  provider?: "takode" | "codex";
  sessionId?: string;
  workflowId?: string;
  label?: string;
}

export interface TodoUserMessageProvenance {
  sessionId: string;
  historyIndex: number;
  messageId?: string;
  timestamp: number;
  contentHash: string;
  threadKey?: string;
  questId?: string;
}

export interface TodoAuthorization {
  /**
   * `grant` and `proposal_approval` are retired: Takode no longer has to-do grants or proposals, but
   * changes made through them keep that record.
   */
  kind: "ui" | "direct_message" | "standing_approval" | "agent_direct" | "bootstrap" | "grant" | "proposal_approval";
  userMessage?: TodoUserMessageProvenance;
  /**
   * The written standing approval the agent relied on, as it cited it: where it is written and the
   * rule. Takode records the citation but cannot check it.
   */
  standingApproval?: string;
  grantId?: string;
  proposalId?: string;
}

export interface TodoMutationProvenance {
  actor: TodoActor;
  authorization: TodoAuthorization;
  at: number;
  /** Where an agent found the to-do it added, e.g. "Slack group chat with Junhong, Oct 4". */
  source?: string;
}

export interface TodoCategory {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  createdBy: TodoMutationProvenance;
  lastModifiedBy: TodoMutationProvenance;
}

export interface TodoMarkdownParts {
  /** First non-empty Markdown line, trimmed only for display. */
  titleMarkdown: string;
  /** Exact source after the title line when it contains non-whitespace. */
  detailsMarkdown?: string;
}

export interface TodoItem {
  id: string;
  /** Canonical authored source. Title/details are derived presentation only. */
  markdown: string;
  /** Durable order within the item's active or derived Done/category section. */
  rank: number;
  categoryId: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number;
  completedAt?: number;
  archivedAt?: number;
  /**
   * Quests related to this to-do, as loose metadata. Many-to-many and purely
   * informational: quest progress never changes the to-do's status.
   */
  questIds?: string[];
  /** Optional due date, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, in the user's local time (see `shared/todo-due.ts`). */
  due?: string;
  createdBy: TodoMutationProvenance;
  lastModifiedBy: TodoMutationProvenance;
}

/**
 * Canonical callers send `markdown`. The split fields remain accepted only as
 * compatibility input for pre-v2 CLI/API clients and are never persisted.
 */
export interface TodoItemCreateInput {
  markdown?: string;
  titleMarkdown?: string;
  detailsMarkdown?: string | null;
  categoryId?: string;
  status?: TodoStatus;
  /** Optional due date in the `TodoItem.due` format. */
  due?: string;
  beforeItemId?: string;
  afterItemId?: string;
}

export interface TodoItemEditInput {
  markdown?: string;
  titleMarkdown?: string;
  detailsMarkdown?: string | null;
}

export interface TodoItemMoveInput {
  categoryId?: string;
  beforeItemId?: string;
  afterItemId?: string;
}

/** Quest links to add to or remove from one to-do. */
export interface TodoItemLinkInput {
  addQuestIds?: string[];
  removeQuestIds?: string[];
}

export interface TodoCategoryCreateInput {
  name: string;
}

/** `GET /todos/due-dates`: the due dates of current Todo and Doing items, without the rest of the list. */
export interface TodoDueDates {
  dues: string[];
  revision: number;
}

export interface TodoState {
  schemaVersion: 3;
  revision: number;
  updatedAt: number;
  nextItemId: number;
  nextCategoryId: number;
  categories: TodoCategory[];
  items: TodoItem[];
}

export interface TodoItemListFilters {
  statuses?: TodoStatus[];
  categoryIds?: string[];
  search?: string;
  includeArchived?: boolean;
  completedOn?: string;
  timeZone?: string;
}

/** A linked quest as seen when reading a to-do; resolved by the server at read time. */
export interface TodoLinkedQuest {
  questId: string;
  /** "missing" when the quest no longer exists. */
  status: "idea" | "refined" | "in_progress" | "done" | "cancelled" | "missing";
  /** Present on single-item reads, omitted from compact lists. */
  title?: string;
}

export interface TodoCompactItem {
  id: string;
  /** Derived first non-empty line retained for compact-output compatibility. */
  titleMarkdown: string;
  categoryId: string;
  categoryName: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number;
  completedAt?: number;
  archivedAt?: number;
  due?: string;
  /** Present only when the to-do links quests. */
  linkedQuests?: TodoLinkedQuest[];
}

export interface TodoCompletionUndoHandle {
  token: string;
  itemId: string;
  expiresAt: number;
}

export interface TodoStateMutationResponse {
  state: TodoState;
  item?: TodoItem;
  category?: TodoCategory;
  /** Opaque, short-lived receipt for undoing the immediately preceding UI completion. */
  completionUndo?: TodoCompletionUndoHandle;
}
