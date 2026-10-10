import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import type { NextAttentionLanding } from "../hooks/useAttentionNavigator.js";
import { useNextAttention } from "../hooks/useNextAttention.js";
import { useStore } from "../store.js";
import { useAttentionQuestTitles } from "../hooks/useAttentionQuestTitles.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { AttentionItemSections } from "./AttentionItemRows.js";
import { AttentionKindIcon, NextAttentionToast, NextChevron, attentionTone } from "./AttentionKind.js";

const TOAST_MS = 2600;
const ALL_KINDS = ["needs-input", "notify-me", "unread"] as const;

/** Dispatched by the "Next item needing attention" keyboard shortcut. */
export const ATTENTION_NEXT_EVENT = "takode:attention-next";

/**
 * The top bar's attention list: a count that opens everything across sessions
 * that needs the user, grouped by priority, with a Next step (and keyboard
 * shortcut) that walks the whole list. Hidden while nothing needs attention.
 * `compact` is the phone top bar's larger form.
 */
export function GlobalAttentionMenu({ compact = false }: { compact?: boolean }) {
  const { queue, next, goNext, open: openItem } = useNextAttention();
  const [open, setOpen] = useState(false);
  const [landing, setLanding] = useState<NextAttentionLanding | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const step = useCallback(() => setLanding(goNext()), [goNext]);

  useEffect(() => {
    if (!landing) return;
    const timer = window.setTimeout(() => setLanding(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [landing]);

  useEffect(() => {
    window.addEventListener(ATTENTION_NEXT_EVENT, step);
    return () => window.removeEventListener(ATTENTION_NEXT_EVENT, step);
  }, [step]);

  useEffect(() => {
    if (queue.length === 0) setOpen(false);
  }, [queue.length]);

  return (
    <>
      {queue.length > 0 && (
        <AttentionListPill
          ref={triggerRef}
          count={queue.length}
          topKind={queue[0]!.kind}
          compact={compact}
          open={open}
          onClick={() => setOpen((value) => !value)}
        />
      )}
      {open && (
        <GlobalAttentionPanel
          items={queue}
          nextKey={next?.item.key ?? null}
          nextPosition={next ? next.position + 1 : null}
          trigger={triggerRef.current}
          onClose={() => setOpen(false)}
          onNext={step}
          onOpen={(item) => {
            openItem(item);
            setOpen(false);
          }}
        />
      )}
      {landing && <NextAttentionToast landing={landing} />}
    </>
  );
}

/** The count button, tinted by the most urgent kind waiting. Separate so the Playground can show its states. */
export function AttentionListPill({
  ref,
  count,
  topKind,
  compact = false,
  open = false,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  count: number;
  topKind: NextAttentionItem["kind"];
  compact?: boolean;
  open?: boolean;
  onClick?: () => void;
}) {
  const tone = attentionTone(topKind);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-testid="attention-list-button"
      aria-label={`Everything that needs attention (${count})`}
      aria-expanded={open}
      title="Everything that needs attention"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold transition-colors hover:opacity-90 cursor-pointer ${tone.border} ${tone.bg} ${tone.text} ${
        compact ? "h-9 px-2.5 text-[12px]" : "h-7 px-2 text-[11px]"
      }`}
    >
      <AttentionKindIcon kind={topKind} className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
      <span className="tabular-nums">{count}</span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={`${compact ? "h-3.5 w-3.5" : "h-3 w-3"} transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  );
}

/** The list itself. `inline` renders in place for the Playground. */
export function GlobalAttentionPanel({
  items,
  nextKey,
  nextPosition,
  trigger,
  onClose,
  onNext,
  onOpen,
  sessionsOverride,
  questTitleFor,
  inline = false,
}: {
  items: readonly NextAttentionItem[];
  nextKey: string | null;
  nextPosition: number | null;
  trigger?: HTMLElement | null;
  onClose: () => void;
  onNext: () => void;
  onOpen: (item: NextAttentionItem) => void;
  /** Session numbers and names, and quest titles, for the Playground, which has no real sessions or quests. */
  sessionsOverride?: ReadonlyArray<{ sessionId: string; sessionNum?: number | null; name?: string }>;
  questTitleFor?: (questId: string) => string | undefined;
  inline?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const storeQuestTitleFor = useAttentionQuestTitles(items);
  const sessionInfo = useMemo(() => {
    const info = new Map<string, { tag?: string; label?: string }>();
    for (const { sessionId, sessionNum, name } of sessionsOverride ?? sdkSessions) {
      const tag = sessionNum ? `#${sessionNum}` : undefined;
      info.set(sessionId, { tag, label: [tag, name].filter(Boolean).join(" ") || undefined });
    }
    return info;
  }, [sdkSessions, sessionsOverride]);

  useEffect(() => {
    if (inline) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || trigger?.contains(target)) return;
      // A row's context menu lives in a portal; using it must not close the list.
      if (target instanceof Element && target.closest("[data-context-menu]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [inline, onClose, trigger]);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Everything that needs attention"
      data-testid="attention-list-panel"
      className={`flex flex-col overflow-hidden rounded-2xl border border-cc-border bg-cc-card/95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl font-sans-ui ${
        inline
          ? "w-full max-h-[32rem]"
          : "fixed right-3 top-14 z-50 w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(70dvh,36rem)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-cc-border/50 px-3 py-2.5">
        <h2 className="text-[13px] font-medium text-cc-fg">
          Needs attention <span className="ml-1 text-[11px] font-normal text-cc-muted">({items.length})</span>
        </h2>
        <div className="flex items-center gap-1.5">
          {nextPosition !== null && (
            <button
              type="button"
              onClick={onNext}
              data-testid="attention-list-next"
              aria-label={`Go to the next item that needs attention, ${nextPosition} of ${items.length}`}
              className="inline-flex items-center gap-1 rounded-full border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-fg transition-colors hover:bg-cc-hover cursor-pointer"
            >
              Next
              <span className="tabular-nums text-cc-muted">
                {nextPosition}/{items.length}
              </span>
              <NextChevron className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 p-1 text-cc-muted transition-colors hover:text-cc-fg cursor-pointer"
            aria-label="Close"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AttentionItemSections
          items={items}
          kinds={ALL_KINDS}
          onOpen={onOpen}
          nextKey={nextKey}
          sessionLabelFor={(item) => sessionInfo.get(item.sessionId)?.label}
          sessionTagFor={(item) => sessionInfo.get(item.sessionId)?.tag}
          questTitleFor={questTitleFor ?? storeQuestTitleFor}
        />
      </div>
    </div>
  );
  return inline ? panel : createPortal(panel, document.body);
}
