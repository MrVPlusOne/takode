import { MarkdownContent } from "../MarkdownContent.js";
import { Card, Section } from "./shared.js";

function OutlineItem({
  status,
  markdown,
  expanded = false,
  category,
}: {
  status: "Todo" | "Doing" | "Done";
  markdown: string;
  expanded?: boolean;
  category?: string;
}) {
  const [title, ...details] = markdown.split("\n");
  return (
    <div className="flex items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-cc-card/70">
      <span
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${status === "Done" ? "border-emerald-500 bg-emerald-500 text-white" : status === "Doing" ? "border-amber-500 text-amber-500" : "border-cc-muted/60 text-transparent"}`}
      >
        {status === "Doing" ? "•" : "✓"}
      </span>
      <span className="mt-0.5 w-4 shrink-0 text-xs text-cc-muted">{details.length ? (expanded ? "▾" : "▸") : ""}</span>
      <div className="min-w-0 flex-1">
        <MarkdownContent
          text={title ?? ""}
          variant="conservative"
          size="md"
          className={`font-medium ${status === "Done" ? "text-cc-muted line-through" : ""}`}
        />
        {expanded && details.length > 0 && (
          <div className="mt-1.5 border-l border-cc-border pl-3 text-cc-muted">
            <MarkdownContent text={details.join("\n")} size="sm" />
          </div>
        )}
      </div>
      {category && <span className="text-[10px] text-cc-muted">{category}</span>}
      <span className="text-sm tracking-widest text-cc-muted">•••</span>
    </div>
  );
}

export function PlaygroundTodoStates() {
  return (
    <Section
      title="Personal To-dos"
      description="Lightweight outline rows, one-source Markdown editing, collapsed Done groups, and compact advanced management above Timers."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Outline, derived detail, and direct completion">
          <div className="space-y-4 p-3">
            <section className="border-l border-cc-border pl-3">
              <p className="mb-1 text-sm font-medium text-cc-fg">
                Inbox <span className="text-[10px] text-cc-muted">2</span>
              </p>
              <OutlineItem status="Doing" markdown="Review **the latest result**" />
              <OutlineItem
                status="Todo"
                expanded
                markdown={
                  "[Reply to the thread](https://example.com/thread)\nKeep the source link and response notes together."
                }
              />
              <button type="button" className="ml-7 mt-1 rounded px-2 py-1 text-xs text-cc-muted">
                + Add to Inbox
              </button>
            </section>
            <details className="border-t border-cc-border pt-3">
              <summary className="flex list-none justify-between px-1 py-2 text-sm text-cc-muted">
                <span>▸ Done</span>
                <span>1</span>
              </summary>
              <div className="rounded-lg border border-cc-border bg-cc-card/35 px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cc-muted">Today</p>
                <OutlineItem status="Done" category="Inbox" markdown="Share [q-42](quest:q-42) with the team" />
              </div>
            </details>
          </div>
        </Card>
        <Card label="Single inline Markdown editor">
          <div className="p-3">
            <textarea
              readOnly
              value={
                "OAI video sessions\nhttps://example.com/recordings\n\nAdd the useful sections to the reading list."
              }
              className="h-28 w-full resize-none rounded-lg border border-cc-primary/35 bg-cc-bg px-3 py-2 text-sm leading-relaxed text-cc-fg"
            />
            <p className="mt-1 text-[10px] text-cc-muted">
              Saves on click-away · first non-empty line is the title · Esc discards
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cc-error/30 bg-cc-error/10 px-2.5 py-2 text-xs text-cc-error">
              <span>Save failed; your draft is still here.</span>
              <div className="flex gap-1">
                <button type="button" className="rounded border border-cc-error/30 px-2 py-1 font-medium">
                  Retry
                </button>
                <button type="button" className="rounded border border-cc-error/30 px-2 py-1">
                  Copy draft
                </button>
              </div>
            </div>
          </div>
        </Card>
        <Card label="Advanced management drawer">
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            <div className="rounded-xl border border-cc-border bg-cc-bg/60 p-3">
              <p className="text-xs font-medium text-cc-fg">
                Agent proposals <span className="text-cc-primary">1</span>
              </p>
              <p className="mt-2 text-[11px] text-cc-muted">Add “Read the important result”</p>
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
              <p className="text-xs font-medium text-cc-fg">Workflow grant · Slack sweep</p>
              <p className="mt-2 text-[11px] leading-relaxed text-cc-muted">
                Add, edit, order, or complete items in the Slack category.
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
