import type {
  TodoGrantAction,
  TodoItemCreateInput,
  TodoItemEditInput,
  TodoPrincipal,
  TodoState,
  TodoStateMutationResponse,
  TodoStatus,
} from "../../shared/todo-types.js";

const BASE = "/api";

async function request<T>(path: string, options?: { method?: "GET" | "POST" | "PATCH"; body?: object }): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: options?.method ?? "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof body.error === "string" && body.error ? body.error : response.statusText);
  }
  return response.json() as Promise<T>;
}

export const todoApi = {
  getTodoState: () => request<TodoState>("/todos"),

  listTodoPrincipals: () => request<{ principals: TodoPrincipal[] }>("/todos/principals"),

  createTodoItem: (input: TodoItemCreateInput) =>
    request<TodoStateMutationResponse>("/todos/items", { method: "POST", body: input }),

  editTodoItem: (id: string, input: TodoItemEditInput) =>
    request<TodoStateMutationResponse>(`/todos/items/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),

  setTodoItemStatus: (id: string, status: TodoStatus) =>
    request<TodoStateMutationResponse>(`/todos/items/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: { status },
    }),

  moveTodoItem: (id: string, categoryId: string) =>
    request<TodoStateMutationResponse>(`/todos/items/${encodeURIComponent(id)}/move`, {
      method: "POST",
      body: { categoryId },
    }),

  archiveTodoItem: (id: string) =>
    request<TodoStateMutationResponse>(`/todos/items/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: {},
    }),

  restoreTodoItem: (id: string) =>
    request<TodoStateMutationResponse>(`/todos/items/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: {},
    }),

  createTodoCategory: (name: string) =>
    request<TodoStateMutationResponse>("/todos/categories", { method: "POST", body: { name } }),

  renameTodoCategory: (id: string, name: string) =>
    request<TodoStateMutationResponse>(`/todos/categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { name },
    }),

  archiveTodoCategory: (id: string) =>
    request<TodoStateMutationResponse>(`/todos/categories/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: {},
    }),

  restoreTodoCategory: (id: string) =>
    request<TodoStateMutationResponse>(`/todos/categories/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: {},
    }),

  resolveTodoProposal: (id: string, decision: "approve" | "reject") =>
    request<TodoStateMutationResponse>(`/todos/proposals/${encodeURIComponent(id)}/${decision}`, {
      method: "POST",
      body: {},
    }),

  createTodoGrant: (input: { principal: TodoPrincipal; actions: TodoGrantAction[]; categoryIds: string[] | null }) =>
    request<TodoStateMutationResponse>("/todos/grants", { method: "POST", body: input }),

  revokeTodoGrant: (id: string) =>
    request<TodoStateMutationResponse>(`/todos/grants/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: {},
    }),
};
