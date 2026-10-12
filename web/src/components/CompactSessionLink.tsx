import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

interface CompactSessionLinkProps {
  sessionId: string;
  threadKey?: string | null;
  className?: string;
  hoverCardZIndexClassName?: string;
  stopPropagation?: boolean;
  onNavigate?: () => void;
}

const DEFAULT_CLASS_NAME =
  "inline-flex items-center text-[11px] font-mono px-1.5 py-0.5 rounded bg-cc-primary/10 text-cc-primary hover:bg-cc-primary/20 cursor-pointer transition-colors";

export function CompactSessionLink({
  sessionId,
  threadKey,
  className,
  hoverCardZIndexClassName,
  stopPropagation = true,
  onNavigate,
}: CompactSessionLinkProps) {
  const sdkSession = useSdkSessionRow(sessionId);
  const routeSessionRef = sdkSession?.sessionNum ?? sessionId;
  const label = sdkSession?.sessionNum != null ? `#${sdkSession.sessionNum}` : "#?";

  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sdkSession?.sessionNum ?? null}
      threadKey={threadKey}
      stopPropagation={stopPropagation}
      hoverCardZIndexClassName={hoverCardZIndexClassName}
      onNavigate={onNavigate}
      className={className ?? DEFAULT_CLASS_NAME}
      ariaLabel={label}
      title={threadKey ? `Open session ${label}, thread ${threadKey}` : `Open session ${label}`}
    >
      {routeSessionRef == null ? "#?" : label}
    </SessionInlineLink>
  );
}
