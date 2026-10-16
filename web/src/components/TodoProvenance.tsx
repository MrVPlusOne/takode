import type { TodoActor, TodoAuthorization, TodoItem, TodoMutationProvenance } from "../../shared/todo-types.js";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

/**
 * Who added a to-do and who last changed it, when that was an agent: the session or scheduled
 * workflow, where an added to-do came from, and what authorized the change. The user's own changes
 * stay unmarked. Renders nothing for a to-do only the user has touched.
 */
export function TodoProvenance({
  item,
  className,
  onNavigate,
}: {
  item: TodoItem;
  className?: string;
  onNavigate?: () => void;
}) {
  const added = byAgent(item.createdBy);
  // The creating change is also the last one until something else changes the to-do.
  const changed = byAgent(item.lastModifiedBy) && item.lastModifiedBy.at !== item.createdBy.at;
  if (!added && !changed) return null;
  return (
    <div className={className} data-testid="todo-provenance">
      {added && (
        <p>
          Added by <ActorName actor={item.createdBy.actor} onNavigate={onNavigate} /> {timeAgo(item.createdBy.at)}
          {item.createdBy.source ? ` · from ${item.createdBy.source}` : ""}
          {authorityText(item.createdBy.authorization)}
        </p>
      )}
      {changed && (
        <p>
          Changed by <ActorName actor={item.lastModifiedBy.actor} onNavigate={onNavigate} />{" "}
          {timeAgo(item.lastModifiedBy.at)}
          {authorityText(item.lastModifiedBy.authorization)}
        </p>
      )}
    </div>
  );
}

function byAgent(provenance: TodoMutationProvenance): boolean {
  return provenance.actor.kind === "session" || provenance.actor.kind === "workflow";
}

function authorityText(authorization: TodoAuthorization): string {
  switch (authorization.kind) {
    case "direct_message":
      return " · with your approval";
    case "standing_approval":
      return ` · standing approval: ${authorization.standingApproval ?? ""}`;
    case "grant":
      return " · under a grant";
    case "proposal_approval":
      return " · you approved its proposal";
    default:
      return "";
  }
}

function ActorName({ actor, onNavigate }: { actor: TodoActor; onNavigate?: () => void }) {
  const session = useSdkSessionRow(actor.sessionId ?? null);
  if (!session) {
    // A session's label is its name, or its number when it has none.
    return <>{actor.label?.replace(/^\d+$/, "#$&") ?? "an agent"}</>;
  }
  return (
    <SessionInlineLink
      sessionId={session.sessionId}
      sessionNum={session.sessionNum}
      className="text-cc-primary hover:underline"
      onNavigate={onNavigate}
    >
      {session.sessionNum != null ? `#${session.sessionNum}` : "session"}
      {session.name ? ` ${session.name}` : ""}
    </SessionInlineLink>
  );
}
