import { useComposerScrollSpace } from "../ComposerFeedLayout.js";
import { Activity, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QuestTopicMap, TopicListResponse } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { openLeaderLibrary } from "../../utils/library-nav.js";
import { loadLeaderTopics, useKnownQuestTopic } from "../../utils/leader-topics.js";
import {
  nextKeptTopicPages,
  setTopicPanelOpen,
  setTopicSheetOpen,
  useTopicPanel,
  useTopicPanelOpen,
  useTopicSheetOpen,
} from "../../utils/topic-panel.js";
import { PhoneTopicFrame } from "./PhoneTopicFrame.js";
import { useStore } from "../../store.js";
import { usePreviewSheetHistoryEntry } from "../quest-preview-sheet-history.js";
import { SplitHandle, useSplitWidth } from "../SplitHandle.js";
import { ChangeList, RenameSuggestions, TopicSettings, TopicsOffHint } from "./TopicPage.js";
import { TopicActivityList } from "./TopicActivityList.js";
import { TopicView } from "./TopicView.js";
import { readTopicConversation } from "../../utils/topic-conversation.js";
import { navigateToSession } from "../../utils/routing.js";
import type { ScribeActivity } from "../../../shared/library-topics.js";
import { CollapseIcon, GalleryIcon, SettingsIcon, TopicIcon } from "./library-icons.js";

const REFRESH_MS = 20_000;

/**
 * The topic of a leader's quest tab, for the panel to follow and for the rail and strip to name;
 * null on Main or for a quest not filed under a topic.
 */
export function useQuestTopic(leaderId: string, threadKey: string): QuestTopicMap[string] | null {
  // Read from what the tab bar already loaded for every tab, so the topic shows with the quest
  // strip; asked again in the background in case the quest was filed meanwhile.
  const known = useKnownQuestTopic(leaderId, threadKey);
  useEffect(() => {
    if (!threadKey.startsWith("q-")) return;
    loadLeaderTopics(leaderId, [threadKey]).catch((error: Error) =>
      console.warn("[library] Could not look up the tab's topic:", error.message),
    );
  }, [leaderId, threadKey]);
  return threadKey.startsWith("q-") ? (known ?? null) : null;
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
  phone,
}: {
  leaderId: string;
  threadKey: string;
  variant: "docked" | "sheet";
  /** On phones: whether it is open (or closing), and where it starts. */
  phone?: { open: boolean; top: number; onHidden: () => void };
}) {
  const [data, setData] = useState<TopicListResponse | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const followed = useQuestTopic(leaderId, threadKey);
  // An expanded desktop composer can cover the panel's lower part; the feed gets the same room.
  const composerRoom = useComposerScrollSpace(`topic-panel:${leaderId}`);
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
  // Compared in render, not in effects: effects re-run whenever a hidden panel is shown again,
  // which must not undo the user's choice.
  const [seen, setSeen] = useState<{ threadKey: string; focus: typeof focus }>({ threadKey, focus: null });
  if (seen.threadKey !== threadKey || seen.focus !== focus) {
    setSeen({ threadKey, focus });
    if (focus && focus !== seen.focus) setChosen(focus.topicId);
    else if (seen.threadKey !== threadKey) setChosen(null);
  }

  // "" means the list was chosen over the tab's topic.
  const shown = chosen ?? followed?.id ?? null;
  // Recently shown pages stay mounted, hidden, so going back to one keeps its scroll position.
  const keptRef = useRef<ReturnType<typeof nextKeptTopicPages>>([]);
  const kept = (keptRef.current = nextKeptTopicPages(keptRef.current, shown || null));
  const close = () => (variant === "sheet" ? setTopicSheetOpen(leaderId, false) : setTopicPanelOpen(leaderId, false));
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // On phones the back gesture closes the sheet.
  usePreviewSheetHistoryEntry(variant === "sheet" && (phone?.open ?? true), sheetRef, close);
  const act = (action: Promise<unknown>) => void action.then(load).catch((reason: Error) => setError(reason.message));
  const collapses = variant === "docked";
  const topicsOn = !!data?.leaders.find((leader) => leader.sessionId === leaderId)?.enabled;

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
        {topicsOn && (
          <button
            type="button"
            onClick={() => {
              // Settings show above the topic list: from a topic page the gear goes there and opens them.
              setSettingsOpen((value) => (shown ? true : !value));
              setChosen("");
            }}
            aria-label="Topic settings"
            aria-expanded={settingsOpen && !shown}
            title="Topic settings: instructions for the Scribe, pause, turn off"
            className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-cc-hover hover:text-cc-fg ${
              settingsOpen && !shown ? "text-cc-fg" : "text-cc-muted"
            }`}
            data-testid="topic-settings-button"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        )}
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
      {[...kept]
        .sort((a, b) => a.seq - b.seq)
        .map(({ topicId }) => (
          <Activity key={topicId} mode={topicId === shown ? "visible" : "hidden"}>
            <TopicView
              bottomRoom={composerRoom}
              id={topicId}
              topics={data?.topics ?? []}
              onBack={() => setChosen("")}
              onChanged={load}
              embedded
              leaderId={leaderId}
              onReadConversation={(questIds) => {
                readTopicConversation(leaderId, questIds, threadKey);
                if (variant === "sheet") close();
              }}
            />
          </Activity>
        ))}
      <Activity mode={shown ? "hidden" : "visible"}>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={composerRoom ? { paddingBottom: composerRoom } : undefined}
          data-testid="topic-panel-list"
        >
          {!data ? (
            <div className="px-3 py-4 text-[13px] text-cc-muted">Loading…</div>
          ) : (
            <>
              <TopicsOffHint data={data} leaderId={leaderId} act={act} />
              {topicsOn && settingsOpen && (
                <TopicSettings data={data} leaderId={leaderId} act={act} onClose={() => setSettingsOpen(false)} />
              )}
              <ChangeList data={data} act={act} />
              {threadKey.startsWith("q-") && (
                <div className="px-4 pt-2 text-[12.5px] text-cc-muted">{threadKey} isn't filed under a topic yet.</div>
              )}
              <TopicActivityList topics={data.topics} onOpen={setChosen} />
            </>
          )}
        </div>
      </Activity>
    </>
  );

  if (variant === "sheet") {
    return (
      <PhoneTopicFrame
        open={phone?.open ?? true}
        top={phone?.top ?? 0}
        onClose={close}
        onHidden={phone?.onHidden ?? noop}
        frameRef={sheetRef}
      >
        {body}
      </PhoneTopicFrame>
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
  phoneTopRef,
}: {
  leaderId: string;
  threadKey: string;
  desktop: boolean;
  /** On phones: an element whose top is where the panel starts (just under the thread strip). */
  phoneTopRef?: RefObject<HTMLElement | null>;
}) {
  const open = useTopicPanelOpen(leaderId);
  const sheetOpen = useTopicSheetOpen(leaderId);
  const split = useSplitWidth("topic-panel", { defaultWidth: 440, min: 320, max: 820, side: "right" });
  // Once opened, the phone sheet stays mounted while dismissed, so reopening shows the same page
  // where it was left; hidden, it runs no effects (no refreshes, no back-gesture entry).
  const [sheetMounted, setSheetMounted] = useState(sheetOpen);
  if (sheetOpen && !sheetMounted) setSheetMounted(true);
  // A closed sheet stays shown while it slides away.
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(sheetOpen);
  if (wasOpen !== sheetOpen) {
    setWasOpen(sheetOpen);
    setLeaving(!sheetOpen);
  }
  const onHidden = useCallback(() => setLeaving(false), []);
  const top = usePhoneTop(phoneTopRef, !desktop && (sheetOpen || leaving));
  if (!desktop) {
    if (!sheetMounted) return null;
    return (
      <Activity mode={sheetOpen || leaving ? "visible" : "hidden"}>
        <TopicSidePanel
          leaderId={leaderId}
          threadKey={threadKey}
          variant="sheet"
          phone={{ open: sheetOpen, top, onHidden }}
        />
      </Activity>
    );
  }
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
 * What the leader's Scribe is doing, live: "Sorting recent work into topics: 120 of 336 quests", "Updating T7 run…", "Up to
 * date". Tapping Scribe opens its session.
 */
function ScribeStatusLine({ activity }: { activity: ScribeActivity }) {
  const busy = activity.state === "initializing" || activity.state === "updating" || activity.state === "starting";
  const quiet = activity.state === "paused";
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

/** Where the phone panel starts: the top of `ref`, kept current while the panel shows. */
function usePhoneTop(ref: RefObject<HTMLElement | null> | undefined, active: boolean): number {
  const [top, setTop] = useState(0);
  const zoom = useStore((state) => state.zoomLevel) || 1;
  useLayoutEffect(() => {
    if (!active || !ref?.current) return;
    // The app is scaled by its zoom level, and fixed positions are laid out inside that scale.
    const measure = () => setTop(Math.max(0, (ref.current?.getBoundingClientRect().top ?? 0) / zoom));
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    // The conversation below the marker shrinks when the strip above it grows.
    const below = ref.current.nextElementSibling ?? ref.current.parentElement;
    if (below) observer?.observe(below);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [active, ref, zoom]);
  return top;
}

function noop() {}
