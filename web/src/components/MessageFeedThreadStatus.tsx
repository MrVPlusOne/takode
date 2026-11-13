import { useLayoutEffect, useRef } from "react";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { threadAddress } from "../../shared/topic-thread-key.js";
import { isAllThreadsKey, normalizeThreadKey } from "../utils/thread-projection.js";
import { WaitingWorkerPreview, type WaitingWorkerTarget } from "./WaitingWorkerPreview.js";

/** The thread's status as its feed shows it: none in All Threads, which mixes every thread. */
export function visibleCurrentThreadStatuses(
  status: LeaderThreadStatus | null,
  currentThreadKey: string | undefined,
): LeaderThreadStatus[] {
  return status && !isAllThreadsKey(normalizeThreadKey(currentThreadKey || "main")) ? [status] : [];
}

export function measureThreadStatusLayoutContribution(root: HTMLElement): number {
  const rect = root.getBoundingClientRect();
  const previous = root.previousElementSibling;
  if (previous instanceof HTMLElement) {
    const previousRect = previous.getBoundingClientRect();
    const contribution = rect.bottom - previousRect.bottom;
    if (Number.isFinite(contribution) && contribution > 0) return contribution;
  }
  const style = getComputedStyle(root);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  return Math.max(0, rect.height + marginTop + marginBottom);
}

function ThreadStatusMetadata({
  statuses,
  currentThreadKey,
  onSelectThread,
}: {
  statuses: LeaderThreadStatus[];
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  if (statuses.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Current thread status">
      {statuses.map((status) => {
        const normalizedCurrentThread = normalizeThreadKey(currentThreadKey || "main");
        const selectable =
          !!onSelectThread && !isAllThreadsKey(normalizedCurrentThread) && status.threadKey !== normalizedCurrentThread;
        const destinationLabel = status.threadKey === "main" ? "Main" : threadAddress(status.threadKey);
        const accessibleDestinationLabel = status.threadKey === "main" ? "Main" : `thread:${destinationLabel}`;
        // The chip says how its thread stands in plain words: "Waiting" or "Ready" and the leader's
        // note, without the marker's "Thread" prefix or the thread's key. The accessible label keeps both.
        const content = (
          <>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                status.kind === "ready" ? "bg-green-400/70" : "bg-amber-300/70"
              }`}
              aria-hidden="true"
            />
            <span className="shrink-0 font-medium text-cc-fg/75">{status.kind === "ready" ? "Ready" : "Waiting"}</span>
            <span
              className="min-w-0 basis-full whitespace-normal break-words text-cc-muted/80 sm:basis-auto"
              data-testid="thread-status-summary"
            >
              {status.summary}
            </span>
          </>
        );
        const className =
          "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-cc-border/60 bg-cc-card/70 px-2.5 py-1 text-[11px] leading-tight shadow-[0_8px_20px_rgba(0,0,0,0.18)]";
        return selectable ? (
          <button
            key={`${status.threadKey}:${status.messageId}:${status.kind}:${status.updatedAt ?? status.timestamp}`}
            type="button"
            className={`${className} cursor-pointer hover:bg-cc-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50`}
            onClick={() => onSelectThread?.(status.threadKey)}
            title={`Open ${accessibleDestinationLabel}`}
            aria-label={`${status.label} for ${accessibleDestinationLabel}: ${status.summary}. Open thread.`}
          >
            {content}
          </button>
        ) : (
          <div
            key={`${status.threadKey}:${status.messageId}:${status.kind}:${status.updatedAt ?? status.timestamp}`}
            className={className}
            role="status"
            aria-label={`${status.label} for ${accessibleDestinationLabel}: ${status.summary}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function TurnThreadStatusFooter({
  statuses,
  workerPreviewTarget = null,
  currentThreadKey,
  onSelectThread,
  onLayoutContributionChange,
}: {
  statuses: LeaderThreadStatus[];
  workerPreviewTarget?: WaitingWorkerTarget | null;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  onLayoutContributionChange?: (height: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!onLayoutContributionChange) return;
    const root = rootRef.current;
    if (!root) return;
    const report = () => {
      const contribution = Math.ceil(measureThreadStatusLayoutContribution(root));
      root.dataset.feedThreadStatusContribution = `${contribution}`;
      onLayoutContributionChange(contribution);
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(root);
    if (root.parentElement) observer.observe(root.parentElement);
    if (root.previousElementSibling) observer.observe(root.previousElementSibling);
    return () => observer.disconnect();
  }, [onLayoutContributionChange, statuses, workerPreviewTarget]);

  return (
    <div
      ref={rootRef}
      className="-mt-1 flex flex-col items-start gap-1.5 pl-9 font-mono-code text-[10px] text-cc-muted/70"
      data-feed-thread-status-footer="true"
      data-testid="turn-thread-status-footer"
    >
      <ThreadStatusMetadata statuses={statuses} currentThreadKey={currentThreadKey} onSelectThread={onSelectThread} />
      {workerPreviewTarget && <WaitingWorkerPreview target={workerPreviewTarget} />}
    </div>
  );
}
