import { useState } from "react";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import type { NextAttentionLanding } from "../hooks/useAttentionNavigator.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import {
  ATTENTION_GROUP_TITLE,
  AttentionKindIcon,
  NextAttentionToast,
  formatRelativeTime,
  type AttentionKind,
} from "./AttentionKind.js";

const GO_TO_BUTTON_CLASS =
  "inline-flex shrink-0 items-center rounded border border-cc-border/70 bg-cc-card px-2 py-0.5 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-muted/45 cursor-pointer";

const GROUP_ARIA_LABEL: Record<AttentionKind, string> = {
  "needs-input": "Needs-input prompts",
  "notify-me": "Notify Me results",
  unread: "Unread results",
};

/** Where the feed chip's Next just went, floating above the chip. */
export function SessionAttentionToast({ landing }: { landing: NextAttentionLanding }) {
  return (
    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 w-max max-w-[min(24rem,calc(100vw-1.5rem))] font-sans-ui">
      <NextAttentionToast landing={landing} inline />
    </div>
  );
}

function itemLabel(item: NextAttentionItem): string {
  return item.kind === "unread" && item.threadKey === null ? "Latest result" : item.label;
}

/**
 * One item in an attention list: what it is, where it lives and a Go to.
 * `isNext` marks the item the list's Next step opens.
 */
export function AttentionItemRow({
  item,
  onOpen,
  sessionLabel,
  isNext = false,
}: {
  item: NextAttentionItem;
  onOpen: (item: NextAttentionItem) => void;
  sessionLabel?: string;
  isNext?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = itemLabel(item);
  const pending = item.kind === "notify-me" ? item.entry.pending : null;
  const acknowledge = () => {
    if (item.kind !== "notify-me" || !pending || busy) return;
    setBusy(true);
    setError(null);
    updateThreadMonitoring(item.sessionId, item.entry.threadKey, "acknowledge", pending.id)
      .catch((err) => setError(err instanceof Error && err.message ? err.message : "Acknowledge failed."))
      .finally(() => setBusy(false));
  };
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 ${isNext ? "bg-cc-hover/30" : ""}`}
      data-testid="attention-item-row"
      data-attention-kind={item.kind}
      data-attention-next={isNext ? "true" : undefined}
    >
      <span className="mt-0.5">
        <AttentionKindIcon kind={item.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg/90">{label}</span>
          {isNext && (
            <span className="shrink-0 rounded border border-cc-border/70 px-1 py-px text-[10px] font-medium text-cc-muted">
              Next
            </span>
          )}
          {pending && (
            <button
              type="button"
              disabled={busy}
              onClick={acknowledge}
              className="inline-flex shrink-0 items-center rounded border border-cc-info/30 px-2 py-0.5 text-[11px] font-medium text-cc-info transition-colors hover:bg-cc-info/10 disabled:opacity-50 cursor-pointer"
              aria-label={`Acknowledge ${label}`}
            >
              Acknowledge
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={GO_TO_BUTTON_CLASS}
            aria-label={`Go to ${label}`}
          >
            Go to
          </button>
        </div>
        {pending?.summary && <p className="mt-0.5 text-[11px] leading-snug text-cc-muted">{pending.summary}</p>}
        <p className="mt-0.5 truncate text-[10px] text-cc-muted">
          {sessionLabel && <span>{sessionLabel} · </span>}
          {item.timestamp > 0 ? formatRelativeTime(item.timestamp) : null}
        </p>
        {error && <p className="mt-1 text-[10px] leading-snug text-cc-error">{error}</p>}
      </div>
    </div>
  );
}

/**
 * Items grouped by kind, in queue order: the order the Next steps visit them.
 * `kinds` picks which groups to show (the feed inbox renders its prompts itself).
 */
export function AttentionItemSections({
  items,
  kinds,
  onOpen,
  sessionLabelFor,
  nextKey,
}: {
  items: readonly NextAttentionItem[];
  kinds: readonly AttentionKind[];
  onOpen: (item: NextAttentionItem) => void;
  sessionLabelFor?: (item: NextAttentionItem) => string | undefined;
  nextKey?: string | null;
}) {
  return (
    <>
      {kinds.map((kind) => {
        const group = items.filter((item) => item.kind === kind);
        if (group.length === 0) return null;
        return (
          <section
            key={kind}
            className="border-t border-cc-border/60 first:border-t-0"
            aria-label={GROUP_ARIA_LABEL[kind]}
          >
            <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
              <span className="text-[11px] font-medium text-cc-muted">{ATTENTION_GROUP_TITLE[kind]}</span>
              <span className="text-[10px] text-cc-muted/70">{group.length}</span>
            </div>
            <div className="divide-y divide-cc-border/20">
              {group.map((item) => (
                <AttentionItemRow
                  key={item.key}
                  item={item}
                  onOpen={onOpen}
                  sessionLabel={sessionLabelFor?.(item)}
                  isNext={item.key === nextKey}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
