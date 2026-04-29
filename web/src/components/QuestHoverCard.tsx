import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { QuestmasterTask } from "../types.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { getQuestLeaderSessionId, getQuestOwnerSessionId } from "../utils/quest-helpers.js";
import { useStore } from "../store.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";
import { isCompletedJourneyPresentationStatus, QuestJourneyCompactSummary } from "./QuestJourneyTimeline.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

interface QuestHoverCardProps {
  quest: QuestmasterTask;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

interface QuestJourneyBoardRow {
  questId: string;
  journey?: QuestJourneyPlanState;
  status?: string;
}

export function QuestHoverCard({ quest, anchorRect, onMouseEnter, onMouseLeave }: QuestHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const statusTheme = getQuestStatusTheme(quest.status);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const ownerSessionId = getQuestOwnerSessionId(quest);
  const leaderSessionId = useStore((state) => {
    const recordedLeader = getQuestLeaderSessionId(quest);
    if (recordedLeader) return recordedLeader;
    if (!ownerSessionId) return null;
    return state.sdkSessions.find((session) => session.sessionId === ownerSessionId)?.herdedBy ?? null;
  });
  const ownerSessionName = useStore((state) => (ownerSessionId ? state.sessionNames.get(ownerSessionId) : undefined));
  const ownerSessionNum = useStore((state) =>
    ownerSessionId
      ? (state.sdkSessions.find((session) => session.sessionId === ownerSessionId)?.sessionNum ?? null)
      : null,
  );
  const leaderSessionName = useStore((state) =>
    leaderSessionId ? state.sessionNames.get(leaderSessionId) : undefined,
  );
  const leaderSessionNum = useStore((state) =>
    leaderSessionId
      ? (state.sdkSessions.find((session) => session.sessionId === leaderSessionId)?.sessionNum ?? null)
      : null,
  );
  const journeyBoardRow = useStore((state) =>
    findQuestJourneyBoardRow(quest.questId, state.sessionBoards, state.sessionCompletedBoards),
  );

  const cardWidth = getResponsiveCardWidth();
  const gap = 6;
  const left = anchorRect.left;
  const top = anchorRect.bottom + gap;
  const journeyStatus = isCompletedJourneyPresentationStatus(quest.status) ? "done" : journeyBoardRow?.status;

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const el = cardRef.current;

    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - cardWidth - 8)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${Math.max(8, anchorRect.top - rect.height - gap)}px`;
    }
    if (rect.top < 8) {
      el.style.top = "8px";
    }
  }, [anchorRect, cardWidth]);

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 pointer-events-auto hidden-on-touch"
      style={{ left, top, width: cardWidth, transform: `scale(${zoomLevel})`, transformOrigin: "top left" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="quest-hover-card"
    >
      <div className="bg-cc-card border border-cc-border rounded-xl shadow-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] text-cc-muted">{quest.questId}</div>
          <div
            data-testid="quest-hover-title"
            className="mt-0.5 text-sm font-semibold text-cc-fg leading-snug break-words"
          >
            {quest.title}
          </div>
        </div>
        <div data-testid="quest-hover-status-row" className="mt-2 flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-cc-muted/60">Status</span>
          <span
            className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${statusTheme.bg} ${statusTheme.text} ${statusTheme.border}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusTheme.dot}`} />
            {statusTheme.label}
          </span>
        </div>
        {quest.tags && quest.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {quest.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-cc-hover text-cc-muted border border-cc-border"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {journeyBoardRow?.journey && (
          <div data-testid="quest-hover-journey" className="mt-2 pt-2 border-t border-cc-border/50">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-cc-muted/60">Quest Journey</div>
            <QuestJourneyCompactSummary journey={journeyBoardRow.journey} status={journeyStatus} />
          </div>
        )}
        {ownerSessionId && (
          <SessionMetadataRow
            testId="quest-hover-owner-session"
            label="Owner session"
            sessionId={ownerSessionId}
            sessionNum={ownerSessionNum}
            sessionName={ownerSessionName}
            tone="owner"
          />
        )}
        {leaderSessionId && leaderSessionId !== ownerSessionId && (
          <SessionMetadataRow
            testId="quest-hover-leader-session"
            label="Leader session"
            sessionId={leaderSessionId}
            sessionNum={leaderSessionNum}
            sessionName={leaderSessionName}
            tone="leader"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function getResponsiveCardWidth(): number {
  const preferredWidth = 450;
  if (typeof window === "undefined") return preferredWidth;
  return Math.max(240, Math.min(preferredWidth, window.innerWidth - 16));
}

function findQuestJourneyBoardRow(
  questId: string,
  sessionBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
  completedBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
): QuestJourneyBoardRow | null {
  const normalizedQuestId = questId.toLowerCase();
  for (const board of [...sessionBoards.values(), ...completedBoards.values()]) {
    const match = board.find(
      (row) => row.questId.toLowerCase() === normalizedQuestId && (row.journey?.phaseIds?.length ?? 0) > 0,
    );
    if (match) return match;
  }
  return null;
}

function SessionMetadataRow({
  testId,
  label,
  sessionId,
  sessionNum,
  sessionName,
  tone,
}: {
  testId: string;
  label: string;
  sessionId: string;
  sessionNum: number | null;
  sessionName?: string;
  tone: "owner" | "leader";
}) {
  const toneClass =
    tone === "leader"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
      : "border-cc-primary/15 bg-cc-primary/10 text-cc-primary hover:bg-cc-primary/20";
  return (
    <div data-testid={testId} className="mt-2 pt-2 border-t border-cc-border/50">
      <div className="text-[10px] uppercase tracking-wider text-cc-muted/60">{label}</div>
      <div className="mt-1 flex items-center gap-2 min-w-0 flex-wrap">
        <SessionInlineLink
          sessionId={sessionId}
          sessionNum={sessionNum}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${toneClass}`}
        >
          {sessionNum != null ? `#${sessionNum}` : sessionId.slice(0, 8)}
        </SessionInlineLink>
        {sessionName && <span className="min-w-0 truncate text-[11px] text-cc-muted">{sessionName}</span>}
      </div>
    </div>
  );
}
