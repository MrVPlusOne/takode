import type { AlternateVoiceRerun } from "./composer-voice-types.js";

export function AlternateVoiceRerunOffer({
  rerun,
  onRerun,
  onDismiss,
  className = "",
}: {
  rerun: AlternateVoiceRerun;
  onRerun: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const targetMode = rerun.sourceMode === "edit" ? "append" : "edit";
  const actionLabel = targetMode === "append" ? "Rerun as append" : "Rerun as voice edit";
  const statusText =
    rerun.status === "running"
      ? `Rerunning as ${targetMode === "append" ? "append" : "voice edit"}...`
      : rerun.status === "error"
        ? rerun.message || "Voice rerun failed. Try again."
        : `Voice ${rerun.sourceMode} result ready`;
  const isError = rerun.status === "error";

  return (
    <div
      data-testid="alternate-voice-rerun-offer"
      data-state={rerun.status}
      className={`flex min-h-9 min-w-0 items-center gap-1 rounded-md border border-cc-border/70 bg-cc-input-bg/60 px-1.5 ${
        isError ? "py-1" : "flex-nowrap"
      } ${className}`}
    >
      <span
        role="status"
        aria-live="polite"
        title={statusText}
        className={`min-w-0 flex-1 text-[11px] text-cc-muted ${isError ? "break-words leading-4" : "truncate"}`}
      >
        {statusText}
      </span>
      <button
        type="button"
        onClick={onRerun}
        disabled={rerun.status === "running"}
        className="inline-flex h-8 shrink-0 items-center rounded-md border border-cc-border px-2 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus:outline-none focus:ring-2 focus:ring-cc-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus:outline-none focus:ring-2 focus:ring-cc-primary/40"
        aria-label="Dismiss alternate voice rerun offer"
        title="Dismiss"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
