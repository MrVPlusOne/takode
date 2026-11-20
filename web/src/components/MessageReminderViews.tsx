import type { ReactNode } from "react";
import type { NeedsInputResolutionNoticeViewModel } from "../utils/needs-input-resolution-notice.js";
import type { NeedsInputReminderEntryStatus, NeedsInputReminderViewModel } from "../utils/needs-input-reminder.js";
import type { QuestThreadReminderViewModel } from "../utils/quest-thread-reminder.js";
import type { ThreadRoutingReminderViewModel } from "../utils/thread-routing-reminder.js";
import { InjectedMessageChip, type InjectedMessageChipTone } from "./InjectedMessageChip.js";
import { BellIcon, CheckCircleIcon, LinkIcon, RouteIcon } from "./InjectedMessageIcons.js";

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

export function NeedsInputReminderView({ reminder }: { reminder: NeedsInputReminderViewModel }) {
  // Always start collapsed, like the other injected reminder chips: the live
  // prompts themselves already demand attention elsewhere in the UI.
  const status = needsInputReminderStatus(reminder);
  return (
    <InjectedMessageChip
      title={reminder.title}
      badge={status.label}
      badgeTone={status.tone}
      iconTone={reminder.activeCount > 0 ? "attention" : "neutral"}
      icon={<BellIcon />}
      testId="needs-input-reminder-chip"
      kind="needs-input-reminder"
    >
      <p className="text-[12px] leading-snug text-cc-muted">{reminder.description}</p>
      {reminder.entries.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[13px] leading-snug">
          {reminder.entries.map((entry) => (
            <li key={`${entry.notificationId}-${entry.rawId}`} className="flex min-w-0 items-start gap-2">
              <NeedsInputEntryStatusIcon status={entry.status} />
              <span className={`min-w-0 flex-1 ${entry.status === "active" ? "text-cc-fg" : "text-cc-muted"}`}>
                {entry.summary}
              </span>
              <span className="shrink-0 text-[11px] text-cc-muted/80">{ENTRY_STATUS_LABELS[entry.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </InjectedMessageChip>
  );
}

const ENTRY_STATUS_LABELS = { active: "Open", resolved: "Resolved", unknown: "Unavailable" } as const;

function needsInputReminderStatus(reminder: NeedsInputReminderViewModel): {
  label: string;
  tone: InjectedMessageChipTone;
} {
  if (reminder.activeCount > 0) return { label: `${reminder.activeCount} open`, tone: "attention" };
  if (reminder.hasPartialState) return { label: "Partial state", tone: "neutral" };
  if (reminder.resolvedCount > 0 && reminder.unknownCount === 0) return { label: "Resolved", tone: "success" };
  if (reminder.unknownCount > 0) return { label: "State unavailable", tone: "neutral" };
  return { label: "Historical", tone: "neutral" };
}

function NeedsInputEntryStatusIcon({ status }: { status: NeedsInputReminderEntryStatus }) {
  if (status === "resolved") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cc-success" aria-hidden="true">
        <path
          d="M4 8.25l2.35 2.35L12 4.95"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  const dotClass = status === "active" ? "bg-cc-attention" : "border border-cc-muted/60";
  return (
    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
    </span>
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
