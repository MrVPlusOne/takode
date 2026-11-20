import type { ReactNode } from "react";
import type { NeedsInputResolutionNoticeViewModel } from "../utils/needs-input-resolution-notice.js";
import type { QuestThreadReminderViewModel } from "../utils/quest-thread-reminder.js";
import type { ThreadRoutingReminderViewModel } from "../utils/thread-routing-reminder.js";
import { InjectedMessageChip, type InjectedMessageChipTone } from "./InjectedMessageChip.js";
import { CheckCircleIcon, LinkIcon, RouteIcon } from "./InjectedMessageIcons.js";

type ModelOnlyReminderViewModel = {
  title: string;
  description: string;
  rawContent: string;
};

export function ThreadRoutingReminderView({ reminder }: { reminder: ThreadRoutingReminderViewModel }) {
  return <ModelOnlyReminderView reminder={reminder} kind="thread-routing" iconTone="info" icon={<RouteIcon />} />;
}

export function QuestThreadReminderView({ reminder }: { reminder: QuestThreadReminderViewModel }) {
  return <ModelOnlyReminderView reminder={reminder} kind="quest-thread" iconTone="attention" icon={<LinkIcon />} />;
}

function ModelOnlyReminderView({
  reminder,
  kind,
  iconTone,
  icon,
}: {
  reminder: ModelOnlyReminderViewModel;
  kind: string;
  iconTone: InjectedMessageChipTone;
  icon: ReactNode;
}) {
  return (
    <InjectedMessageChip
      title={reminder.title}
      badge="model-only"
      iconTone={iconTone}
      icon={icon}
      testId="model-only-reminder-chip"
      kind={kind}
    >
      <p className="mb-1.5 text-[11px] leading-snug text-cc-muted">{reminder.description}</p>
      <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-muted">
        {reminder.rawContent}
      </pre>
    </InjectedMessageChip>
  );
}

export function NeedsInputResolutionNoticeView({ notice }: { notice: NeedsInputResolutionNoticeViewModel }) {
  return (
    <InjectedMessageChip
      title={notice.title}
      summary={notice.description}
      badge="resolved"
      tone="success"
      icon={<CheckCircleIcon />}
      testId="needs-input-resolution-notice-chip"
      kind="needs-input-resolution"
    >
      {notice.warning && <p className="mb-2 text-[11px] leading-snug text-cc-muted">{notice.warning}</p>}
      {notice.entries.length > 0 ? (
        <ul className="space-y-1 text-[13px] leading-snug">
          {notice.entries.map((entry) => (
            <li key={`${entry.rawId}-${entry.summary}`} className="min-w-0">
              <span className="text-cc-fg/85">{entry.summary}</span>
              {entry.source && <span className="text-cc-muted"> ({entry.source})</span>}
            </li>
          ))}
        </ul>
      ) : (
        <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-muted">
          {notice.rawContent}
        </pre>
      )}
    </InjectedMessageChip>
  );
}
