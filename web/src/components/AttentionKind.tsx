import { isUrgentAttentionItem, type AttentionSection, type NextAttentionItem } from "../utils/next-attention.js";
import { NotifyMeIcon } from "./NotifyMe.js";

/**
 * Pieces the two attention navigators share, so the top bar's list and each
 * feed's chip name, color and mark each kind of item the same way.
 */
export type AttentionKind = NextAttentionItem["kind"] | "urgent";

/** How an item looks: its kind, except that an unread answer marked urgent looks urgent. */
export function attentionKindOf(item: NextAttentionItem): AttentionKind {
  return isUrgentAttentionItem(item) ? "urgent" : item.kind;
}

/** Kind names for accessible labels. */
export const ATTENTION_KIND_TITLE: Record<AttentionKind, string> = {
  "needs-input": "Needs input",
  urgent: "Urgent result",
  "notify-me": "Notify Me result",
  unread: "Unread result",
};

/** Section headings in the lists, in the order Next visits them. */
export const ATTENTION_SECTION_TITLE: Record<AttentionSection, string> = {
  "needs-input": "Questions",
  urgent: "Urgent",
  reminder: "Reminders",
  unread: "Unread",
  "notify-me": "Notify Me",
};

/** Text, border and background classes: amber for prompts, red for urgent results, blue for other results. */
export function attentionTone(kind: AttentionKind) {
  if (kind === "needs-input")
    return { text: "text-cc-attention", border: "border-cc-attention-border", bg: "bg-cc-attention-bg" };
  if (kind === "urgent") return { text: "text-cc-error", border: "border-cc-error/30", bg: "bg-cc-error/10" };
  return { text: "text-cc-info", border: "border-cc-info-border", bg: "bg-cc-info-bg" };
}

/** The exclamation mark that marks an urgent result, in the attention lists and on the answer in the feed. */
export function UrgentIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="8" cy="11.25" r="1" fill="currentColor" />
    </svg>
  );
}

export function BellIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 8 1.5z" />
      <path d="M6 12a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function AttentionKindIcon({ kind, className = "h-3.5 w-3.5" }: { kind: AttentionKind; className?: string }) {
  if (kind === "needs-input") return <BellIcon className={`${className} shrink-0 text-cc-attention`} />;
  if (kind === "urgent") return <UrgentIcon className={`${className} shrink-0 text-cc-error`} />;
  if (kind === "notify-me") return <NotifyMeIcon pending className={className} />;
  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center`} aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-cc-info" />
    </span>
  );
}

/** Above an answer its leader marked urgent, so it stands out in the feed. */
export function UrgentAnswerLabel() {
  return (
    <div
      className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-cc-error/30 bg-cc-error/10 px-2 py-0.5 text-[11px] font-medium text-cc-error"
      data-testid="urgent-answer-label"
    >
      <UrgentIcon className="h-3 w-3" />
      Urgent
    </div>
  );
}

export function NextChevron({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
