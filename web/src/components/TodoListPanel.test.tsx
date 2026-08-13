// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  undoTodoCompletion: vi.fn(),
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
    schemaVersion: 2,
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
        markdown: "Reply to **Alice**\n[Thread](https://example.slack.com/thread)",
        rank: 1024,
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
        markdown: "Review result",
        rank: 1024,
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
        markdown: "Finished",
        rank: 1024,
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
        mutation: { action: "item:add", input: { markdown: "Read the result\nAgent context" } },
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
  it("renders the lightweight category outline and one collapsed Done history with visible category labels", async () => {
    render(<TodoListPanel />);
    expect(await screen.findByText("Personal To-dos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Doing 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done 1" })).toBeInTheDocument();
    expect(screen.getAllByText("Slack").length).toBeGreaterThan(0);
    expect(screen.getByText("Reply to **Alice**")).toBeInTheDocument();
    expect(screen.queryByText("[Thread](https://example.slack.com/thread)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Expand details for Reply to **Alice**"));
    expect(screen.getByText("[Thread](https://example.slack.com/thread)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status for Reply to **Alice**")).not.toBeInTheDocument();
    const doneSection = screen.getByTestId("todo-done-section");
    expect(doneSection).not.toHaveAttribute("open");
    fireEvent.click(within(doneSection).getByText("▸ Done"));
    expect(doneSection).toHaveAttribute("open");
    expect(within(doneSection).getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(within(doneSection).getByTitle("Inbox")).toBeInTheDocument();
  });

  it("saves the exact raw Markdown body on click-away and applies only the returned server state", async () => {
    const next = makeState(2);
    next.items[0] = { ...next.items[0]!, markdown: "Updated title\nUpdated detail", updatedAt: 400 };
    mocks.editTodoItem.mockResolvedValue({ state: next, item: next.items[0] });
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Reply to **Alice**" }));
    const editor = screen.getByLabelText("Edit Reply to **Alice**");
    expect(editor).toHaveValue("Reply to **Alice**\n[Thread](https://example.slack.com/thread)");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "Updated title\nUpdated detail" } });
    fireEvent.blur(editor, { relatedTarget: screen.getByRole("button", { name: "Manage · 1" }) });

    await waitFor(() =>
      expect(mocks.editTodoItem).toHaveBeenCalledWith("td-1", { markdown: "Updated title\nUpdated detail" }),
    );
    expect(await screen.findByText("Updated title")).toBeInTheDocument();
  });

  it("retains a failed blur-save draft and exposes retry plus draft recovery", async () => {
    const next = makeState(2);
    next.items[0] = { ...next.items[0]!, markdown: "Recovered draft", updatedAt: 400 };
    mocks.editTodoItem.mockRejectedValueOnce(new Error("Server unavailable")).mockResolvedValueOnce({
      state: next,
      item: next.items[0],
    });
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Reply to **Alice**" }));
    const editor = screen.getByLabelText("Edit Reply to **Alice**");
    fireEvent.change(editor, { target: { value: "Recovered draft" } });
    fireEvent.blur(editor, { relatedTarget: screen.getByRole("button", { name: "Manage · 1" }) });

    expect(await screen.findByText(/Save failed; your draft is still here/)).toBeInTheDocument();
    expect(screen.getByLabelText("Edit Reply to **Alice**")).toHaveValue("Recovered draft");
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.editTodoItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("Edit Reply to **Alice**")).not.toBeInTheDocument());
    expect(screen.getByText("Recovered draft")).toBeInTheDocument();
  });

  it("inserts a new item directly below the focused row with a keyboard interaction", async () => {
    const next = makeState(2);
    next.items.push({
      ...next.items[0]!,
      id: "td-4",
      markdown: "New reminder\nContext",
      rank: 2048,
    });
    mocks.createTodoItem.mockResolvedValue({ state: next, item: next.items.at(-1) });
    render(<TodoListPanel />);

    const row = await screen.findByRole("button", { name: "Edit Reply to **Alice**" });
    fireEvent.keyDown(row, { key: "Enter", altKey: true });
    const editor = screen.getByLabelText("New to-do Markdown");
    fireEvent.change(editor, { target: { value: "New reminder\nContext" } });
    fireEvent.blur(editor, { relatedTarget: screen.getByRole("button", { name: "Manage · 1" }) });

    await waitFor(() =>
      expect(mocks.createTodoItem).toHaveBeenCalledWith({
        markdown: "New reminder\nContext",
        categoryId: "cat-1",
        status: "todo",
        afterItemId: "td-1",
      }),
    );
    expect(await screen.findByText("New reminder")).toBeInTheDocument();
  });

  it("completes in one click, offers exact Undo, and keeps Todo/Doing in the compact overflow", async () => {
    const completed = makeState(2);
    completed.items[0] = { ...completed.items[0]!, status: "done", completedAt: 500 };
    mocks.setTodoItemStatus.mockResolvedValue({
      state: completed,
      item: completed.items[0],
      completionUndo: { token: "undo-1", itemId: "td-1", expiresAt: Date.now() + 60_000 },
    });
    mocks.undoTodoCompletion.mockResolvedValue({ state: makeState(3), item: makeState(3).items[0] });
    mocks.moveTodoItem.mockResolvedValue({ state: makeState(2), item: makeState(2).items[0] });
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete Reply to **Alice**" }));
    await waitFor(() => expect(mocks.setTodoItemStatus).toHaveBeenCalledWith("td-1", "done"));
    expect(await screen.findByText("Moved “Reply to **Alice**” to Done.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.undoTodoCompletion).toHaveBeenCalledWith("td-1", "undo-1"));

    const more = screen.getByLabelText("More actions for Review result");
    fireEvent.click(more);
    const menu = more.parentElement!;
    expect(within(menu).getByRole("button", { name: "Move to Todo" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Add item below" })).toBeInTheDocument();
    fireEvent.change(within(menu).getByLabelText("Move td-2 to category"), { target: { value: "cat-1" } });
    await waitFor(() => expect(mocks.moveTodoItem).toHaveBeenCalledWith("td-2", { categoryId: "cat-1" }));
    expect(menu).not.toHaveAttribute("open");
  });

  it("reopens a Done item to Todo from the leading marker", async () => {
    const reopened = makeState(2);
    reopened.items[2] = {
      ...reopened.items[2]!,
      status: "todo",
      statusChangedAt: 400,
      updatedAt: 400,
      completedAt: undefined,
    };
    mocks.setTodoItemStatus.mockResolvedValue({ state: reopened, item: reopened.items[2] });
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Reopen Finished" }));
    await waitFor(() => expect(mocks.setTodoItemStatus).toHaveBeenCalledWith("td-3", "todo"));
    expect(await screen.findByText("Finished")).toBeInTheDocument();
  });

  it("uses the full row as the drag preview and shows an insertion placeholder", async () => {
    mocks.moveTodoItem.mockResolvedValue({ state: makeState(2), item: makeState(2).items[0] });
    render(<TodoListPanel />);
    const setDragImage = vi.fn();
    const dataTransfer = { effectAllowed: "none", setData: vi.fn(), setDragImage };

    const handle = await screen.findByRole("button", { name: "Drag Reply to **Alice**" });
    fireEvent.dragStart(handle, { dataTransfer });
    expect(setDragImage).toHaveBeenCalledWith(expect.objectContaining({ dataset: expect.anything() }), 24, 0);

    const targetRow = screen.getByRole("button", { name: "Edit Review result" }).closest("[data-todo-id]")!;
    vi.spyOn(targetRow, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      right: 500,
      bottom: 180,
      width: 500,
      height: 80,
      toJSON: () => ({}),
    });
    fireEvent.dragOver(targetRow, { dataTransfer, clientY: 10 });
    expect(await screen.findByTestId("todo-drop-placeholder")).toBeInTheDocument();
    fireEvent.drop(targetRow, { dataTransfer, clientY: 10 });
    await waitFor(() =>
      expect(mocks.moveTodoItem).toHaveBeenCalledWith("td-1", { categoryId: "cat-inbox", afterItemId: "td-2" }),
    );
  });

  it("refetches after the server broadcasts a multi-browser invalidation", async () => {
    const next = makeState(2);
    next.items[0] = { ...next.items[0]!, markdown: "Updated elsewhere" };
    mocks.getTodoState.mockResolvedValueOnce(makeState()).mockResolvedValueOnce(next);
    render(<TodoListPanel />);
    expect(await screen.findByText("Reply to **Alice**")).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT, { detail: { revision: 2, updatedAt: 200 } }));
    expect(await screen.findByText("Updated elsewhere")).toBeInTheDocument();
    expect(mocks.getTodoState).toHaveBeenCalledTimes(2);
  });

  it("keeps proposals and category administration behind the compact management drawer", async () => {
    mocks.resolveTodoProposal.mockResolvedValue({ state: { ...makeState(2), proposals: [] } });
    render(<TodoListPanel />);
    await screen.findByText("Personal To-dos");

    fireEvent.click(screen.getByRole("button", { name: "Manage · 1" }));
    expect(screen.getByTestId("todo-management-drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "proposals (1)" }));
    expect(screen.getByText("Add “Read the result”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.resolveTodoProposal).toHaveBeenCalledWith("tp-1", "approve"));

    fireEvent.click(screen.getByRole("button", { name: "categories" }));
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    expect(archiveButtons.some((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
