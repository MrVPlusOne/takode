// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoState } from "../../shared/todo-types.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";

const mocks = vi.hoisted(() => ({
  getTodoState: vi.fn(),
  listTodoPrincipals: vi.fn(),
  createTodoItem: vi.fn(),
  editTodoItem: vi.fn(),
  setTodoItemStatus: vi.fn(),
  moveTodoItem: vi.fn(),
  archiveTodoItem: vi.fn(),
  restoreTodoItem: vi.fn(),
  createTodoCategory: vi.fn(),
  renameTodoCategory: vi.fn(),
  archiveTodoCategory: vi.fn(),
  restoreTodoCategory: vi.fn(),
  resolveTodoProposal: vi.fn(),
  createTodoGrant: vi.fn(),
  revokeTodoGrant: vi.fn(),
}));

vi.mock("../api.js", () => ({ api: mocks }));
vi.mock("./MarkdownContent.js", () => ({
  MarkdownContent: ({ text }: { text: string }) => <span data-testid="todo-markdown">{text}</span>,
}));

import { TodoListPanel } from "./TodoListPanel.js";

const provenance = {
  actor: { kind: "user" as const, label: "User" },
  authorization: { kind: "ui" as const },
  at: 100,
};

function makeState(revision = 1): TodoState {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: revision * 100,
    nextItemId: 4,
    nextCategoryId: 2,
    nextProposalId: 2,
    nextGrantId: 1,
    categories: [
      { id: "cat-inbox", name: "Inbox", createdAt: 1, updatedAt: 1, createdBy: provenance, lastModifiedBy: provenance },
      { id: "cat-1", name: "Slack", createdAt: 1, updatedAt: 1, createdBy: provenance, lastModifiedBy: provenance },
    ],
    items: [
      {
        id: "td-1",
        titleMarkdown: "Reply to **Alice**",
        detailsMarkdown: "[Thread](https://example.slack.com/thread)",
        categoryId: "cat-1",
        status: "todo",
        createdAt: 100,
        updatedAt: 100,
        statusChangedAt: 100,
        createdBy: provenance,
        lastModifiedBy: provenance,
      },
      {
        id: "td-2",
        titleMarkdown: "Review result",
        categoryId: "cat-inbox",
        status: "doing",
        createdAt: 100,
        updatedAt: 200,
        statusChangedAt: 200,
        createdBy: provenance,
        lastModifiedBy: provenance,
      },
      {
        id: "td-3",
        titleMarkdown: "Finished",
        categoryId: "cat-inbox",
        status: "done",
        createdAt: 100,
        updatedAt: 300,
        statusChangedAt: 300,
        completedAt: Date.now(),
        createdBy: provenance,
        lastModifiedBy: provenance,
      },
    ],
    proposals: [
      {
        id: "tp-1",
        mutation: { action: "item:add", input: { titleMarkdown: "Read the result" } },
        status: "pending",
        createdAt: 100,
        updatedAt: 100,
        requestedBy: { kind: "session", sessionId: "s2", label: "Worker #2" },
      },
    ],
    grants: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTodoState.mockResolvedValue(makeState());
  mocks.listTodoPrincipals.mockResolvedValue({ principals: [] });
});

describe("TodoListPanel", () => {
  it("renders status counts, Markdown items, category grouping, and local Done grouping", async () => {
    render(<TodoListPanel />);
    expect(await screen.findByText("Personal To-dos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Doing 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done 1" })).toBeInTheDocument();
    expect(screen.getAllByText("Slack").length).toBeGreaterThan(0);
    expect(screen.getByText("Reply to **Alice**")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "done" } });
    expect(await screen.findByText(/Done · Today/)).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("applies only server-returned state after creating an item", async () => {
    const next = makeState(2);
    next.items.push({ ...next.items[0]!, id: "td-4", titleMarkdown: "New reminder", categoryId: "cat-inbox" });
    mocks.createTodoItem.mockResolvedValue({ state: next, item: next.items.at(-1) });
    render(<TodoListPanel />);

    const input = await screen.findByLabelText("New to-do title");
    fireEvent.change(input, { target: { value: "New reminder" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocks.createTodoItem).toHaveBeenCalledWith({
        titleMarkdown: "New reminder",
        detailsMarkdown: undefined,
        categoryId: "cat-inbox",
        status: "todo",
      }),
    );
    expect(await screen.findByText("New reminder")).toBeInTheDocument();
  });

  it("refetches after the server broadcasts a multi-browser invalidation", async () => {
    const next = makeState(2);
    next.items[0] = { ...next.items[0]!, titleMarkdown: "Updated elsewhere" };
    mocks.getTodoState.mockResolvedValueOnce(makeState()).mockResolvedValueOnce(next);
    render(<TodoListPanel />);
    expect(await screen.findByText("Reply to **Alice**")).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT, { detail: { revision: 2, updatedAt: 200 } }));
    expect(await screen.findByText("Updated elsewhere")).toBeInTheDocument();
    expect(mocks.getTodoState).toHaveBeenCalledTimes(2);
  });

  it("exposes proposal approval and conservative category archival controls", async () => {
    mocks.resolveTodoProposal.mockResolvedValue({ state: { ...makeState(2), proposals: [] } });
    render(<TodoListPanel />);
    await screen.findByText("Personal To-dos");

    fireEvent.click(screen.getByRole("button", { name: "proposals (1)" }));
    expect(screen.getByText("Add “Read the result”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.resolveTodoProposal).toHaveBeenCalledWith("tp-1", "approve"));

    fireEvent.click(screen.getByRole("button", { name: "categories" }));
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    expect(archiveButtons.some((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("restores archived categories before their archived items can return", async () => {
    const archived = makeState();
    archived.categories.push({
      id: "cat-archived",
      name: "Old list",
      createdAt: 1,
      updatedAt: 2,
      archivedAt: 2,
      createdBy: provenance,
      lastModifiedBy: provenance,
    });
    mocks.getTodoState.mockResolvedValue(archived);
    const restored = makeState(2);
    restored.categories.push({
      id: "cat-archived",
      name: "Old list",
      createdAt: 1,
      updatedAt: 3,
      createdBy: provenance,
      lastModifiedBy: provenance,
    });
    mocks.restoreTodoCategory.mockResolvedValue({ state: restored, category: restored.categories.at(-1) });
    render(<TodoListPanel />);
    await screen.findByText("Personal To-dos");

    fireEvent.click(screen.getByRole("button", { name: "categories" }));
    expect(screen.getByText("Old list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mocks.restoreTodoCategory).toHaveBeenCalledWith("cat-archived"));
  });
});
