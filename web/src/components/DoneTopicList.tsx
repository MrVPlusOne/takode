import { type ReactNode, useState } from "react";
import type { QuestTopicMap } from "../../shared/library-topics.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { TopicIcon } from "./library/library-icons.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/**
 * The Done list of a leader with Library topics on: the newest finished quests first, then every
 * topic newest first, then the quests under no topic. A topic is its own kind of row (book icon,
 * name, its quests and the latest one): tapping it opens the topic as one conversation, and its ▾
 * lists the topic's quests, so an earlier quest is always one tap away. Neither repeats what the
 * topic page says.
 */
export function DoneTopicList({
  tabs,
  map,
  renderRow,
  onOpenConversation,
}: {
  /** Newest first. */
  tabs: PrimaryThreadChip[];
  map: QuestTopicMap;
  renderRow: (tab: PrimaryThreadChip) => ReactNode;
  /** Opens the topic of this quest tab as one conversation. */
  onOpenConversation: (threadKey: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((current) => (current === id ? null : id));
  const groups = groupByTopic(tabs, map);
  const others = tabs.filter((tab) => !(tab.questId && map[tab.questId]));
  return (
    <div data-testid="done-topic-list">
      <SubHeading>Recent</SubHeading>
      {tabs.slice(0, RECENT_QUESTS).map(renderRow)}
      {groups.length > 0 && <SubHeading>Topics</SubHeading>}
      {groups.map((group) => (
        <TopicRow
          key={group.id}
          group={group}
          open={open === group.id}
          onToggle={() => toggle(group.id)}
          onOpen={() => onOpenConversation(group.tabs[0]!.threadKey)}
          renderRow={renderRow}
        />
      ))}
      {others.length > 0 && (
        <OtherQuests tabs={others} open={open === ""} onToggle={() => toggle("")} renderRow={renderRow} />
      )}
    </div>
  );
}

const RECENT_QUESTS = 5;

interface TopicGroup {
  id: string;
  name: string;
  /** Newest first. */
  tabs: PrimaryThreadChip[];
}

/** A topic: book icon and name, its quests and latest one; tap to read it, ▾ to list its quests. */
function TopicRow({
  group,
  open,
  onToggle,
  onOpen,
  renderRow,
}: {
  group: TopicGroup;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  renderRow: (tab: PrimaryThreadChip) => ReactNode;
}) {
  const latest = group.tabs[0]!;
  return (
    <div data-testid="done-topic-row">
      <div className="flex min-h-[3.25rem] items-center gap-3 px-4 py-1.5 hover:bg-cc-hover/40">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cc-primary/12 text-cc-primary">
            <TopicIcon className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] text-cc-fg">{group.name}</span>
            <span className="truncate text-[12.5px] text-cc-muted">
              {group.tabs.length} quest{group.tabs.length === 1 ? "" : "s"} · latest: {latest.title} ·{" "}
              {timeAgo(latest.groupChangedAt ?? latest.updatedAt)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Hide the quests of ${group.name}` : `List the quests of ${group.name}`}
          className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        >
          {open ? "▴" : "▾"}
        </button>
      </div>
      {open && <div className="ml-7 border-l border-cc-border/70">{group.tabs.map(renderRow)}</div>}
    </div>
  );
}

function OtherQuests({
  tabs,
  open,
  onToggle,
  renderRow,
}: {
  tabs: PrimaryThreadChip[];
  open: boolean;
  onToggle: () => void;
  renderRow: (tab: PrimaryThreadChip) => ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[2.75rem] w-full items-center gap-2 px-4 text-left text-[13px] text-cc-muted hover:text-cc-fg"
      >
        Quests under no topic · {tabs.length} {open ? "▴" : "▾"}
      </button>
      {open && <div className="ml-7 border-l border-cc-border/70">{tabs.map(renderRow)}</div>}
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-0.5 pt-2.5 text-[11px] uppercase tracking-wide text-cc-muted">{children}</div>;
}

/** Topics in order of their newest quest. */
function groupByTopic(tabs: PrimaryThreadChip[], map: QuestTopicMap): TopicGroup[] {
  const groups = new Map<string, TopicGroup>();
  for (const tab of tabs) {
    const topic = tab.questId ? map[tab.questId] : undefined;
    if (!topic) continue;
    const group = groups.get(topic.id) ?? { id: topic.id, name: topic.name, tabs: [] };
    group.tabs.push(tab);
    groups.set(topic.id, group);
  }
  return [...groups.values()];
}
