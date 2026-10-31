import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicStands, TopicSummary } from "../../../shared/library-topics.js";
import { artifactApi } from "../../api/artifacts.js";
import { topicApi } from "../../api/topics.js";
import { openTopicLibrary } from "../../utils/library-nav.js";
import { openArtifact } from "../../utils/side-column.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { InlineLocalImagesContext } from "../inline-local-images.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";
import { TopicQuestPicker } from "./TopicQuestPicker.js";
import { pageSections, TopicSection, useCollapsedSections } from "./topic-page-sections.js";
import { questOf, questionText, useTopicQuestions } from "./topic-questions.js";

/**
 * A topic's page, for deciding what to do next and seeing what happened lately. From the top: the
 * name with its one-sentence summary, where it stands (a few lines the Scribe rewrites on every
 * update, so nothing on it needs ticking off), the user's open questions in its quests and the
 * quests still open (both live), the Scribe's page (History, with the sections that fit the topic),
 * then two lists Takode keeps from the topic's records: the newest artifacts with a link to all of
 * them in the gallery, and the quest log of its finished quests. Every section but the questions
 * folds at its heading. Rename, merge and the user's requests for the page sit in a menu;
 * corrections go through the leader.
 */

const REFRESH_MS = 20_000;
const IMAGE_REFRESH_MS = 60_000;
const ARTIFACTS_SHOWN = 3;
const HISTORY_SHOWN = 5;
const QUEST_LOG_SHOWN = 5;

export function TopicView({
  id,
  topics,
  onBack,
  onChanged,
  embedded = false,
  leaderId,
  bottomRoom = 0,
  onReadConversation,
  conversationOnScreen = false,
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
  /** Opens the topic's conversation (its quests read as one) in the leader's feed. */
  onReadConversation?: () => void;
  /** Whether the topic's conversation is what the leader's feed shows. */
  conversationOnScreen?: boolean;
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
  const sections = useCollapsedSections(id);
  // Pages show local images inline, re-read each minute: monitors rewrite plots in place. A stable
  // value spares the page's Markdown a re-render on every refresh of the panel.
  const refreshKey = String(Math.floor(Date.now() / IMAGE_REFRESH_MS));
  const pictures = useStablePictures(detail?.pictures);
  const inlineImages = useMemo(
    () => ({ sessionId: leaderId, refreshKey, modifiedAt: pictures }),
    [leaderId, refreshKey, pictures],
  );

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
  const quests = [...(detail.quests ?? [])].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0));
  const open = quests.filter((quest) => quest.status !== "done");
  const finished = quests
    .filter((quest) => quest.status === "done")
    .sort((a, b) => (b.completedAt ?? b.changedAt ?? 0) - (a.completedAt ?? a.changedAt ?? 0));
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
            detail.questIds.length > 0 &&
            (conversationOnScreen ? (
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
                onClick={() => onReadConversation()}
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
        <WhereItStands stands={detail.stands ?? []} />
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
          <div className="mt-4">
            <TopicSection
              title={`Open quests · ${open.length}`}
              size="meta"
              // In the side column the overview above lists what runs, so the topic's open quests fold.
              collapsed={sections.isCollapsed("Open quests", embedded)}
              onToggle={() => sections.toggle("Open quests", embedded)}
              testId="topic-open-quests"
            >
              <QuestList quests={open} />
            </TopicSection>
          </div>
        )}

        <div className="mt-3" data-testid="topic-page">
          {body && detail.picturesNewerThanText && (
            // Pictures the page shows were redrawn after its text: say so until the Scribe catches up.
            <p
              className="mb-2 rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2 text-[13px] text-cc-muted"
              data-testid="topic-pictures-newer"
            >
              Some pictures here were redrawn after the text about them was written. The Scribe is updating it.
            </p>
          )}
          {body ? (
            <InlineLocalImagesContext.Provider value={inlineImages}>
              <TopicPageBody
                body={body}
                sections={sections}
                // The side column keeps the page short: the newest History lines, the rest folded.
                historyShown={embedded ? HISTORY_SHOWN : undefined}
              />
            </InlineLocalImagesContext.Provider>
          ) : (
            // A written page may be just its summary: History holds only events outside quests, which
            // the quest log below covers.
            !detail.writtenAt && <p className="text-[14px] text-cc-muted">The page is being written.</p>
          )}
        </div>

        {artifacts.items.length > 0 && (
          <div className="mt-5">
            <TopicSection
              title="Latest artifacts"
              size="meta"
              collapsed={sections.isCollapsed("Latest artifacts")}
              onToggle={() => sections.toggle("Latest artifacts")}
              testId="topic-artifacts"
              aside={
                <button
                  type="button"
                  onClick={() =>
                    openTopicLibrary(leaderId ?? null, { id: detail.id, name: detail.name, questIds: detail.questIds })
                  }
                  className="text-[13px] text-cc-primary hover:underline"
                >
                  All {artifacts.total} in the gallery ›
                </button>
              }
            >
              <div className="grid grid-cols-3 gap-2">
                {artifacts.items.map((artifact) => (
                  <ArtifactCard
                    key={artifact.id}
                    artifact={artifact}
                    showKind
                    showSpace={false}
                    onOpen={(event) => openArtifact({ id: artifact.id, title: artifact.title }, event)}
                  />
                ))}
              </div>
            </TopicSection>
          </div>
        )}

        {finished.length > 0 && (
          // The finished quests with their one-line wrap-ups, from the quests themselves: the Scribe
          // doesn't restate them in History.
          <div className="mt-5">
            <TopicSection
              title={`Quest log · ${finished.length}`}
              size="meta"
              collapsed={sections.isCollapsed("Quest log")}
              onToggle={() => sections.toggle("Quest log")}
              testId="topic-quest-log"
            >
              <QuestLog quests={finished} shown={QUEST_LOG_SHOWN} />
            </TopicSection>
          </div>
        )}

        <p className="mt-6 text-[12px] text-cc-muted">
          Something wrong or missing on this page? Tell your leader; it passes it to the Scribe.
        </p>
      </div>
    </TopicFrame>
  );
}

/** The page's sections: a leading Status or "Latest …" section first, as the Scribe wrote them. */
function TopicPageBody({
  body,
  sections,
  historyShown,
}: {
  body: string;
  sections: ReturnType<typeof useCollapsedSections>;
  /** How many History lines show before the older ones fold; all when unset. */
  historyShown?: number;
}) {
  const section = (part: ReturnType<typeof pageSections>[number], index: number) =>
    part.title === null ? (
      <MarkdownContent key={index} text={part.text} questLinkSurface="chat-feed" />
    ) : (
      <TopicSection
        key={index}
        title={plainText(part.title)}
        collapsed={sections.isCollapsed(part.title)}
        onToggle={() => sections.toggle(part.title!)}
      >
        {historyShown !== undefined && /^history$/i.test(part.title.trim()) ? (
          <RecentHistory text={part.text} shown={historyShown} />
        ) : (
          <MarkdownContent text={part.text} questLinkSurface="chat-feed" />
        )}
      </TopicSection>
    );
  return <>{pageSections(body).map(section)}</>;
}

/**
 * Where the topic stands: the panel's leader's lines (its Scribe rewrites them on every update), and
 * other leaders' folded below. Plain lines, nothing to tick: an outdated line is simply rewritten.
 */
function WhereItStands({ stands }: { stands: TopicStands[] }) {
  const [othersOpen, setOthersOpen] = useState(false);
  if (!stands.length) return null;
  const [mine, ...others] = stands;
  return (
    <section className="mt-3 rounded-lg bg-cc-hover/40 px-3 py-2" data-testid="topic-stands">
      <ul className="flex flex-col gap-1 text-[14px] text-cc-fg">
        {mine!.lines.map((line, index) => (
          <li key={index} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-[0.6em] h-[5px] w-[5px] shrink-0 rounded-full bg-cc-fg/70" />
            <span className="min-w-0 flex-1">
              <MarkdownContent text={line} questLinkSurface="chat-feed" />
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setOthersOpen((open) => !open)}
            aria-expanded={othersOpen}
            className="text-[12.5px] text-cc-muted hover:text-cc-fg"
            data-testid="topic-stands-others"
          >
            {othersOpen ? "▾" : "›"} From other leaders ({others.length})
          </button>
          {othersOpen &&
            others.map((stand) => (
              <ul key={stand.leaderId} className="mt-1 flex flex-col gap-1 text-[13px] text-cc-muted">
                {stand.lines.map((line, index) => (
                  <li key={index}>
                    <MarkdownContent text={`#${stand.leaderNum ?? "?"} · ${line}`} questLinkSurface="chat-feed" />
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </section>
  );
}

/** Finished quests, newest first, each with its date and one-line wrap-up; older ones folded. */
function QuestLog({ quests, shown }: { quests: NonNullable<TopicDetail["quests"]>; shown: number }) {
  const [all, setAll] = useState(false);
  const visible = all ? quests : quests.slice(0, shown);
  const day = (at?: number) =>
    at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <>
      <MarkdownContent
        text={visible
          .map(
            (quest) =>
              `- **${day(quest.completedAt ?? quest.changedAt)}** · [${quest.questId}](quest:${quest.questId}) ${quest.title}${quest.wrapUp ? `: ${quest.wrapUp}` : ""}`,
          )
          .join("\n")}
        questLinkSurface="chat-feed"
      />
      {!all && quests.length > shown && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 text-[13px] text-cc-muted hover:text-cc-fg"
          data-testid="topic-quest-log-older"
        >
          › {quests.length - shown} older
        </button>
      )}
    </>
  );
}

/**
 * A History section's newest lines (it is newest first), with the older ones folded behind a button
 * until asked for.
 */
function RecentHistory({ text, shown }: { text: string; shown: number }) {
  const [all, setAll] = useState(false);
  const { lead, items } = listItems(text);
  const older = items.length - shown;
  if (older <= 0 || all) return <MarkdownContent text={text} questLinkSurface="chat-feed" />;
  return (
    <>
      <MarkdownContent
        text={[lead, ...items.slice(0, shown)].filter(Boolean).join("\n")}
        questLinkSurface="chat-feed"
      />
      <button
        type="button"
        onClick={() => setAll(true)}
        className="mt-1 text-[13px] text-cc-muted hover:text-cc-fg"
        data-testid="topic-history-older"
      >
        › {older} older {older === 1 ? "entry" : "entries"}
      </button>
    </>
  );
}

/** Splits Markdown into the text before its list and the list's top-level items (each with its own lines). */
export function listItems(text: string): { lead: string; items: string[] } {
  const lead: string[] = [];
  const items: string[] = [];
  for (const line of text.split("\n")) {
    if (/^[-*+] /.test(line)) items.push(line);
    else if (items.length > 0) items[items.length - 1] += `\n${line}`;
    else lead.push(line);
  }
  return { lead: lead.join("\n").trim(), items };
}

/** Quests as linked lines with their state, in the order given. */
function QuestList({ quests }: { quests: NonNullable<TopicDetail["quests"]> }) {
  return (
    <MarkdownContent
      text={quests
        .map((quest) => `- [${quest.questId}](quest:${quest.questId}) ${quest.title} · ${statusLabel(quest.status)}`)
        .join("\n")}
      questLinkSurface="chat-feed"
    />
  );
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

/** The page's picture times, the same object while they don't change, so the page doesn't re-render. */
function useStablePictures(pictures: Record<string, number> | undefined): Record<string, number> | undefined {
  const ref = useRef(pictures);
  if (JSON.stringify(ref.current) !== JSON.stringify(pictures)) ref.current = pictures;
  return ref.current;
}
