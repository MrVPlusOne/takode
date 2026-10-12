import type { ReactNode } from "react";
import { useStore } from "../store.js";
import type { BoardParticipantStatus } from "../types.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import { SessionStatusDot } from "./SessionStatusDot.js";
import { useParticipantSessionStatusDotProps } from "./session-participant-status.js";

const BUTTON_CLASS =
  "inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50";
const WORKER_BUTTON_CLASS = `${BUTTON_CLASS} border-cc-border bg-cc-hover/30 text-cc-fg hover:border-cc-primary/45 hover:bg-cc-hover/60`;
// Open Thread is the jump users want most often, so it carries the accent.
const THREAD_BUTTON_CLASS = `${BUTTON_CLASS} border-cc-primary/50 bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25`;
const DISABLED_BUTTON_CLASS = `${BUTTON_CLASS} cursor-not-allowed border-dashed border-cc-border/60 text-cc-muted/60`;

/**
 * The quest views' top jump buttons: Open Worker opens the worker session and Open Thread opens
 * the quest's thread tab in its leader session. Each button names its session number, so the
 * buttons double as the visible session links, and Open Worker carries the worker's live status
 * dot. A missing session leaves its button disabled so both always sit in the same place; with
 * neither session there is nothing to show.
 */
export function QuestSessionActions({
  questId,
  workerSessionId,
  workerStatus,
  leaderSessionId,
  onNavigate,
  className = "",
}: {
  questId: string;
  workerSessionId: string | null;
  /** The board's worker status, used for the dot when the session is not in the session list. */
  workerStatus?: BoardParticipantStatus["status"];
  leaderSessionId: string | null;
  /** Called after either button navigates, so a preview or dialog can close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  if (!workerSessionId && !leaderSessionId) return null;
  return (
    <div
      data-testid="quest-session-actions"
      className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}
      aria-label="Quest sessions"
    >
      <QuestSessionButton
        role="Worker"
        label="Open Worker"
        sessionId={workerSessionId}
        status={workerStatus}
        className={WORKER_BUTTON_CLASS}
        missingTitle="No worker session for this quest"
        testId="quest-open-worker"
        onNavigate={onNavigate}
      />
      <QuestSessionButton
        role="Leader"
        label="Open Thread"
        sessionId={leaderSessionId}
        threadKey={questId}
        className={THREAD_BUTTON_CLASS}
        missingTitle="No leader session for this quest"
        testId="quest-open-thread"
        onNavigate={onNavigate}
      />
    </div>
  );
}

function QuestSessionButton({
  role,
  label,
  sessionId,
  status,
  threadKey,
  className,
  missingTitle,
  testId,
  onNavigate,
}: {
  role: "Worker" | "Leader";
  label: string;
  sessionId: string | null;
  status?: BoardParticipantStatus["status"];
  threadKey?: string;
  className: string;
  missingTitle: string;
  testId: string;
  onNavigate?: () => void;
}) {
  const session = useStore((state) =>
    sessionId ? state.sdkSessions.find((candidate) => candidate.sessionId === sessionId) : undefined,
  );
  const sessionNum = session?.sessionNum ?? null;
  const dotProps = useParticipantSessionStatusDotProps(role === "Worker" ? sessionId : null, status);
  const content: ReactNode = (
    <>
      <SessionRoleIcon role={role} />
      <span className="whitespace-nowrap">{label}</span>
    </>
  );

  if (!sessionId) {
    return (
      <button type="button" disabled data-testid={testId} className={DISABLED_BUTTON_CLASS} title={missingTitle}>
        {content}
      </button>
    );
  }

  // An unlisted session has no number yet; the button still opens it by ID.
  const sessionLabel = sessionNum != null ? `#${sessionNum}` : null;
  const sessionName = `${role === "Leader" ? "leader" : "worker"} session${sessionLabel ? ` ${sessionLabel}` : ""}${
    session?.name ? ` (${session.name})` : ""
  }`;
  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sessionNum}
      threadKey={threadKey}
      stopPropagation
      className={className}
      dataTestId={testId}
      ariaLabel={sessionLabel ? `${label} ${sessionLabel}` : label}
      title={threadKey ? `Open the ${threadKey} thread in ${sessionName}` : `Open ${sessionName}`}
      onNavigate={onNavigate}
    >
      {content}
      {sessionLabel && <span className="font-mono-code text-[11px] opacity-75">{sessionLabel}</span>}
      {dotProps && <SessionStatusDot className="mt-0" {...dotProps} />}
    </SessionInlineLink>
  );
}
