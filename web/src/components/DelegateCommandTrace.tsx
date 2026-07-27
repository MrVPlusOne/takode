import { useEffect, useState } from "react";
import { api, type DelegateTraceEvent, type DelegateTraceResponse } from "../api.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolIcon } from "./ToolBlock.js";

export function extractDelegateId(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.match(/\bdel_[a-f0-9]+\b/i)?.[0] ?? null;
}

export function useDelegateCommandTrace(args: {
  sessionId: string;
  isDelegate: boolean;
  delegatePrompt: string;
  isLegacyCommand: boolean;
  delegateId: string | null;
  resultComplete: boolean;
}): { trace: DelegateTraceResponse | null; error: string | null; count: number } {
  const { sessionId, isDelegate, delegatePrompt, isLegacyCommand, delegateId, resultComplete } = args;
  const [trace, setTrace] = useState<DelegateTraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDelegate || (!delegateId && !delegatePrompt)) {
      setTrace(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await api.getDelegateTrace(sessionId, {
          delegateId,
          ...(isLegacyCommand ? { command: delegatePrompt } : { task: delegatePrompt }),
        });
        if (cancelled) return;
        setTrace(next);
        setError(null);
        if (next.pending && !resultComplete) timer = setTimeout(load, 1000);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Delegate trace unavailable");
        if (!resultComplete) timer = setTimeout(load, 1500);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [delegateId, delegatePrompt, isDelegate, isLegacyCommand, resultComplete, sessionId]);

  return { trace, error, count: trace?.trace.length ?? 0 };
}

type DelegateTraceRow =
  | { kind: "event"; event: DelegateTraceEvent; index: number }
  | { kind: "bash"; command: DelegateTraceEvent; result: DelegateTraceEvent | null; index: number };

function isBashCommandEvent(event: DelegateTraceEvent): boolean {
  return event.kind === "tool" && event.label === "Bash";
}

function isBashResultEvent(event: DelegateTraceEvent, command: DelegateTraceEvent): boolean {
  if (event.kind !== "tool") return false;
  const label = event.label.toLowerCase();
  if (command.toolUseId && event.toolUseId && command.toolUseId !== event.toolUseId) return false;
  return label === "result" || label === "bash result";
}

function groupDelegateTraceEvents(events: DelegateTraceEvent[]): DelegateTraceRow[] {
  const rows: DelegateTraceRow[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (isBashCommandEvent(event)) {
      const next = events[i + 1];
      if (next && isBashResultEvent(next, event)) {
        rows.push({ kind: "bash", command: event, result: next, index: i });
        i++;
        continue;
      }
      rows.push({ kind: "bash", command: event, result: null, index: i });
      continue;
    }
    rows.push({ kind: "event", event, index: i });
  }
  return rows;
}

function TraceStatusLabel({ event }: { event: DelegateTraceEvent }) {
  return (
    <>
      {event.status && <span className={event.isError ? "text-cc-error" : "text-cc-muted/80"}>{event.status}</span>}
      {event.isTruncated && <span className="text-cc-muted/70">truncated</span>}
    </>
  );
}

function DelegateTraceEventCard({ event }: { event: DelegateTraceEvent }) {
  return (
    <div className="rounded-[8px] border border-cc-border/50 bg-cc-hover/20 px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-cc-muted">
        <ToolIcon type={event.kind === "tool" ? "terminal" : "agent"} />
        <span className="font-medium">{event.label}</span>
        <TraceStatusLabel event={event} />
      </div>
      {event.text && (
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-fg/90">
          {event.text}
        </pre>
      )}
    </div>
  );
}

function DelegateBashTraceCard({
  command,
  result,
}: {
  command: DelegateTraceEvent;
  result: DelegateTraceEvent | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className="overflow-hidden rounded-[10px] border border-cc-border bg-cc-card"
      data-testid="delegate-bash-trace-group"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-cc-hover"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <ToolIcon type="terminal" />
        <span className="min-w-0 flex-1 truncate font-mono-code text-xs text-cc-fg/90" title={command.text ?? ""}>
          {command.text || "Bash"}
        </span>
        <span className="shrink-0 text-[10px] text-cc-muted">
          {result?.status === "failed" ? "failed" : result ? "completed" : command.status || "running"}
        </span>
        {result?.isTruncated && <span className="shrink-0 text-[10px] text-cc-muted/70">truncated</span>}
      </button>
      {open && (
        <div className="border-t border-cc-border px-3 pb-3 pt-2">
          {result?.text ? (
            <pre
              className={`max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg px-2.5 py-2 font-mono-code text-[11px] leading-relaxed ${
                result.isError ? "border border-cc-error/20 bg-cc-error/5 text-cc-error" : "bg-cc-code-bg text-cc-muted"
              }`}
            >
              {result.text}
            </pre>
          ) : (
            <div className="text-[11px] text-cc-muted italic">Waiting for command output...</div>
          )}
        </div>
      )}
    </div>
  );
}

export function DelegateTrace({ trace, sessionId }: { trace: DelegateTraceResponse; sessionId: string }) {
  const rawLink =
    trace.rawOutputLink?.kind === "session"
      ? "Raw transcript: [" + trace.rawOutputLink.label + "](session:" + trace.rawOutputLink.sessionNum + ")"
      : trace.rawOutputLink?.kind === "delegate"
        ? "Raw transcript: delegate " + trace.rawOutputLink.label
        : "";
  return (
    <div className="space-y-2">
      {groupDelegateTraceEvents(trace.trace).map((row) =>
        row.kind === "bash" ? (
          <DelegateBashTraceCard key={"bash-" + row.index} command={row.command} result={row.result} />
        ) : (
          <DelegateTraceEventCard key={row.event.kind + "-" + row.index} event={row.event} />
        ),
      )}
      {rawLink && (
        <div className="text-[11px] text-cc-muted">
          {trace.rawOutputLink?.kind === "delegate" ? (
            <a
              className="text-cc-primary hover:underline"
              href={"#/session/" + encodeURIComponent(trace.rawOutputLink.sessionId)}
            >
              Open raw delegate transcript: {trace.rawOutputLink.label}
            </a>
          ) : (
            <MarkdownContent text={rawLink} sessionId={sessionId} />
          )}
        </div>
      )}
    </div>
  );
}
