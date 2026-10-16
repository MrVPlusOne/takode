import { useMemo, useRef } from "react";
import type { TodoItem, TodoMutationProvenance, TodoState, TodoStatus } from "../../../shared/todo-types.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { type TodoLinkSource, TodoLinkSourceContext } from "../TodoInlineLink.js";

const SYSTEM = { actor: { kind: "system" as const }, authorization: { kind: "bootstrap" as const }, at: 1 };
const BRIEFING = { kind: "session" as const, label: "Daily briefing" };
const HOURS_AGO = (hours: number) => Date.now() - hours * 3_600_000;

/** Added by an agent on its own, with where it came from. */
const AGENT_ADDED: TodoMutationProvenance = {
  actor: BRIEFING,
  authorization: { kind: "agent_direct" },
  at: HOURS_AGO(5),
  source: "Slack group chat with Junhong, Oct 4",
};

/** Changed by an agent under a standing approval it cited. */
const STANDING_APPROVAL: TodoMutationProvenance = {
  actor: BRIEFING,
  authorization: {
    kind: "standing_approval",
    standingApproval: "daily-briefing skill, To-do hygiene: mark Done Slack to-dos whose obligation is fulfilled",
  },
  at: HOURS_AGO(1),
};

/** Created by approving a to-do proposal before proposals were retired. */
const FROM_PROPOSAL: TodoMutationProvenance = {
  actor: BRIEFING,
  authorization: { kind: "proposal_approval", proposalId: "tp-36" },
  at: HOURS_AGO(30),
};

/** A local `YYYY-MM-DD` date `days` from today, for demo due dates. */
function localDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function demoState(): TodoState {
  return {
    schemaVersion: 3,
    revision: 1,
    updatedAt: 1,
    nextItemId: 34,
    nextCategoryId: 2,
    categories: [
      { id: "cat-inbox", name: "Inbox", createdAt: 1, updatedAt: 1, createdBy: SYSTEM, lastModifiedBy: SYSTEM },
      { id: "cat-work", name: "Work", createdAt: 1, updatedAt: 1, createdBy: SYSTEM, lastModifiedBy: SYSTEM },
    ],
    items: [
      {
        id: "td-30",
        markdown: "Reply to Alice about the offsite\nShe asked for dates by Friday.",
        rank: 1024,
        categoryId: "cat-inbox",
        status: "todo",
        due: `${localDate(-1)}T17:00`,
        createdAt: 1,
        updatedAt: 1,
        statusChangedAt: 1,
        createdBy: SYSTEM,
        lastModifiedBy: SYSTEM,
      },
      {
        id: "td-31",
        markdown: "Ship the export feature\nWaiting on the review quest.",
        rank: 2048,
        categoryId: "cat-work",
        status: "doing",
        due: localDate(1),
        questIds: ["q-418"],
        createdAt: 1,
        updatedAt: Date.now() - 3 * 3_600_000,
        statusChangedAt: 1,
        createdBy: SYSTEM,
        lastModifiedBy: SYSTEM,
      },
      {
        id: "td-32",
        markdown: "Check whether Junhong's QA-grading PR still needs a review\nHe asked the group for a stamp.",
        rank: 3072,
        categoryId: "cat-work",
        status: "done",
        createdAt: AGENT_ADDED.at,
        updatedAt: STANDING_APPROVAL.at,
        statusChangedAt: STANDING_APPROVAL.at,
        completedAt: STANDING_APPROVAL.at,
        createdBy: AGENT_ADDED,
        lastModifiedBy: STANDING_APPROVAL,
      },
      {
        id: "td-33",
        markdown: "Review Junhong's QA mixture-weight PR 98888",
        rank: 4096,
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

/**
 * To-do links in prose: tapping one opens its preview, where the to-do can be changed and an
 * agent-added one shows who added it, from where, and on what authority it was last changed. Links
 * to retired proposals from older messages open the to-do the proposal created, or say it never was.
 */
export function PlaygroundTodoLinkDemo() {
  // Changes affect only this demo's in-memory copy, never the real list.
  const stateRef = useRef<TodoState>(demoState());
  const statusBeforeDone = useRef(new Map<string, TodoStatus>());
  const source = useMemo<TodoLinkSource>(() => {
    const updateItem = (itemId: string, change: (item: TodoItem) => TodoItem) => {
      const current = stateRef.current;
      stateRef.current = {
        ...current,
        revision: current.revision + 1,
        items: current.items.map((item) => (item.id === itemId ? { ...change(item), updatedAt: Date.now() } : item)),
      };
      return { state: stateRef.current };
    };
    const setStatus = (item: TodoItem, status: TodoStatus): TodoItem => {
      const { completedAt: _completedAt, ...rest } = item;
      return {
        ...rest,
        status,
        statusChangedAt: Date.now(),
        ...(status === "done" ? { completedAt: Date.now() } : {}),
      };
    };
    return {
      loadState: async () => stateRef.current,
      setItemStatus: async (itemId, status) => {
        const previous = stateRef.current.items.find((item) => item.id === itemId)?.status;
        if (status === "done" && previous) statusBeforeDone.current.set(itemId, previous);
        const response = updateItem(itemId, (item) => setStatus(item, status));
        return status === "done"
          ? { ...response, completionUndo: { itemId, token: "demo", expiresAt: Date.now() + 30_000 } }
          : response;
      },
      editItem: async (itemId, markdown) => updateItem(itemId, (item) => ({ ...item, markdown })),
      setItemDue: async (itemId, due) =>
        updateItem(itemId, (item) => {
          const { due: _due, ...rest } = item;
          return due ? { ...rest, due } : rest;
        }),
      undoCompletion: async (itemId) =>
        updateItem(itemId, (item) => setStatus(item, statusBeforeDone.current.get(itemId) ?? "todo")),
    };
  }, []);

  return (
    <TodoLinkSourceContext.Provider value={source}>
      <MarkdownContent text="To-dos: [Ship the export feature](todo:td-31) (doing, linked quest), [Reply to Alice about the offsite](todo:td-30) and [Check Junhong's QA-grading PR](todo:td-32) (added by an agent, marked done under a standing approval). Older proposal links: [PR 98888 review](todo:tp-36) (opens the to-do it created) and [file the September expense report](todo:tp-35) (never added)." />
    </TodoLinkSourceContext.Provider>
  );
}
