/**
 * The Session Info section about a session's work: its leader or workers as participant chips,
 * then its quests, current one first. It replaced the old "Herded by" links and the task list,
 * whose quest entries it keeps; auto-named tasks are left out because the session name already
 * shows the latest one.
 */
import type { SessionTaskEntry } from "../types.js";
import { useStore } from "../store.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { QuestBannerParticipantChip, type QuestBannerParticipantRole } from "./QuestThreadBanner.js";

export interface SessionInfoQuest {
  questId: string;
  title: string;
  /** Known for the claimed quest; others take theirs from loaded quest data when present. */
  status?: string;
}

/** Quests a session has worked on, newest first: the claimed one, then those from its task history. */
export function sessionInfoQuests(
  current: SessionInfoQuest | null,
  taskHistory: readonly SessionTaskEntry[] | undefined,
): SessionInfoQuest[] {
  const quests = current ? [current] : [];
  const seen = new Set(quests.map((quest) => quest.questId.toLowerCase()));
  for (const task of [...(taskHistory ?? [])].reverse()) {
    if (task.source !== "quest" || !task.questId || seen.has(task.questId.toLowerCase())) continue;
    seen.add(task.questId.toLowerCase());
    quests.push({ questId: task.questId, title: task.title.trim() });
  }
  return quests;
}

export function SessionInfoQuests({
  leaderSessionId,
  herded,
  quests,
  currentQuestId,
  onNavigate,
}: {
  leaderSessionId: string | null;
  herded: { sessionId: string; role: QuestBannerParticipantRole }[];
  quests: SessionInfoQuest[];
  currentQuestId: string | null;
  onNavigate: () => void;
}) {
  if (!leaderSessionId && herded.length === 0 && quests.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-cc-border/50 px-4 py-2.5">
      {leaderSessionId && (
        <div data-testid="session-info-herded-by" className="flex flex-wrap gap-1.5">
          <QuestBannerParticipantChip
            role="Leader"
            sessionId={leaderSessionId}
            showDisplayName={false}
            onNavigate={onNavigate}
          />
        </div>
      )}
      {herded.length > 0 && (
        <div data-testid="session-info-herding" className="flex flex-wrap gap-1.5">
          {herded.map(({ sessionId, role }) => (
            <QuestBannerParticipantChip
              key={sessionId}
              role={role}
              sessionId={sessionId}
              showDisplayName={false}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      {quests.length > 0 && (
        <div data-testid="session-info-quests">
          <div className="mb-0.5 px-1 text-[10px] uppercase tracking-wider text-cc-muted/60">Quests</div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {quests.map((quest) => (
              <QuestRow
                key={quest.questId}
                quest={quest}
                current={quest.questId === currentQuestId}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestRow({
  quest,
  current,
  onNavigate,
}: {
  quest: SessionInfoQuest;
  current: boolean;
  onNavigate: () => void;
}) {
  const loadedStatus = useStore((s) => {
    const key = quest.questId.toLowerCase();
    return (
      s.questDetails?.get(key)?.status ?? s.quests?.find((candidate) => candidate.questId.toLowerCase() === key)?.status
    );
  });
  const status = quest.status ?? loadedStatus;
  const theme = status ? getQuestStatusTheme(status) : null;
  return (
    <QuestInlineLink
      questId={quest.questId}
      onNavigate={onNavigate}
      stopPropagation
      hoverCardZIndexClassName="z-[60]"
      className={`flex min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 text-[12px] transition-colors hover:bg-cc-hover ${
        current ? "bg-cc-hover/40" : ""
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme ? theme.dot : "bg-cc-muted/40"}`}
        aria-hidden="true"
      />
      <span className="shrink-0 font-mono-code text-[11px] text-cc-muted">{quest.questId}</span>
      <span className={`min-w-0 flex-1 truncate ${current ? "font-medium text-cc-fg" : "text-cc-fg/85"}`}>
        {quest.title}
      </span>
      {theme && <span className={`shrink-0 text-[10px] ${theme.text}`}>{theme.label}</span>}
    </QuestInlineLink>
  );
}
