import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getQuestJourneyPhase, getQuestJourneyPresentation } from "../../../shared/quest-journey.js";
import { useStore } from "../../store.js";
import { timeAgo } from "../../utils/quest-helpers.js";
import { getQuestPhaseColorValue } from "../../utils/quest-phase-theme.js";
import { resolveSessionNavigation } from "../../utils/session-navigation-resolver.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { SessionNumChip } from "../SessionNumChip.js";
import { THREAD_GROUP_DOT } from "../ThreadTabGroups.js";
import { UpdateMarker } from "../ThreadUpdate.js";
import type { ThreadRow } from "./SidebarThreadsMode.js";

/**
 * The card a Threads view row shows on hover, styled as the session and quest hover cards (Jiayi,
 * Nov 3: the plain-text tooltip of title and update looked ugly; a tooltip is only a button's
 * label). It says what the thread is (title, quest number, leader), where it stands (status,
 * question waiting, phase and worker), its whole latest update, and when it last changed. It opens
 * beside the row, outside the panel, so it never covers the row; touch never shows it (long-press
 * keeps the row's menu).
 */
export function ThreadHoverCard({
  row,
  line,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: {
  row: ThreadRow;
  /** The thread's news line, as on its leader's Home, when there is one. */
  line?: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const gap = 6;

  // Beside the row, its top aligned with the row's; to the row's left when the window is too
  // narrow, and kept inside the window.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) el.style.left = `${Math.max(8, anchorRect.left - rect.width - gap)}px`;
    if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }, [anchorRect]);

  const leader = row.leader.leader;
  const status = STATUS[row.group];
  const stage = questStage(row);
  const worker = row.tab && !row.tab.completed ? row.tab.workerSessionId : null;
  // A worker this browser knows is a chip (its card on hover, a click opens it); else its number.
  const workerKnown = useStore((state) => !!worker && !!resolveSessionNavigation(state, worker));
  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 pointer-events-auto hidden-on-touch"
      style={{
        left: anchorRect.right + gap,
        top: anchorRect.top,
        width: CARD_WIDTH,
        transform: `scale(${zoomLevel})`,
        transformOrigin: "top left",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="thread-hover-card"
    >
      <div className="overflow-hidden rounded-xl border border-cc-border bg-cc-card shadow-xl">
        <div className="flex gap-2.5 px-4 pb-2.5 pt-3">
          {leader.leaderProfilePortrait && (
            <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-cc-muted">
              {row.questId && <span className="shrink-0 font-mono-code">{row.questId}</span>}
              {row.questId && <span className="text-cc-muted/50">·</span>}
              <span className="min-w-0 truncate">
                {leader.name ?? "Leader"}
                {leader.sessionNum != null ? ` #${leader.sessionNum}` : ""}
              </span>
            </div>
            <div className="mt-0.5 break-words text-[14px] font-semibold leading-snug text-cc-fg">{row.title}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" data-testid="thread-hover-status">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${THREAD_GROUP_DOT[row.group]}`} aria-hidden="true" />
              <span className={status.text}>{status.label(row)}</span>
              {row.activityAt > 0 && (
                <>
                  <span className="text-cc-muted/50">·</span>
                  <span className="text-cc-muted">Updated {timeAgo(row.activityAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {row.question && (
          <div className="border-t border-cc-border/50 px-4 py-2" data-testid="thread-hover-question">
            <span className="text-[10px] uppercase tracking-wider text-cc-attention/80">Asks</span>
            <p className="mt-0.5 line-clamp-4 break-words text-[12px] leading-relaxed text-cc-fg">{row.question}</p>
          </div>
        )}

        {line && (
          <div className="border-t border-cc-border/50 px-4 py-2" data-testid="thread-hover-update">
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-cc-muted/70">
              <UpdateMarker />
              Latest
            </span>
            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-cc-fg/85">{line}</p>
          </div>
        )}

        {(stage || worker) && (
          <div
            className="flex min-w-0 items-center gap-2 border-t border-cc-border/50 px-4 py-2 text-[11px]"
            data-testid="thread-hover-work"
          >
            {stage && (
              <span className="font-medium text-cc-muted" style={stage.color ? { color: stage.color } : undefined}>
                {stage.label}
              </span>
            )}
            {worker && (
              <>
                <span className="text-cc-muted">Worker</span>
                {workerKnown ? (
                  <SessionNumChip
                    sessionId={worker}
                    className="rounded-full bg-cc-hover px-1.5 py-px font-mono-code text-[11px] text-cc-fg/85 hover:bg-cc-border"
                  />
                ) : (
                  <span className="font-mono-code text-cc-fg/85">#{row.tab?.workerSessionNum ?? "?"}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const CARD_WIDTH = 340;

/** Each status as the card's line names it, in the status colours of the rows' rings and Home's dots. */
const STATUS: Record<ThreadRow["group"], { text: string; label: (row: ThreadRow) => string }> = {
  "needs-input": {
    text: "text-cc-attention",
    label: ({ counts }) => (counts.permission > 1 ? `Needs you: ${counts.permission} questions` : "Needs you"),
  },
  "new-results": {
    text: "text-cc-info",
    label: ({ counts }) => `${counts.unread} unread`,
  },
  "in-progress": { text: "text-cc-success", label: () => "In progress" },
  idle: { text: "text-cc-muted", label: () => "Idle" },
};

/** A quest's place in its Journey (in the phase's colour), its board state, or Done. */
function questStage(row: ThreadRow): { label: string; color?: string } | null {
  const tab = row.tab;
  if (!tab) return null;
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  if (phase) return { label: phase.label, color: getQuestPhaseColorValue(phase.color) };
  if (tab.boardStatus) return { label: getQuestJourneyPresentation(tab.boardStatus)?.label ?? tab.boardStatus };
  return tab.completed ? { label: "Done" } : null;
}

/**
 * Which row's card is open: it opens as the mouse enters a row, as the session cards do, and closes
 * shortly after the mouse leaves both the row and the card.
 */
export function useThreadHoverCard() {
  const [hovered, setHovered] = useState<{ key: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    hovered,
    start: (key: string, rect: DOMRect) => {
      cancel();
      setHovered({ key, rect });
    },
    end: () => {
      cancel();
      timer.current = setTimeout(() => setHovered(null), 100);
    },
    keep: cancel,
    close: () => {
      cancel();
      setHovered(null);
    },
  };
}
