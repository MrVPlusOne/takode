/**
 * What a leader's Home adds to its thread groups: a line of news under each row (the Scribe's, or a
 * stand-in from what agents wrote), Idle listed newest first or by topic (with each topic's "where
 * it stands"), and what changed since the user last looked.
 */
import { useEffect, useMemo, useState } from "react";
import type { TopicBrief } from "../../../shared/library-topics.js";
import { topicHandle } from "../../../shared/topic-thread-key.js";
import { topicApi } from "../../api/topics.js";
import { useLeaderTopicBriefs, loadLeaderNamesOnce } from "../../utils/leader-topics.js";
import { scopedGetItem, scopedSetItem } from "../../utils/scoped-storage.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { TopicIcon } from "../library/library-icons.js";
import { ThreadTabListRow, type RowContext } from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";

/** A line of news per thread (`GET /topics/home-lines`), loaded again every minute. */
export function useHomeLines(leaderId: string, questIds: readonly string[]): (threadKey: string) => string | undefined {
  const lineOf = useLeadersHomeLines([{ leaderId, questIds }]);
  return (threadKey) => lineOf(leaderId, threadKey);
}

/**
 * A line of news per thread of several leaders at once (Home's lines, for the sessions panel's
 * Threads view): the Scribe's line when written, else a stand-in from what agents wrote. Each
 * leader's lines load again every minute; nothing loads while `active` is false.
 */
export function useLeadersHomeLines(
  leaders: readonly { leaderId: string; questIds: readonly string[] }[],
  active = true,
): (leaderId: string, threadKey: string) => string | undefined {
  const [lines, setLines] = useState<Record<string, Record<string, { text: string }>>>({});
  const key = leaders
    .map(({ leaderId, questIds }) => `${leaderId}:${[...questIds].sort().join(",")}`)
    .sort()
    .join(";");
  useEffect(() => {
    if (!active || !key) return;
    let cancelled = false;
    const requests = key.split(";").map((entry) => {
      const [leaderId, quests] = entry.split(":") as [string, string];
      return { leaderId, questIds: quests ? quests.split(",") : [] };
    });
    const load = () => {
      for (const { leaderId, questIds } of requests) {
        topicApi
          .homeLines(leaderId, questIds)
          .then((response) => !cancelled && setLines((all) => ({ ...all, [leaderId]: response.lines })))
          .catch((error: Error) => console.warn("[home] Could not load the threads' news:", error.message));
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, active]);
  return (leaderId, threadKey) => lines[leaderId]?.[normalizeThreadKey(threadKey)]?.text;
}

export type IdleView = "recent" | "topic";

/** Recent | By topic, for Idle. */
export function IdleViewSwitch({ value, onChange }: { value: IdleView; onChange: (view: IdleView) => void }) {
  return (
    <span
      className="inline-flex overflow-hidden rounded-md border border-cc-border/70 text-[11px] normal-case tracking-normal"
      role="group"
      aria-label="List Idle"
    >
      {(["recent", "topic"] as const).map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => onChange(view)}
          className={`w-[4.75rem] py-0.5 ${value === view ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:bg-cc-hover/50"}`}
          aria-pressed={value === view}
          data-testid={`idle-view-${view}`}
        >
          {view === "recent" ? "Recent" : "By topic"}
        </button>
      ))}
    </span>
  );
}

interface TopicGroup {
  id: string | null;
  name: string;
  summary?: string;
  tabs: PrimaryThreadChip[];
}

/** The topic a thread is filed under, from the leader's topic list. */
function topicOfKey(
  briefs: Readonly<Record<string, TopicBrief>>,
  threadKey: string,
): (TopicBrief & { id: string }) | null {
  const key = normalizeThreadKey(threadKey);
  for (const [id, brief] of Object.entries(briefs)) {
    if (brief.questIds.includes(key)) return { id, ...brief };
    if (key.startsWith("topic:") && brief.threads?.some((thread) => `topic:${topicHandle(thread.handle)}` === key))
      return { id, ...brief };
  }
  return null;
}

/**
 * Idle by topic: each topic with where it stands, its newest threads first and the rest behind
 * "N more"; topics ordered by their newest thread, threads under no topic last.
 */
export function IdleByTopic({
  leaderId,
  tabs,
  context,
  perTopic = 3,
}: {
  leaderId: string;
  tabs: readonly PrimaryThreadChip[];
  context: RowContext;
  perTopic?: number;
}) {
  useEffect(() => loadLeaderNamesOnce(leaderId), [leaderId]);
  const briefs = useLeaderTopicBriefs(leaderId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const byTopic = new Map<string | null, TopicGroup>();
    for (const tab of tabs) {
      const topic = topicOfKey(briefs, tab.threadKey);
      const id = topic?.id ?? null;
      const group = byTopic.get(id) ?? {
        id,
        name: topic?.name ?? "No topic",
        ...(topic?.summary ? { summary: topic.summary } : {}),
        tabs: [],
      };
      group.tabs.push(tab);
      byTopic.set(id, group);
    }
    const newest = (group: TopicGroup) => Math.max(...group.tabs.map((tab) => tab.groupChangedAt ?? tab.updatedAt));
    return [...byTopic.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : newest(b) - newest(a)));
  }, [tabs, briefs]);
  return (
    <div className="pb-1" data-testid="idle-by-topic">
      {groups.map((group) => {
        const key = group.id ?? "none";
        const shown = open[key] ? group.tabs : group.tabs.slice(0, perTopic);
        return (
          <div key={key} className="mt-1 first:mt-0" data-testid="idle-topic">
            <div className="flex min-w-0 items-baseline gap-2 px-4 pt-2">
              {group.id && <TopicIcon className="h-3.5 w-3.5 shrink-0 self-center text-cc-primary" />}
              <span className="shrink-0 text-[13px] font-medium text-cc-fg">{group.name}</span>
              <span className="text-[11px] tabular-nums text-cc-muted">{group.tabs.length}</span>
            </div>
            {group.summary && (
              <p className="truncate px-4 pl-[2.375rem] text-[12px] text-cc-muted" data-testid="idle-topic-summary">
                {group.summary}
              </p>
            )}
            {shown.map((tab) => (
              <ThreadTabListRow key={tab.threadKey} tab={tab} context={context} />
            ))}
            {shown.length < group.tabs.length && (
              <button
                type="button"
                onClick={() => setOpen((previous) => ({ ...previous, [key]: true }))}
                className="w-full px-4 py-1 text-left text-[12px] text-cc-muted hover:bg-cc-hover/40"
              >
                {group.tabs.length - shown.length} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** How Idle is listed on a leader's Home, remembered in this browser. */
export function useIdleView(): [IdleView, (view: IdleView) => void] {
  const [view, setView] = useState<IdleView>(() => (scopedGetItem(IDLE_VIEW_KEY) === "topic" ? "topic" : "recent"));
  return [
    view,
    (next) => {
      setView(next);
      scopedSetItem(IDLE_VIEW_KEY, next);
    },
  ];
}

const IDLE_VIEW_KEY = "cc-home-idle-view";

/**
 * When this browser last showed a leader's Home: read when Home opens, and written when it closes,
 * so the line about what changed stays put while the user reads.
 */
export function useLastLooked(leaderId: string): number | null {
  const key = `cc-home-seen:${leaderId}`;
  const [seen] = useState(() => {
    const stored = Number(scopedGetItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  useEffect(() => {
    const save = () => scopedSetItem(key, String(Date.now()));
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [key]);
  return seen;
}

/**
 * What changed in a leader's threads since `since`: quests that finished, new answers and new
 * questions; null when nothing did or the user never looked before.
 */
export function changesSince(
  threads: readonly PrimaryThreadChip[],
  since: number | null,
): { finished: number; answers: number; questions: number } | null {
  if (since === null) return null;
  const changed = threads.filter((tab) => (tab.groupChangedAt ?? tab.updatedAt) > since);
  const counts = {
    finished: changed.filter((tab) => tab.completed && !tab.needsInput && !tab.blueNudge).length,
    answers: changed.filter((tab) => tab.blueNudge && !tab.needsInput).length,
    questions: changed.filter((tab) => tab.needsInput).length,
  };
  return counts.finished + counts.answers + counts.questions > 0 ? counts : null;
}

/** "Since you last looked (3:05 PM): 2 finished · 1 new answer · 1 question". */
export function SinceLastLooked({ threads, since }: { threads: readonly PrimaryThreadChip[]; since: number | null }) {
  const changes = changesSince(threads, since);
  if (!changes || since === null) return null;
  const parts = [
    changes.questions ? `${changes.questions} ${changes.questions === 1 ? "question" : "questions"}` : null,
    changes.answers ? `${changes.answers} new ${changes.answers === 1 ? "answer" : "answers"}` : null,
    changes.finished ? `${changes.finished} finished` : null,
  ].filter(Boolean);
  const sameDay = new Date(since).toDateString() === new Date().toDateString();
  const when = new Date(since).toLocaleString([], {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <p className="px-1 pb-2 text-[12.5px] text-cc-muted" data-testid="home-since-last-looked">
      Since you last looked ({when}): <span className="text-cc-fg">{parts.join(" · ")}</span>
    </p>
  );
}
