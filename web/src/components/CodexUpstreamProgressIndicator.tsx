import type { CodexUpstreamProgressState } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { YarnBallDot } from "./CatIcons.js";

export function CodexUpstreamProgressIndicator({
  progress,
  sessionId,
}: {
  progress: CodexUpstreamProgressState;
  sessionId: string;
}) {
  const label = labelForPhase(progress.phase);
  const details = [
    progress.item_type ? "item: " + progress.item_type : null,
    progress.part_type ? "part: " + progress.part_type : null,
    progress.status ? "status: " + progress.status : null,
    progress.event_count > 0 ? progress.event_count + " events" : null,
  ].filter(Boolean);

  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out] pl-9 py-1" data-testid="codex-upstream-progress">
      <div className="max-w-3xl rounded-xl border border-cc-border bg-cc-card/70 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-mono-code text-cc-muted">
          <YarnBallDot className="text-cc-primary animate-pulse" />
          <span className="font-medium text-cc-fg/80">Copilot backend progress</span>
          <span className="text-cc-muted/50">·</span>
          <span>{label}</span>
          {details.length > 0 && <span className="text-cc-muted/60">({details.join(", ")})</span>}
        </div>
        {progress.safe_content && (
          <div className="mt-2 border-l-2 border-cc-primary/40 pl-3 text-sm text-cc-fg">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-cc-muted font-mono-code">
              Backend-provided summary
            </div>
            <MarkdownContent text={progress.safe_content} sessionId={sessionId} />
          </div>
        )}
      </div>
    </div>
  );
}

function labelForPhase(phase: CodexUpstreamProgressState["phase"]): string {
  switch (phase) {
    case "stream_start":
      return "stream opened";
    case "response_created":
    case "response_in_progress":
      return "response active";
    case "reasoning_started":
      return "reasoning item observed";
    case "reasoning_done":
      return "reasoning item finished";
    case "safe_content_delta":
    case "safe_content_done":
      return "safe summary received";
    case "output_item_started":
    case "content_part_started":
      return "output lifecycle active";
    case "output_item_done":
    case "content_part_done":
      return "output lifecycle updated";
    case "response_completed":
      return "response complete";
    case "response_failed":
      return "response failed";
    case "response_incomplete":
      return "response incomplete";
    case "stream_done":
      return "stream closed";
    default:
      return "stream event";
  }
}
