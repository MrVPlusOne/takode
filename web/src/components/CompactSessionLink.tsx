import type { ReactNode } from "react";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

interface CompactSessionLinkProps {
  sessionId: string;
  threadKey?: string | null;
  className?: string;
  hoverCardZIndexClassName?: string;
  stopPropagation?: boolean;
  onNavigate?: () => void;
  /**
   * Shown instead of the link while the session's number isn't known, such as for a session archived
   * long ago (the browser lists only active and recently archived ones); nothing by default.
   */
  fallback?: ReactNode;
}

const DEFAULT_CLASS_NAME =
  "inline-flex items-center text-[11px] font-mono px-1.5 py-0.5 rounded bg-cc-primary/10 text-cc-primary hover:bg-cc-primary/20 cursor-pointer transition-colors";

/** A session's "#N" link; never a placeholder number for a session the browser doesn't know. */
export function CompactSessionLink({
  sessionId,
  threadKey,
  className,
  hoverCardZIndexClassName,
  stopPropagation = true,
  onNavigate,
  fallback = null,
}: CompactSessionLinkProps) {
  const sessionNum = useSdkSessionRow(sessionId)?.sessionNum;
  if (sessionNum == null) return <>{fallback}</>;
  const label = `#${sessionNum}`;

  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sessionNum}
      threadKey={threadKey}
      stopPropagation={stopPropagation}
      hoverCardZIndexClassName={hoverCardZIndexClassName}
      onNavigate={onNavigate}
      className={className ?? DEFAULT_CLASS_NAME}
      ariaLabel={label}
      title={threadKey ? `Open session ${label}, thread ${threadKey}` : `Open session ${label}`}
    >
      {label}
    </SessionInlineLink>
  );
}
