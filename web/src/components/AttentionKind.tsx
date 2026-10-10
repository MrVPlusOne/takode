import { createPortal } from "react-dom";
import type { NextAttentionLanding } from "../hooks/useAttentionNavigator.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { BellIcon } from "./GlobalNeedsInputMenu.js";
import { NotifyMeIcon } from "./NotifyMe.js";

/**
 * Pieces the two attention navigators share, so the top bar's list and each
 * feed's chip name, color and mark each kind of item the same way.
 */
export type AttentionKind = NextAttentionItem["kind"];

/** Short kind names for chips: "1/3 · needs input". */
export const ATTENTION_KIND_SHORT: Record<AttentionKind, string> = {
  "needs-input": "needs input",
  "notify-me": "Notify Me",
  unread: "unread",
};

/** Kind names for toasts and accessible labels. */
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

/** Where a Next step just went. `inline` renders in place instead of floating at the top. */
export function NextAttentionToast({ landing, inline = false }: { landing: NextAttentionLanding; inline?: boolean }) {
  const { item } = landing;
  const toast = (
    <div
      role="status"
      data-testid="next-attention-toast"
      className={`rounded-xl border bg-cc-card px-3 py-2 shadow-lg ${attentionTone(item.kind).border} ${
        inline
          ? ""
          : "pointer-events-none fixed left-1/2 top-14 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2"
      }`}
    >
      <div className="flex items-center gap-2 text-[12px] text-cc-fg">
        <AttentionKindIcon kind={item.kind} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{ATTENTION_KIND_TITLE[item.kind]}</span> ·{" "}
          {landing.sessionNum !== null && <span className="text-cc-muted">#{landing.sessionNum} </span>}
          {item.label}
        </span>
        <span className="shrink-0 tabular-nums text-cc-muted">
          {landing.position} / {landing.total}
        </span>
      </div>
    </div>
  );
  return inline ? toast : createPortal(toast, document.body);
}
