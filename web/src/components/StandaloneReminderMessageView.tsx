import type { ChatMessage, SessionNotification } from "../types.js";
import type { SearchHighlightInfo } from "../hooks/use-message-search-highlight.js";
import { buildNeedsInputResolutionNoticeViewModel } from "../utils/needs-input-resolution-notice.js";
import { buildNeedsInputReminderViewModel } from "../utils/needs-input-reminder.js";
import { buildQuestThreadReminderViewModel } from "../utils/quest-thread-reminder.js";
import {
  buildSystemReminderViewModel,
  isStandaloneReminderMessage,
  type SystemReminderViewModel,
} from "../utils/standalone-reminder-message.js";
import { buildThreadRoutingReminderViewModel } from "../utils/thread-routing-reminder.js";
import { useStore } from "../store.js";
import { HighlightedText } from "./HighlightedText.js";
import { InjectedMessageChip, InjectedMessageRow } from "./InjectedMessageChip.js";
import { BookIcon, LandingIcon, LockIcon, RestartIcon, WarningIcon } from "./InjectedMessageIcons.js";
import { MarkdownContent } from "./MarkdownContent.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import {
  NeedsInputReminderView,
  NeedsInputResolutionNoticeView,
  QuestThreadReminderView,
  ThreadRoutingReminderView,
} from "./MessageReminderViews.js";

export { isStandaloneReminderMessage };

export function StandaloneReminderMessageView({
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
  questLinkSurface = "legacy",
}: {
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
  questLinkSurface?: QuestLinkSurface;
}) {
  const notifications = useStore((s) => (sessionId ? s.sessionNotifications.get(sessionId) : undefined));
  const body = buildStandaloneReminderBody(message, notifications, searchHighlight, sessionId, questLinkSurface);
  if (!body) return null;

  return (
    <InjectedMessageRow timestamp={message.timestamp} showTimestamp={showTimestamp}>
      {body}
    </InjectedMessageRow>
  );
}

function buildStandaloneReminderBody(
  message: ChatMessage,
  notifications: ReadonlyArray<SessionNotification> | undefined,
  searchHighlight: SearchHighlightInfo | undefined,
  sessionId: string | undefined,
  questLinkSurface: QuestLinkSurface,
) {
  const threadRoutingReminder = buildThreadRoutingReminderViewModel(message);
  if (threadRoutingReminder) return <ThreadRoutingReminderView reminder={threadRoutingReminder} />;

  const questThreadReminder = buildQuestThreadReminderViewModel(message);
  if (questThreadReminder) return <QuestThreadReminderView reminder={questThreadReminder} />;

  const needsInputReminder = buildNeedsInputReminderViewModel(message, notifications);
  if (needsInputReminder) return <NeedsInputReminderView reminder={needsInputReminder} />;

  const needsInputResolutionNotice = buildNeedsInputResolutionNoticeViewModel(message);
  if (needsInputResolutionNotice) {
    return <NeedsInputResolutionNoticeView notice={needsInputResolutionNotice} />;
  }

  const systemReminder = buildSystemReminderViewModel(message);
  if (systemReminder) {
    return (
      <SystemReminderChip
        reminder={systemReminder}
        searchHighlight={searchHighlight}
        sessionId={sessionId}
        questLinkSurface={questLinkSurface}
      />
    );
  }
  return null;
}

function SystemReminderChip({
  reminder,
  searchHighlight,
  sessionId,
  questLinkSurface,
}: {
  reminder: SystemReminderViewModel;
  searchHighlight?: SearchHighlightInfo;
  sessionId?: string;
  questLinkSurface: QuestLinkSurface;
}) {
  return (
    <InjectedMessageChip
      title={reminder.title}
      summary={reminder.summary}
      meta={reminder.meta}
      badge={reminder.badge}
      tone={reminder.tone}
      icon={<SystemReminderIcon kind={reminder.kind} />}
      testId="standalone-system-reminder-chip"
      kind={reminder.kind}
      searchHighlight={searchHighlight}
    >
      {reminder.detailFacts.length > 0 && (
        <dl
          className="mb-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] leading-snug"
          data-testid="system-reminder-detail-facts"
        >
          {reminder.detailFacts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-cc-muted">{fact.label}</dt>
              <dd className="min-w-0 break-words text-cc-fg/85">
                {searchHighlight?.query ? (
                  <HighlightedText
                    text={fact.value}
                    query={searchHighlight.query}
                    mode={searchHighlight.mode}
                    isCurrent={searchHighlight.isCurrent}
                  />
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <MarkdownContent
        text={reminder.detailContent}
        variant="conservative"
        sessionId={sessionId}
        searchHighlight={searchHighlight}
        questLinkSurface={questLinkSurface}
      />
    </InjectedMessageChip>
  );
}

function SystemReminderIcon({ kind }: { kind: SystemReminderViewModel["kind"] }) {
  if (kind === "resource-lease") return <LockIcon />;
  if (kind === "landing-queue") return <LandingIcon />;
  if (kind === "long-sleep-guard" || kind === "session-recovery") return <WarningIcon />;
  if (kind === "skills-changed") return <BookIcon />;
  return <RestartIcon />;
}
