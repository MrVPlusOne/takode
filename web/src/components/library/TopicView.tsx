import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicSummary } from "../../../shared/library-topics.js";
import { NOW_ENTRY_STALE_MS, NOW_GROUPS, type NowEntry, nowGroupLabel } from "../../../shared/topic-now-items.js";
import { artifactApi } from "../../api/artifacts.js";
import { topicApi } from "../../api/topics.js";
import { openLibraryArtifact, openTopicLibrary } from "../../utils/library-nav.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { InlineLocalImagesContext } from "../inline-local-images.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";
import { TopicQuestPicker } from "./TopicQuestPicker.js";
import { questOf, questionText, useTopicQuestions } from "./topic-questions.js";

/**
 * A topic's page, for deciding what to do next and seeing what happened lately. From the top: the
 * name with its one-sentence summary, the user's open questions in its quests and the quests still
 * open (both live), the Scribe's page (Now
 * and History, with the sections that fit the topic), and the newest artifacts with a link to all of
 * them in the gallery. Rename, merge and the user's requests for the page sit in a menu; corrections
 * go through the leader.
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
  onReadConversation,
  conversationQuestId = null,
  currentQuestId = null,
  onOpenQuest,
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
  /** Reads the topic's quests as one conversation in the leader's feed. */
  onReadConversation?: (questIds: string[]) => void;
  /** The quest tab on screen when it shows its topic as one conversation. */
  conversationQuestId?: string | null;
  /** The quest whose tab is on screen. */
  currentQuestId?: string | null;
  /** Opens one of the topic's quests in its tab. */
  onOpenQuest?: (questId: string) => void;
}) {
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [artifacts, setArtifacts] = useState<{ items: ArtifactSummary[]; total: number }>({ items: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const { questionsOf, openQuestion } = useTopicQuestions();
  // Pages show local images inline, re-read each minute: monitors rewrite plots in place. A stable
  // value spares the page's Markdown a re-render on every refresh of the panel.
  const refreshKey = String(Math.floor(Date.now() / IMAGE_REFRESH_MS));
  const inlineImages = useMemo(() => ({ sessionId: leaderId, refreshKey }), [leaderId, refreshKey]);

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
  const questions = questionsOf(detail.questIds);
  return (
    <TopicFrame onBack={onBack} embedded={embedded}>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 [&>*]:max-w-3xl"
        style={bottomRoom ? { paddingBottom: `calc(2rem + ${bottomRoom}px)` } : undefined}
        data-testid="topic-view"
      >
        <TopicHeader
          detail={detail}
          others={topics.filter((topic) => topic.id !== detail.id)}
          act={act}
          leaderId={leaderId}
        />
        {lead && (
          <p className="mt-1 text-[14px] leading-snug text-cc-muted" data-testid="topic-lead">
            {plainText(lead)}
          </p>
        )}
        <div className="relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-cc-muted">
          {onReadConversation &&
            detail.questIds.length > 1 &&
            (conversationQuestId && detail.questIds.includes(conversationQuestId) ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-md bg-cc-hover px-2.5 py-1 text-[13px] text-cc-muted"
                data-testid="topic-viewing-conversation"
              >
                <ConversationIcon className="h-3.5 w-3.5" />
                Viewing topic tab
              </span>
            ) : (
              // How Jiayi jumps to the topic's conversation most of the time, so a button, not a link.
              <button
                type="button"
                onClick={() => onReadConversation(detail.questIds)}
                className="inline-flex items-center gap-1.5 rounded-md border border-cc-primary/40 bg-cc-primary/10 px-2.5 py-1 text-[13px] font-medium text-cc-primary hover:bg-cc-primary/15"
                title="Read the topic's quests as one conversation"
                data-testid="topic-read-conversation"
              >
                <ConversationIcon className="h-3.5 w-3.5" />
                View topic tab
              </button>
            ))}
          <span className="inline-flex flex-wrap items-center gap-x-1">
            {onOpenQuest ? (
              <TopicQuestPicker
                quests={detail.quests ?? []}
                count={detail.questIds.length}
                currentQuestId={currentQuestId}
                onOpen={onOpenQuest}
              />
            ) : (
              `${detail.questIds.length} quest${detail.questIds.length === 1 ? "" : "s"}`
            )}
            {detail.writtenAt ? <span>· page updated {clock(detail.writtenAt)}</span> : null}
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

        {questions.length > 0 && (
          // The questions themselves, from the notifications: answering one removes it here.
          <section className="mt-4" data-testid="topic-questions">
            <h3 className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-cc-phase-accent-amber)]">
              {questions.length === 1 ? "A question for you" : `${questions.length} questions for you`}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {questions.map((entry) => (
                <li key={`${entry.sessionId}:${entry.notification.id}`}>
                  <button
                    type="button"
                    onClick={() => openQuestion(entry)}
                    className="flex w-full items-start gap-2 text-left text-[14px] text-cc-fg hover:underline"
                    data-testid="topic-question"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-cc-phase-accent-amber)]"
                    />
                    <span className="min-w-0 flex-1">
                      {questionText(entry)}
                      <span className="ml-1.5 text-[12px] text-cc-muted">
                        {questOf(entry)} · {clock(entry.notification.timestamp)} ›
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

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
            <InlineLocalImagesContext.Provider value={inlineImages}>
              <TopicPageBody
                body={body}
                entries={detail.now ?? []}
                leaderId={leaderId}
                onDone={leaderId ? (id, done) => act(topicApi.nowDone(detail.id, id, leaderId, done)) : undefined}
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
 * The page, with Now from the topic's entries: after a leading Status or "Latest …" section, else
 * first. The panel's leader's entries come first in fixed groups; other leaders' entries of a shared
 * topic are folded below them.
 */
function TopicPageBody({
  body,
  entries,
  leaderId,
  onDone,
}: {
  body: string;
  entries: NowEntry[];
  leaderId?: string;
  onDone?: (id: string, done: boolean) => void;
}) {
  const [othersOpen, setOthersOpen] = useState(false);
  const { first, rest } = splitLeadingSections(body);
  const mine = entries.filter((entry) => !leaderId || !entry.leaderId || entry.leaderId === leaderId);
  const others = entries.filter((entry) => !mine.includes(entry));
  return (
    <>
      {first && <MarkdownContent text={first} questLinkSurface="chat-feed" />}
      {entries.length > 0 && (
        <div className="mb-3" data-testid="topic-now">
          <MarkdownContent text="## Now" />
          <NowGroups entries={mine} onDone={onDone} />
          {others.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOthersOpen((open) => !open)}
                aria-expanded={othersOpen}
                className="text-[13px] text-cc-muted hover:text-cc-fg"
                data-testid="topic-now-others"
              >
                {othersOpen ? "▾" : "›"} From other leaders ({others.length})
              </button>
              {othersOpen && <NowGroups entries={others} onDone={onDone} showLeader />}
            </div>
          )}
        </div>
      )}
      {rest && <MarkdownContent text={rest} questLinkSurface="chat-feed" />}
    </>
  );
}

/** The page's leading Status and "Latest …" sections, which come before Now, and the rest. */
function splitLeadingSections(body: string): { first: string; rest: string } {
  const sections = body.split(/\n(?=## )/);
  let count = 0;
  while (count < sections.length && /^## +(Status|Latest\b.*)\s*$/m.test(sections[count]!.split("\n")[0]!)) count += 1;
  return { first: sections.slice(0, count).join("\n"), rest: sections.slice(count).join("\n") };
}

/** Entries in the fixed groups, newest first within each; entries marked done follow, struck through. */
function NowGroups({
  entries,
  onDone,
  showLeader = false,
}: {
  entries: NowEntry[];
  onDone?: (id: string, done: boolean) => void;
  showLeader?: boolean;
}) {
  const open = entries.filter((entry) => entry.doneAt === undefined);
  const done = entries.filter((entry) => entry.doneAt !== undefined);
  const groups = new Map<string, NowEntry[]>();
  for (const group of NOW_GROUPS) {
    for (const entry of open.filter((candidate) => candidate.group === group).sort((a, b) => b.since - a.since)) {
      const label = nowGroupLabel(entry);
      groups.set(label, [...(groups.get(label) ?? []), entry]);
    }
  }
  return (
    <div className="mt-1 flex flex-col gap-2" data-testid="topic-now-items">
      {[...groups.entries()].map(([label, group]) => (
        <div key={label} data-testid="topic-now-group">
          <div className="text-[12.5px] font-medium text-cc-muted">{label}</div>
          <ul className="mt-0.5 flex flex-col gap-1.5">
            {group.map((entry) => (
              <NowItemRow key={entry.id} entry={entry} onDone={onDone} showLeader={showLeader} />
            ))}
          </ul>
        </div>
      ))}
      {done.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {done.map((entry) => (
            <NowItemRow key={entry.id} entry={entry} onDone={onDone} showLeader={showLeader} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NowItemRow({
  entry,
  onDone,
  showLeader,
}: {
  entry: NowEntry;
  onDone?: (id: string, done: boolean) => void;
  showLeader: boolean;
}) {
  const done = entry.doneAt !== undefined;
  const stale = !done && Date.now() - entry.lastNews > NOW_ENTRY_STALE_MS;
  // Follow-ups are optional: shown quietly, never as something waiting on the user.
  const quiet = entry.group === "followup";
  const facts = [
    ...(showLeader && entry.leaderNum != null ? [`#${entry.leaderNum}`] : []),
    ...(entry.due ? [`Due ${dueDay(entry.due)}`] : []),
    stale ? `No news since ${when(entry.lastNews)}` : `Since ${when(entry.since)}`,
  ];
  return (
    <li
      className="flex items-start gap-2"
      data-testid="topic-now-item"
      data-stale={stale || undefined}
      data-quiet={quiet || undefined}
    >
      <span
        aria-hidden="true"
        className={`mt-[0.6em] h-[6px] w-[6px] shrink-0 rounded-full ${quiet ? "bg-cc-muted" : "bg-cc-fg/80"}`}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`${done ? "line-through opacity-50" : stale ? "opacity-60" : ""} ${quiet ? "text-cc-muted" : ""}`}
        >
          <MarkdownContent text={entry.text} questLinkSurface="chat-feed" />
        </div>
        <div className="text-[12px] text-cc-muted">
          {done ? (
            <>
              Marked done {when(entry.doneAt!)}.{" "}
              {onDone && (
                <button
                  type="button"
                  onClick={() => onDone(entry.id, false)}
                  className="text-cc-primary hover:underline"
                >
                  Undo
                </button>
              )}
            </>
          ) : (
            facts.join(" · ")
          )}
        </div>
      </div>
      {onDone && !done && (
        <button
          type="button"
          onClick={() => onDone(entry.id, true)}
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

/** "Nov 6", for a due date given as "YYYY-MM-DD". */
function dueDay(due: string): string {
  return new Date(`${due}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Oct 24, 3:22 PM". */
function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The name, with Rename, Merge and the user's requests for the page in a small menu rather than on
 * the page.
 */
function TopicHeader({
  detail,
  others,
  act,
  leaderId,
}: {
  detail: TopicDetail;
  others: TopicSummary[];
  act: (action: Promise<unknown>) => void;
  /** The panel's leader, whose Scribe hears about changed requests; without one they can't be edited. */
  leaderId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [requests, setRequests] = useState<string | null>(null);
  if (requests !== null && leaderId) {
    return (
      <PageRequestsEditor
        name={detail.name}
        text={requests}
        onChange={setRequests}
        onCancel={() => setRequests(null)}
        onSave={() => {
          act(topicApi.setPageRequests(detail.id, requests, leaderId));
          setRequests(null);
        }}
      />
    );
  }
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
          {leaderId && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setRequests(detail.instructions);
              }}
              className="rounded px-2 py-1 text-left text-cc-fg hover:bg-cc-hover"
            >
              Requests for this page
            </button>
          )}
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

/** What the user wants this page to keep, in their own words; the Scribe follows it on every update. */
function PageRequestsEditor({
  name,
  text,
  onChange,
  onCancel,
  onSave,
}: {
  name: string;
  text: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div data-testid="topic-page-requests">
      <h2 className="text-[22px] font-semibold leading-tight text-cc-fg">{name}</h2>
      <label htmlFor="topic-page-requests" className="mb-1 mt-2 block text-[12px] text-cc-muted">
        Requests for this page
      </label>
      <textarea
        id="topic-page-requests"
        autoFocus
        value={text}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="For example: keep a section with links to the two newest reports at the top."
        className="w-full resize-y rounded-lg border border-cc-border bg-cc-card px-2.5 py-1.5 text-base text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60 md:text-[13px]"
      />
      <div className="mt-1 flex justify-end gap-2 text-[13px]">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-cc-muted hover:text-cc-fg">
          Cancel
        </button>
        <button type="button" onClick={onSave} className="rounded-md bg-cc-primary px-2.5 py-1 text-white">
          Save
        </button>
      </div>
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

function ConversationIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
    </svg>
  );
}
