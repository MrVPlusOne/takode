import { useState } from "react";
import type { NeedsInputResolutionNoticeViewModel } from "../utils/needs-input-resolution-notice.js";
import type { NeedsInputReminderEntryStatus, NeedsInputReminderViewModel } from "../utils/needs-input-reminder.js";
import type { QuestThreadReminderViewModel } from "../utils/quest-thread-reminder.js";
import type { ThreadRoutingReminderViewModel } from "../utils/thread-routing-reminder.js";

type ModelOnlyReminderViewModel = {
  title: string;
  description: string;
  rawContent: string;
};

export function ThreadRoutingReminderView({ reminder }: { reminder: ThreadRoutingReminderViewModel }) {
  return <ModelOnlyReminderView reminder={reminder} accent="sky" icon="route" />;
}

export function QuestThreadReminderView({ reminder }: { reminder: QuestThreadReminderViewModel }) {
  return <ModelOnlyReminderView reminder={reminder} accent="amber" icon="link" />;
}

function ModelOnlyReminderView({
  reminder,
  accent,
  icon,
}: {
  reminder: ModelOnlyReminderViewModel;
  accent: "amber" | "sky";
  icon: "link" | "route";
}) {
  const [expanded, setExpanded] = useState(false);
  const accentClass = accent === "sky" ? "text-sky-300/80" : "text-amber-200/80";
  const borderClass = accent === "sky" ? "border-sky-400/15" : "border-amber-300/15";

  return (
    <div className="text-left">
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-2 rounded-md border ${borderClass} bg-cc-hover/20 px-2 py-1 text-left transition-colors hover:bg-cc-hover/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${reminder.title}`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <ModelOnlyReminderIcon icon={icon} className={`h-3.5 w-3.5 shrink-0 ${accentClass}`} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-cc-muted">
          {reminder.title}
        </span>
        <span className="shrink-0 rounded-full border border-cc-border/40 px-1.5 py-0.5 font-mono-code text-[9px] leading-none text-cc-muted/65">
          model-only
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md border border-cc-border/25 bg-cc-card/35 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] leading-snug text-cc-muted">{reminder.description}</p>
          <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-muted/90">
            {reminder.rawContent}
          </pre>
        </div>
      )}
    </div>
  );
}

function ModelOnlyReminderIcon({ icon, className }: { icon: "link" | "route"; className: string }) {
  if (icon === "link") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={className}
        aria-hidden="true"
        data-testid="model-only-reminder-icon"
        data-icon-kind="link"
      >
        <path
          d="M6.85 4.45l.75-.75a3 3 0 014.25 4.25l-1.7 1.7a3 3 0 01-4.25 0"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.15 11.55l-.75.75a3 3 0 01-4.25-4.25l1.7-1.7a3 3 0 014.25 0"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M6.45 9.55l3.1-3.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
      data-testid="model-only-reminder-icon"
      data-icon-kind="route"
    >
      <path
        d="M3 4.5h5.5c2.5 0 4.5 2 4.5 4.5v2M10.5 8.5L13 11l-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NeedsInputReminderView({ reminder }: { reminder: NeedsInputReminderViewModel }) {
  // Always start collapsed, like the other injected reminder chips: the live
  // prompts themselves already demand attention elsewhere in the UI.
  const [expanded, setExpanded] = useState(false);
  const hasActive = reminder.activeCount > 0;
  const status = needsInputReminderStatus(reminder);

  return (
    <div className="text-left">
      <button
        type="button"
        className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-cc-border/35 bg-cc-hover/20 px-2 py-1 text-left text-[12px] leading-snug transition-colors hover:border-cc-border/55 hover:bg-cc-hover/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${reminder.title}`}
        data-testid="needs-input-reminder-chip"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3.5 w-3.5 shrink-0 ${hasActive ? "text-cc-attention" : "text-cc-muted/60"}`}
          aria-hidden="true"
        >
          <path d="M8 1.5A3.5 3.5 0 004.5 5v2.5c0 .78-.26 1.54-.73 2.16L3 10.66V11.5h10v-.84l-.77-1A3.49 3.49 0 0111.5 7.5V5A3.5 3.5 0 008 1.5zM6.5 13a1.5 1.5 0 003 0h-3z" />
        </svg>
        <span className="min-w-0 truncate font-medium text-cc-fg/85">{reminder.title}</span>
        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium ${status.className}`}>
          {status.label}
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 rounded-md border border-cc-border/25 bg-cc-card/35 px-2.5 py-2">
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
        </div>
      )}
    </div>
  );
}

const ENTRY_STATUS_LABELS = { active: "Open", resolved: "Resolved", unknown: "Unavailable" } as const;

function needsInputReminderStatus(reminder: NeedsInputReminderViewModel): { label: string; className: string } {
  if (reminder.activeCount > 0) {
    return {
      label: `${reminder.activeCount} open`,
      className: "border-cc-attention-border bg-cc-attention-bg text-cc-attention",
    };
  }
  const muted = "border-cc-border/50 text-cc-muted";
  if (reminder.hasPartialState) return { label: "Partial state", className: muted };
  if (reminder.resolvedCount > 0 && reminder.unknownCount === 0) {
    return { label: "Resolved", className: "border-cc-success/30 text-cc-success" };
  }
  if (reminder.unknownCount > 0) return { label: "State unavailable", className: muted };
  return { label: "Historical", className: muted };
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
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="text-left">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-emerald-400/20 bg-emerald-500/8 px-2 py-1 text-left transition-colors hover:bg-emerald-500/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${notice.title}`}
        data-testid="needs-input-resolution-notice-chip"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${collapsed ? "" : "rotate-90"}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" aria-hidden="true">
          <path
            d="M4 8.25l2.35 2.35L12 4.95"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.15" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-cc-muted">
          <span className="text-cc-fg/85">{notice.title}</span>
          <span className="text-cc-muted/75"> · {notice.description}</span>
        </span>
        <span className="shrink-0 rounded-full border border-emerald-400/25 px-1.5 py-0.5 font-mono-code text-[9px] leading-none text-emerald-200/80">
          resolved
        </span>
      </button>

      {!collapsed && (
        <div className="mt-1.5 rounded-md border border-cc-border/25 bg-cc-card/35 px-2.5 py-2">
          {notice.warning && <p className="mb-2 text-[11px] leading-snug text-cc-muted">{notice.warning}</p>}
          {notice.entries.length > 0 ? (
            <div className="space-y-1 font-mono-code text-[12px] leading-relaxed">
              {notice.entries.map((entry) => (
                <div key={`${entry.rawId}-${entry.summary}`} className="flex min-w-0 items-start gap-2">
                  <span className="shrink-0 text-cc-muted/70">{entry.rawId}.</span>
                  <span className="min-w-0 flex-1 text-cc-muted">
                    <span className="text-cc-fg/85">{entry.summary}</span>
                    {entry.source && <span className="text-cc-muted/75"> ({entry.source})</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words font-mono-code text-[11px] leading-relaxed text-cc-muted/90">
              {notice.rawContent}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
