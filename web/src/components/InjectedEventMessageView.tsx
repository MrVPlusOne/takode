import type { SearchHighlightInfo } from "../hooks/use-message-search-highlight.js";
import type { ChatMessage } from "../types.js";
import type { InjectedEventMessageViewModel } from "../utils/injected-event-message.js";
import { InjectedMessageChip, InjectedMessageRow } from "./InjectedMessageChip.js";
import { EventIcon, WarningIcon } from "./InjectedMessageIcons.js";
import { MarkdownContent } from "./MarkdownContent.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";

function formatCharacterCount(count: number): string {
  return count.toLocaleString() + " " + (count === 1 ? "character" : "characters");
}

export function InjectedEventMessageView({
  event,
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
  questLinkSurface = "legacy",
}: {
  event: InjectedEventMessageViewModel;
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
  questLinkSurface?: QuestLinkSurface;
}) {
  const warningTone = event.tone === "warning";
  return (
    <InjectedMessageRow timestamp={message.timestamp} showTimestamp={showTimestamp}>
      <InjectedMessageChip
        title={event.title}
        badge={warningTone ? "warning" : "event"}
        tone={warningTone ? "warning" : "neutral"}
        icon={warningTone ? <WarningIcon /> : <EventIcon />}
        testId="injected-event-message-chip"
        searchHighlight={searchHighlight}
      >
        <p className={`mb-1.5 text-[11px] leading-snug ${warningTone ? "text-cc-error" : "text-cc-muted"}`}>
          {event.description}
        </p>
        <p className="mb-1.5 font-mono-code text-[10px] leading-snug text-cc-muted">
          Message size: {formatCharacterCount(event.messageSizeChars)}
        </p>
        <MarkdownContent
          text={event.rawContent}
          variant="conservative"
          sessionId={sessionId}
          searchHighlight={searchHighlight}
          questLinkSurface={questLinkSurface}
        />
      </InjectedMessageChip>
    </InjectedMessageRow>
  );
}
