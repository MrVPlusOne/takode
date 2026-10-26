import { useRef, useState } from "react";
import type { TopicDetail } from "../../../shared/library-topics.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { timeAgo } from "../../utils/quest-helpers.js";
import { getQuestStatusTheme } from "../../utils/quest-status-theme.js";

type TopicQuest = NonNullable<TopicDetail["quests"]>[number];

/**
 * The topic page's quest count as a picker: "18 quests ▾" opens a list of all the topic's quests,
 * most recent first, and choosing one opens its tab. The tab on screen is marked. The list spans
 * the nearest positioned ancestor (the page's line of controls), so it fits a phone's width.
 */
export function TopicQuestPicker({
  quests,
  count,
  currentQuestId,
  onOpen,
}: {
  quests: TopicQuest[];
  /** The topic's quest count; the list may lack quests the server couldn't read. */
  count: number;
  currentQuestId: string | null;
  onOpen: (questId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useOutsidePress([listRef, triggerRef], () => setOpen(false), open);
  const label = `${count} quest${count === 1 ? "" : "s"}`;
  const sorted = [...quests].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0));

  return (
    <span className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-0.5 rounded px-1 -mx-1 text-cc-fg/80 hover:bg-cc-hover hover:text-cc-fg"
        data-testid="topic-quest-picker"
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Quests in this topic"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 max-w-md overflow-y-auto rounded-lg border border-cc-border bg-cc-card py-1 shadow-xl"
          data-testid="topic-quest-picker-list"
        >
          {sorted.map((quest) => {
            const current = quest.questId === currentQuestId;
            const theme = getQuestStatusTheme(quest.status);
            return (
              <button
                key={quest.questId}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => {
                  setOpen(false);
                  onOpen(quest.questId);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${current ? "bg-cc-active" : "hover:bg-cc-hover"}`}
                data-testid="topic-quest-picker-row"
                data-quest={quest.questId}
              >
                <span aria-hidden="true" className={`mt-[0.45em] h-2 w-2 shrink-0 rounded-full ${theme.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[14px] text-cc-fg">{quest.title}</span>
                  <span className="block text-[12px] text-cc-muted">
                    {quest.questId} · {theme.label}
                    {quest.changedAt ? ` · ${timeAgo(quest.changedAt)}` : ""}
                    {current ? " · on screen" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
