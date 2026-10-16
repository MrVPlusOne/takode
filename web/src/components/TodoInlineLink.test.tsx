// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TodoItem, TodoProposal, TodoState } from "../../shared/todo-types.js";
import { useStore } from "../store.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { type TodoLinkSource, TodoLinkSourceContext } from "./TodoInlineLink.js";

const SYSTEM = { actor: { kind: "system" as const }, authorization: { kind: "bootstrap" as const }, at: 1 };

function proposal(overrides: Partial<TodoProposal> = {}): TodoProposal {
  return {
    id: "tp-36",
    mutation: {
      action: "item:add",
      input: {
        markdown: "Review Junhong's PR 98888\nMixture-weight change; may only need the stamp.",
        categoryId: "cat-work",
      },
    },
    status: "pending",
    createdAt: Date.now() - 2 * 3_600_000,
    updatedAt: Date.now() - 2 * 3_600_000,
    requestedBy: { kind: "session", sessionId: "session-2978", label: "2978" },
    ...overrides,
  };
}

function todoState(proposals: TodoProposal[], revision = 5): TodoState {
  return {
    schemaVersion: 2,
    revision,
    updatedAt: 1,
    nextItemId: 2,
    nextCategoryId: 2,
    nextProposalId: 37,
    nextGrantId: 1,
    categories: [
      { id: "cat-inbox", name: "Inbox", createdAt: 1, updatedAt: 1, createdBy: SYSTEM, lastModifiedBy: SYSTEM },
      { id: "cat-work", name: "Work", createdAt: 1, updatedAt: 1, createdBy: SYSTEM, lastModifiedBy: SYSTEM },
    ],
    items: [
      {
        id: "td-1",
        markdown: "Reply to Alice\nOld detail",
        rank: 1024,
        categoryId: "cat-inbox",
        status: "todo",
        createdAt: 1,
        updatedAt: 1,
        statusChangedAt: 1,
        createdBy: SYSTEM,
        lastModifiedBy: SYSTEM,
      },
    ],
    proposals,
    grants: [],
  };
}

/** The list with its one to-do (td-1, "Reply to Alice") changed by `overrides`. */
function withItem(overrides: Partial<TodoItem>, revision = 5): TodoState {
  const state = todoState([], revision);
  state.items[0] = { ...state.items[0]!, ...overrides };
  return state;
}

const statusButton = (name: string) =>
  within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name });

// Preview tests don't care about the link markers, so their statuses default to an empty list, and
// each test supplies only the to-do changes it exercises.
type PreviewSource = Pick<TodoLinkSource, "loadState" | "resolve"> & Partial<TodoLinkSource>;

const fullSources = new WeakMap<PreviewSource, TodoLinkSource>();

// The same partial source always gives the same full one: proposal statuses are cached per source.
function fullSource(source: PreviewSource): TodoLinkSource {
  const known = fullSources.get(source);
  if (known) return known;
  const full: TodoLinkSource = {
    loadProposalStatuses: async () => ({ statuses: {}, revision: 0 }),
    setItemStatus: vi.fn(),
    editItem: vi.fn(),
    setItemDue: vi.fn(),
    undoCompletion: vi.fn(),
    ...source,
  };
  fullSources.set(source, full);
  fullSources.set(full, full);
  return full;
}

function renderLink(source: PreviewSource, text = "The [PR 98888 review](todo:tp-36) may only need the stamp.") {
  return render(
    <TodoLinkSourceContext.Provider value={fullSource(source)}>
      <MarkdownContent text={text} />
    </TodoLinkSourceContext.Provider>,
  );
}

describe("to-do and proposal links", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-2978",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 2978,
          name: "Briefing Worker",
        },
      ],
    }));
  });

  it("opens a preview of an add proposal on tap and approves it from there", async () => {
    // The link label is the agent's summary; the preview resolves the proposal from the live list
    // (category name, requester session) and Approve goes through the proposal's own resolve path.
    const resolve = vi.fn(async () => ({
      state: todoState([proposal({ status: "approved", resolvedAt: Date.now() })], 6),
    }));
    const source = { loadState: vi.fn(async () => todoState([proposal()])), resolve };
    renderLink(source);

    const link = screen.getByRole("link", { name: "PR 98888 review" });
    // The href is the to-dos page, so opening the link in a new tab still lands somewhere useful.
    expect(link.getAttribute("href")).toBe("#/scheduled");
    fingerTap(link);

    const dialog = await screen.findByRole("dialog", { name: "To-do proposal" });
    await screen.findByText("Review Junhong's PR 98888");
    expect(dialog.textContent).toContain("Add to-do");
    expect(dialog.textContent).toContain("Mixture-weight change; may only need the stamp.");
    expect(dialog.textContent).toContain("In Work");
    expect(dialog.textContent).toContain("#2978 Briefing Worker");
    expect(screen.getByTestId("todo-preview-status").textContent).toBe("Pending");

    fireEvent.click(screen.getByTestId("todo-proposal-approve"));
    expect(resolve).toHaveBeenCalledWith("tp-36", "approve");
    await waitFor(() => expect(screen.getByTestId("todo-preview-status").textContent).toBe("Approved"));
    // A resolved proposal shows a receipt instead of the decision buttons.
    expect(screen.queryByTestId("todo-proposal-approve")).toBeNull();
    expect(screen.getByTestId("todo-preview-footer-status").textContent).toContain("Approved");
  });

  it("marks an add proposal done from its preview", async () => {
    // The to-do may already be done by the time the user reads the proposal: one tap approves it
    // and records it as done, and the receipt says so.
    const resolve = vi.fn(async () => ({
      state: todoState([proposal({ status: "approved", markedDone: true, resolvedAt: Date.now() })], 6),
    }));
    renderLink({ loadState: async () => todoState([proposal()]), resolve });
    fingerTap(screen.getByRole("link", { name: "PR 98888 review" }));

    fireEvent.click(await screen.findByTestId("todo-proposal-mark-done"));
    expect(resolve).toHaveBeenCalledWith("tp-36", "mark-done");
    await waitFor(() => expect(screen.getByTestId("todo-preview-footer-status").textContent).toContain("Marked done"));
    expect(screen.queryByTestId("todo-proposal-mark-done")).toBeNull();
  });

  it("shows the current text next to an edit proposal and rejects without approving", async () => {
    // Approval replaces whatever the to-do says now, so the preview must show that alongside the proposal.
    const edit = proposal({
      mutation: { action: "item:edit", itemId: "td-1", input: { markdown: "Reply to Alice today" } },
    });
    const resolve = vi.fn(async () => ({ state: todoState([{ ...edit, status: "rejected" }], 6) }));
    renderLink({ loadState: async () => todoState([edit]), resolve });

    fireEvent.click(screen.getByRole("link", { name: "PR 98888 review" }));
    await screen.findByText("Reply to Alice today");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Current");
    expect(dialog.textContent).toContain("Old detail");
    // An edit adds no new to-do, so there is nothing to mark done.
    expect(screen.queryByTestId("todo-proposal-mark-done")).toBeNull();

    fireEvent.click(screen.getByTestId("todo-proposal-reject"));
    expect(resolve).toHaveBeenCalledWith("tp-36", "reject");
    await waitFor(() => expect(screen.getByTestId("todo-preview-status").textContent).toBe("Rejected"));
  });

  it("refreshes when the list changes elsewhere and ignores older snapshots", async () => {
    // A proposal resolved in another tab or by the CLI must not stay approvable in an open preview.
    const loadState = vi
      .fn<() => Promise<TodoState>>()
      .mockResolvedValueOnce(todoState([proposal()], 5))
      .mockResolvedValueOnce(todoState([proposal({ status: "rejected", resolvedAt: Date.now() })], 6))
      .mockResolvedValueOnce(todoState([proposal()], 4));
    renderLink({ loadState, resolve: vi.fn() });

    fireEvent.click(screen.getByRole("link", { name: "PR 98888 review" }));
    await screen.findByTestId("todo-proposal-approve");
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    await waitFor(() => expect(screen.getByTestId("todo-preview-status").textContent).toBe("Rejected"));
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    expect(loadState).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("todo-preview-status").textContent).toBe("Rejected");
  });

  it("previews an existing to-do with its status, category and linked quests", async () => {
    // Item links let agents name a to-do the user should look at, e.g. when describing a change for approval.
    const state = todoState([]);
    state.items[0] = { ...state.items[0]!, status: "doing", questIds: ["q-7"] };
    renderLink({ loadState: async () => state, resolve: vi.fn() }, "Ready to [reply to Alice](todo:td-1)?");

    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    const dialog = await screen.findByRole("dialog", { name: "To-do" });
    await screen.findByText("Reply to Alice");
    expect(dialog.textContent).toContain("Old detail");
    expect(dialog.textContent).toContain("In Inbox");
    expect(screen.getByRole("link", { name: "q-7" }).getAttribute("href")).toContain("q-7");
    // The status control at the bottom shows the status; there is no separate status chip.
    expect(statusButton("Doing").getAttribute("aria-pressed")).toBe("true");
    expect(statusButton("Todo").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("todo-preview-status")).toBeNull();
    // An item has nothing to decide: no Approve/Reject.
    expect(screen.queryByTestId("todo-proposal-approve")).toBeNull();
    expect(screen.getByRole("link", { name: "Open to-dos" }).getAttribute("href")).toBe("#/scheduled");
  });

  it("marks to-do and proposal links, with each proposal's status once it loads", async () => {
    // The marker tells to-do links apart from web links. Until the statuses load, a proposal's marker
    // keeps its place but stays invisible, so it never shows a wrong state and nothing shifts later.
    let finishLoad!: (value: { statuses: Record<string, TodoProposal["status"]>; revision: number }) => void;
    const loadProposalStatuses = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<TodoLinkSource["loadProposalStatuses"]>>>((resolve) => (finishLoad = resolve)),
    );
    const source = fullSource({ loadProposalStatuses, loadState: vi.fn(), resolve: vi.fn() });
    renderLink(
      source,
      "[Reply](todo:td-1), [pending](todo:tp-1), [approved](todo:tp-2), [rejected](todo:tp-3), [gone](todo:tp-4)",
    );

    const marker = (name: string) =>
      screen.getByRole("link", { name }).querySelector<SVGElement>('[data-testid="todo-link-marker"]')!;
    expect(marker("Reply").dataset.marker).toBe("item");
    const pendingMarker = marker("pending");
    expect(pendingMarker.dataset.status).toBe("loading");
    expect(pendingMarker.getAttribute("class")).toContain("invisible");
    // Every proposal link shares one load.
    await waitFor(() => expect(loadProposalStatuses).toHaveBeenCalledTimes(1));
    expect(marker("pending").dataset.status).toBe("loading");

    await act(async () =>
      finishLoad({ statuses: { "tp-1": "pending", "tp-2": "approved", "tp-3": "rejected" }, revision: 3 }),
    );
    // The same element changes state in place rather than being replaced.
    expect(marker("pending")).toBe(pendingMarker);
    expect(pendingMarker.dataset.status).toBe("pending");
    expect(pendingMarker.getAttribute("class")).not.toContain("invisible");
    expect(marker("approved").dataset.status).toBe("approved");
    expect(marker("rejected").dataset.status).toBe("rejected");
    expect(marker("gone").dataset.status).toBe("missing");
  });

  it("gives links shown later their status at once and keeps statuses current", async () => {
    // Scrolling or switching threads remounts links; they must render their final marker from the
    // shared statuses, not load and change in front of the user.
    const loadProposalStatuses = vi
      .fn<TodoLinkSource["loadProposalStatuses"]>()
      .mockResolvedValueOnce({ statuses: { "tp-36": "pending" }, revision: 5 })
      .mockResolvedValueOnce({ statuses: { "tp-36": "rejected" }, revision: 7 })
      .mockResolvedValueOnce({ statuses: { "tp-36": "pending" }, revision: 6 });
    const resolve = vi.fn(async () => ({
      state: todoState([proposal({ status: "approved", resolvedAt: Date.now() })], 6),
    }));
    const source = fullSource({ loadProposalStatuses, loadState: async () => todoState([proposal()], 5), resolve });
    const first = renderLink(source);
    const status = () => screen.getByRole("link", { name: "PR 98888 review" }).querySelector("svg")!.dataset.status;
    await waitFor(() => expect(status()).toBe("pending"));
    first.unmount();

    renderLink(source);
    expect(status()).toBe("pending");

    // Deciding in the preview updates the link right away, before any reload.
    fireEvent.click(screen.getByRole("link", { name: "PR 98888 review" }));
    fireEvent.click(await screen.findByTestId("todo-proposal-approve"));
    await waitFor(() => expect(status()).toBe("approved"));

    // A change elsewhere reloads the statuses; an answer older than what the page has is ignored.
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    await waitFor(() => expect(status()).toBe("rejected"));
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    expect(loadProposalStatuses).toHaveBeenCalledTimes(3);
    expect(status()).toBe("rejected");
  });

  it("moves a to-do to Done from its preview and offers the To-dos page's Undo", async () => {
    // Marking a to-do done is the main reason to act on it from a link. The server's short-lived
    // completion receipt gives the same Undo as the To-dos page, restoring the exact earlier status.
    const setItemStatus = vi.fn(async () => ({
      state: withItem({ status: "done", completedAt: Date.now() }, 6),
      completionUndo: { itemId: "td-1", token: "undo-token", expiresAt: Date.now() + 30_000 },
    }));
    const undoCompletion = vi.fn(async () => ({ state: withItem({ status: "doing" }, 7) }));
    renderLink(
      { loadState: async () => withItem({ status: "doing" }), resolve: vi.fn(), setItemStatus, undoCompletion },
      "[reply to Alice](todo:td-1)",
    );
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    await screen.findByText("Reply to Alice");

    fingerTap(statusButton("Done"));
    await waitFor(() => expect(statusButton("Done").getAttribute("aria-pressed")).toBe("true"));
    expect(setItemStatus).toHaveBeenCalledWith("td-1", "done");
    expect(screen.getByTestId("todo-preview-footer-status").textContent).toContain("Moved to Done");
    // A Done to-do has no due date to change, as on the To-dos page.
    expect(screen.queryByTestId("todo-preview-due")).toBeNull();

    fingerTap(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(statusButton("Doing").getAttribute("aria-pressed")).toBe("true"));
    expect(undoCompletion).toHaveBeenCalledWith("td-1", "undo-token");
    expect(screen.getByTestId("todo-preview-footer-status").textContent).toContain("Updated");
  });

  it("shows a failed change next to the controls and keeps the to-do as it was", async () => {
    const setItemStatus = vi.fn(async () => {
      throw new Error("Server unreachable");
    });
    renderLink({ loadState: async () => withItem({}), resolve: vi.fn(), setItemStatus }, "[reply to Alice](todo:td-1)");
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    await screen.findByText("Reply to Alice");

    fingerTap(statusButton("Doing"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not update the to-do. Server unreachable");
    expect(statusButton("Todo").getAttribute("aria-pressed")).toBe("true");
  });

  it("edits the to-do text in the preview without losing the draft to a stray tap", async () => {
    // Editing uses the To-dos page's rules: one Markdown body whose first line must stay non-empty.
    const editItem = vi.fn(async (_itemId: string, markdown: string) => ({ state: withItem({ markdown }, 6) }));
    renderLink({ loadState: async () => withItem({}), resolve: vi.fn(), editItem }, "[reply to Alice](todo:td-1)");
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    await screen.findByText("Reply to Alice");

    fingerTap(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "To-do text" });
    expect(editor.value).toBe("Reply to Alice\nOld detail");
    fireEvent.change(editor, { target: { value: "Reply to Alice\nNew detail" } });
    // A backdrop tap while editing keeps the preview, and the draft, open.
    fireEvent.click(screen.getByTestId("todo-preview-backdrop"));
    expect(screen.getByRole("textbox", { name: "To-do text" })).toBe(editor);
    // Escape leaves the editor without closing the preview or saving.
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "To-do text" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "To-do" }).textContent).toContain("Old detail");
    expect(editItem).not.toHaveBeenCalled();

    fingerTap(screen.getByRole("button", { name: "Edit" }));
    const second = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "To-do text" });
    fireEvent.change(second, { target: { value: "\n" } });
    expect(screen.getByTestId("todo-preview-save").hasAttribute("disabled")).toBe(true);
    fireEvent.change(second, { target: { value: "Reply to Alice\nNew detail" } });
    fingerTap(screen.getByTestId("todo-preview-save"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "To-do text" })).toBeNull());
    expect(editItem).toHaveBeenCalledWith("td-1", "Reply to Alice\nNew detail");
    expect(screen.getByRole("dialog", { name: "To-do" }).textContent).toContain("New detail");
  });

  it("shows the due date, flagged once overdue, and sets or clears it from the preview", async () => {
    const setItemDue = vi.fn(async (_itemId: string, due: string | null) => ({
      state: withItem(due ? { due } : {}, setItemDue.mock.calls.length + 5),
    }));
    renderLink(
      { loadState: async () => withItem({ due: "2020-01-02" }), resolve: vi.fn(), setItemDue },
      "[reply to Alice](todo:td-1)",
    );
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    const due = await screen.findByTestId("todo-preview-due");
    expect(due.textContent).toMatch(/^Overdue /);
    expect(due.className).toContain("text-cc-error");

    // The due date is its own control: tapping it opens the same date and time inputs as the To-dos page.
    fingerTap(due);
    expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("2020-01-02");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2099-05-01" } });
    fingerTap(screen.getByRole("button", { name: "Change due date" }));
    await waitFor(() => expect(screen.getByTestId("todo-preview-due").textContent).toMatch(/^Due /));
    expect(setItemDue).toHaveBeenLastCalledWith("td-1", "2099-05-01");
    expect(screen.getByTestId("todo-preview-due").className).not.toContain("text-cc-error");
    expect(screen.queryByLabelText("Due date")).toBeNull();

    fingerTap(screen.getByTestId("todo-preview-due"));
    fingerTap(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByTestId("todo-preview-due").textContent).toBe("Add due date"));
    expect(setItemDue).toHaveBeenLastCalledWith("td-1", null);
  });

  it("reports a missing proposal and closes on Escape or the backdrop", async () => {
    renderLink({ loadState: async () => todoState([]), resolve: vi.fn() });
    const link = screen.getByRole("link", { name: "PR 98888 review" });

    fireEvent.click(link);
    await screen.findByText("Proposal tp-36 was not found.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(link);
    fireEvent.click(await screen.findByTestId("todo-preview-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
