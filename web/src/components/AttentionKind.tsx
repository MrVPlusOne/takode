import type { NextAttentionItem } from "../utils/next-attention.js";
import { NotifyMeIcon } from "./NotifyMe.js";

/**
 * Pieces the two attention navigators share, so the top bar's list and each
 * feed's chip name, color and mark each kind of item the same way.
 */
export type AttentionKind = NextAttentionItem["kind"];

/** Kind names for accessible labels. */
export const ATTENTION_KIND_TITLE: Record<AttentionKind, string> = {
  "needs-input": "Needs input",
  "notify-me": "Notify Me result",
  unread: "Unread result",
};

/** Group headings in the lists. */
export const ATTENTION_GROUP_TITLE: Record<AttentionKind, string> = {
  "needs-input": "Needs input",
  "notify-me": "Notify Me",
  unread: "Unread",
};

/** Text, border and background classes: amber for prompts, blue for results. */
export function attentionTone(kind: AttentionKind) {
  return kind === "needs-input"
    ? { text: "text-cc-attention", border: "border-cc-attention-border", bg: "bg-cc-attention-bg" }
    : { text: "text-cc-info", border: "border-cc-info-border", bg: "bg-cc-info-bg" };
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
  if (kind === "notify-me") return <NotifyMeIcon pending className={className} />;
  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center`} aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-cc-info" />
    </span>
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
