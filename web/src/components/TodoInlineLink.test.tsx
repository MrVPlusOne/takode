// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TodoProposal, TodoState } from "../../shared/todo-types.js";
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

function renderLink(source: TodoLinkSource, text = "The [PR 98888 review](todo:tp-36) may only need the stamp.") {
  return render(
    <TodoLinkSourceContext.Provider value={source}>
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
    expect(screen.getByTestId("todo-preview-status").textContent).toBe("Doing");
    // An item has nothing to decide: no Approve/Reject, only the way on to the list.
    expect(screen.queryByTestId("todo-proposal-approve")).toBeNull();
    expect(screen.getByRole("link", { name: "Open to-dos" }).getAttribute("href")).toBe("#/scheduled");
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
