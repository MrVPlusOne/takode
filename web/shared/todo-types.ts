export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_GRANT_ACTIONS = [
  "item:add",
  "item:edit",
  "item:status",
  "item:move",
  "item:archive",
  "item:restore",
  "item:link",
  "category:create",
  "category:rename",
  "category:archive",
  "category:restore",
] as const;
export type TodoGrantAction = (typeof TODO_GRANT_ACTIONS)[number];

export type TodoPrincipal =
  | { kind: "session"; id: string; label?: string }
  | { kind: "cron"; id: string; label?: string };

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
  kind: "ui" | "direct_message" | "grant" | "proposal_approval" | "agent_direct" | "bootstrap";
  userMessage?: TodoUserMessageProvenance;
  grantId?: string;
  proposalId?: string;
}

export interface TodoMutationProvenance {
  actor: TodoActor;
  authorization: TodoAuthorization;
  at: number;
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

export interface TodoGrant {
  id: string;
  principal: TodoPrincipal;
  actions: TodoGrantAction[];
  /** null means every active category. */
  categoryIds: string[] | null;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number;
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

export type TodoProposalMutation =
  | { action: "item:add"; input: TodoItemCreateInput }
  | { action: "item:edit"; itemId: string; input: TodoItemEditInput }
  | { action: "item:status"; itemId: string; status: TodoStatus }
  | ({ action: "item:move"; itemId: string } & TodoItemMoveInput)
  | { action: "item:archive"; itemId: string }
  | { action: "item:restore"; itemId: string }
  | ({ action: "item:link"; itemId: string } & TodoItemLinkInput)
  | { action: "category:create"; input: TodoCategoryCreateInput }
  | { action: "category:rename"; categoryId: string; name: string }
  | { action: "category:archive"; categoryId: string }
  | { action: "category:restore"; categoryId: string };

export interface TodoProposal {
  id: string;
  mutation: TodoProposalMutation;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  requestedBy: TodoActor;
  resolution?: TodoMutationProvenance;
  /** Approved with the new to-do marked done in the same step: it was already done when reviewed. */
  markedDone?: boolean;
}

/**
 * How the user resolves a proposal. `mark-done` approves a proposal that adds a to-do and marks
 * that to-do done at once, for an obligation that was real but finished before it was reviewed.
 */
export type TodoProposalDecision = "approve" | "reject" | "mark-done";

/** `GET /todos/proposal-statuses`: every proposal's status by ID, without the rest of the list. */
export interface TodoProposalStatuses {
  statuses: Record<string, TodoProposal["status"]>;
  revision: number;
}

/** `GET /todos/due-dates`: the due dates of current Todo and Doing items, without the rest of the list. */
export interface TodoDueDates {
  dues: string[];
  revision: number;
}

export interface TodoState {
  schemaVersion: 2;
  revision: number;
  updatedAt: number;
  nextItemId: number;
  nextCategoryId: number;
  nextProposalId: number;
  nextGrantId: number;
  categories: TodoCategory[];
  items: TodoItem[];
  proposals: TodoProposal[];
  grants: TodoGrant[];
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
  proposal?: TodoProposal;
  grant?: TodoGrant;
  /** Opaque, short-lived receipt for undoing the immediately preceding UI completion. */
  completionUndo?: TodoCompletionUndoHandle;
}
