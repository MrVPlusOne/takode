// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoState } from "../../shared/todo-types.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { useStore } from "../store.js";

const mocks = vi.hoisted(() => ({
  getTodoState: vi.fn(),
  getTodoLinkedQuests: vi.fn(),
  getTodoItemSummaries: vi.fn(),
  createTodoItem: vi.fn(),
  editTodoItem: vi.fn(),
  setTodoItemStatus: vi.fn(),
  setTodoItemDue: vi.fn(),
  undoTodoCompletion: vi.fn(),
  moveTodoItem: vi.fn(),
  archiveTodoItem: vi.fn(),
  restoreTodoItem: vi.fn(),
  createTodoCategory: vi.fn(),
  renameTodoCategory: vi.fn(),
  archiveTodoCategory: vi.fn(),
  restoreTodoCategory: vi.fn(),
}));

vi.mock("../api.js", () => ({ api: mocks }));
const celebrate = vi.hoisted(() => vi.fn());
vi.mock("./completion-celebration.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./completion-celebration.js")>()),
  playCompletionCelebration: celebrate,
}));
vi.mock("./MarkdownContent.js", () => ({
  MarkdownContent: ({ text }: { text: string }) => <span data-testid="todo-markdown">{text}</span>,
}));

import { TodoListPanel } from "./TodoListPanel.js";

const provenance = { actor: { kind: "user" as const, label: "User" }, authorization: { kind: "ui" as const }, at: 100 };

function makeState(revision = 1): TodoState {
  return {
    schemaVersion: 3,
    revision,
    updatedAt: revision * 100,
    nextItemId: 5,
    nextCategoryId: 2,
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
      {
        id: "td-4",
        markdown: "Plan the offsite",
        rank: 2048,
        categoryId: "cat-inbox",
        status: "todo",
        createdAt: 100,
        updatedAt: 100,
        statusChangedAt: 100,
        createdBy: provenance,
        lastModifiedBy: provenance,
      },
    ],
  };
}

const rowOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-todo-id="${id}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getTodoState.mockResolvedValue(makeState());
  mocks.getTodoLinkedQuests.mockResolvedValue({ quests: [], revision: 1 });
  mocks.getTodoItemSummaries.mockResolvedValue({ items: [], revision: 1 });
});

describe("TodoListPanel", () => {
  it("shows linked quests as read-only status chips that open the quest", async () => {
    // Links are metadata on the item; their status comes from the server's
    // linked-quest lookup, not from the to-do state.
    const state = makeState();
    state.items[1] = { ...state.items[1]!, questIds: ["q-7", "q-8", "q-9"] };
    mocks.getTodoState.mockResolvedValue(state);
    mocks.getTodoLinkedQuests.mockResolvedValue({
      quests: [
        { questId: "q-7", status: "done", title: "Build the export" },
        { questId: "q-8", status: "cancelled", title: "Dropped idea" },
      ],
      revision: 1,
    });
    useStore.getState().reset();
    window.location.hash = "#/todos";
    render(<TodoListPanel />);

    const chips = await screen.findByLabelText("Linked quests");
    await waitFor(() => expect(within(chips).getByRole("link", { name: /q-7\s*Done/ })).toBeInTheDocument());
    expect(within(chips).getByRole("link", { name: /q-8\s*Cancelled/ })).toBeInTheDocument();
    // A quest the lookup has not reported shows its ID without a status.
    expect(within(chips).getByRole("link", { name: "q-9" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Linked quests")).toHaveLength(1);

    // Clicking a chip opens the quest instead of the row's to-do sheet.
    fireEvent.click(within(chips).getByRole("link", { name: /q-7/ }));
    expect(useStore.getState().questOverlayId).toBe("q-7");
    expect(screen.queryByTestId("todo-preview")).not.toBeInTheDocument();
  });

  it("keeps the header to one row with an even status filter, and Done as one collapsed history", async () => {
    render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");
    // No repeated page title or description above the list.
    expect(screen.queryByText("Personal To-dos")).not.toBeInTheDocument();

    // The status filter is one segmented group with counts; current means Todo plus Doing.
    const filter = screen.getByRole("group", { name: "Filter by status" });
    expect(
      within(filter)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All3", "Todo2", "Doing1", "Done1", "Archived"]);
    // Details stay out of the list; the row only hints that there are some.
    expect(screen.queryByText("[Thread](https://example.slack.com/thread)")).not.toBeInTheDocument();
    expect(within(rowOf(document.body, "td-1")).getByTitle("Has details")).toBeInTheDocument();

    const doneSection = screen.getByTestId("todo-done-section");
    expect(doneSection).not.toHaveAttribute("open");
    fireEvent.click(within(doneSection).getByText("Done"));
    expect(doneSection).toHaveAttribute("open");
    expect(within(doneSection).getByText("Today")).toBeInTheDocument();
    // Done rows name their category.
    expect(within(rowOf(doneSection, "td-3")).getByText("Inbox")).toBeInTheDocument();

    // Choosing Doing shows only Doing rows.
    fireEvent.click(within(filter).getByRole("button", { name: /^Doing/ }));
    expect(screen.getByText("Review result")).toBeInTheDocument();
    expect(screen.queryByText("Plan the offsite")).not.toBeInTheDocument();
  });

  it("collapses a category, remembers it, and still shows how many of its items are overdue", async () => {
    const state = makeState();
    state.items[3] = { ...state.items[3]!, due: "2020-01-02" };
    mocks.getTodoState.mockResolvedValue(state);
    const { unmount } = render(<TodoListPanel />);
    await screen.findByText("Plan the offsite");

    const inbox = screen.getByRole("region", { name: "Inbox" });
    fireEvent.click(within(inbox).getByRole("button", { name: /^Inbox/ }));
    expect(screen.queryByText("Plan the offsite")).not.toBeInTheDocument();
    expect(within(inbox).getByText("1 overdue")).toBeInTheDocument();

    // A search still finds items in a collapsed category.
    fireEvent.change(screen.getByLabelText("Search to-dos"), { target: { value: "offsite" } });
    expect(screen.getByText("Plan the offsite")).toBeInTheDocument();

    // Collapsed categories survive leaving and reopening the page.
    unmount();
    render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");
    expect(screen.queryByText("Plan the offsite")).not.toBeInTheDocument();
  });

  it("adds to-dos in a run from New: Enter adds and keeps the box, a dropdown picks the category", async () => {
    const afterFirst = makeState(2);
    afterFirst.items.push({ ...afterFirst.items[3]!, id: "td-5", markdown: "Book flights", rank: 4096 });
    mocks.createTodoItem.mockResolvedValue({ state: afterFirst, item: afterFirst.items.at(-1) });
    render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const composer = screen.getByTestId("todo-composer");
    const box = within(composer).getByLabelText("New to-do");
    expect(box).toHaveFocus();
    // The category is a dropdown, defaulting to the first category.
    const category = within(composer).getByLabelText("Category");
    expect(category).toHaveValue("cat-inbox");
    fireEvent.change(category, { target: { value: "cat-1" } });

    // Shift+Enter is a new details line, not a save.
    fireEvent.change(box, { target: { value: "Book flights" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(mocks.createTodoItem).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.createTodoItem).toHaveBeenCalledWith({
        markdown: "Book flights",
        categoryId: "cat-1",
        status: "todo",
      }),
    );
    // The box stays open and empty for the next one.
    await waitFor(() =>
      expect(within(screen.getByTestId("todo-composer")).getByLabelText("New to-do")).toHaveValue(""),
    );
    expect(await screen.findByText("Book flights")).toBeInTheDocument();

    // Clicking away with nothing typed just closes it; Escape discards a draft.
    fireEvent.blur(screen.getByLabelText("New to-do"), { relatedTarget: screen.getByLabelText("Search to-dos") });
    expect(screen.queryByTestId("todo-composer")).not.toBeInTheDocument();
    expect(mocks.createTodoItem).toHaveBeenCalledTimes(1);
  });

  it("keeps a draft that failed to save on click-away, with Retry and Copy draft", async () => {
    const saved = makeState(2);
    saved.items.push({ ...saved.items[3]!, id: "td-5", markdown: "Recovered draft", rank: 4096 });
    mocks.createTodoItem
      .mockRejectedValueOnce(new Error("Server unavailable"))
      .mockResolvedValueOnce({ state: saved, item: saved.items.at(-1) });
    render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");

    fireEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));
    const box = screen.getByLabelText("New to-do");
    fireEvent.change(box, { target: { value: "Recovered draft" } });
    fireEvent.blur(box, { relatedTarget: screen.getByLabelText("Search to-dos") });

    expect(await screen.findByText(/your draft is still here/)).toBeInTheDocument();
    expect(screen.getByLabelText("New to-do")).toHaveValue("Recovered draft");
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.createTodoItem).toHaveBeenCalledTimes(2));
    expect(mocks.createTodoItem).toHaveBeenLastCalledWith({
      markdown: "Recovered draft",
      categoryId: "cat-inbox",
      status: "todo",
    });
    expect(await screen.findByText("Recovered draft")).toBeInTheDocument();
  });

  it("adds below the focused row with Alt+Enter, and each next Enter below the one just added", async () => {
    const first = makeState(2);
    first.items.push({ ...first.items[0]!, id: "td-5", markdown: "First", rank: 1536 });
    const second = makeState(3);
    second.items.push(first.items.at(-1)!, { ...first.items[0]!, id: "td-6", markdown: "Second", rank: 1792 });
    mocks.createTodoItem
      .mockResolvedValueOnce({ state: first, item: first.items.at(-1) })
      .mockResolvedValueOnce({ state: second, item: second.items.at(-1) });
    render(<TodoListPanel />);

    fireEvent.keyDown(await screen.findByRole("button", { name: "Open Reply to **Alice**" }), {
      key: "Enter",
      altKey: true,
    });
    const box = screen.getByLabelText("New to-do");
    fireEvent.change(box, { target: { value: "First" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.createTodoItem).toHaveBeenCalledWith({
        markdown: "First",
        categoryId: "cat-1",
        status: "todo",
        afterItemId: "td-1",
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("New to-do")).toHaveValue(""));
    fireEvent.change(screen.getByLabelText("New to-do"), { target: { value: "Second" } });
    fireEvent.keyDown(screen.getByLabelText("New to-do"), { key: "Enter" });
    await waitFor(() =>
      expect(mocks.createTodoItem).toHaveBeenLastCalledWith(expect.objectContaining({ afterItemId: "td-5" })),
    );
  });

  it("completes in one tap and offers exact Undo in a toast", async () => {
    const completed = makeState(2);
    completed.items[0] = { ...completed.items[0]!, status: "done", completedAt: 500 };
    mocks.setTodoItemStatus.mockResolvedValue({
      state: completed,
      item: completed.items[0],
      completionUndo: { token: "undo-1", itemId: "td-1", expiresAt: Date.now() + 60_000 },
    });
    mocks.undoTodoCompletion.mockResolvedValue({ state: makeState(3), item: makeState(3).items[0] });
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete Reply to **Alice**" }));
    await waitFor(() => expect(mocks.setTodoItemStatus).toHaveBeenCalledWith("td-1", "done"));
    // The small celebration plays once the server confirms the completion.
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Done: Reply to **Alice**");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.undoTodoCompletion).toHaveBeenCalledWith("td-1", "undo-1"));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("opens a row's sheet with every action: category dropdown, due date, order and archive", async () => {
    const { container } = render(<TodoListPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Review result" }));
    const sheet = await screen.findByTestId("todo-preview");
    await within(sheet).findByText("Review result");
    // On the page itself there is no "Open to-dos" link back to it.
    expect(within(sheet).queryByRole("link", { name: "Open to-dos" })).not.toBeInTheDocument();

    mocks.moveTodoItem.mockResolvedValue({ state: makeState(2) });
    fireEvent.change(within(sheet).getByLabelText("Category"), { target: { value: "cat-1" } });
    await waitFor(() => expect(mocks.moveTodoItem).toHaveBeenCalledWith("td-2", { categoryId: "cat-1" }));

    // td-2 is first in Inbox: it can move down below td-4 but not up.
    expect(within(sheet).getByRole("button", { name: "↑ Move up" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "↓ Move down" }));
    await waitFor(() => expect(mocks.moveTodoItem).toHaveBeenLastCalledWith("td-2", { afterItemId: "td-4" }));

    // Due dates: one tap for Tomorrow, or Date… for an exact date and time saved only on Set.
    const due = makeState(4);
    due.items[1] = { ...due.items[1]!, due: "2026-11-03T16:45" };
    mocks.setTodoItemDue.mockResolvedValueOnce({ state: makeState(3) }).mockResolvedValueOnce({ state: due });
    const shortcuts = within(sheet).getByRole("group", { name: "Due date shortcuts" });
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Tomorrow" }));
    await waitFor(() =>
      expect(mocks.setTodoItemDue).toHaveBeenCalledWith("td-2", expect.stringMatching(/^\d{4}-\d\d-\d\d$/)),
    );
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Date…" }));
    fireEvent.change(within(sheet).getByLabelText("Due date"), { target: { value: "2026-11-03" } });
    fireEvent.change(within(sheet).getByLabelText("Due time (optional)"), { target: { value: "16:45" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(mocks.setTodoItemDue).toHaveBeenLastCalledWith("td-2", "2026-11-03T16:45"));
    await waitFor(() => expect(within(rowOf(container, "td-2")).getByTestId("todo-due-label")).toBeInTheDocument());
    mocks.setTodoItemDue.mockResolvedValue({ state: makeState(5) });
    fireEvent.click(await within(sheet).findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(mocks.setTodoItemDue).toHaveBeenLastCalledWith("td-2", null));

    mocks.archiveTodoItem.mockResolvedValue({ state: makeState(6) });
    fireEvent.click(within(sheet).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mocks.archiveTodoItem).toHaveBeenCalledWith("td-2"));
  });

  it("marks only overdue current rows", async () => {
    // td-1 is long overdue, td-2 is due far in the future, and the Done td-3 is past its date but never overdue.
    const state = makeState();
    state.items[0] = { ...state.items[0]!, due: "2020-01-02" };
    state.items[1] = { ...state.items[1]!, due: "2999-01-02T09:30" };
    state.items[2] = { ...state.items[2]!, due: "2020-01-02" };
    mocks.getTodoState.mockResolvedValue(state);
    const { container } = render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");

    expect(rowOf(container, "td-1")).toHaveAttribute("data-overdue", "true");
    expect(within(rowOf(container, "td-1")).getByTestId("todo-due-label")).toHaveTextContent(
      /Overdue, due Jan 2, 2020/,
    );
    expect(rowOf(container, "td-2")).not.toHaveAttribute("data-overdue");
    expect(within(rowOf(container, "td-2")).getByTestId("todo-due-label")).toHaveTextContent(/Jan 2, 2999/);
    expect(container.querySelector('[data-todo-id="td-3"] [data-testid="todo-due-label"]')).toBeNull();
  });

  it("swipes right on touch to complete and left to reveal Start and More; a mouse never swipes", async () => {
    mocks.setTodoItemStatus.mockResolvedValue({ state: makeState(2) });
    const { container } = render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");
    const swipe = (id: string, dx: number, pointerType = "touch") => {
      const row = rowOf(container, id);
      fireEvent.pointerDown(row, { pointerType, clientX: 100, clientY: 50, pointerId: 1 });
      for (const step of [0.25, 0.5, 1]) {
        fireEvent.pointerMove(row, { pointerType, clientX: 100 + dx * step, clientY: 52, pointerId: 1 });
      }
      fireEvent.pointerUp(row, { pointerType, clientX: 100 + dx, clientY: 52, pointerId: 1 });
    };

    // A mouse drag across the row does nothing.
    swipe("td-1", 150, "mouse");
    expect(mocks.setTodoItemStatus).not.toHaveBeenCalled();

    swipe("td-1", 150);
    await waitFor(() => expect(mocks.setTodoItemStatus).toHaveBeenCalledWith("td-1", "done"));

    // Left reveals Start for a Todo row; the tap that follows the swipe does not open the sheet.
    // act() batches the whole gesture into one render, as a fast real swipe can, so the release
    // must not depend on a re-render after the last move.
    act(() => swipe("td-4", -100));
    fireEvent.click(within(rowOf(container, "td-4")).getByRole("button", { name: "Open Plan the offsite" }));
    expect(screen.queryByTestId("todo-preview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(mocks.setTodoItemStatus).toHaveBeenLastCalledWith("td-4", "doing"));
    act(() => swipe("td-4", -100));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByTestId("todo-preview")).toBeInTheDocument();
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
    // Reopening is not a completion, so nothing celebrates.
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("uses the full row as the drag preview and shows an insertion placeholder", async () => {
    mocks.moveTodoItem.mockResolvedValue({ state: makeState(2), item: makeState(2).items[0] });
    const { container } = render(<TodoListPanel />);
    const setDragImage = vi.fn();
    const dataTransfer = { effectAllowed: "none", setData: vi.fn(), setDragImage };

    const handle = await screen.findByRole("button", { name: "Drag Reply to **Alice**" });
    fireEvent.dragStart(handle, { dataTransfer });
    expect(setDragImage).toHaveBeenCalledWith(expect.objectContaining({ dataset: expect.anything() }), 24, 0);

    const targetRow = rowOf(container, "td-2");
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

  it("keeps category administration behind the Manage categories button", async () => {
    render(<TodoListPanel />);
    await screen.findByText("Reply to **Alice**");

    fireEvent.click(screen.getByRole("button", { name: "Manage categories" }));
    expect(screen.getByTestId("todo-management-drawer")).toBeInTheDocument();
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    expect(archiveButtons.some((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("says in an agent-added to-do's sheet who added it and where it came from", async () => {
    // The user dismisses unwanted agent additions by archiving, so the sheet with Archive also
    // shows which agent added the to-do and from where.
    const state = makeState();
    state.items[1] = {
      ...state.items[1]!,
      createdBy: {
        actor: { kind: "workflow", workflowId: "briefing", label: "Daily briefing" },
        authorization: { kind: "agent_direct" },
        at: Date.now() - 2 * 3_600_000,
        source: "Slack DM from Junhong",
      },
    };
    mocks.getTodoState.mockResolvedValue(state);
    render(<TodoListPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Review result" }));
    expect(await screen.findByTestId("todo-provenance")).toHaveTextContent(
      "Added by Daily briefing 2h ago · from Slack DM from Junhong",
    );
  });
});
