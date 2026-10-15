import { useMemo, useRef } from "react";
import type { TodoProposal, TodoState } from "../../../shared/todo-types.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { type TodoLinkSource, TodoLinkSourceContext } from "../TodoInlineLink.js";

const SYSTEM = { actor: { kind: "system" as const }, authorization: { kind: "bootstrap" as const }, at: 1 };
const REQUESTER = { kind: "session" as const, label: "Briefing Worker" };

function demoProposal(id: string, mutation: TodoProposal["mutation"], status: TodoProposal["status"]): TodoProposal {
  const createdAt = Date.now() - 2 * 3_600_000;
  return {
    id,
    mutation,
    status,
    createdAt,
    updatedAt: createdAt,
    requestedBy: REQUESTER,
    ...(status === "pending" ? {} : { resolvedAt: Date.now() - 600_000 }),
  };
}

function demoState(): TodoState {
  return {
    schemaVersion: 2,
    revision: 1,
    updatedAt: 1,
    nextItemId: 31,
    nextCategoryId: 2,
    nextProposalId: 37,
    nextGrantId: 1,
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
        questIds: ["q-418"],
        createdAt: 1,
        updatedAt: Date.now() - 3 * 3_600_000,
        statusChangedAt: 1,
        createdBy: SYSTEM,
        lastModifiedBy: SYSTEM,
      },
    ],
    proposals: [
      demoProposal(
        "tp-36",
        {
          action: "item:add",
          input: {
            markdown:
              "Review Junhong's QA mixture-weight PR 98888\nWeights question answered on Slack last night; it may only need the stamp.",
            categoryId: "cat-work",
          },
        },
        "pending",
      ),
      demoProposal(
        "tp-30",
        {
          action: "item:edit",
          itemId: "td-30",
          input: { markdown: "Reply to Alice about the offsite\nSuggest the week of Nov 3." },
        },
        "pending",
      ),
      demoProposal("tp-34", { action: "item:status", itemId: "td-30", status: "done" }, "approved"),
      demoProposal(
        "tp-35",
        { action: "item:add", input: { markdown: "File the September expense report" } },
        "rejected",
      ),
    ],
    grants: [],
  };
}

/**
 * To-do and proposal links in prose, each with its marker (a proposal's shows its status): tapping one
 * opens its preview, where a pending proposal can be decided.
 */
export function PlaygroundTodoLinkDemo() {
  // Decisions change only this demo's in-memory copy, never the real list.
  const stateRef = useRef<TodoState>(demoState());
  const source = useMemo<TodoLinkSource>(
    () => ({
      loadProposalStatuses: async () => ({
        statuses: Object.fromEntries(stateRef.current.proposals.map((proposal) => [proposal.id, proposal.status])),
        revision: stateRef.current.revision,
      }),
      loadState: async () => stateRef.current,
      resolve: async (proposalId, decision) => {
        const current = stateRef.current;
        stateRef.current = {
          ...current,
          revision: current.revision + 1,
          proposals: current.proposals.map((proposal) =>
            proposal.id === proposalId
              ? {
                  ...proposal,
                  status: decision === "reject" ? "rejected" : "approved",
                  ...(decision === "mark-done" ? { markedDone: true } : {}),
                  resolvedAt: Date.now(),
                }
              : proposal,
          ),
        };
        return { state: stateRef.current };
      },
    }),
    [],
  );

  return (
    <TodoLinkSourceContext.Provider value={source}>
      <MarkdownContent text="To-dos: [Ship the export feature](todo:td-31) (doing, linked quest) and [Reply to Alice about the offsite](todo:td-30). The [PR 98888 review](todo:tp-36) may only need the stamp. Older proposals: [a new plan for the offsite reply](todo:tp-30) (edit), [mark the offsite reply done](todo:tp-34) (approved) and [file the September expense report](todo:tp-35) (rejected). Missing: [an old proposal](todo:tp-99)." />
    </TodoLinkSourceContext.Provider>
  );
}
