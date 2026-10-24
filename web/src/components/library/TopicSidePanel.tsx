import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestTopicMap, TopicListResponse } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { openLeaderLibrary } from "../../utils/library-nav.js";
import {
  setTopicPanelOpen,
  setTopicSheetOpen,
  useTopicPanel,
  useTopicPanelOpen,
  useTopicSheetOpen,
} from "../../utils/topic-panel.js";
import { backdropClickProps } from "../../utils/backdrop-click.js";
import { usePreviewSheetHistoryEntry } from "../quest-preview-sheet-history.js";
import { SplitHandle, useSplitWidth } from "../SplitHandle.js";
import { ChangeList, LeaderSwitches, RenameSuggestions, TopicRow, TopicView } from "./TopicPage.js";
import { navigateToSession } from "../../utils/routing.js";
import type { ScribeActivity } from "../../../shared/library-topics.js";
import { CollapseIcon, GalleryIcon, TopicIcon } from "./library-icons.js";

const REFRESH_MS = 20_000;

/**
 * The topic of a leader's quest tab, for the panel to follow and for the rail and strip to name;
 * null on Main or for a quest not filed under a topic.
 */
export function useQuestTopic(leaderId: string, threadKey: string): QuestTopicMap[string] | null {
  const [topic, setTopic] = useState<QuestTopicMap[string] | null>(null);
  useEffect(() => {
    setTopic(null);
    if (!threadKey.startsWith("q-")) return;
    let cancelled = false;
    topicApi
      .questMap(leaderId, [threadKey])
      .then((response) => !cancelled && setTopic(response.map[threadKey] ?? null))
      .catch((error: Error) => console.warn("[library] Could not look up the tab's topic:", error.message));
    return () => {
      cancelled = true;
    };
  }, [leaderId, threadKey]);
  return topic;
}

/**
 * A leader's topic pages beside its conversation (a sheet on phones). It follows the quest tab on
 * screen: a quest filed under a topic shows that topic's page, and Main or an unfiled quest shows
 * the leader's topics to choose from. The artifact gallery opens on demand from its header.
 */
export function TopicSidePanel({
  leaderId,
  threadKey,
  variant,
}: {
  leaderId: string;
  threadKey: string;
  variant: "docked" | "sheet";
}) {
  const [data, setData] = useState<TopicListResponse | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followed = useQuestTopic(leaderId, threadKey);
  const focus = useTopicPanel((state) => (state.focus?.leaderId === leaderId ? state.focus : null));

  const load = useCallback(() => {
    topicApi
      .list("", leaderId)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [leaderId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Switching tabs shows the new tab's topic again; a topic asked for elsewhere shows that one.
  useEffect(() => setChosen(null), [threadKey]);
  useEffect(() => {
    if (focus) setChosen(focus.topicId);
  }, [focus]);

  // "" means the list was chosen over the tab's topic.
  const shown = chosen ?? followed?.id ?? null;
  const close = () => (variant === "sheet" ? setTopicSheetOpen(leaderId, false) : setTopicPanelOpen(leaderId, false));
  const sheetRef = useRef<HTMLDivElement>(null);
  // On phones the back gesture closes the sheet.
  usePreviewSheetHistoryEntry(variant === "sheet", sheetRef, close);
  const act = (action: Promise<unknown>) => void action.then(load).catch((reason: Error) => setError(reason.message));
  const collapses = variant === "docked";

  const body = (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-cc-border px-3 py-2 text-[13px]">
        {shown ? (
          <button type="button" onClick={() => setChosen("")} className="text-cc-muted hover:text-cc-fg">
            ‹ All topics
          </button>
        ) : (
          <span className="font-medium text-cc-fg">Topics</span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => openLeaderLibrary(leaderId)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-cc-primary hover:bg-cc-hover"
          title="Open the gallery of what this leader and its workers made"
        >
          <GalleryIcon className="h-3.5 w-3.5" /> Artifacts
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={collapses ? "Collapse topics" : "Close topics"}
          title={collapses ? "Collapse" : "Close"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        >
          {collapses ? <CollapseIcon className="h-4 w-4" /> : "✕"}
        </button>
      </div>
      {data?.scribe && data.scribe.activity.state !== "off" && <ScribeStatusLine activity={data.scribe.activity} />}
      {error && <div className="px-3 py-2 text-[13px] text-cc-error">{error}</div>}
      {data && <RenameSuggestions data={data} act={act} />}
      {shown ? (
        <TopicView
          id={shown}
          topics={data?.topics ?? []}
          onBack={() => setChosen("")}
          onChanged={load}
          embedded
          leaderId={leaderId}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="topic-panel-list">
          {!data ? (
            <div className="px-3 py-4 text-[13px] text-cc-muted">Loading…</div>
          ) : (
            <>
              <LeaderSwitches data={data} leaderId={leaderId} act={act} />
              {data.changes.some((change) => !change.undone) && <ChangeList data={data} act={act} />}
              {threadKey.startsWith("q-") && (
                <div className="px-4 pt-2 text-[12.5px] text-cc-muted">{threadKey} isn't filed under a topic yet.</div>
              )}
              {data.topics.map((topic) => (
                <TopicRow key={topic.id} topic={topic} selected={false} onOpen={() => setChosen(topic.id)} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );

  if (variant === "sheet") {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/25" {...backdropClickProps(close)} aria-hidden="true" />
        <div
          ref={sheetRef}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[82dvh] flex-col overflow-hidden rounded-t-2xl border-t border-cc-border bg-cc-bg shadow-2xl"
          role="dialog"
          aria-label="Topics"
          data-testid="topic-side-panel"
          data-variant="sheet"
        >
          <div className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-cc-border" aria-hidden="true" />
          {body}
        </div>
      </>
    );
  }
  return (
    <aside
      className="flex min-h-0 w-full flex-col border-l border-cc-border bg-cc-bg"
      aria-label="Topics"
      data-testid="topic-side-panel"
      data-variant="docked"
    >
      {body}
    </aside>
  );
}

/**
 * The topic panel's place beside a leader's conversation: on desktop the panel with a draggable
 * divider, or the slim rail when collapsed; on phones a sheet, while open.
 */
export function LeaderTopicPanel({
  leaderId,
  threadKey,
  desktop,
}: {
  leaderId: string;
  threadKey: string;
  desktop: boolean;
}) {
  const open = useTopicPanelOpen(leaderId);
  const sheetOpen = useTopicSheetOpen(leaderId);
  const split = useSplitWidth("topic-panel", { defaultWidth: 440, min: 320, max: 820, side: "right" });
  if (!desktop) return sheetOpen ? <TopicSidePanel leaderId={leaderId} threadKey={threadKey} variant="sheet" /> : null;
  if (!open) return <TopicRail leaderId={leaderId} threadKey={threadKey} />;
  return (
    <>
      <SplitHandle label="Resize the topic panel" {...split.handleProps} />
      <div style={split.style} className="flex min-h-0 w-[var(--split-w)] shrink-0">
        <TopicSidePanel leaderId={leaderId} threadKey={threadKey} variant="docked" />
      </div>
    </>
  );
}

/**
 * The collapsed topic panel: a slim rail at the right edge naming the topic of the tab on screen,
 * so it is always there to find and says what it would show. Its gallery icon opens the artifacts.
 */
function TopicRail({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const topic = useQuestTopic(leaderId, threadKey);
  return (
    <div
      className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-cc-border bg-cc-bg py-2"
      data-testid="topic-rail"
    >
      <button
        type="button"
        onClick={() => setTopicPanelOpen(leaderId, true)}
        className="flex min-h-0 flex-1 flex-col items-center gap-2 rounded-md px-1 py-1 text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label={topic ? `Show the topic ${topic.name}` : "Show topics"}
        title={topic ? `Topic: ${topic.name}` : "Topics"}
      >
        <TopicIcon className="h-4 w-4 shrink-0" />
        <span className="min-h-0 overflow-hidden text-[13px] text-cc-fg/85 [writing-mode:vertical-rl]">
          {topic ? topic.name : "Topics"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => openLeaderLibrary(leaderId)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label="Open the artifact gallery"
        title="Artifacts"
      >
        <GalleryIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * What the leader's Scribe is doing, live: "Filing 120 of 336 quests", "Updating T7 run…", "Up to
 * date". Tapping Scribe opens its session.
 */
function ScribeStatusLine({ activity }: { activity: ScribeActivity }) {
  const busy = activity.state === "filing" || activity.state === "updating" || activity.state === "starting";
  const quiet = activity.state === "paused" || activity.state === "over_budget";
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-cc-border px-3 py-1.5 text-[12.5px] text-cc-muted"
      data-testid="scribe-status"
      data-state={activity.state}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          busy ? "bg-cc-primary" : quiet ? "bg-cc-muted/50" : "bg-cc-success"
        }`}
      />
      <span className="min-w-0 flex-1 truncate">
        {activity.sessionId ? (
          <button
            type="button"
            onClick={() => navigateToSession(activity.sessionId!)}
            className="text-cc-primary hover:underline"
            title="Open the Scribe's session"
          >
            Scribe{activity.sessionNum != null ? ` #${activity.sessionNum}` : ""}
          </button>
        ) : (
          "Scribe"
        )}{" "}
        · <span className="text-cc-fg">{activity.text}</span>
      </span>
      {activity.progress && activity.progress.total > 0 && (
        <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-cc-border" aria-hidden="true">
          <span
            className="block h-full bg-cc-primary"
            style={{ width: `${Math.round((100 * activity.progress.done) / activity.progress.total)}%` }}
          />
        </span>
      )}
    </div>
  );
}
