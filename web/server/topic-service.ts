import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { STORYTELLER_BUDGET_SHARE, TOPIC_HINT_QUEST_COUNT, type TopicLeaderState } from "../shared/library-topics.js";
import type { TopicStore } from "./topic-store.js";

/**
 * Keeps topic pages current, close to real time. Events (a quest filed or finished, the user's
 * messages in a quest's tab, a saved artifact, a fix the user asked for) mark their topic
 * changed; about a minute after the first one, the space's page writer (a hidden agent session)
 * is asked to update the changed topics, reading only what is new. Its spend stays within a
 * share of the leaders' own spend in the space, and each space can be paused. Only leaders with
 * topics turned on are read.
 */

export interface TopicSessionLike {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  state: { treeGroupId?: string | null; isGenerating?: boolean };
}

export interface TopicLeaderInfo {
  sessionId: string;
  sessionNum: number | null;
  name: string;
  space: string;
  isOrchestrator: boolean;
  archived: boolean;
}

export interface TopicServiceDeps {
  getSession: (sessionId: string) => TopicSessionLike | undefined;
  getLeaderInfo: (sessionId: string) => TopicLeaderInfo | undefined;
  listLeaders: () => TopicLeaderInfo[];
  sessionNum: (sessionId: string) => number | null;
  listQuests: () => Promise<QuestmasterTask[]>;
  /** Sends text to a session as an injected message; false when it could not be delivered. */
  inject: (sessionId: string, text: string) => boolean;
  /** Starts the hidden page writer of a space in the leader's tree group; returns its session ID. */
  createWriter: (space: string, treeGroupId: string | undefined) => Promise<string>;
  isWriterAlive: (sessionId: string) => boolean;
  /** About how many tokens the writer's conversation holds. */
  writerContextTokens: (sessionId: string) => number;
  /** Ends a page writer whose conversation grew long; the next request starts a fresh one. */
  retireWriter: (sessionId: string) => Promise<void>;
  /** Tells browsers the topics changed. */
  broadcastChanged: () => void;
  now?: () => number;
}

/** Events wait this long for more before the page writer is asked. */
export const TOPIC_UPDATE_DELAY_MS = 60_000;
/** A request the page writer hasn't answered is sent again after this long. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const SPEND_WINDOW_MS = 24 * 60 * 60_000;
/**
 * A page writer whose conversation holds more than this is replaced before its next request: each
 * update needs only the guide and what is new, while a long conversation is reread (and paid for)
 * on every update.
 */
export const WRITER_CONTEXT_LIMIT = 100_000;
const EXCERPT_CHARS = 280;

export class TopicService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Space to when the page writer was last asked, while it hasn't written since. */
  private requested = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    readonly store: TopicStore,
    private readonly deps: TopicServiceDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  /** Reads new messages of a leader with topics on: the user's messages in a quest tab are events. */
  sessionSaved(sessionId: string): void {
    if (!this.store.loaded || !this.store.isLeaderEnabled(sessionId)) return;
    const session = this.deps.getSession(sessionId);
    if (!session) return;
    const history = session.messageHistory;
    const start = Math.min(this.store.cursorFor(sessionId) ?? history.length, history.length);
    for (let index = start; index < history.length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
      const threadKey = leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]);
      if (!threadKey.startsWith("q-")) continue;
      const topic = this.store.topicOfQuest(threadKey);
      if (!topic) continue;
      const text = typeof message.content === "string" ? message.content : "";
      this.event(topic.id, topic.space, {
        at: typeof message.timestamp === "number" ? message.timestamp : this.now(),
        kind: "message",
        questId: threadKey,
        sessionId,
        messageIndex: index,
        text: excerpt(text),
      });
    }
    this.store.setCursor(sessionId, history.length);
    void this.store.flush();
  }

  /** A quest changed: finishing one under a topic is an event. */
  questChanged(quest: QuestmasterTask): void {
    if (!this.store.loaded || quest.status !== "done") return;
    const topic = this.store.topicOfQuest(quest.questId);
    if (!topic) return;
    const already = topic.events.some((event) => event.kind === "quest_done" && event.questId === quest.questId);
    if (already) return;
    this.event(topic.id, topic.space, {
      at: this.now(),
      kind: "quest_done",
      questId: quest.questId,
      text: quest.title,
    });
    void this.store.flush();
  }

  /** A new artifact version saved in a quest's tab is an event for that quest's topic. */
  artifactSaved(input: { sessionId: string; threadKey: string; title: string; kind: string; version: number }): void {
    if (!this.store.loaded || !input.threadKey.startsWith("q-")) return;
    const topic = this.store.topicOfQuest(input.threadKey);
    if (!topic) return;
    this.event(topic.id, topic.space, {
      at: this.now(),
      kind: "artifact",
      questId: input.threadKey,
      sessionId: input.sessionId,
      text: `${input.kind} "${input.title}"${input.version > 1 ? ` v${input.version}` : ""}`,
    });
    void this.store.flush();
  }

  /** The user asked for a fix on a topic's page; the page writer gets it right away. */
  feedback(topicId: string, text: string): void {
    const topic = this.store.resolve(topicId);
    if (!topic) return;
    this.store.addEvent(topic.id, { at: this.now(), kind: "feedback", text: excerpt(text, 2000) });
    void this.store.flush();
    void this.ask(topic.space, { force: true });
  }

  /** Records an event and schedules the space's update about a minute after the first pending one. */
  event(topicId: string, space: string, event: Parameters<TopicStore["addEvent"]>[1]): void {
    this.store.addEvent(topicId, event);
    this.deps.broadcastChanged();
    this.schedule(space);
  }

  schedule(space: string, delay = TOPIC_UPDATE_DELAY_MS): void {
    if (this.timers.has(space)) return;
    const timer = setTimeout(() => {
      this.timers.delete(space);
      void this.ask(space);
    }, delay);
    timer.unref?.();
    this.timers.set(space, timer);
  }

  // ─── Asking the page writer ───────────────────────────────────────────────

  /**
   * Asks the space's page writer to update every topic with pending events. `force` (the user's
   * Update now or a fix request) skips the pause and the budget.
   */
  async ask(
    space: string,
    options: { force?: boolean; topicId?: string } = {},
  ): Promise<"asked" | "nothing" | "paused" | "over_budget" | "busy"> {
    const topics = this.store
      .list(space)
      .filter((topic) => topic.pendingEvents > 0 && (!options.topicId || topic.id === options.topicId));
    const folds = options.topicId ? [] : this.store.foldCandidates(space);
    if (topics.length === 0 && folds.length === 0) return "nothing";
    if (!options.force) {
      if (this.store.isPaused(space)) return "paused";
      if (this.budget(space).overBudget) return "over_budget";
      const askedAt = this.requested.get(space);
      if (askedAt !== undefined && this.now() - askedAt < REQUEST_TIMEOUT_MS) return "busy";
    }
    const writer = await this.ensureWriter(space);
    const lines = [
      `[Library] Update the topic pages of the ${space} space. Your guide: \`takode topic guide\`.`,
      "",
      ...topics.map(
        (topic) =>
          `- "${topic.name}" (${topic.id.slice(0, 8)}): ${topic.pendingEvents} new event${topic.pendingEvents === 1 ? "" : "s"}${topic.upToDateAt === null ? ", no page yet" : ""}. Run \`takode topic changes ${topic.id.slice(0, 8)}\`.`,
      ),
      ...(folds.length
        ? [
            "",
            "Tentative topics nothing joined in a day; fold each into a better topic if one fits (`takode topic merge <from> <into> --fold`), otherwise leave it:",
            ...folds.map((topic) => `- "${topic.name}" (${topic.id.slice(0, 8)})`),
          ]
        : []),
    ];
    if (!this.deps.inject(writer, lines.join("\n"))) return "busy";
    this.requested.set(space, this.now());
    return "asked";
  }

  /** A page was written: the writer answered, so the next events may ask again. */
  pageWritten(space: string): void {
    this.requested.delete(space);
    this.deps.broadcastChanged();
    // Events that arrived while the writer worked get their own update.
    if (this.store.list(space).some((topic) => topic.pendingEvents > 0)) this.schedule(space);
  }

  /** Turns topics on for a leader; the first time, its last month of quests is filed into topics. */
  async setLeaderEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator) throw new Error("Topics can be turned on only for leaders.");
    const { needsBackfill } = this.store.setLeaderEnabled(sessionId, enabled);
    const session = this.deps.getSession(sessionId);
    if (enabled && session) this.store.setCursor(sessionId, session.messageHistory.length);
    await this.store.flush();
    this.deps.broadcastChanged();
    if (!enabled || !needsBackfill) return;
    const writer = await this.ensureWriter(leader.space, session?.state.treeGroupId ?? undefined);
    const delivered = this.deps.inject(
      writer,
      [
        `[Library] Topics were turned on for leader #${leader.sessionNum ?? "?"} "${leader.name}" in the ${leader.space} space.`,
        `File its quests from the last 30 days into topics: \`takode topic quests --leader ${sessionId.slice(0, 8)} --unfiled\` lists them.`,
        "Choose a few clear topics in the user's words (subjects they would look for later), file each quest with `takode topic set q-N \"<topic>\"`, then write each topic's page.",
        "Your guide: `takode topic guide`.",
      ].join("\n"),
    );
    if (delivered) {
      this.store.markBackfilled(sessionId);
      this.requested.set(leader.space, this.now());
      await this.store.flush();
    }
  }

  private async ensureWriter(space: string, treeGroupId?: string): Promise<string> {
    const existing = this.store.writerFor(space);
    if (existing && this.deps.isWriterAlive(existing)) {
      // Never replace a writer that may still be working on a request.
      if (this.requested.has(space) || this.deps.writerContextTokens(existing) <= WRITER_CONTEXT_LIMIT) return existing;
      this.store.recordRetiredSpend(space, sessionSpend(this.deps.getSession(existing), this.now() - SPEND_WINDOW_MS));
      await this.deps.retireWriter(existing);
    }
    const group =
      treeGroupId ??
      this.deps
        .listLeaders()
        .filter((leader) => leader.space === space && this.store.isLeaderEnabled(leader.sessionId))
        .map((leader) => this.deps.getSession(leader.sessionId)?.state.treeGroupId ?? undefined)
        .find((id) => !!id);
    const sessionId = await this.deps.createWriter(space, group);
    this.store.setWriter(space, sessionId);
    await this.store.flush();
    this.deps.inject(sessionId, writerIntroduction(space));
    return sessionId;
  }

  // ─── Budget and leader states ─────────────────────────────────────────────

  /** The page writer's spend over the last day against a share of the topic-enabled leaders' spend. */
  budget(space: string): { used: number; limit: number; overBudget: boolean } {
    const since = this.now() - SPEND_WINDOW_MS;
    const leaders = this.deps
      .listLeaders()
      .filter((leader) => leader.space === space && this.store.isLeaderEnabled(leader.sessionId));
    const leaderSpend = leaders.reduce(
      (sum, leader) => sum + sessionSpend(this.deps.getSession(leader.sessionId), since),
      0,
    );
    const writer = this.store.writerFor(space);
    const used =
      (writer ? sessionSpend(this.deps.getSession(writer), since) : 0) + this.store.retiredSpend(space, since);
    const limit = leaderSpend * STORYTELLER_BUDGET_SHARE;
    // With no measured leader spend yet (a fresh day or backend without usage), do not block the first updates.
    return { used, limit, overBudget: limit > 0 && used > limit };
  }

  async leaderStates(): Promise<TopicLeaderState[]> {
    const quests = await this.deps.listQuests();
    const counts = new Map<string, number>();
    for (const quest of quests) {
      const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
      if (leaderId) counts.set(leaderId, (counts.get(leaderId) ?? 0) + 1);
    }
    return this.deps
      .listLeaders()
      .filter((leader) => !leader.archived)
      .map((leader) => {
        const enabled = this.store.isLeaderEnabled(leader.sessionId);
        const questCount = counts.get(leader.sessionId) ?? 0;
        return {
          sessionId: leader.sessionId,
          sessionNum: leader.sessionNum,
          name: leader.name,
          space: leader.space,
          enabled,
          questCount,
          suggest: !enabled && questCount >= TOPIC_HINT_QUEST_COUNT && !this.store.hintDismissed(leader.sessionId),
        };
      });
  }
}

/**
 * Spend of a session since a time, from its turns' token usage, weighted roughly like Claude's
 * prices (cache reads cheap, output dear), so leaders and the page writer compare fairly.
 */
export function sessionSpend(session: TopicSessionLike | undefined, since: number): number {
  if (!session) return 0;
  let spend = 0;
  // Results carry no time of their own: walking back, a result counts once its turn's earlier
  // timed message is found inside the window.
  let unplaced = 0;
  for (let index = session.messageHistory.length - 1; index >= 0; index -= 1) {
    const message = session.messageHistory[index] as { type?: string; timestamp?: number; data?: { usage?: Usage } };
    if (message.type === "result" && message.data?.usage) unplaced += weightedTokens(message.data.usage);
    if (typeof message.timestamp !== "number") continue;
    if (message.timestamp < since) return spend;
    spend += unplaced;
    unplaced = 0;
  }
  return spend + unplaced;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function weightedTokens(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0) +
    5 * (usage.output_tokens ?? 0)
  );
}

function excerpt(text: string, limit = EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

/** The first message of a new page writer. */
function writerIntroduction(space: string): string {
  return [
    `[Library] You keep the Library's topic pages for the ${space} space. You never talk to the user and never change quests, artifacts or memory: you write topic pages and, when it clearly helps, tidy topics.`,
    "Read your guide now with `takode topic guide`, and again whenever you are unsure. Requests to update pages will follow; between them, stay idle.",
  ].join("\n");
}

/** What `takode topic guide` prints for the page writer. */
export const PAGE_WRITER_GUIDE = `# Writing topic pages

A topic groups a leader's quests about one subject, named in the user's words. Its page is where the
user starts days later: what is going on, what they decided, what was made, and what happened, every
line linked to where it came from. You never talk to the user and never change quests, artifacts or
memory.

## When asked to update topics

1. For each topic named, run \`takode topic changes <topic>\`. It shows the page as it is and what
   happened since: quests filed or finished, the user's messages in those quests' tabs (their
   decisions), saved artifacts, and fixes the user asked for. Read only what you need more of, with
   \`takode read <session> <index>\` for a message and \`quest show q-N\` for a quest.
2. Write the whole page to a file and save it: \`takode topic write-page <topic> --file <path>\`.
   Keep what is still true from the old page; change what the events changed.

## The page

\`\`\`
## Where it stands
2-4 sentences: the current state and what comes next.

## Open now
Live quests and anything waiting for the user. Leave the section out when nothing is open.

## Your decisions
- Oct 23 · "the user's exact words" ([message](session:2957:6115)), and what it decided.

## Made
- [T7 thread update](quest:q-2713), post, 3 versions. (Artifacts come from \`takode topic changes\`
  and \`takode artifact list --query ...\`.)

## What happened
- **Oct 23** · Twin plots redrawn by data trained ([q-2713](quest:q-2713)).
\`\`\`

- Link every line: messages as \`[label](session:N:index)\` with the session number and history
  index \`takode topic changes\` shows, quests as \`[q-N](quest:q-N)\`.
- Quote the user's decisions exactly; never paraphrase them as if they were quotes.
- Newest first in "What happened"; condense older days to one line each.
- Plain words for the user. No internal jargon, no IDs beyond the links.

## Tidying topics

Only when it clearly helps, and at most a few changes per update; the user sees each one as a line
with Undo.
- Fold a tentative topic that nothing joined into a better-fitting one:
  \`takode topic merge <from> <into> --fold\`.
- Merge two topics about the same subject: \`takode topic merge <from> <into>\`.
- Rename an unclear name you or a leader chose: \`takode topic rename <topic> "<name>"\`. A name the
  user chose cannot be renamed; mention a suggestion on the page instead.
- Move a quest filed under the wrong topic: \`takode topic move q-N "<topic>"\`.

## Filing a leader's recent quests

When topics are turned on for a leader, run \`takode topic quests --leader <id> --unfiled\`, look at
existing topics with \`takode topic list\`, and file each quest with \`takode topic set q-N "<topic>"\`.
Prefer a few clear topics, each a subject the user would look for (for example "T7 run" rather than
"Find 12B coding captain duties"); one quest per topic only when nothing else fits. Then write each
topic's page.

## Cost

Read only what is new and what you need. A busy topic gets more; a quiet one should cost little.
`;
