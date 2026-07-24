import { useEffect, useState } from "react";
import { api, type DelegateTraceResponse } from "../api.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolIcon } from "./ToolBlock.js";

export function extractDelegateId(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.match(/\bdel_[a-f0-9]+\b/i)?.[0] ?? null;
}

export function useDelegateCommandTrace(args: {
  sessionId: string;
  isDelegateCommand: boolean;
  delegateCommand: string;
  delegateId: string | null;
  resultComplete: boolean;
}): { trace: DelegateTraceResponse | null; error: string | null; count: number } {
  const { sessionId, isDelegateCommand, delegateCommand, delegateId, resultComplete } = args;
  const [trace, setTrace] = useState<DelegateTraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDelegateCommand || (!delegateId && !delegateCommand)) {
      setTrace(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await api.getDelegateTrace(sessionId, { delegateId, command: delegateCommand });
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
  }, [delegateCommand, delegateId, isDelegateCommand, resultComplete, sessionId]);

  return { trace, error, count: trace?.trace.length ?? 0 };
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
      {trace.trace.map((event, index) => (
        <div
          key={event.kind + "-" + index}
          className="rounded-[8px] border border-cc-border/50 bg-cc-hover/20 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-[11px] text-cc-muted">
            <ToolIcon type={event.kind === "tool" ? "terminal" : "agent"} />
            <span className="font-medium">{event.label}</span>
            {event.status && (
              <span className={event.isError ? "text-cc-error" : "text-cc-muted/80"}>{event.status}</span>
            )}
            {event.isTruncated && <span className="text-cc-muted/70">truncated</span>}
          </div>
          {event.text && (
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-fg/90">
              {event.text}
            </pre>
          )}
        </div>
      ))}
      {rawLink && (
        <div className="text-[11px] text-cc-muted">
          <MarkdownContent text={rawLink} sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}
