import { MarkdownContent } from "../MarkdownContent.js";
import { Card, Section } from "./shared.js";

const statusStyles = {
  Todo: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  Doing: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  Done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
};

function TodoPreview({
  status,
  title,
  category,
}: {
  status: keyof typeof statusStyles;
  title: string;
  category: string;
}) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusStyles[status]}`}>
          {status}
        </span>
        <span className="rounded-full bg-cc-bg px-2 py-0.5 text-[10px] text-cc-muted">{category}</span>
      </div>
      <MarkdownContent text={title} variant="conservative" size="md" className="mt-2 font-medium" />
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted">
          {status === "Done" ? "Doing" : "Done"}
        </button>
        <button type="button" className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted">
          Edit
        </button>
        <button type="button" className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted">
          Archive
        </button>
      </div>
    </div>
  );
}

export function PlaygroundTodoStates() {
  return (
    <Section
      title="Personal To-dos"
      description="Responsive Markdown item, pending proposal, and scoped workflow-grant states used above Timers."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Todo / Doing / Done items">
          <div className="grid gap-3 p-3 md:grid-cols-3">
            <TodoPreview status="Todo" category="Slack" title="[Reply to the thread](https://example.com/thread)" />
            <TodoPreview status="Doing" category="Inbox" title="Review **the latest result**" />
            <TodoPreview status="Done" category="Results" title="Share [q-42](quest:q-42) with the team" />
          </div>
        </Card>
        <Card label="Agent proposal and workflow grant">
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            <div className="rounded-xl border border-cc-border bg-cc-bg/60 p-3">
              <p className="text-xs font-medium text-cc-fg">Add “Read the important result”</p>
              <p className="mt-1 text-[10px] text-cc-muted">tp-7 · proposed by Worker #12</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="rounded-lg bg-cc-primary px-3 py-1.5 text-xs font-medium text-white">
                  Approve
                </button>
                <button type="button" className="rounded-lg border border-cc-border px-3 py-1.5 text-xs text-cc-muted">
                  Reject
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-cc-border bg-cc-bg/60 p-3">
              <p className="text-xs font-medium text-cc-fg">Slack sweep</p>
              <p className="mt-1 text-[10px] leading-relaxed text-cc-muted">
                Add items, change status · Slack category · server-derived cron workflow identity
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg border border-cc-border px-3 py-1.5 text-xs text-cc-muted"
              >
                Revoke
              </button>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}
