import { useMemo, useState } from "react";
import type {
  CodexAutoPauseHeldInput,
  CodexResultErrorFamily,
  PausedInboundMessage,
  SessionPauseState,
  SessionState,
} from "../types.js";

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

type HeldInputListItem = PausedInboundMessage | CodexAutoPauseHeldInput;

function formatHeldSource(item: HeldInputListItem, sanitizeAutomaticRouting: boolean): string {
  if (sanitizeAutomaticRouting) {
    if (item.message.takodeHerdBatch || item.message.agentSource?.sessionId === "herd-events") return "Herd Events";
    if (item.message.agentSource?.sessionId.startsWith("timer:")) return "Timer";
    return item.source === "programmatic" ? "Automatic" : "Browser";
  }
  if (item.message.agentSource?.sessionLabel) return item.message.agentSource.sessionLabel;
  if (item.message.agentSource?.sessionId) return item.message.agentSource.sessionId;
  if (item.message.takodeHerdBatch) return "Herd";
  return item.source === "programmatic" ? "External" : "Browser";
}

function formatHeldPreview(item: HeldInputListItem, sanitizeAutomaticPayload: boolean): string {
  if (sanitizeAutomaticPayload) {
    if (item.message.takodeHerdBatch || item.message.agentSource?.sessionId === "herd-events") return "Held herd event";
    if (item.message.agentSource?.sessionId.startsWith("timer:")) return "Held timer input";
    const imageCount = item.message.imageRefs?.length ?? 0;
    if (imageCount > 0) return `Held input with ${imageCount} image attachment${imageCount === 1 ? "" : "s"}`;
    return item.source === "programmatic" ? "Held automatic input" : "Held browser input";
  }
  const content = item.message.content.trim();
  if (content) return content;
  const imageCount = item.message.imageRefs?.length ?? 0;
  if (imageCount > 0) return `${imageCount} prepared image attachment${imageCount === 1 ? "" : "s"}`;
  return "Held input";
}

function fixedAutoPauseCause(family: CodexResultErrorFamily): string {
  switch (family) {
    case "copilot_auth_refresh_exhausted":
      return "Copilot sign-in failed";
    case "copilot_auth_refresh_invalidated":
      return "Copilot sign-in expired while Takode was reconnecting";
    case "model_not_supported":
      return "The selected model is not available";
    case "model_backend_stream_error":
      return "The model connection dropped repeatedly";
    default:
      return "The model connection failed";
  }
}

function autoPauseGuidance(
  family: CodexResultErrorFamily,
  recoveryProgress: "testing" | "active" | null,
  releaseAccepted: boolean,
): string {
  if (releaseAccepted) {
    return "Takode accepted your request and is releasing the held inputs.";
  }
  if (recoveryProgress === "active") {
    return "Your current message is running. Held automatic inputs will send when it finishes successfully.";
  }
  if (recoveryProgress === "testing") {
    return "Takode is checking this session with your current message. Held inputs will send if it finishes successfully.";
  }

  switch (family) {
    case "copilot_auth_refresh_exhausted":
    case "copilot_auth_refresh_invalidated":
      return "Sign in to Copilot again, then retry this session. Held inputs will stay paused until it succeeds.";
    case "model_not_supported":
      return "Choose a supported model, then try again. Held inputs will stay paused until this session succeeds.";
    case "model_backend_stream_error":
    default:
      return "Takode will keep these inputs paused until this session completes a message successfully. They will then send automatically.";
  }
}

function formatAutoPauseTime(pausedAt: number): string {
  return new Date(pausedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatHeldTime(item: HeldInputListItem): string {
  return new Date(item.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getHeldCount(item: HeldInputListItem): number {
  return "count" in item ? Math.max(1, item.count) : 1;
}

export function PauseOtherSourcesButton({
  isPaused,
  heldCount,
  busy,
  directComposerMessagesSend,
  onToggle,
}: {
  isPaused: boolean;
  heldCount: number;
  busy: boolean;
  directComposerMessagesSend: boolean;
  onToggle: () => void;
}) {
  const title = isPaused
    ? directComposerMessagesSend
      ? "Resume other input sources. Releases held CLI, timer, herd, and programmatic work."
      : "Resume other input sources. Direct composer messages still need the session to resume."
    : directComposerMessagesSend
      ? "Pause other input sources. Direct composer messages still send; CLI, timer, herd, and programmatic work is held."
      : "Pause other input sources. Direct composer messages still need the session to resume.";

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
          ? "border border-cc-attention/75 bg-cc-attention-bg text-cc-attention-strong hover:bg-cc-warning/15"
          : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {isPaused ? <PlayIcon /> : <PauseIcon />}
      <span className="hidden sm:inline">{isPaused ? "Resume sources" : "Pause sources"}</span>
      {isPaused && heldCount > 0 && (
        <span className="rounded border border-cc-attention/45 bg-cc-card/70 px-1.5 py-0.5 font-mono-code text-[10px] text-cc-attention-strong">
          {heldCount}
        </span>
      )}
    </button>
  );
}

export function PausedInputChip({
  pause,
  autoPause,
  autoPauseRecoveryProgress,
  heldCount,
  autoPausedHeldCount = 0,
  directComposerMessagesSend,
  onReleaseAutoPausedInputs,
}: {
  pause: SessionPauseState | null | undefined;
  autoPause?: SessionState["codex_result_error_auto_pause"];
  autoPauseRecoveryProgress?: "testing" | "active" | null;
  heldCount: number;
  autoPausedHeldCount?: number;
  directComposerMessagesSend: boolean;
  onReleaseAutoPausedInputs?: (pausedAt: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const isManualPause = !!pause?.pausedAt;
  const isAutoPause = !isManualPause && !!autoPause?.pausedAt;
  const queued: HeldInputListItem[] = isManualPause ? (pause?.queuedMessages ?? []) : (autoPause?.heldInputs ?? []);
  const visibleCount = isManualPause
    ? Math.max(heldCount, queued.length)
    : Math.max(
        autoPausedHeldCount,
        queued.reduce((total, item) => total + getHeldCount(item), 0),
      );
  const label = visibleCount === 1 ? "1 held input" : `${visibleCount} held inputs`;
  const compactLabel = `${visibleCount} held`;
  const autoPauseCause = isAutoPause
    ? `Cause: ${fixedAutoPauseCause(autoPause.family)} at ${formatAutoPauseTime(autoPause.pausedAt!)}.`
    : "";
  const recoveryProgress = autoPauseRecoveryProgress ?? null;
  const releaseAccepted = isAutoPause && autoPause.releaseProgress?.status === "releasing";
  const autoPauseGuidanceText = isAutoPause
    ? autoPauseGuidance(autoPause.family, recoveryProgress, releaseAccepted)
    : "";
  const listTitle = useMemo(() => {
    if (isAutoPause) return `Automatic inputs paused, ${label}. ${autoPauseCause} ${autoPauseGuidanceText}`;
    if (visibleCount > 0) return `Other input sources are paused. ${label} will release after resume.`;
    return directComposerMessagesSend
      ? "Other input sources are paused. Direct composer messages still send."
      : "Other input sources are paused. Direct composer messages still need the session to resume.";
  }, [autoPauseCause, autoPauseGuidanceText, directComposerMessagesSend, isAutoPause, label, visibleCount]);

  if (!isManualPause && !isAutoPause) return null;

  return (
    <div className="px-4 pt-2">
      <div
        data-testid="composer-paused-banner"
        className="rounded-lg border border-cc-attention/75 bg-cc-attention-bg px-2.5 py-2 text-[11px] text-cc-fg"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="composer-paused-chip"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            title={listTitle}
            className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-medium text-cc-attention-strong transition-colors hover:bg-cc-warning/10"
          >
            <PauseIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{isAutoPause ? "Automatic inputs paused" : "Other sources paused"}</span>
            <span
              data-testid="composer-held-count-chip"
              className="rounded border border-cc-attention/45 bg-cc-card/70 px-1.5 py-0.5 font-mono-code text-[10px] text-cc-attention-strong"
            >
              {isAutoPause ? `· ${compactLabel}` : label}
            </span>
          </button>
          {isAutoPause && onReleaseAutoPausedInputs && (
            <button
              type="button"
              data-testid="composer-auto-pause-release"
              disabled={releaseAccepted}
              onClick={() => onReleaseAutoPausedInputs(autoPause.pausedAt!)}
              title={
                releaseAccepted
                  ? "Takode accepted your request and is releasing the held inputs."
                  : "Release the automatic inputs held by this pause."
              }
              className={`ml-auto inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-attention/70 ${
                releaseAccepted
                  ? "cursor-wait border-cc-attention/25 bg-cc-card/40 text-cc-muted"
                  : "cursor-pointer border-cc-attention/55 bg-cc-card/65 text-cc-attention-strong hover:bg-cc-warning/10"
              }`}
            >
              {releaseAccepted && (
                <span
                  className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-r-transparent"
                  aria-hidden="true"
                />
              )}
              {releaseAccepted ? "Releasing…" : "Release now"}
            </button>
          )}
          {isAutoPause ? (
            <div
              data-testid="composer-auto-pause-guidance"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="min-w-0 basis-full space-y-0.5 break-words text-cc-fg sm:pl-1"
            >
              <p>{autoPauseCause}</p>
              <p>{autoPauseGuidanceText}</p>
            </div>
          ) : (
            <span className="min-w-0 flex-1 text-cc-fg">
              {directComposerMessagesSend
                ? "Direct composer messages still send. External input waits here."
                : "Direct composer messages still need the session to resume. External input waits here."}
            </span>
          )}
        </div>
        {open && (
          <div
            data-testid="composer-held-input-list"
            className="mt-2 max-h-40 overflow-y-auto rounded-md border border-cc-attention/45 bg-cc-card/70"
          >
            {queued.length === 0 ? (
              <div className="px-2.5 py-2 text-cc-muted">No held input yet.</div>
            ) : (
              queued.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-t border-cc-attention/25 px-2.5 py-2 first:border-t-0"
                >
                  <span className="font-medium text-cc-attention-strong">{formatHeldSource(item, isAutoPause)}</span>
                  <span className="min-w-0 truncate text-cc-fg">{formatHeldPreview(item, isAutoPause)}</span>
                  <span className="flex items-center gap-1 font-mono-code text-[10px] text-cc-muted">
                    {getHeldCount(item) > 1 && (
                      <span className="rounded bg-cc-warning/15 px-1 text-cc-attention-strong">
                        x{getHeldCount(item)}
                      </span>
                    )}
                    {formatHeldTime(item)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
