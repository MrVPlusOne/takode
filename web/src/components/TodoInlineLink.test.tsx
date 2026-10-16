// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TodoItem, TodoMutationProvenance, TodoState } from "../../shared/todo-types.js";
import { useStore } from "../store.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { type TodoLinkSource, TodoLinkSourceContext } from "./TodoInlineLink.js";

const SYSTEM = { actor: { kind: "system" as const }, authorization: { kind: "bootstrap" as const }, at: 1 };
const BRIEFING = { kind: "session" as const, sessionId: "session-2978", label: "2978" };

/** td-2 was created by approving proposal tp-36, before proposals were retired. */
const FROM_PROPOSAL: TodoMutationProvenance = {
  actor: BRIEFING,
  authorization: { kind: "proposal_approval", proposalId: "tp-36" },
  at: Date.now() - 2 * 3_600_000,
};

function todoState(revision = 5): TodoState {
  return {
    schemaVersion: 3,
    revision,
    updatedAt: 1,
    nextItemId: 3,
    nextCategoryId: 2,
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
      {
        id: "td-2",
        markdown: "Review Junhong's PR 98888\nMixture-weight change; may only need the stamp.",
        rank: 1024,
        categoryId: "cat-work",
        status: "todo",
        createdAt: FROM_PROPOSAL.at,
        updatedAt: FROM_PROPOSAL.at,
        statusChangedAt: FROM_PROPOSAL.at,
        createdBy: FROM_PROPOSAL,
        lastModifiedBy: FROM_PROPOSAL,
      },
    ],
  };
}

/** The list with its first to-do (td-1, "Reply to Alice") changed by `overrides`. */
function withItem(overrides: Partial<TodoItem>, revision = 5): TodoState {
  const state = todoState(revision);
  state.items[0] = { ...state.items[0]!, ...overrides };
  return state;
}

const statusButton = (name: string) =>
  within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name });

// Each test supplies only the to-do changes it exercises.
type PreviewSource = Pick<TodoLinkSource, "loadState"> & Partial<TodoLinkSource>;

function renderLink(source: PreviewSource, text = "Ready to [reply to Alice](todo:td-1)?") {
  const full: TodoLinkSource = {
    setItemStatus: vi.fn(),
    editItem: vi.fn(),
    setItemDue: vi.fn(),
    undoCompletion: vi.fn(),
    ...source,
  };
  return render(
    <TodoLinkSourceContext.Provider value={full}>
      <MarkdownContent text={text} />
    </TodoLinkSourceContext.Provider>,
  );
}

describe("to-do links", () => {
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

  it("refreshes when the list changes elsewhere and ignores older snapshots", async () => {
    // A to-do changed in another tab or by an agent must not show its old state in an open preview.
    const loadState = vi
      .fn<() => Promise<TodoState>>()
      .mockResolvedValueOnce(withItem({}, 5))
      .mockResolvedValueOnce(withItem({ status: "doing" }, 6))
      .mockResolvedValueOnce(withItem({}, 4));
    renderLink({ loadState });

    fireEvent.click(screen.getByRole("link", { name: "reply to Alice" }));
    await screen.findByText("Reply to Alice");
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    await waitFor(() => expect(statusButton("Doing").getAttribute("aria-pressed")).toBe("true"));
    await act(async () => window.dispatchEvent(new CustomEvent(TODO_STATE_UPDATED_EVENT)));
    expect(loadState).toHaveBeenCalledTimes(3);
    expect(statusButton("Doing").getAttribute("aria-pressed")).toBe("true");
  });

  it("previews an existing to-do with its status, category and linked quests", async () => {
    // Item links let agents name a to-do the user should look at, e.g. when describing a change for approval.
    renderLink({ loadState: async () => withItem({ status: "doing", questIds: ["q-7"] }) });

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
    // The user made this to-do, so there is no provenance line.
    expect(screen.queryByTestId("todo-provenance")).toBeNull();
    expect(screen.getByRole("link", { name: "Open to-dos" }).getAttribute("href")).toBe("#/scheduled");
  });

  it("shows who added a to-do, from where, and the standing approval behind an agent's last change", async () => {
    // Agents add to-dos on their own and may change them under a standing approval the user wrote,
    // so the preview says which agent, where the to-do came from, and which approval it cited.
    const added: TodoMutationProvenance = {
      actor: BRIEFING,
      authorization: { kind: "agent_direct" },
      at: Date.now() - 5 * 3_600_000,
      source: "Slack group chat with Junhong, Oct 4",
    };
    const completed: TodoMutationProvenance = {
      actor: BRIEFING,
      authorization: { kind: "standing_approval", standingApproval: "daily-briefing skill, To-do hygiene" },
      at: Date.now() - 3_600_000,
    };
    renderLink({
      loadState: async () =>
        withItem({ status: "done", completedAt: completed.at, createdBy: added, lastModifiedBy: completed }),
    });
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));

    const provenance = await screen.findByTestId("todo-provenance");
    expect(provenance.textContent).toContain(
      "Added by #2978 Briefing Worker 5h ago · from Slack group chat with Junhong, Oct 4",
    );
    expect(provenance.textContent).toContain(
      "Changed by #2978 Briefing Worker 1h ago · standing approval: daily-briefing skill, To-do hygiene",
    );
    expect(within(provenance).getAllByRole("link", { name: "#2978 Briefing Worker" })).toHaveLength(2);
  });

  it("opens a link to a retired proposal as the to-do it created, or says it was never added", async () => {
    // Older messages still hold proposal links. Every to-do link carries the same checklist marker,
    // and an approved proposal's link opens the to-do its approval created.
    renderLink(
      { loadState: async () => todoState() },
      "The [PR 98888 review](todo:tp-36) may only need the stamp; [the expense report](todo:tp-35) was rejected.",
    );
    for (const name of ["PR 98888 review", "the expense report"]) {
      const marker = screen.getByRole("link", { name }).querySelector<SVGElement>('[data-testid="todo-link-marker"]');
      expect(marker?.dataset.marker).toBe("item");
    }

    fingerTap(screen.getByRole("link", { name: "PR 98888 review" }));
    const dialog = await screen.findByRole("dialog", { name: "To-do" });
    await screen.findByText("Review Junhong's PR 98888");
    expect(dialog.textContent).toContain("In Work");
    expect(screen.getByTestId("todo-provenance").textContent).toContain("you approved its proposal");
    fireEvent.keyDown(document, { key: "Escape" });

    fingerTap(screen.getByRole("link", { name: "the expense report" }));
    await screen.findByText(/a feature Takode no longer has\. It wasn't added to your list\./);
    expect(screen.queryByRole("group", { name: "Status" })).toBeNull();
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
      { loadState: async () => withItem({ status: "doing" }), setItemStatus, undoCompletion },
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
    renderLink({ loadState: async () => withItem({}), setItemStatus }, "[reply to Alice](todo:td-1)");
    fingerTap(screen.getByRole("link", { name: "reply to Alice" }));
    await screen.findByText("Reply to Alice");

    fingerTap(statusButton("Doing"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not update the to-do. Server unreachable");
    expect(statusButton("Todo").getAttribute("aria-pressed")).toBe("true");
  });

  it("edits the to-do text in the preview without losing the draft to a stray tap", async () => {
    // Editing uses the To-dos page's rules: one Markdown body whose first line must stay non-empty.
    const editItem = vi.fn(async (_itemId: string, markdown: string) => ({ state: withItem({ markdown }, 6) }));
    renderLink({ loadState: async () => withItem({}), editItem }, "[reply to Alice](todo:td-1)");
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
    renderLink({ loadState: async () => withItem({ due: "2020-01-02" }), setItemDue }, "[reply to Alice](todo:td-1)");
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

  it("reports a missing to-do and closes on Escape or the backdrop", async () => {
    renderLink({ loadState: async () => todoState() }, "[an old to-do](todo:td-9)");
    const link = screen.getByRole("link", { name: "an old to-do" });

    fireEvent.click(link);
    await screen.findByText("To-do td-9 was not found.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(link);
    fireEvent.click(await screen.findByTestId("todo-preview-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
