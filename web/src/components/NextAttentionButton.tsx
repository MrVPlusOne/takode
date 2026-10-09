import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNextAttention, type NextAttentionLanding } from "../hooks/useNextAttention.js";
import { BellIcon } from "./GlobalNeedsInputMenu.js";
import { NotifyMeIcon } from "./NotifyMe.js";

const TOAST_MS = 2600;
const KIND_LABEL: Record<NextAttentionLanding["item"]["kind"], string> = {
  "needs-input": "Needs input",
  "notify-me": "Notify Me result",
  unread: "Unread result",
};

/**
 * "Next" pill: opens the next session or thread that needs the user and briefly
 * says where it landed. Hidden while nothing needs attention. `compact` is the
 * phone top bar's larger count-only form.
 */
export function NextAttentionButton({ compact = false }: { compact?: boolean }) {
  const { count, goNext } = useNextAttention();
  const [landing, setLanding] = useState<NextAttentionLanding | null>(null);

  useEffect(() => {
    if (!landing) return;
    const timer = window.setTimeout(() => setLanding(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [landing]);

  return (
    <>
      {count > 0 && <NextAttentionPill count={count} compact={compact} onClick={() => setLanding(goNext())} />}
      {landing && <NextAttentionToast landing={landing} />}
    </>
  );
}

/** The pill itself, separate from the queue so the Playground can show its states. */
export function NextAttentionPill({
  count,
  compact = false,
  onClick,
}: {
  count: number;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="next-attention-button"
      aria-label={`Go to the next item that needs attention (${count})`}
      title="Go to the next item that needs attention"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-cc-attention-border bg-cc-attention-bg font-semibold text-cc-attention transition-colors hover:bg-cc-attention-bg/80 cursor-pointer ${
        compact ? "h-9 pl-2.5 pr-1.5 text-[12px]" : "h-7 pl-2 pr-1 text-[11px]"
      }`}
    >
      {!compact && <span className="font-medium">Next</span>}
      <span className="tabular-nums">{count}</span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={compact ? "h-4 w-4" : "h-3.5 w-3.5"}
        aria-hidden="true"
      >
        <path d="M6 3.5L10.5 8 6 12.5" />
      </svg>
    </button>
  );
}

/** Where Next just went. `inline` renders in place instead of floating, for the Playground. */
export function NextAttentionToast({ landing, inline = false }: { landing: NextAttentionLanding; inline?: boolean }) {
  const { item } = landing;
  const toast = (
    <div
      role="status"
      data-testid="next-attention-toast"
      className={`rounded-xl border border-cc-attention-border bg-cc-card px-3 py-2 shadow-lg ${
        inline
          ? ""
          : "pointer-events-none fixed left-1/2 top-14 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2"
      }`}
    >
      <div className="flex items-center gap-2 text-[12px] text-cc-fg">
        <span
          className={`flex w-3.5 justify-center ${item.kind === "needs-input" ? "text-cc-attention" : "text-cc-info"}`}
        >
          {item.kind === "needs-input" ? (
            <BellIcon className="h-3.5 w-3.5" />
          ) : item.kind === "notify-me" ? (
            <NotifyMeIcon pending className="h-3.5 w-3.5" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-cc-info" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{KIND_LABEL[item.kind]}</span> ·{" "}
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
