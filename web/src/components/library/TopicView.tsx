import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicSummary } from "../../../shared/library-topics.js";
import { NOW_ITEM_STALE_MS, type NowItemStatus, nowSectionOf } from "../../../shared/topic-now-items.js";
import { artifactApi } from "../../api/artifacts.js";
import { topicApi } from "../../api/topics.js";
import { openLibraryArtifact, openTopicLibrary } from "../../utils/library-nav.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { InlineLocalImagesContext } from "../inline-local-images.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";

/**
 * A topic's page, for deciding what to do next and seeing what happened lately. From the top: the
 * name with its one-sentence summary, the topic's quests still open (live), the Scribe's page (Now,
 * then Recent, newest first), and the newest artifacts with a link to all of them in the gallery. Rename and merge sit in a menu; corrections go through the leader.
 */

const REFRESH_MS = 20_000;
const IMAGE_REFRESH_MS = 60_000;
const ARTIFACTS_SHOWN = 3;

export function TopicView({
  id,
  topics,
  onBack,
  onChanged,
  embedded = false,
  leaderId,
  bottomRoom = 0,
}: {
  id: string;
  topics: TopicSummary[];
  onBack: () => void;
  onChanged: () => void;
  /** Inside the topic side panel, which has its own header and back button. */
  embedded?: boolean;
  /** The leader whose panel shows the page: Update now goes to its Scribe, the gallery is its own. */
  leaderId?: string;
  /** Extra room at the bottom, so an expanded composer covering the panel's lower part hides nothing. */
  bottomRoom?: number;
}) {
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [artifacts, setArtifacts] = useState<{ items: ArtifactSummary[]; total: number }>({ items: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(() => {
    topicApi
      .get(id)
      .then((next) => {
        setDetail(next);
        setError(null);
        if (!next.questIds.length) return setArtifacts({ items: [], total: 0 });
        return artifactApi
          .list({ threads: next.questIds, limit: ARTIFACTS_SHOWN })
          .then((list) => setArtifacts({ items: list.artifacts, total: list.total }));
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
  const { lead, body } = splitPage(detail.page);
  const open = (detail.quests ?? []).filter((quest) => quest.status !== "done");
  return (
    <TopicFrame onBack={onBack} embedded={embedded}>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 [&>*]:max-w-3xl"
        style={bottomRoom ? { paddingBottom: `calc(2rem + ${bottomRoom}px)` } : undefined}
        data-testid="topic-view"
      >
        <TopicHeader detail={detail} others={topics.filter((topic) => topic.id !== detail.id)} act={act} />
        {lead && (
          <p className="mt-1 text-[14px] leading-snug text-cc-muted" data-testid="topic-lead">
            {plainText(lead)}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-cc-muted">
          <span>
            {detail.questIds.length} quest{detail.questIds.length === 1 ? "" : "s"}
            {detail.writtenAt ? ` · page updated ${clock(detail.writtenAt)}` : ""}
          </span>
          {detail.pendingEvents > 0 && (
            <span>
              · {detail.pendingEvents} new event{detail.pendingEvents === 1 ? "" : "s"} ·{" "}
              <button
                type="button"
                onClick={() => act(topicApi.updateNow(detail.id, leaderId), "Updating the page…")}
                className="text-cc-primary hover:underline"
              >
                Update now
              </button>
            </span>
          )}
        </div>
        {notice && <div className="mt-1 text-[13px] text-cc-muted">{notice}</div>}
        {error && <div className="mt-1 text-[13px] text-cc-error">{error}</div>}

        {open.length > 0 && (
          <section className="mt-4" data-testid="topic-open-quests">
            <h3 className="mb-1 text-[11px] uppercase tracking-wide text-cc-muted">Open quests</h3>
            <MarkdownContent
              text={open
                .map(
                  (quest) =>
                    `- [${quest.questId}](quest:${quest.questId}) ${quest.title} · ${statusLabel(quest.status)}`,
                )
                .join("\n")}
              questLinkSurface="chat-feed"
            />
          </section>
        )}

        <div className="mt-3" data-testid="topic-page">
          {body ? (
            // Pages show local images inline, re-read each minute: monitors rewrite plots in place.
            <InlineLocalImagesContext.Provider
              value={{ sessionId: leaderId, refreshKey: String(Math.floor(Date.now() / IMAGE_REFRESH_MS)) }}
            >
              <TopicPageBody
                body={body}
                status={detail.nowItems ?? []}
                onDone={leaderId ? (key, done) => act(topicApi.nowDone(detail.id, key, leaderId, done)) : undefined}
              />
            </InlineLocalImagesContext.Provider>
          ) : (
            <p className="text-[14px] text-cc-muted">The page is being written.</p>
          )}
        </div>

        {artifacts.items.length > 0 && (
          <section className="mt-5" data-testid="topic-artifacts">
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className="text-[11px] uppercase tracking-wide text-cc-muted">Latest artifacts</h3>
              <button
                type="button"
                onClick={() =>
                  openTopicLibrary(leaderId ?? null, { id: detail.id, name: detail.name, questIds: detail.questIds })
                }
                className="ml-auto text-[13px] text-cc-primary hover:underline"
              >
                All {artifacts.total} in the gallery ›
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {artifacts.items.map((artifact) => (
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

        <p className="mt-6 text-[12px] text-cc-muted">
          Something wrong or missing on this page? Tell your leader; it passes it to the Scribe.
        </p>
      </div>
    </TopicFrame>
  );
}

/**
 * The page, with each Now item showing when it appeared (muted after a week without news) and a
 * button to mark it done, which tells the Scribe.
 */
function TopicPageBody({
  body,
  status,
  onDone,
}: {
  body: string;
  status: NowItemStatus[];
  onDone?: (key: string, done: boolean) => void;
}) {
  const section = nowSectionOf(body);
  const byKey = new Map(status.map((item) => [item.key, item]));
  // Items marked done are off the page; they show struck through, with Undo, for a day.
  const done = status.filter(
    (item) => item.doneAt !== undefined && item.text && !section?.items.some((i) => i.key === item.key),
  );
  if (!section && !done.length) return <MarkdownContent text={body} questLinkSurface="chat-feed" />;
  const groups = nowGroups(section?.items ?? [], byKey);
  return (
    <>
      <MarkdownContent text={section ? section.before : body} questLinkSurface="chat-feed" />
      <div className="mb-3 mt-1 flex flex-col gap-2" data-testid="topic-now-items">
        {groups.map((group) => (
          <div key={group.label || "-"} data-testid="topic-now-group">
            {group.label && <div className="text-[12.5px] font-medium text-cc-muted">{group.label}</div>}
            <ul className="mt-0.5 flex flex-col gap-1.5">
              {group.items.map((item) => (
                <NowItemRow
                  key={item.key}
                  text={item.text}
                  status={byKey.get(item.key)}
                  onDone={onDone}
                  itemKey={item.key}
                />
              ))}
            </ul>
          </div>
        ))}
        {done.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {done.map((item) => (
              <NowItemRow key={item.key} text={item.text!} status={item} onDone={onDone} itemKey={item.key} />
            ))}
          </ul>
        )}
      </div>
      {section?.after && <MarkdownContent text={section.after} questLinkSurface="chat-feed" />}
    </>
  );
}

/**
 * Now items grouped by their label ("In progress", "Next"), in the order the page first uses
 * each label, newest first within a group; the label shows once as the group's heading instead
 * of on each item. Items without a label come first.
 */
function nowGroups(
  items: ReadonlyArray<{ key: string; text: string }>,
  status: ReadonlyMap<string, NowItemStatus>,
): Array<{ label: string; items: Array<{ key: string; text: string }> }> {
  const groups = new Map<string, Array<{ key: string; text: string; since: number }>>();
  for (const item of items) {
    const match = /^\*\*([^*]+?):?\*\*:?\s*/.exec(item.text);
    const label = match ? match[1]!.replace(/:$/, "").trim() : "";
    const group = groups.get(label) ?? [];
    group.push({
      key: item.key,
      text: match ? item.text.slice(match[0].length) : item.text,
      since: status.get(item.key)?.since ?? 0,
    });
    groups.set(label, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
  return ordered.map(([label, group]) => ({ label, items: [...group].sort((a, b) => b.since - a.since) }));
}

function NowItemRow({
  itemKey,
  text,
  status,
  onDone,
}: {
  itemKey: string;
  text: string;
  status?: NowItemStatus;
  onDone?: (key: string, done: boolean) => void;
}) {
  const done = !!status?.doneAt;
  const stale = !done && !!status && Date.now() - status.lastNews > NOW_ITEM_STALE_MS;
  return (
    <li className="flex items-start gap-2" data-testid="topic-now-item" data-stale={stale || undefined}>
      <span aria-hidden="true" className="mt-[0.6em] h-[6px] w-[6px] shrink-0 rounded-full bg-cc-fg/80" />
      <div className="min-w-0 flex-1">
        <div className={done ? "line-through opacity-50" : stale ? "opacity-60" : ""}>
          <MarkdownContent text={text} questLinkSurface="chat-feed" />
        </div>
        {status && (
          <div className="text-[12px] text-cc-muted">
            {done ? (
              <>
                Marked done {when(status.doneAt!)}.{" "}
                {onDone && (
                  <button
                    type="button"
                    onClick={() => onDone(itemKey, false)}
                    className="text-cc-primary hover:underline"
                  >
                    Undo
                  </button>
                )}
              </>
            ) : stale ? (
              `No news since ${when(status.lastNews)}`
            ) : (
              `Since ${when(status.since)}`
            )}
          </div>
        )}
      </div>
      {onDone && !done && (
        <button
          type="button"
          onClick={() => onDone(itemKey, true)}
          aria-label="Mark done"
          title="Mark done"
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          data-testid="topic-now-done"
        >
          <svg
            viewBox="0 0 20 20"
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7.25" />
            <path d="m7 10.2 2 2 4-4.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </li>
  );
}

/** "Oct 24, 3:22 PM". */
function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The name, with Rename and Merge in a small menu rather than on the page. */
function TopicHeader({
  detail,
  others,
  act,
}: {
  detail: TopicDetail;
  others: TopicSummary[];
  act: (action: Promise<unknown>) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (renaming !== null) {
    return (
      <form
        className="flex gap-2"
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
    );
  }
  return (
    <div className="relative flex items-start gap-2">
      <h2 className="min-w-0 flex-1 text-[22px] font-semibold leading-tight text-cc-fg">{detail.name}</h2>
      <button
        type="button"
        aria-label="Topic actions"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className="h-8 w-8 shrink-0 rounded-lg text-[18px] leading-none text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-9 z-10 flex w-64 flex-col gap-1 rounded-lg border border-cc-border bg-cc-card p-2 text-[13px] shadow-lg"
          data-testid="topic-actions"
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setRenaming(detail.name);
            }}
            className="rounded px-2 py-1 text-left text-cc-fg hover:bg-cc-hover"
          >
            Rename
          </button>
          {others.length > 0 && (
            <select
              aria-label="Merge into another topic"
              value=""
              onChange={(event) => {
                setMenuOpen(false);
                if (event.target.value) act(topicApi.merge(detail.id, event.target.value));
              }}
              className="takode-native-select rounded-md border border-cc-border bg-cc-card px-2 py-1 text-[13px] text-cc-fg"
            >
              <option value="">Merge into…</option>
              {others.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/** The page's opening sentence (before the first heading), and the rest. */
export function splitPage(page: string | null): { lead: string; body: string } {
  if (!page) return { lead: "", body: "" };
  if (page.startsWith("#")) return { lead: "", body: page.trim() };
  const heading = page.search(/\n#/);
  return heading < 0
    ? { lead: page.trim(), body: "" }
    : { lead: page.slice(0, heading).trim(), body: page.slice(heading).trim() };
}

/** Markdown as plain text: link labels kept, emphasis marks dropped. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function statusLabel(status: string): string {
  if (status === "in_progress") return "in progress";
  if (status === "refined" || status === "idea") return "not started";
  return status;
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

function clock(at: number): string {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
