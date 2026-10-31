import { useEffect, useRef, useState } from "react";
import { topicApi } from "../../api/topics.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { useStore } from "../../store.js";
import { openInSide, sideChatOrigin } from "../../utils/side-column.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";

/** A leader as a side chat names it: its number, name and portrait. */
export function useLeaderCard(sessionId: string) {
  return useStore((state) => state.sdkSessions.find((session) => session.sessionId === sessionId));
}

/** "#2851 DevBox takode", with the leader's portrait before it when it has one. */
export function LeaderName({ sessionId }: { sessionId: string }) {
  const leader = useLeaderCard(sessionId);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 align-middle">
      {leader?.leaderProfilePortrait && <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} />}
      <span className="min-w-0 truncate">
        <span className="font-mono-code text-[12px] text-cc-muted">#{leader?.sessionNum ?? "?"}</span>{" "}
        {leader?.name ?? "Leader"}
      </span>
    </span>
  );
}

/**
 * The leaders a side chat can be started with: those with topics on that are not archived, the
 * column's own first, then the rest by when the user last wrote to them. Read when `enabled`.
 */
function useSideChatLeaders(columnId: string, enabled: boolean): string[] | null {
  const [topicsOn, setTopicsOn] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    topicApi
      .list("all")
      .then((all) => {
        if (!cancelled) setTopicsOn(all.leaders.filter((leader) => leader.enabled).map((leader) => leader.sessionId));
      })
      .catch((error: Error) => console.warn("[side-column] Could not load the leaders:", error.message));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  const sessions = useStore((state) => state.sdkSessions);
  if (!topicsOn) return null;
  const others = sessions
    .filter((session) => session.isOrchestrator && !session.archived && session.sessionId !== columnId)
    .filter((session) => topicsOn.includes(session.sessionId))
    .sort((a, b) => (b.lastUserMessageAt ?? 0) - (a.lastUserMessageAt ?? 0))
    .map((session) => session.sessionId);
  return [columnId, ...others];
}

/**
 * Beside "New side chat": picks the leader a new side chat is with. The plain button starts one
 * with the column's leader; this starts one with another leader, kept in this column, about what is
 * on screen. The chat is that leader's: it answers there and lists it with its own side chats.
 */
export function SideChatLeaderMenu({ columnId }: { columnId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useOutsidePress([listRef, triggerRef], () => setOpen(false), open);
  const leaders = useSideChatLeaders(columnId, open);
  const start = (leaderId: string) => {
    setOpen(false);
    openInSide(columnId, { kind: "new-chat", startedFrom: sideChatOrigin(columnId), leaderId });
  };
  return (
    <span className="relative flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Choose the leader for a new side chat"
        title="Start a side chat with another leader"
        className={`-ml-1 inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-[10px] text-cc-primary hover:bg-cc-hover ${
          open ? "bg-cc-hover" : ""
        }`}
        data-testid="side-new-chat-leader"
      >
        ▾
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 max-h-[60dvh] w-[17rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl"
          data-testid="side-new-chat-leaders"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        >
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-cc-muted">New side chat with</div>
          {!leaders && <div className="px-3 py-1.5 text-[12px] text-cc-muted">Loading…</div>}
          {leaders?.map((leaderId) => (
            <button
              key={leaderId}
              type="button"
              role="menuitem"
              onClick={() => start(leaderId)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-cc-fg hover:bg-cc-hover"
              data-testid="side-new-chat-leader-row"
            >
              <span className="min-w-0 flex-1">
                <LeaderName sessionId={leaderId} />
              </span>
              {leaderId === columnId && <span className="shrink-0 text-[11px] text-cc-muted">this page</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
