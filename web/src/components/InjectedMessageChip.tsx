import { useId, useState, type ReactNode, type Ref } from "react";
import type { SearchHighlightInfo } from "../hooks/use-message-search-highlight.js";
import { HighlightedText } from "./HighlightedText.js";
import { MessageTimestamp } from "./MessageTimestamp.js";

/**
 * Shared look for messages Takode injects into a session (reminders, notices,
 * recovery and bootstrap events). They are part of the agent's workflow, not
 * the user's conversation, so the feed shows each as one collapsed line that
 * expands to the full text instead of a user bubble. New injected message
 * types should render through this chip; see the takode-injected-message-design skill.
 */
export type InjectedMessageChipTone = "neutral" | "success" | "attention" | "info" | "warning";

// Theme tokens keep every tone readable in both light and dark themes.
const TONES: Record<InjectedMessageChipTone, { surface: string; icon: string; badge: string; detail: string }> = {
  neutral: {
    surface: "border-cc-border/35 bg-cc-hover/20 hover:border-cc-border/55 hover:bg-cc-hover/35",
    icon: "text-cc-muted/65",
    badge: "border-cc-border/50 text-cc-muted",
    detail: "border-cc-border/25 bg-cc-card/35",
  },
  success: {
    surface: "border-cc-success/25 bg-cc-success/8 hover:bg-cc-success/12",
    icon: "text-cc-success",
    badge: "border-cc-success/30 text-cc-success",
    detail: "border-cc-border/25 bg-cc-card/35",
  },
  attention: {
    surface: "border-cc-attention-border bg-cc-attention-bg/60 hover:bg-cc-attention-bg",
    icon: "text-cc-attention",
    badge: "border-cc-attention-border bg-cc-attention-bg text-cc-attention",
    detail: "border-cc-border/25 bg-cc-card/35",
  },
  info: {
    surface: "border-cc-info/20 bg-cc-info/8 hover:bg-cc-info/12",
    icon: "text-cc-info",
    badge: "border-cc-info/30 text-cc-info",
    detail: "border-cc-border/25 bg-cc-card/35",
  },
  warning: {
    surface: "border-cc-error/40 bg-cc-error/10 hover:bg-cc-error/15",
    icon: "text-cc-error",
    badge: "border-cc-error/40 text-cc-error",
    detail: "border-cc-error/25 bg-cc-error/8",
  },
};

export interface InjectedMessageChipProps {
  /** What kind of message this is, e.g. "Landing queue". */
  title: string;
  /** The one fact worth seeing without expanding; truncates on narrow screens. */
  summary?: string;
  /** Short text kept visible beside the badge while the summary truncates. */
  meta?: string;
  /** Status word at the end of the chip, e.g. "landed" or "1 open". */
  badge?: string;
  /** Colors the chip surface, icon and badge. */
  tone?: InjectedMessageChipTone;
  /** The badge element, for a celebration played on it. */
  badgeRef?: Ref<HTMLSpanElement>;
  /** Overrides the badge color, for a neutral chip with a colored status. */
  badgeTone?: InjectedMessageChipTone;
  /** Overrides the icon color. */
  iconTone?: InjectedMessageChipTone;
  /** A 16x16 `currentColor` icon; the chip sizes and colors it. */
  icon: ReactNode;
  testId: string;
  /** Exposed as `data-chip-kind` for tests and styling hooks. */
  kind?: string;
  searchHighlight?: SearchHighlightInfo;
  /** The expanded detail; rendered only while expanded. */
  children: ReactNode;
}

export function InjectedMessageChip({
  title,
  summary,
  meta,
  badge,
  badgeRef,
  tone = "neutral",
  badgeTone,
  iconTone,
  icon,
  testId,
  kind,
  searchHighlight,
  children,
}: InjectedMessageChipProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const colors = TONES[tone];
  return (
    <div className="text-left">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
        className={`inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-[12px] leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60 ${colors.surface}`}
        data-testid={testId}
        data-chip-kind={kind}
        data-chip-tone={tone}
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5 ${TONES[iconTone ?? tone].icon}`}
        >
          {icon}
        </span>
        <span className="min-w-0 truncate font-medium text-cc-muted">
          <span className="text-cc-fg/85">{highlight(title, searchHighlight)}</span>
          {summary && <span className="font-normal text-cc-muted"> · {highlight(summary, searchHighlight)}</span>}
        </span>
        {meta && (
          <span className="shrink-0 text-cc-muted" data-testid="injected-message-chip-meta">
            {meta}
          </span>
        )}
        {badge && (
          <span
            ref={badgeRef}
            className={`shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium ${TONES[badgeTone ?? tone].badge}`}
          >
            {badge}
          </span>
        )}
      </button>
      {expanded && (
        <div
          id={detailId}
          role="region"
          aria-label={`${title} details`}
          className={`mt-1.5 rounded-md border px-2.5 py-2 text-left ${colors.detail}`}
          data-testid={`${testId}-detail`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** The feed row an injected message chip sits in, with its optional timestamp. */
export function InjectedMessageRow({
  timestamp,
  showTimestamp,
  children,
}: {
  timestamp: number;
  showTimestamp: boolean;
  children: ReactNode;
}) {
  return (
    <div className="pl-9 py-0.5 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{children}</div>
          {showTimestamp && <MessageTimestamp timestamp={timestamp} />}
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, searchHighlight: SearchHighlightInfo | undefined): ReactNode {
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
