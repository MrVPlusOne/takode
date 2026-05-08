import { useMemo, useState } from "react";
import type { PausedInboundMessage, SessionPauseState } from "../types.js";

function PauseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4.5 3A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13h1A1.5 1.5 0 007 11.5v-7A1.5 1.5 0 005.5 3h-1zM10.5 3A1.5 1.5 0 009 4.5v7a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0011.5 3h-1z" />
    </svg>
  );
}

function PlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5 3.5a.75.75 0 011.2-.6l5 3.75a.75.75 0 010 1.2l-5 3.75A.75.75 0 015 11V3.5z" />
    </svg>
  );
}

function formatHeldSource(item: PausedInboundMessage): string {
  if (item.message.agentSource?.sessionLabel) return item.message.agentSource.sessionLabel;
  if (item.message.agentSource?.sessionId) return item.message.agentSource.sessionId;
  if (item.message.takodeHerdBatch) return "Herd";
  return item.source === "programmatic" ? "External" : "Browser";
}

function formatHeldPreview(item: PausedInboundMessage): string {
  const content = item.message.content.trim();
  if (content) return content;
  const imageCount = item.message.imageRefs?.length ?? 0;
  if (imageCount > 0) return `${imageCount} prepared image attachment${imageCount === 1 ? "" : "s"}`;
  return "Held input";
}

function formatHeldTime(item: PausedInboundMessage): string {
  return new Date(item.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PauseOtherSourcesButton({
  isPaused,
  heldCount,
  busy,
  onToggle,
}: {
  isPaused: boolean;
  heldCount: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const title = isPaused
    ? "Resume other input sources. Releases held CLI, timer, herd, and programmatic work."
    : "Pause other input sources. Direct composer messages still send; CLI, timer, herd, and programmatic work is held.";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      data-testid="composer-pause-sources-button"
      aria-pressed={isPaused}
      aria-label={isPaused ? "Resume other input sources" : "Pause other input sources"}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${
        busy ? "cursor-wait opacity-60" : "cursor-pointer"
      } ${
        isPaused
          ? "border border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
          : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {isPaused ? <PlayIcon /> : <PauseIcon />}
      <span className="hidden sm:inline">{isPaused ? "Resume sources" : "Pause sources"}</span>
      {isPaused && heldCount > 0 && (
        <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono-code text-[10px]">{heldCount}</span>
      )}
    </button>
  );
}

export function PausedInputChip({
  pause,
  heldCount,
}: {
  pause: SessionPauseState | null | undefined;
  heldCount: number;
}) {
  const [open, setOpen] = useState(false);
  const queued = pause?.queuedMessages ?? [];
  const visibleCount = Math.max(heldCount, queued.length);
  const label = visibleCount === 1 ? "1 held input" : `${visibleCount} held inputs`;
  const listTitle = useMemo(
    () =>
      visibleCount > 0
        ? `Other input sources are paused. ${label} will release after resume.`
        : "Other input sources are paused. Direct composer messages still send.",
    [label, visibleCount],
  );

  if (!pause?.pausedAt) return null;

  return (
    <div className="px-4 pt-2">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="composer-paused-chip"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            title={listTitle}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-medium text-amber-200 transition-colors hover:bg-amber-400/10 cursor-pointer"
          >
            <PauseIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">Other sources paused</span>
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono-code text-[10px]">{label}</span>
          </button>
          <span className="min-w-0 flex-1 text-amber-200/80">
            Direct composer messages still send. External input waits here.
          </span>
        </div>
        {open && (
          <div
            data-testid="composer-held-input-list"
            className="mt-2 max-h-40 overflow-y-auto rounded-md border border-amber-400/15 bg-cc-bg/40"
          >
            {queued.length === 0 ? (
              <div className="px-2.5 py-2 text-amber-100/70">No held input yet.</div>
            ) : (
              queued.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-t border-amber-400/10 px-2.5 py-2 first:border-t-0"
                >
                  <span className="font-medium text-amber-100">{formatHeldSource(item)}</span>
                  <span className="min-w-0 truncate text-amber-100/80">{formatHeldPreview(item)}</span>
                  <span className="font-mono-code text-[10px] text-amber-100/60">{formatHeldTime(item)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
