import { useState } from "react";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import type { NextAttentionLanding } from "../hooks/useNextAttention.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { NextAttentionToast } from "./NextAttentionButton.js";
import { NotifyMeIcon } from "./NotifyMe.js";

type NotifyMeItem = Extract<NextAttentionItem, { kind: "notify-me" }>;
type UnreadItem = Extract<NextAttentionItem, { kind: "unread" }>;

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const GO_TO_BUTTON_CLASS =
  "inline-flex shrink-0 items-center rounded border border-cc-border/70 bg-cc-card px-2 py-0.5 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-muted/45 cursor-pointer";

/** Chevron used by the chip's Next button. */
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

/** Count of pending Notify Me results or unread results in the feed chip. */
export function AttentionCountInline({
  kind,
  count,
  label,
}: {
  kind: "notify-me" | "unread";
  count: number;
  label?: string;
}) {
  return (
    <span
      data-testid={`notification-chip-${kind}`}
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-hidden="true"
      title={kind === "notify-me" ? `Notify Me results: ${count}` : `Unread results: ${count}`}
    >
      <span className="text-cc-fg/95">{count}</span>
      {kind === "notify-me" ? (
        <NotifyMeIcon pending className="h-3.5 w-3.5" />
      ) : (
        <span className="mx-0.5 h-2 w-2 shrink-0 rounded-full bg-cc-info" />
      )}
      {label && <span className="text-cc-info">{label}</span>}
    </span>
  );
}

/** Where the chip's Next just went, floating above the chip. */
export function SessionAttentionToast({ landing }: { landing: NextAttentionLanding }) {
  return (
    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 w-max max-w-[min(24rem,calc(100vw-1.5rem))] font-sans-ui">
      <NextAttentionToast landing={landing} inline />
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
      <span className="text-[11px] font-medium text-cc-muted">{title}</span>
      <span className="text-[10px] text-cc-muted/70">{count}</span>
    </div>
  );
}

function NotifyMeAttentionRow({ item, onOpen }: { item: NotifyMeItem; onOpen: (item: NextAttentionItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = item.entry.pending;
  const acknowledge = () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    updateThreadMonitoring(item.sessionId, item.entry.threadKey, "acknowledge", pending.id)
      .catch((err) => setError(err instanceof Error && err.message ? err.message : "Acknowledge failed."))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-start gap-2 px-3 py-2" data-testid="session-attention-notify-me-row">
      <span className="mt-0.5">
        <NotifyMeIcon pending className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg/90">{item.label}</span>
          <button
            type="button"
            disabled={busy}
            onClick={acknowledge}
            className="inline-flex shrink-0 items-center rounded border border-cc-info/30 px-2 py-0.5 text-[11px] font-medium text-cc-info transition-colors hover:bg-cc-info/10 disabled:opacity-50 cursor-pointer"
            aria-label={`Acknowledge ${item.label}`}
          >
            Acknowledge
          </button>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={GO_TO_BUTTON_CLASS}
            aria-label={`Go to ${item.label}`}
          >
            Go to
          </button>
        </div>
        {pending?.summary && <p className="mt-0.5 text-[11px] leading-snug text-cc-muted">{pending.summary}</p>}
        <p className="mt-0.5 text-[10px] text-cc-muted">{formatRelativeTime(item.timestamp)}</p>
        {error && <p className="mt-1 text-[10px] leading-snug text-cc-error">{error}</p>}
      </div>
    </div>
  );
}

function UnreadAttentionRow({ item, onOpen }: { item: UnreadItem; onOpen: (item: NextAttentionItem) => void }) {
  const label = item.threadKey === null ? "Latest result" : item.label;
  return (
    <div className="flex items-start gap-2 px-3 py-2" data-testid="session-attention-unread-row">
      <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-cc-info" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg/90">{label}</span>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={GO_TO_BUTTON_CLASS}
            aria-label={`Go to ${label}`}
          >
            Go to
          </button>
        </div>
        {item.timestamp > 0 && <p className="mt-0.5 text-[10px] text-cc-muted">{formatRelativeTime(item.timestamp)}</p>}
      </div>
    </div>
  );
}

/**
 * The inbox's sections after the needs-input prompts: pending Notify Me
 * results, then unread results, in the order the chip's Next visits them.
 */
export function SessionAttentionSections({
  items,
  onOpen,
}: {
  items: readonly NextAttentionItem[];
  onOpen: (item: NextAttentionItem) => void;
}) {
  const notifyMe = items.filter((item): item is NotifyMeItem => item.kind === "notify-me");
  const unread = items.filter((item): item is UnreadItem => item.kind === "unread");
  return (
    <>
      {notifyMe.length > 0 && (
        <section className="border-t border-cc-border/60" aria-label="Notify Me results">
          <SectionHeader title="Notify Me" count={notifyMe.length} />
          <div className="divide-y divide-cc-border/20">
            {notifyMe.map((item) => (
              <NotifyMeAttentionRow key={item.key} item={item} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
      {unread.length > 0 && (
        <section className="border-t border-cc-border/60" aria-label="Unread results">
          <SectionHeader title="Unread" count={unread.length} />
          <div className="divide-y divide-cc-border/20">
            {unread.map((item) => (
              <UnreadAttentionRow key={item.key} item={item} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
