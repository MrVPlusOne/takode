import { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { isKeyOfTopic } from "../../../shared/topic-thread-key.js";
import { getQuestJourneyPhase, getQuestJourneyPresentation } from "../../../shared/quest-journey.js";
import { useAttentionThreadTitles } from "../../hooks/useAttentionThreadTitles.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { useStore } from "../../store.js";
import { resolveLeaderThreadTabsProjection } from "../../utils/leader-thread-tabs-resolver.js";
import type { NextAttentionItem } from "../../utils/next-attention.js";
import { getQuestPhaseColorValue } from "../../utils/quest-phase-theme.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { attentionItemLabel } from "../AttentionItemRows.js";
import { NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { questOf } from "../library/topic-questions.js";
import type { TopicPlace } from "./SidebarTopicsMode.js";

/** What a topic or side chat holds now: what waits on the user, new results and running quests. */
export interface PlaceWork {
  /** Questions waiting on the user (amber), including a quest's worker asking about it. */
  needYou: NextAttentionItem[];
  /** New answers, reports and finished quests (blue). */
  fresh: NextAttentionItem[];
  /** Quests running now (green), by the work board's rule (`isRunningBoardRow`). */
  running: string[];
}

/**
 * The work in each place of the Topics list, and in each leader as a whole. It comes from the top
 * bar's attention list and from the running quests each leader's synced tab state carries, so every
 * leader has it, not only the one open. The rows' count dots and the hover card both read it, so
 * they always agree.
 */
export function usePlaceWork(): {
  ofPlace: (place: TopicPlace) => PlaceWork;
  ofLeader: (leaderId: string) => PlaceWork;
  open: (item: NextAttentionItem) => void;
} {
  const { queue, open } = useNextAttention();
  const projections = useStore((state) => state.syncedProjectionValues);
  const projectionKeys = useStore((state) => state.syncedProjectionKeys);
  const runningOf = (leaderId: string) =>
    resolveLeaderThreadTabsProjection(
      { syncedProjectionValues: projections, syncedProjectionKeys: projectionKeys },
      leaderId,
    ).value?.runningQuestIds ?? [];
  const work = (leaderId: string, inPlace: (threadKey: string) => boolean, anyAsker: boolean): PlaceWork => {
    const needYou: NextAttentionItem[] = [];
    const fresh: NextAttentionItem[] = [];
    for (const item of queue) {
      if (!inPlace(threadOfItem(item))) continue;
      // A quest's question can come from its worker; everything else is the leader's own.
      if (item.kind === "needs-input" && (anyAsker || item.sessionId === leaderId)) needYou.push(item);
      else if (item.kind !== "needs-input" && item.sessionId === leaderId) fresh.push(item);
    }
    return { needYou, fresh, running: runningOf(leaderId).filter(inPlace) };
  };
  return {
    ofPlace: (place) =>
      work(
        place.leader.leader.id,
        (key) =>
          place.topic
            ? place.topic.questIds.includes(key) || isKeyOfTopic(key, place.topic.id)
            : key === place.threadKey,
        true,
      ),
    ofLeader: (leaderId) => work(leaderId, () => true, false),
    open,
  };
}

/** The counts the panel's dots show for some work. */
export function countsOf(work: PlaceWork): { running: number; permission: number; unread: number } {
  return { running: work.running.length, permission: work.needYou.length, unread: work.fresh.length };
}

/** The thread an attention item is about: a question's quest, else the thread it was posted in. */
export function threadOfItem(item: NextAttentionItem): string {
  return normalizeThreadKey((item.kind === "needs-input" ? questOf(item.entry) : null) ?? item.threadKey ?? "");
}

const CARD_WIDTH = 340;
const GAP = 4;
const MARGIN = 8;

/**
 * A topic row's card: what waits on the user there, what is new and what runs, each a row that opens
 * its quest (or answers its question) in one click. A quest is named by its title, so the user sees
 * which quest it is without knowing numbers. A mouse opens it by hovering the row; touch opens it with
 * a long-press, and a press outside closes it.
 */
export function TopicPlaceCard({
  place,
  work,
  anchorRect,
  pinned,
  onOpenItem,
  onOpenQuest,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  place: TopicPlace;
  work: PlaceWork;
  anchorRect: DOMRect;
  /** Opened by a long-press (or right-click): it stays until a press outside closes it. */
  pinned: boolean;
  onOpenItem: (item: NextAttentionItem) => void;
  onOpenQuest: (questId: string) => void;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const leaderId = place.leader.leader.id;
  const tabs = useStore((state) => {
    const resolution = resolveLeaderThreadTabsProjection(state, leaderId);
    return resolution.projectionState === "accepted" ? resolution.value.tabs : null;
  });
  const titleItems = useMemo(
    () => [
      ...[...work.needYou, ...work.fresh].map((item) => ({ sessionId: leaderId, threadKey: threadOfItem(item) })),
      ...work.running.map((questId) => ({ sessionId: leaderId, threadKey: questId })),
    ],
    [leaderId, work],
  );
  const titles = useAttentionThreadTitles(titleItems);
  // The place's own conversation needs no name in its own card; its rows say what happened instead.
  const titleOf = (threadKey: string) =>
    threadKey === place.threadKey ? null : (titles.titleFor(leaderId, threadKey) ?? threadKey);
  const empty = work.needYou.length + work.fresh.length + work.running.length === 0;
  const size = `${work.needYou.length}:${work.fresh.length}:${work.running.length}`;

  useOutsidePress([cardRef], onClose, pinned);

  // Beside the panel like the session cards; where that does not fit (a phone), under the row, or
  // above it when the row is low on the screen.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const width = el.offsetWidth * zoomLevel;
    const height = el.offsetHeight * zoomLevel;
    let left = anchorRect.right + GAP;
    let top = anchorRect.top;
    if (left + width > window.innerWidth - MARGIN) left = anchorRect.left - width - GAP;
    if (left < MARGIN) {
      left = Math.max(MARGIN, Math.min(anchorRect.left, window.innerWidth - width - MARGIN));
      top = anchorRect.bottom + GAP;
      if (top + height > window.innerHeight - MARGIN) top = anchorRect.top - height - GAP;
    }
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchorRect, zoomLevel, size]);

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 pointer-events-auto"
      style={{
        left: anchorRect.right + GAP,
        top: anchorRect.top,
        width: `min(${CARD_WIDTH}px, calc(100vw - ${2 * MARGIN}px))`,
        transform: `scale(${zoomLevel})`,
        transformOrigin: "top left",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="topic-place-card"
    >
      <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-2 shadow-xl">
        <div className="flex min-w-0 items-center gap-1.5 px-3 pb-1">
          {place.kind === "thread" ? (
            <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
          ) : (
            <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-cc-fg">{place.name}</span>
          <span className="shrink-0 truncate text-[11px] text-cc-muted">{place.leader.leader.name ?? "Leader"}</span>
        </div>
        {empty && <div className="px-3 py-1 text-[12px] text-cc-muted">Nothing waiting, new or running.</div>}
        <Section title="Needs you" dotClass="bg-cc-warning" count={work.needYou.length}>
          {work.needYou.map((item) => (
            <ItemRow
              key={item.key}
              title={titleOf(threadOfItem(item))}
              detail={attentionItemLabel(item)}
              onOpen={() => onOpenItem(item)}
            />
          ))}
        </Section>
        <Section title="New" dotClass="bg-blue-500" count={work.fresh.length}>
          {work.fresh.map((item) => (
            <ItemRow
              key={item.key}
              title={titleOf(threadOfItem(item))}
              detail={attentionItemLabel(item)}
              onOpen={() => onOpenItem(item)}
            />
          ))}
        </Section>
        <Section title="Running" dotClass="bg-cc-success" count={work.running.length}>
          {work.running.map((questId) => {
            const phase = phaseOf(tabs?.find((tab) => tab.threadKey === questId));
            return (
              <button
                key={questId}
                type="button"
                onClick={() => onOpenQuest(questId)}
                className={ROW_CLASS}
                data-testid="topic-place-card-running"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg">{titleOf(questId)}</span>
                  {phase && (
                    <span className="shrink-0 text-[10px] font-medium text-cc-muted" style={{ color: phase.color }}>
                      {phase.label}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </Section>
      </div>
    </div>,
    document.body,
  );
}

const ROW_CLASS =
  "block w-full min-w-0 cursor-pointer px-3 py-1 pointer-coarse:py-2.5 text-left transition-colors hover:bg-cc-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70";

function Section({
  title,
  dotClass,
  count,
  children,
}: {
  title: string;
  dotClass: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mt-1 border-t border-cc-border/50 pt-1.5" data-testid="topic-place-card-section">
      <div className="flex items-center gap-1.5 px-3 pb-0.5 text-[10px] uppercase tracking-wider text-cc-muted/70">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
        {title}
      </div>
      {children}
    </div>
  );
}

/** A question or result: its quest's title, then what it says; in the place's own thread, only what it says. */
function ItemRow({ title, detail, onOpen }: { title: string | null; detail: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={ROW_CLASS} data-testid="topic-place-card-item">
      <span className="block truncate text-[12px] text-cc-fg">{title ?? detail}</span>
      {title && detail && <span className="block truncate text-[11px] text-cc-muted">{detail}</span>}
    </button>
  );
}

function phaseOf(
  tab: { journey?: { currentPhaseId?: string | null } | null; boardStatus?: string | null } | undefined,
): { label: string; color?: string } | null {
  if (!tab) return null;
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  if (phase) return { label: phase.label, color: getQuestPhaseColorValue(phase.color) };
  const presentation = getQuestJourneyPresentation(tab.boardStatus ?? undefined);
  return presentation ? { label: presentation.label } : null;
}
