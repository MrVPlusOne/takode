import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type {
  GlobalStarredMessageSearchResult,
  MessageSearchResult,
  RecentAskBundle,
  UserMessageSearchResult,
} from "../api.js";
import type { QuestListPreview, SdkSessionInfo } from "../types.js";
import {
  getQuestDisplayOwner,
  getQuestLeaderSessionId,
  getQuestOwnerSessionId,
  timeAgo,
} from "../utils/quest-helpers.js";
import { getQuestRecordStatusTheme } from "../utils/quest-status-theme.js";
import { getHighlightParts } from "../utils/highlight.js";
import type { SearchRank } from "../../shared/search-utils.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { StarIcon } from "./StarredMessageIndicator.js";
import { RecentAskBundleResult } from "./RecentAskBundleResult.js";
import { SEARCH_ROW_CLASS, SearchMeta, SearchRowContent } from "./SearchSheet.js";
import { CodexQuestOwnerChip } from "./CodexQuestOwnerChip.js";
import { LeaderProfilePortraitImage } from "./LeaderProfilePortraitButton.js";
import type { ThreadRow } from "./sidebar-threads/SidebarThreadsMode.js";

/** Universal Search's result rows: threads, quests, sessions, messages and Recent conversations. */
/** A message found by any search: in one session, among starred messages, or among the user's own. */
type AnyMessageResult = MessageSearchResult | GlobalStarredMessageSearchResult | UserMessageSearchResult;

export type UniversalSearchResult =
  /** A leader's thread, shown above the open tab's results (`sidebar-threads/thread-search.ts`). */
  | { kind: "thread"; id: string; thread: ThreadRow }
  | { kind: "quest"; id: string; quest: QuestListPreview }
  | { kind: "session"; id: string; session: SdkSessionInfo; rank: SearchRank | null }
  | { kind: "message"; id: string; message: MessageSearchResult | GlobalStarredMessageSearchResult }
  /** One of the user's own messages, found by typing in Recent. */
  | { kind: "my_message"; id: string; message: UserMessageSearchResult }
  | { kind: "recent_ask"; id: string; bundle: RecentAskBundle };

export type QuestResultAction =
  | { id: "copy"; label: string }
  | { id: "leader" | "worker"; label: string; sessionId: string; sessionNum: number | null };

function questRecency(quest: QuestListPreview): number {
  return Math.max(quest.createdAt ?? 0, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

export function sessionNumForId(sessions: SdkSessionInfo[], sessionId: string | null): number | null {
  if (!sessionId) return null;
  return sessions.find((session) => session.sessionId === sessionId)?.sessionNum ?? null;
}

export function getQuestResultActions(quest: QuestListPreview, sessions: SdkSessionInfo[]): QuestResultAction[] {
  const leaderSessionId = getQuestLeaderSessionId(quest);
  const workerSessionId = getQuestOwnerSessionId(quest);
  const leaderSessionNum = sessionNumForId(sessions, leaderSessionId);
  const workerSessionNum = sessionNumForId(sessions, workerSessionId);
  const actions: QuestResultAction[] = [{ id: "copy", label: "Copy quest number" }];

  if (leaderSessionId) {
    actions.push({
      id: "leader",
      label: `Open thread in leader${leaderSessionNum != null ? ` #${leaderSessionNum}` : ""}`,
      sessionId: leaderSessionId,
      sessionNum: leaderSessionNum,
    });
  }
  if (workerSessionId) {
    actions.push({
      id: "worker",
      label: `Go to worker session${workerSessionNum != null ? ` #${workerSessionNum}` : ""}`,
      sessionId: workerSessionId,
      sessionNum: workerSessionNum,
    });
  }
  return actions;
}

export function sessionDisplayName(session: SdkSessionInfo): string {
  return (
    session.name?.trim() || (typeof session.sessionNum === "number" ? `#${session.sessionNum}` : session.sessionId)
  );
}

export function sessionRecency(session: SdkSessionInfo): number {
  return session.lastActivityAt ?? session.lastUserMessageAt ?? session.createdAt;
}

export function ResultRow({
  result,
  query,
  sessions,
  selected,
  copiedQuestId,
  questActionMenu,
  onPointerMove,
  onOpen,
  onCopyQuestId,
  onOpenQuestActionMenu,
  onSelectQuestAction,
  onActivateQuestAction,
  onInlineNavigate,
  onOpenRecentMessage,
}: {
  result: UniversalSearchResult;
  query: string;
  sessions: SdkSessionInfo[];
  selected: boolean;
  copiedQuestId: string | null;
  questActionMenu: { resultId: string; selectedActionIndex: number } | null;
  onPointerMove: () => void;
  onOpen: () => void;
  onCopyQuestId: (questId: string) => void;
  onOpenQuestActionMenu: () => void;
  onSelectQuestAction: (selectedActionIndex: number) => void;
  onActivateQuestAction: (quest: QuestListPreview, action: QuestResultAction) => void;
  onInlineNavigate: () => void;
  onOpenRecentMessage: (bundle: RecentAskBundle, messageId: string) => void;
}) {
  if (result.kind === "quest") {
    return (
      <QuestResultRow
        quest={result.quest}
        sessions={sessions}
        selected={selected}
        copied={copiedQuestId === result.quest.questId}
        actionMenu={questActionMenu}
        onPointerMove={onPointerMove}
        onOpen={onOpen}
        onCopyQuestId={onCopyQuestId}
        onOpenActionMenu={onOpenQuestActionMenu}
        onSelectAction={onSelectQuestAction}
        onActivateAction={onActivateQuestAction}
        onInlineNavigate={onInlineNavigate}
      />
    );
  }
  if (result.kind === "recent_ask") {
    return (
      <RecentAskBundleResult
        bundle={result.bundle}
        selected={selected}
        onPointerMove={onPointerMove}
        onOpenMember={(member) => onOpenRecentMessage(result.bundle, member.messageId)}
        onNavigateQuest={onInlineNavigate}
      />
    );
  }
  if (result.kind === "thread") {
    return (
      <ThreadResultRow
        thread={result.thread}
        query={query}
        selected={selected}
        onPointerMove={onPointerMove}
        onOpen={onOpen}
      />
    );
  }
  if (result.kind === "session") {
    return (
      <SessionResultRow
        session={result.session}
        query={query}
        selected={selected}
        onPointerMove={onPointerMove}
        onOpen={onOpen}
      />
    );
  }
  return (
    <MessageResultRow
      message={result.message}
      // Every message Recent finds is the user's, so it doesn't say so.
      showKind={result.kind !== "my_message"}
      query={query}
      selected={selected}
      onPointerMove={onPointerMove}
      onOpen={onOpen}
    />
  );
}

function ResultOption({
  selected,
  onPointerMove,
  onOpen,
  children,
}: {
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onPointerMove={onPointerMove}
      onClick={onOpen}
      // Keyboard selection shows on wide screens only; on a phone it would mark the first row for no reason.
      className={`${SEARCH_ROW_CLASS} relative cursor-pointer ${selected ? "md:bg-cc-hover/60" : "hover:bg-cc-hover/40"}`}
    >
      {children}
    </div>
  );
}

function QuestResultRow({
  quest,
  sessions,
  selected,
  copied,
  actionMenu,
  onPointerMove,
  onOpen,
  onCopyQuestId,
  onOpenActionMenu,
  onSelectAction,
  onActivateAction,
  onInlineNavigate,
}: {
  quest: QuestListPreview;
  sessions: SdkSessionInfo[];
  selected: boolean;
  copied: boolean;
  actionMenu: { resultId: string; selectedActionIndex: number } | null;
  onPointerMove: () => void;
  onOpen: () => void;
  onCopyQuestId: (questId: string) => void;
  onOpenActionMenu: () => void;
  onSelectAction: (selectedActionIndex: number) => void;
  onActivateAction: (quest: QuestListPreview, action: QuestResultAction) => void;
  onInlineNavigate: () => void;
}) {
  const leaderSessionId = getQuestLeaderSessionId(quest);
  const owner = getQuestDisplayOwner(quest);
  const workerSessionId = getQuestOwnerSessionId(quest);
  const leaderSessionNum = sessionNumForId(sessions, leaderSessionId);
  const workerSessionNum = sessionNumForId(sessions, workerSessionId);
  const actions = getQuestResultActions(quest, sessions);
  const leaderAction = actions.find((action) => action.id === "leader");
  const selectedActionIndex = Math.min(actionMenu?.selectedActionIndex ?? 0, actions.length - 1);
  const status = getQuestRecordStatusTheme(quest);
  function handleInteractiveKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  }
  function handleCopyClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onCopyQuestId(quest.questId);
  }
  function handleOpenActionMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onOpenActionMenu();
  }
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={`var(--color-cc-status-${QUEST_STATUS_BAR[quest.status] ?? "idea"})`}
        barQuiet={quest.status === "done"}
        meta={
          <SearchMeta
            truncate={-1}
            items={[
              <span className="inline-flex items-center gap-0.5">
                <QuestInlineLink
                  questId={quest.questId}
                  stopPropagation
                  hoverCardZIndexClassName="z-[90]"
                  onNavigate={onInlineNavigate}
                  className="font-mono-code hover:underline"
                />
                <button
                  type="button"
                  className={`inline-flex h-5 w-5 items-center justify-center rounded hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 ${
                    copied ? "text-cc-success" : ""
                  }`}
                  aria-label={`Copy quest ID ${quest.questId}`}
                  title={copied ? `Copied ${quest.questId}` : `Copy ${quest.questId}`}
                  onKeyDown={handleInteractiveKeyDown}
                  onClick={handleCopyClick}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                    <rect x="5" y="3" width="8" height="10" rx="1.5" />
                    <path d="M3 11V5.5A2.5 2.5 0 015.5 3H9" />
                  </svg>
                </button>
              </span>,
              <span className={status.text}>{status.label}</span>,
              // Time comes before the people, so a narrow row clips a session number rather than when.
              timeAgo(questRecency(quest)),
              leaderSessionId ? (
                <span className="inline-flex items-center gap-1">
                  <span>leader</span>
                  <SessionInlineLink
                    sessionId={leaderSessionId}
                    sessionNum={leaderSessionNum}
                    threadKey={quest.questId}
                    stopPropagation
                    hoverCardZIndexClassName="z-[90]"
                    onNavigate={onInlineNavigate}
                    className="font-mono-code hover:underline"
                  >
                    {`#${leaderSessionNum ?? "?"}`}
                  </SessionInlineLink>
                </span>
              ) : null,
              owner?.kind === "codex" ? (
                <span className="inline-flex items-center gap-1">
                  <span>owner</span>
                  <CodexQuestOwnerChip owner={owner} stopPropagation />
                </span>
              ) : workerSessionId ? (
                <span className="inline-flex items-center gap-1">
                  <span>worker</span>
                  <SessionInlineLink
                    sessionId={workerSessionId}
                    sessionNum={workerSessionNum}
                    stopPropagation
                    hoverCardZIndexClassName="z-[90]"
                    onNavigate={onInlineNavigate}
                    className="font-mono-code hover:underline"
                  >
                    {`#${workerSessionNum ?? "?"}`}
                  </SessionInlineLink>
                </span>
              ) : null,
            ]}
          />
        }
      >
        <span className="truncate text-[14px] text-cc-fg">{quest.title}</span>
      </SearchRowContent>
      {leaderAction && (
        // A quest has one thread in its leader: this opens it, while the row opens the quest's details.
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
          aria-label={`Open the thread of ${quest.questId} in leader #${leaderSessionNum ?? "?"}`}
          title={`Open its thread in leader #${leaderSessionNum ?? "?"}`}
          onKeyDown={handleInteractiveKeyDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onActivateAction(quest, leaderAction);
          }}
          data-testid="universal-search-quest-thread"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="7" />
            <path d="M4.5 8h6.5" />
            <path d="M8 5l3 3-3 3" />
          </svg>
          <span>Open thread</span>
        </button>
      )}
      <button
        type="button"
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 ${
          actionMenu ? "text-cc-fg" : "text-cc-muted/75"
        }`}
        aria-label={`More options for ${quest.questId}`}
        title="More options (Right Arrow)"
        onKeyDown={handleInteractiveKeyDown}
        onClick={handleOpenActionMenu}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {actionMenu && (
        <div
          role="menu"
          aria-label={`Actions for ${quest.questId}`}
          className="absolute right-4 top-full z-[90] -mt-1 min-w-44 rounded-lg border border-cc-border bg-cc-card py-1 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          {actions.map((action, index) => {
            const actionSelected = index === selectedActionIndex;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors ${
                  actionSelected ? "bg-cc-hover text-cc-fg" : "text-cc-fg hover:bg-cc-hover"
                }`}
                onMouseEnter={() => onSelectAction(index)}
                onKeyDown={handleInteractiveKeyDown}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onActivateAction(quest, action);
                }}
              >
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </ResultOption>
  );
}

/** Quest status token for the row's bar; finished quests fade like finished tabs in Find. */
const QUEST_STATUS_BAR: Record<string, string> = {
  idea: "idea",
  refined: "refined",
  in_progress: "progress",
  done: "done",
};

/** A thread's bar takes its status group's colour, as everywhere threads are listed. */
const THREAD_GROUP_BAR: Record<ThreadRow["group"], string> = {
  "needs-input": "var(--color-cc-attention)",
  "new-results": "var(--color-cc-info)",
  "in-progress": "var(--color-cc-success)",
  idle: "var(--color-cc-muted)",
};

function ThreadResultRow({
  thread,
  query,
  selected,
  onPointerMove,
  onOpen,
}: {
  thread: ThreadRow;
  query: string;
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
}) {
  const leader = thread.leader.leader;
  const leaderLabel = [leader.name ?? "Leader", leader.sessionNum != null ? `#${leader.sessionNum}` : null];
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={THREAD_GROUP_BAR[thread.group]}
        barQuiet={thread.group === "idle"}
        meta={
          <SearchMeta
            truncate={1}
            items={[
              thread.questId ?? "Thread",
              leaderLabel.filter(Boolean).join(" "),
              timeAgo(thread.at || thread.activityAt),
            ]}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {leader.leaderProfilePortrait && <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} />}
          <span className="truncate text-[14px] text-cc-fg">
            <HighlightedText parts={getHighlightParts(thread.title, query)} />
          </span>
        </span>
      </SearchRowContent>
    </ResultOption>
  );
}

function SessionResultRow({
  session,
  query,
  selected,
  onPointerMove,
  onOpen,
}: {
  session: SdkSessionInfo;
  query: string;
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
}) {
  const displayName = sessionDisplayName(session);
  const nameParts = getHighlightParts(displayName, query);
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={session.isOrchestrator ? "var(--color-cc-fg)" : "var(--color-cc-muted)"}
        barQuiet={session.archived === true}
        meta={
          <SearchMeta
            truncate={3}
            items={[
              typeof session.sessionNum === "number" ? `#${session.sessionNum}` : "session",
              session.archived ? "archived" : null,
              session.gitBranch ? `branch ${session.gitBranch}` : null,
              session.cwd || session.repoRoot || null,
              session.backendType ?? null,
              timeAgo(sessionRecency(session)),
            ]}
          />
        }
      >
        <span className="truncate text-[14px] text-cc-fg">
          <HighlightedText parts={nameParts} />
        </span>
      </SearchRowContent>
    </ResultOption>
  );
}

function MessageResultRow({
  message,
  showKind,
  query,
  selected,
  onPointerMove,
  onOpen,
}: {
  message: AnyMessageResult;
  showKind: boolean;
  query: string;
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
}) {
  const sessionLabel = formatMessageResultSessionLabel(message);
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={message.category === "user" ? "var(--color-cc-fg)" : "var(--color-cc-muted)"}
        meta={
          <SearchMeta
            truncate={1}
            items={[
              showKind ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  {"starred" in message && message.starred && <StarIcon className="h-3 w-3 text-amber-400" />}
                  {message.category}
                </span>
              ) : null,
              sessionLabel,
              "archived" in message && message.archived ? "Archived" : null,
              "reviewerOf" in message && typeof message.reviewerOf === "number" ? "Reviewer" : null,
              message.sourceLabel,
              timeAgo(message.timestamp),
            ]}
          />
        }
      >
        <span className="line-clamp-2 text-[14px] text-cc-fg">
          <HighlightedText parts={getHighlightParts(message.snippet, query)} />
        </span>
      </SearchRowContent>
    </ResultOption>
  );
}

/** Query matches use the same tint as Find's. */
function HighlightedText({ parts }: { parts: ReadonlyArray<{ text: string; matched: boolean }> }) {
  return (
    <>
      {parts.map((part, index) =>
        part.matched ? (
          <mark key={`${part.text}-${index}`} className="rounded-sm bg-cc-primary/25 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function formatMessageResultSessionLabel(message: AnyMessageResult): string {
  if (!("sessionName" in message) && !("archived" in message)) return "";
  const numberLabel = typeof message.sessionNum === "number" ? `#${message.sessionNum}` : "Session";
  const name = "sessionName" in message ? message.sessionName?.trim() : "";
  return name ? `${numberLabel} ${name}` : numberLabel;
}
