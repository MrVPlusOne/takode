export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_GRANT_ACTIONS = [
  "item:add",
  "item:edit",
  "item:status",
  "item:move",
  "item:archive",
  "item:restore",
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
  kind: "ui" | "direct_message" | "grant" | "proposal_approval" | "bootstrap";
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

export interface TodoItem {
  id: string;
  titleMarkdown: string;
  detailsMarkdown?: string;
  categoryId: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number;
  completedAt?: number;
  archivedAt?: number;
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

export interface TodoItemCreateInput {
  titleMarkdown: string;
  detailsMarkdown?: string;
  categoryId?: string;
  status?: TodoStatus;
}

export interface TodoItemEditInput {
  titleMarkdown?: string;
  detailsMarkdown?: string | null;
}

export interface TodoCategoryCreateInput {
  name: string;
}

export type TodoProposalMutation =
  | { action: "item:add"; input: TodoItemCreateInput }
  | { action: "item:edit"; itemId: string; input: TodoItemEditInput }
  | { action: "item:status"; itemId: string; status: TodoStatus }
  | { action: "item:move"; itemId: string; categoryId: string }
  | { action: "item:archive"; itemId: string }
  | { action: "item:restore"; itemId: string }
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
}

export interface TodoState {
  schemaVersion: 1;
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

export interface TodoCompactItem {
  id: string;
  titleMarkdown: string;
  categoryId: string;
  categoryName: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number;
  completedAt?: number;
  archivedAt?: number;
}

export interface TodoStateMutationResponse {
  state: TodoState;
  item?: TodoItem;
  category?: TodoCategory;
  proposal?: TodoProposal;
  grant?: TodoGrant;
}
