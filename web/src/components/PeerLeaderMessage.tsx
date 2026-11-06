import { useContext, useMemo, type CSSProperties } from "react";
import { isSessionSentSourceId } from "../../shared/injected-event-message.js";
import { getLeaderProfilePortrait } from "../../shared/leader-profile-portraits.js";
import { markdownToPlainText } from "../../shared/markdown-plain-text.js";
import { splitTrailingTranscriptionTag } from "../../shared/transcription-tag.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import type { SearchHighlightInfo } from "../hooks/use-message-search-highlight.js";
import { useMessageExpansion } from "../hooks/use-message-expansion.js";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { getDisplayReplyContext } from "../utils/reply-context.js";
import { isStarActionableMessage } from "../utils/starred-messages.js";
import { HighlightedText } from "./HighlightedText.js";
import { LeaderProfilePortraitImage } from "./LeaderProfilePortraitButton.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { UserMessageMenu } from "./MessageActionMenus.js";
import {
  getMessageThreadLinkKey,
  MessageThreadHeader,
  MessageThreadHeaderOwnedContext,
} from "./MessageThreadHeader.js";
import { MessageTimeLabel, isValidMessageTimestamp } from "./MessageTimestamp.js";
import { ContinuedInLinks } from "./QuestForkLinks.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import { StarredMessageRailMarker } from "./StarredMessageIndicator.js";
import { useMessageStarActions } from "./use-message-star-actions.js";
import { UserReplyChip } from "./UserReplyChip.js";

/** Whether a session is a leader, by its live state or its session-list row. */
export function useIsLeaderSession(sessionId: string | undefined): boolean {
  return useStore(
    (s) =>
      !!sessionId &&
      (s.sessions.get(sessionId)?.isOrchestrator === true ||
        s.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator === true)),
  );
}

/**
 * Whether a message in a leader's feed came from another leader. Only a leader may message a
 * leader, so any message another session sent there is one; Takode's own injected messages
 * carry named source IDs instead of session IDs.
 */
export function isPeerLeaderMessage(message: ChatMessage, feedSessionId: string | undefined, feedIsLeader: boolean) {
  const sourceId = message.agentSource?.sessionId;
  return feedIsLeader && message.role === "user" && isSessionSentSourceId(sourceId) && sourceId !== feedSessionId;
}

/** The sender's portrait sits where an answer's paw sits, so this text lines up with answers. */
const RAIL_TIME_SHIFT = { "--message-time-rail-shift": "1.75rem" } as CSSProperties;

/**
 * Another leader's message in a leader's feed. Leaders message each other often, and as user
 * bubbles those messages buried the user's own. Here each one is a light left-side line, the
 * sender and the message's first line, that opens to the full text; only the user's messages
 * stay bubbles.
 */
export function PeerLeaderMessage({
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
  currentThreadKey,
  onSelectThread,
  readOnly,
  questLinkSurface,
}: {
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  readOnly: boolean;
  questLinkSurface: QuestLinkSurface;
}) {
  const senderId = message.agentSource?.sessionId;
  const sender = useSdkSessionRow(senderId);
  const portrait = getLeaderProfilePortrait(sender?.leaderProfilePortraitId);
  const senderLabel =
    message.agentSource?.sessionLabel ||
    (sender?.sessionNum != null ? `#${sender.sessionNum}${sender.name ? ` ${sender.name}` : ""}` : "Another leader");

  const [savedExpanded, setExpanded] = useMessageExpansion(
    sessionId,
    isStarActionableMessage(message) ? message.id : null,
  );
  // A search landing on this message shows its text.
  const expanded = savedExpanded || searchHighlight?.isCurrent === true;
  const starAction = useMessageStarActions(sessionId, message);
  const starred = starAction.actionable && starAction.starred;

  const replyContext = useMemo(
    () => getDisplayReplyContext(message.content, message.metadata?.replyContext),
    [message.content, message.metadata?.replyContext],
  );
  const { text: displayContent } = splitTrailingTranscriptionTag(
    replyContext ? replyContext.userMessage : message.content,
  );
  const preview = useMemo(() => firstLine(markdownToPlainText(displayContent)), [displayContent]);

  const threadHeaderOwned = useContext(MessageThreadHeaderOwnedContext);
  const threadKey = threadHeaderOwned ? null : getMessageThreadLinkKey(message, currentThreadKey);

  return (
    <div
      className="group/msg relative flex items-start gap-2 animate-[fadeSlideIn_0.2s_ease-out]"
      data-testid="peer-leader-message"
      data-expanded={expanded ? "true" : undefined}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {!readOnly && starred ? (
          <StarredMessageRailMarker side="user" onUnstar={starAction.toggleStarred} />
        ) : portrait ? (
          <LeaderProfilePortraitImage portrait={portrait} size="sm" testId="peer-leader-portrait" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cc-hover text-cc-muted">
            <SessionRoleIcon role="Leader" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <MessageThreadHeader
          threadKey={threadKey}
          onSelectThread={onSelectThread}
          message={{ sessionId, id: message.id }}
        />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} message from ${senderLabel}`}
          className="relative flex w-full min-w-0 items-center py-0.5 text-left text-[13px] leading-5 text-cc-muted transition-colors hover:text-cc-fg cursor-pointer"
          style={RAIL_TIME_SHIFT}
          data-testid="peer-leader-message-toggle"
        >
          {showTimestamp && isValidMessageTimestamp(message.timestamp) && (
            <MessageTimeLabel id={message.id} side="assistant" timestamp={message.timestamp} inline />
          )}
          <span className="shrink-0 font-medium text-cc-fg/70" data-testid="peer-leader-message-sender">
            {senderLabel}
          </span>
          {!expanded && preview && (
            <span className="ml-1.5 min-w-0 truncate" data-testid="peer-leader-message-preview">
              {highlight(preview, searchHighlight)}
            </span>
          )}
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`ml-1 h-3 w-3 shrink-0 opacity-60 transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        {expanded && (
          <div
            className="mt-1 border-l-2 border-cc-border/70 pl-3 text-cc-fg/85"
            data-testid="peer-leader-message-body"
          >
            {replyContext && (
              <UserReplyChip previewText={replyContext.previewText} messageId={replyContext.messageId} />
            )}
            <MarkdownContent
              text={displayContent}
              variant="conservative"
              sessionId={sessionId}
              searchHighlight={searchHighlight}
              fileLinkMode={readOnly ? "text-only" : "interactive"}
              questLinkSurface={questLinkSurface}
            />
            <ContinuedInLinks message={message} currentThreadKey={currentThreadKey} onSelectThread={onSelectThread} />
          </div>
        )}
      </div>
      {/* Reverting to another leader's message would put its words in the user's composer. */}
      {!readOnly && !message.pendingState && (
        <UserMessageMenu message={message} sessionId={sessionId} canRevert={false} />
      )}
    </div>
  );
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function highlight(text: string, searchHighlight: SearchHighlightInfo | undefined) {
  if (!searchHighlight?.query) return text;
  return (
    <HighlightedText
      text={text}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  );
}
