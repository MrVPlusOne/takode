import type { ChatMessage } from "../types.js";

/** Why Takode rejected the routing of a leader message, phrased for the user. */
export type RejectedRouteReason = "missing thread tag" | "invalid thread tag" | "answer tag not accepted";

/**
 * Return why the server rejected this leader message's thread routing, or null
 * when the message routed normally.
 *
 * Rejected messages stay in append-only history and the leader is reminded to
 * resend them, so the feed collapses their text. The row does not claim a
 * resend happened: the leader may answer differently or not at all. Shell-command and
 * missing-role errors are excluded: the command still ran, and missing-role
 * text is routed with its marker consumed, so neither leaves stray tag text.
 */
export function getRejectedRouteReason(message: ChatMessage): RejectedRouteReason | null {
  const error = message.metadata?.threadRoutingError;
  if (!error || error.source === "shell_command") return null;
  switch (error.reason) {
    case "missing":
      return "missing thread tag";
    case "invalid":
    case "invalid_role":
      return "invalid thread tag";
    case "invalid_answer_route":
      return "answer tag not accepted";
    case "missing_role":
      return null;
  }
}

/** Disclosure row that stands in for a rejected leader message's text. */
export function RejectedRouteMessageHeader({
  reason,
  expanded,
  onToggle,
}: {
  reason: RejectedRouteReason;
  expanded: boolean;
  onToggle: () => void;
}) {
  const title = reason === "answer tag not accepted" ? "Rejected answer" : "Unrouted message";
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2 rounded-md border border-cc-border/40 bg-cc-hover/15 px-2 py-1 text-left transition-colors hover:bg-cc-hover/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} ${title.toLowerCase()}`}
      data-testid="rejected-route-message-header"
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
        aria-hidden="true"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-cc-muted">
        <span className="text-cc-fg/75">{title}</span>
        <span className="text-cc-muted/75"> · {reason}</span>
      </span>
    </button>
  );
}
