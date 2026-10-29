import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TopicDetail } from "../../../shared/library-topics.js";
import { topicViewKey } from "../../../shared/topic-thread-key.js";
import { topicApi } from "../../api/topics.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { timeAgo } from "../../utils/quest-helpers.js";
import { getQuestStatusTheme } from "../../utils/quest-status-theme.js";
import { NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { Chevron } from "./PlaceCrumb.js";
import { isOpenInSideClick, openConversationInSide } from "../../utils/side-column.js";

type TopicQuest = NonNullable<TopicDetail["quests"]>[number];

/**
 * The breadcrumb's second part: the quest (or thread, or whole topic) on screen inside its topic.
 * Clicking it lists the topic's quests, most recently changed first, and the threads filed under it,
 * after a "Whole topic" row that zooms out to the topic's conversation.
 */
export function ItemCrumb({
  leaderId,
  topicId,
  current,
  label,
  onOpenTopic,
  onOpenQuest,
  onOpenThread,
}: {
  leaderId: string;
  topicId: string;
  /** What is on screen: one quest, one thread, or the whole topic. */
  current: { kind: "quest"; questId: string } | { kind: "thread"; threadKey: string } | { kind: "topic" };
  /** The trigger's text: the quest's title, the thread's name, or "N quests". */
  label: ReactNode;
  onOpenTopic: () => void;
  onOpenQuest: (questId: string) => void;
  onOpenThread: (threadKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quests, setQuests] = useState<TopicQuest[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useOutsidePress([listRef, triggerRef], () => setOpen(false), open);
  const brief = useKnownTopicBrief(leaderId, topicId);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    topicApi
      .get(topicId)
      .then((detail) => !cancelled && setQuests(detail.quests ?? []))
      .catch((error: Error) => console.warn("[breadcrumb] Could not load the topic's quests:", error.message));
    return () => {
      cancelled = true;
    };
  }, [open, topicId]);
  const sorted = [...(quests ?? [])].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0));
  const count = brief?.questIds.length ?? quests?.length ?? 0;
  const go = (action: () => void) => {
    setOpen(false);
    action();
  };
  // The open-in-side click (Shift by default): the quest or thread goes in the side column.
  const goTo = (threadKey: string, open: (key: string) => void) => (event: React.MouseEvent) => {
    setOpen(false);
    if (isOpenInSideClick(event) && openConversationInSide(leaderId, threadKey)) return;
    open(threadKey);
  };
  return (
    // At least a few words of the title; on phones less, so a narrow band never pushes it under its neighbors.
    <span
      className="relative inline-flex min-w-[6rem] items-center max-sm:static max-sm:min-w-[3.5rem]"
      data-testid="item-crumb"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[13px] font-medium text-cc-fg hover:bg-cc-hover ${
          open ? "bg-cc-hover" : ""
        }`}
        title="Switch to another quest or thread of this topic"
        data-testid="item-crumb-button"
      >
        <span className="min-w-0 truncate">{label}</span>
        <Chevron />
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 max-h-[70dvh] w-[28rem] max-sm:left-2 max-sm:right-2 max-sm:w-auto overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl"
          data-testid="item-crumb-list"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        >
          <Row
            selected={current.kind === "topic"}
            onClick={() => go(onOpenTopic)}
            icon={<TopicIcon className="h-4 w-4 text-cc-primary" />}
            title="Whole topic"
            detail={`All ${count} quest${count === 1 ? "" : "s"} as one conversation`}
          />
          <div className="border-t border-cc-border/60 px-4 pb-1 pt-2.5 text-[11px] uppercase tracking-wide text-cc-muted">
            Quests <span className="tabular-nums">{count}</span>
          </div>
          {!quests && <div className="px-4 py-2 text-[12px] text-cc-muted">Loading…</div>}
          {sorted.map((quest) => {
            const theme = getQuestStatusTheme(quest.status);
            return (
              <Row
                key={quest.questId}
                selected={current.kind === "quest" && current.questId === quest.questId}
                onClick={goTo(quest.questId, onOpenQuest)}
                icon={<span aria-hidden="true" className={`h-2 w-2 rounded-full ${theme.dot}`} />}
                title={quest.title}
                detail={`${quest.questId} · ${theme.label}${quest.changedAt ? ` · ${timeAgo(quest.changedAt)}` : ""}`}
              />
            );
          })}
          {brief?.threads && brief.threads.length > 0 && (
            <>
              <div className="border-t border-cc-border/60 px-4 pb-1 pt-2.5 text-[11px] uppercase tracking-wide text-cc-muted">
                Threads <span className="tabular-nums">{brief.threads.length}</span>
              </div>
              {brief.threads.map((thread) => {
                const key = topicViewKey(thread.handle);
                return (
                  <Row
                    key={thread.handle}
                    selected={current.kind === "thread" && current.threadKey === key}
                    onClick={goTo(key, onOpenThread)}
                    icon={<NewThreadIcon className="h-4 w-4 text-cc-muted" />}
                    title={thread.name}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </span>
  );
}

function Row({
  selected,
  onClick,
  icon,
  title,
  detail,
}: {
  selected: boolean;
  onClick: (event: React.MouseEvent) => void;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-start gap-3 px-4 py-2 text-left ${selected ? "bg-cc-active" : "hover:bg-cc-hover/40"}`}
      data-testid="item-crumb-row"
    >
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] text-cc-fg">{title}</span>
        {detail && <span className="block text-[12px] text-cc-muted">{detail}</span>}
      </span>
    </button>
  );
}
