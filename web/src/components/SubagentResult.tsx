import { useEffect, useState } from "react";
import { api, type DelegateTraceResponse } from "../api.js";
import { MarkdownContent } from "./MarkdownContent.js";

export function parseSubagentResultText(raw: string): string {
  try {
    const blocks = JSON.parse(raw);
    if (!Array.isArray(blocks)) {
      if (blocks && typeof blocks === "object" && Array.isArray(blocks.content)) {
        return parseSubagentResultText(JSON.stringify(blocks.content));
      }
      return raw;
    }
    const texts: string[] = [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        if (/^agentId:|^<usage>/i.test(b.text.trim())) continue;
        texts.push(b.text);
      }
    }
    return texts.length > 0 ? texts.join("\n") : raw;
  } catch {
    return raw;
  }
}

export function SubagentResult({
  preview,
  parsedText,
  sessionId,
  toolUseId,
  delegate,
}: {
  preview: { content: string; is_truncated: boolean; duration_seconds?: number };
  parsedText: string | null;
  sessionId: string;
  toolUseId: string;
  delegate?: {
    isDelegate: boolean;
    isLegacyCommand: boolean;
    delegateId: string | null;
    prompt: string;
    trace: DelegateTraceResponse | null;
  };
}) {
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preview.is_truncated && !fullContent && !loading) {
      setLoading(true);
      api
        .getToolResult(sessionId, toolUseId)
        .then((result: { content: string }) => setFullContent(result.content))
        .catch(() => setFullContent("[Failed to load full result]"))
        .finally(() => setLoading(false));
    }
  }, [preview.is_truncated, fullContent, loading, sessionId, toolUseId]);

  const displayText = fullContent ? parseSubagentResultText(fullContent) : (parsedText ?? preview.content);
  const delegateResult = delegate?.isDelegate ? parseDelegateResultText(displayText) : null;
  const summaryText = delegateResult?.summary?.trim() || displayText;
  const metadata = delegate?.isDelegate
    ? buildDelegateResultMetadata({
        parsed: delegateResult,
        delegate,
        durationSeconds: preview.duration_seconds,
      })
    : [];

  return (
    <div className="px-3 pb-2">
      {loading && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-cc-muted">
          <svg className="w-3 h-3 animate-spin text-cc-muted" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading full result...</span>
        </div>
      )}
      <div className="max-h-96 overflow-y-auto">
        <div className="text-sm" data-testid={delegate?.isDelegate ? "delegate-result-summary" : undefined}>
          <MarkdownContent text={summaryText} sessionId={sessionId} />
        </div>
        {metadata.length > 0 && (
          <dl
            className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-cc-border/50 pt-2 text-[11px]"
            data-testid="delegate-result-metadata"
          >
            {metadata.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-cc-muted">{item.label}</dt>
                <dd className="min-w-0 break-words text-cc-fg/85">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function parseDelegateResultText(text: string): {
  status?: string;
  delegateId?: string;
  task?: string;
  command?: string;
  summary?: string;
  inspect?: string;
} | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!/^Delegate (task|command) (completed|failed)\./i.test(normalized)) return null;
  const statusMatch = normalized.match(/^Delegate (task|command) (completed|failed)\./i);
  const delegateMatch = normalized.match(/(?:^|\n)Delegate:\s*([^\n]+)/i);
  const taskMatch = normalized.match(/(?:^|\n)Task:\s*([\s\S]*?)(?=\n\n(?:Summary|Inspect):|$)/i);
  const commandMatch = normalized.match(/(?:^|\n)Command:\s*([\s\S]*?)(?=\n\n(?:Summary|Inspect):|$)/i);
  const summaryMatch = normalized.match(/(?:^|\n)Summary:\s*\n?([\s\S]*?)(?=\n\nInspect:|$)/i);
  const inspectMatch = normalized.match(/(?:^|\n)Inspect:\s*\n?([\s\S]*)$/i);
  const delegateText = delegateMatch?.[1]?.trim() || "";
  return {
    status: statusMatch ? `${statusMatch[1].toLowerCase()} ${statusMatch[2].toLowerCase()}` : undefined,
    delegateId: delegateText.match(/\bdel_[a-f0-9]+\b/i)?.[0] ?? (delegateText || undefined),
    task: taskMatch?.[1]?.trim(),
    command: commandMatch?.[1]?.trim(),
    summary: summaryMatch?.[1]?.trim(),
    inspect: inspectMatch?.[1]?.trim(),
  };
}

function buildDelegateResultMetadata(args: {
  parsed: ReturnType<typeof parseDelegateResultText>;
  delegate: NonNullable<Parameters<typeof SubagentResult>[0]["delegate"]>;
  durationSeconds?: number;
}): Array<{ label: string; value: string }> {
  const { parsed, delegate, durationSeconds } = args;
  const rawLink = delegate.trace?.rawOutputLink;
  const inspect =
    rawLink?.kind === "session"
      ? rawLink.label
      : rawLink?.kind === "delegate"
        ? "delegate " + rawLink.label
        : parsed?.inspect?.replace(/^[-*]\s*/gm, "").trim();
  const items = [
    { label: "Status", value: parsed?.status },
    { label: "Delegate", value: parsed?.delegateId || delegate.delegateId || delegate.trace?.delegateId },
    { label: delegate.isLegacyCommand ? "Command" : "Task", value: parsed?.command || parsed?.task || delegate.prompt },
    {
      label: "Duration",
      value:
        typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
          ? `${durationSeconds.toFixed(1)}s`
          : undefined,
    },
    { label: "Inspect", value: inspect },
  ];
  return items.filter((item): item is { label: string; value: string } => !!item.value);
}
