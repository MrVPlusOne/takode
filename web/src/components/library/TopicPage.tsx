import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import { artifactApi } from "../../api/artifacts.js";
import { topicApi } from "../../api/topics.js";
import { openLibraryArtifact } from "../../utils/library-nav.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";

/**
 * The parts of a leader's topic panel: the per-leader switch and the pause, the latest tidying the
 * page writer did (each with Undo), a topic's row in the list, and a topic's page with its quests
 * and what was made. Topic pages are kept current on the server, so an open page refreshes itself.
 */

const REFRESH_MS = 20_000;

export function LeaderSwitches({ data, act }: { data: TopicListResponse; act: (action: Promise<unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const enabled = data.leaders.filter((leader) => leader.enabled);
  const suggested = data.leaders.filter((leader) => leader.suggest);
  const space = data.topics[0]?.space ?? enabled[0]?.space ?? data.leaders[0]?.space;
  return (
    <div className="border-b border-cc-border px-4 py-2 text-[13px]">
      {suggested.map((leader) => (
        <div
          key={leader.sessionId}
          className="mb-2 rounded-lg border border-cc-border bg-cc-card px-3 py-2"
          data-testid="topic-hint"
        >
          <div className="text-cc-fg">
            #{leader.sessionNum} {leader.name} has {leader.questCount} quests. Group them by topic?
          </div>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => act(topicApi.setLeaderEnabled(leader.sessionId, true))}
              className="rounded-md bg-cc-primary px-2.5 py-1 text-white"
            >
              Turn on
            </button>
            <button
              type="button"
              onClick={() => act(topicApi.dismissHint(leader.sessionId))}
              className="rounded-md px-2.5 py-1 text-cc-muted hover:bg-cc-hover"
            >
              Not now
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 text-cc-muted">
        <span className="min-w-0 flex-1 truncate">
          {enabled.length
            ? `Topics on for ${enabled.map((leader) => `#${leader.sessionNum ?? "?"}`).join(", ")}`
            : "Topics are off for every leader"}
          {data.paused ? " · pages paused" : data.budget.overBudget ? " · pages wait for budget" : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 text-cc-primary hover:underline"
        >
          {open ? "Done" : "Settings"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="topic-settings">
          {data.leaders.map((leader) => (
            <label key={leader.sessionId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={leader.enabled}
                onChange={(event) => act(topicApi.setLeaderEnabled(leader.sessionId, event.target.checked))}
              />
              <span className="min-w-0 flex-1 truncate text-cc-fg">
                #{leader.sessionNum} {leader.name}
              </span>
              <span className="text-cc-muted">{leader.questCount} quests</span>
            </label>
          ))}
          {space && (
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={!data.paused}
                onChange={(event) => act(topicApi.setPaused(space, !event.target.checked))}
              />
              <span className="text-cc-fg">Keep pages up to date</span>
              <span className="ml-auto text-cc-muted">
                {data.budget.limit > 0
                  ? `${Math.round((100 * data.budget.used) / Math.max(1, data.budget.limit / 0.1))}% of leaders' use today`
                  : ""}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function ChangeList({ data, act }: { data: TopicListResponse; act: (action: Promise<unknown>) => void }) {
  return (
    <div className="border-b border-cc-border px-4 py-2" data-testid="topic-changes">
      {/* Undone changes have nothing left to act on. */}
      {data.changes
        .filter((change) => !change.undone)
        .slice(0, 3)
        .map((change) => (
          <div key={change.id} className="flex items-center gap-2 py-0.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-cc-fg">{change.text}</span>
            <button
              type="button"
              onClick={() => act(topicApi.undo(change.id))}
              className="shrink-0 text-cc-primary hover:underline"
            >
              Undo
            </button>
          </div>
        ))}
    </div>
  );
}

export function TopicRow({ topic, selected, onOpen }: { topic: TopicSummary; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full gap-3 border-b border-cc-border px-4 py-2.5 text-left ${selected ? "bg-cc-active" : "hover:bg-cc-hover"}`}
      data-testid="library-topic-row"
    >
      <span
        className={`w-[3px] shrink-0 self-stretch rounded ${topic.tentative ? "bg-cc-border" : "bg-cc-status-done"}`}
      />
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 text-[15px] ${topic.tentative ? "text-cc-muted" : "text-cc-fg"}`}>
          <span className="min-w-0 truncate">{topic.name}</span>
          {topic.tentative && (
            <span className="shrink-0 rounded border border-cc-border px-1 text-[11px] text-cc-muted">new</span>
          )}
        </span>
        {topic.summary && <span className="mt-0.5 line-clamp-2 text-[13.5px] text-cc-fg/90">{topic.summary}</span>}
        <span className="mt-0.5 block text-[12.5px] text-cc-muted">
          {topic.questIds.length} quest{topic.questIds.length === 1 ? "" : "s"}
          {topic.pendingEvents ? ` · ${topic.pendingEvents} new` : ""} · {ago(topic.updatedAt)}
        </span>
      </span>
    </button>
  );
}

export function TopicView({
  id,
  topics,
  onBack,
  onChanged,
  embedded = false,
}: {
  id: string;
  topics: TopicSummary[];
  onBack: () => void;
  onChanged: () => void;
  /** Inside the topic side panel, which has its own header and back button. */
  embedded?: boolean;
}) {
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [fix, setFix] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(() => {
    topicApi
      .get(id)
      .then((next) => {
        setDetail(next);
        setError(null);
        if (next.questIds.length) {
          return artifactApi.list({ threads: next.questIds, limit: 30 }).then((list) => setArtifacts(list.artifacts));
        }
        setArtifacts([]);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  useEffect(() => {
    if (loadedFor.current !== id) {
      setDetail(null);
      setNotice(null);
      loadedFor.current = id;
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [id, load]);

  const act = (action: Promise<unknown>, message?: string) =>
    void action
      .then(() => {
        if (message) setNotice(message);
        load();
        onChanged();
      })
      .catch((reason: Error) => setError(reason.message));

  if (!detail) {
    return (
      <TopicFrame onBack={onBack} embedded={embedded}>
        <p className="p-4 text-[13px] text-cc-muted">{error ?? "Loading…"}</p>
      </TopicFrame>
    );
  }
  const others = topics.filter((topic) => topic.id !== detail.id);
  return (
    <TopicFrame onBack={onBack} embedded={embedded}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 [&>*]:max-w-3xl" data-testid="topic-view">
        <div className="flex items-start gap-2">
          {renaming === null ? (
            <h2 className="min-w-0 flex-1 text-[22px] font-semibold leading-tight text-cc-fg">{detail.name}</h2>
          ) : (
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (renaming.trim()) act(topicApi.rename(detail.id, renaming));
                setRenaming(null);
              }}
            >
              <input
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                aria-label="Topic name"
                className="min-w-0 flex-1 rounded-lg border border-cc-border bg-cc-card px-2 py-1 text-base text-cc-fg outline-none focus:border-cc-primary/60"
              />
              <button type="submit" className="rounded-lg px-2 text-[13px] text-cc-primary">
                Save
              </button>
            </form>
          )}
          {renaming === null && (
            <button
              type="button"
              onClick={() => setRenaming(detail.name)}
              className="h-8 shrink-0 rounded-lg px-2 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            >
              Rename
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-cc-muted">
          <span>
            {detail.questIds.length} quest{detail.questIds.length === 1 ? "" : "s"}
            {detail.upToDateAt ? ` · up to date as of ${clock(detail.upToDateAt)}` : ""}
          </span>
          {(detail.pendingEvents > 0 || !detail.page) && (
            <span>
              · {detail.pendingEvents} new event{detail.pendingEvents === 1 ? "" : "s"} ·{" "}
              <button
                type="button"
                onClick={() => act(topicApi.updateNow(detail.id), "Updating the page…")}
                className="text-cc-primary hover:underline"
              >
                Update now
              </button>
            </span>
          )}
        </div>
        {notice && <div className="mt-1 text-[13px] text-cc-muted">{notice}</div>}
        {error && <div className="mt-1 text-[13px] text-cc-error">{error}</div>}

        <div className="mt-3" data-testid="topic-page">
          {detail.page ? (
            <MarkdownContent text={detail.page} />
          ) : (
            <p className="text-[14px] text-cc-muted">The page is being written.</p>
          )}
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!fix.trim()) return;
            act(topicApi.feedback(detail.id, fix), "Sent; the page will be corrected shortly.");
            setFix("");
          }}
        >
          <input
            value={fix}
            onChange={(event) => setFix(event.target.value)}
            placeholder="Something wrong or missing? Say what to fix"
            aria-label="Fix this page"
            className="min-w-0 flex-1 rounded-lg border border-cc-border bg-cc-card px-3 py-2 text-base text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60 md:text-sm"
          />
          <button type="submit" className="rounded-lg px-3 text-[13px] text-cc-primary">
            Send
          </button>
        </form>

        {artifacts.length > 0 && (
          <section className="mt-5" data-testid="topic-artifacts">
            <h3 className="mb-1 text-[11px] uppercase tracking-wide text-cc-muted">Made</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              {artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  showKind
                  showSpace={false}
                  onOpen={() => openLibraryArtifact(artifact.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-5">
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-cc-muted">Quests</h3>
          {(detail.quests ?? detail.questIds.map((questId) => ({ questId, title: "", status: "" }))).map((quest) => (
            <div key={quest.questId} className="flex items-center gap-2 py-1 text-[14px]">
              <span className="shrink-0 text-cc-muted">{quest.questId}</span>
              <span className="min-w-0 flex-1 truncate text-cc-fg">{quest.title}</span>
              {others.length > 0 && (
                <select
                  aria-label={`Move ${quest.questId} to another topic`}
                  value=""
                  onChange={(event) => event.target.value && act(topicApi.move(quest.questId, event.target.value))}
                  className="takode-native-select w-24 shrink-0 rounded-md border border-cc-border bg-cc-card px-1 py-0.5 text-[12px] text-cc-muted"
                >
                  <option value="">Move…</option>
                  {others.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </section>

        {others.length > 0 && (
          <div className="mt-5 flex items-center gap-2 text-[13px] text-cc-muted">
            <span>Same subject as another topic?</span>
            <select
              aria-label="Merge into another topic"
              value=""
              onChange={(event) => event.target.value && act(topicApi.merge(detail.id, event.target.value))}
              className="takode-native-select min-w-0 flex-1 rounded-md border border-cc-border bg-cc-card px-2 py-1 text-[13px] text-cc-fg"
            >
              <option value="">Merge into…</option>
              {others.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </TopicFrame>
  );
}

function TopicFrame({
  onBack,
  embedded,
  children,
}: {
  onBack: () => void;
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-cc-border">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1 px-3 pt-2 text-[13px] text-cc-muted hover:text-cc-fg md:hidden"
      >
        ‹ Topics
      </button>
      {children}
    </div>
  );
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function clock(at: number): string {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
