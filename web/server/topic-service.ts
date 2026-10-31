import { threadInteractionTimes } from "./topic-interaction.js";
import { topicIdOfViewKey } from "../shared/topic-thread-key.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestFeedbackEntry, QuestmasterTask } from "./quest-types.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import {
  TOPIC_COUNT_TARGET,
  type TopicEvent,
  type TopicLeaderState,
  type ScribeActivity,
  type ScribeOverview,
} from "../shared/library-topics.js";
import type { TopicStore } from "./topic-store.js";
import {
  initializationMessage,
  leaderNotice,
  reminderMessage,
  retryMessage,
  failureNotice,
  looseEndsNotice,
  updateMessage,
  type UpdateContent,
} from "./scribe-messages.js";

/**
 * Keeps topic pages current with one Scribe per leader that has topics on: a worker in that
 * leader's herd, running continuously like any worker. Events (the leader's quests put under a
 * topic or finished, the user's messages in those quests' tabs, artifacts saved there, changes
 * the user undid) are recorded on their topics. Whenever its Scribe is
 * idle, Takode sends it one message with everything that changed for its leader since the last
 * one; while it works, new events wait for its turn to end. If it stops with work of a message
 * left, it gets one reminder, and then its leader is told. Topics stay shared across the session
 * space, so pages can hold several leaders' work. The user can pause a Scribe.
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
  /** The leader's backend; its Scribe uses the same one unless Settings name another. */
  backendType?: string;
  /** The remote host the leader runs on; its Scribe runs there too. Unset: the coordinator's machine. */
  hostId?: string;
}

export interface TopicServiceDeps {
  getSession: (sessionId: string) => TopicSessionLike | undefined;
  getLeaderInfo: (sessionId: string) => TopicLeaderInfo | undefined;
  listLeaders: () => TopicLeaderInfo[];
  sessionNum: (sessionId: string) => number | null;
  /** The leader whose herd a session is in, or the session itself when it is a leader. */
  leaderOf: (sessionId: string) => string | undefined;
  listQuests: () => Promise<QuestmasterTask[]>;
  /** Sends text to a session as an injected message; false when it could not be delivered. */
  inject: (sessionId: string, text: string) => boolean;
  /** Starts a leader's Scribe as a worker in its herd; returns its session ID. */
  createScribe: (leader: TopicLeaderInfo) => Promise<string>;
  isScribeAlive: (sessionId: string) => boolean;
  /** The remote host a session runs on, or undefined on the coordinator's machine. */
  hostOf: (sessionId: string) => string | undefined;
  /** Whether the Scribe is working on a turn now. */
  isScribeBusy: (sessionId: string) => boolean;
  /** Archives a Scribe (its leader turned topics off). */
  retireScribe: (sessionId: string) => Promise<void>;
  /** Tells a leader something about its Scribe that needs it. */
  notifyLeader: (leaderId: string, text: string) => void;
  /** The text of a message by session number and history index, or null when it can't be read. */
  messageText: (sessionNum: number, index: number) => string | null;
  /** Tells browsers the topics changed. */
  broadcastChanged: () => void;
  /** Whether leaders get topics (Settings); on unless the user turned them off there. */
  topicsForLeaders?: () => boolean;
  /** A file's modification time on the leader's machine (its pages' images load from there), or null when missing. */
  fileModifiedAt?: (leaderId: string, path: string) => Promise<number | null>;
  /** The images in a folder on the leader's machine, with paths written the way the folder was. */
  listImages?: (leaderId: string, folder: string) => Promise<Array<{ path: string; mtimeMs: number }>>;
  now?: () => number;
}

/** A message whose turn never ended stops blocking the next one after this long. */
const STALE_DELIVERY_MS = 15 * 60_000;
/** Initialization sorts the leader's quests of this window. */
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Quiet topics listed for the Scribe to consider merging. */
const MAX_CONSOLIDATION_CANDIDATES = 12;
const EXCERPT_CHARS = 280;

/** The page format the brief describes; Scribes whose pages are older are asked once to rewrite them. */
export const PAGE_FORMAT = 9;

export type DeliveryResult = "sent" | "nothing" | "waiting" | "paused" | "busy" | "off";

/** How urgent an event kind is for its Scribe (see `TopicService.schedule`). */
type EventTiming = "ride" | "user" | "leader";

/** The user's own page actions ride along; their other actions and the leader's activity are scheduled. */
/**
 * Local image files a page shows: `src` as the page writes it (a path, absolute or home-relative,
 * or the server's image URL for one, as Scribes often write plots) and the file's `path`.
 */
export function pageImages(page: string | null): Array<{ src: string; path: string }> {
  if (!page) return [];
  const images = new Map<string, string>();
  for (const match of page.matchAll(/!\[[^\]]*\]\(\s*<?([^)>\s]+)>?\s*\)/g)) {
    const src = match[1]!;
    const path = src.startsWith(FILE_LINK_IMAGE) ? fileLinkImagePath(src) : /^[~/]/.test(src) ? src : null;
    if (path && IMAGE_FILE.test(path)) images.set(src, path);
  }
  return [...images].map(([src, path]) => ({ src, path }));
}

const FILE_LINK_IMAGE = "/api/fs/file-link/image?";

/** The file an image URL of the server names, when it is an absolute or home-relative path. */
function fileLinkImagePath(src: string): string | null {
  const params = new URLSearchParams(src.slice(FILE_LINK_IMAGE.length).replace(/&amp;/g, "&"));
  const path = params.get("path");
  return path && params.get("isRelative") !== "1" && /^[~/]/.test(path) ? path : null;
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;

function clockOf(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function eventTiming(kind: TopicEvent["kind"]): EventTiming {
  // A saved artifact or a note on a quest rarely changes a page by itself: they go with the next
  // message rather than waking the Scribe (a note often repeats a message of the user's anyway).
  if (kind === "now_done" || kind === "artifact" || kind === "note") return "ride";
  if (kind === "message" || kind === "undone") return "user";
  return "leader";
}

/** A burst of events waits for a pause this long before it goes, so a burst is one message. */
const DEBOUNCE_MS = 3 * 60_000;
/** No waiting event waits longer than this. */
const MAX_WAIT_MS = 10 * 60_000;
/** A Scribe older than this is replaced by a fresh one at its next message: its state lives in the store. */
const SCRIBE_FRESH_MS = 20 * 60 * 60_000;
/** The user's messages to other leaders go to a Scribe from this far back, the first time. */
const ELSEWHERE_FIRST_MS = 24 * 60 * 60_000;
/** At most this many of them go with one message, newest kept. */
const ELSEWHERE_MAX = 12;
/** A Scribe's loose-ends messages to its leader: messages a day, lines each, characters a line. */
const LOOSE_ENDS_PER_DAY = 3;
const LOOSE_ENDS_LINES_MAX = 5;
const LOOSE_END_MAX = 160;

/** After a Scribe's turn fails, its next message waits this long, doubling with each failure in a row. */
const FAILURE_BACKOFF_MS = 30_000;
/** The longest wait: while its turns keep failing, a Scribe is tried this often. */
const MAX_FAILURE_BACKOFF_MS = 30 * 60_000;
/** Failed turns in a row after which the leader is told, once until a turn finishes. */
const FAILURES_BEFORE_NOTICE = 3;

/** A message the Scribe got and has not finished a turn on yet. */
interface Delivery {
  /** When it, or its reminder or resend, last went: a turn that never ends stops blocking after a while. */
  sentAt: number;
  /** When the message first went. Work done since counts toward it, also work done before a reminder. */
  askedAt: number;
  purpose: "initialize" | "update";
  /** The message, sent again when the turn that took it was interrupted or failed. */
  text: string;
  /** It asked the Scribe to rewrite every page in the current format. */
  rewrite: boolean;
  /** Events up to this sequence number were in it. */
  throughSeq: number;
  topics: string[];
  reminded: boolean;
}

/** How a Scribe's turn ended: an interrupted or failed turn did not do what it was asked. */
export interface ScribeTurnOutcome {
  unfinished: boolean;
}

export class TopicService {
  /** Per leader: the message its Scribe is working on, until a turn of the Scribe ends. */
  private awaiting = new Map<string, Delivery>();
  /** Per leader: topics the user asked to have updated now, sent with the next message. */
  private forced = new Map<string, Set<string>>();
  /**
   * Per leader: the message its Scribe stopped on again after a reminder (shown in its status), until
   * a later finished turn leaves nothing of it or a new message goes.
   */
  private stalled = new Map<string, Delivery>();
  /**
   * Per leader whose Scribe's last turns failed: how many in a row, when it is tried again, the
   * message to send again then, and whether the leader was told. Without a wait, a Scribe whose
   * backend fails at once would be sent its message again and again.
   */
  private failing = new Map<string, { count: number; retryAt: number; resend?: Delivery; told: boolean }>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per leader: when its waiting events are due to go, and when the first of them came. */
  private dueAt = new Map<string, number>();
  private firstPendingAt = new Map<string, number>();
  private dueTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per leader: deliveries run one at a time, so two events never send two messages. */
  private chains = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  /** Per leader: its threads' interaction times, as of a history length, extended as messages arrive. */
  private interactions = new Map<string, { length: number; times: Map<string, number> }>();

  constructor(
    readonly store: TopicStore,
    private readonly deps: TopicServiceDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * When the user and each of a leader's threads last dealt with each other (`threadInteractionTimes`),
   * read once and then only for new messages; a shorter history (a revert) is read again.
   */
  interactionTimes(leaderId: string): ReadonlyMap<string, number> {
    const history = this.deps.getSession(leaderId)?.messageHistory ?? [];
    const cached = this.interactions.get(leaderId);
    const fresh = !cached || history.length < cached.length;
    const times = threadInteractionTimes(history, fresh ? 0 : cached.length, fresh ? new Map() : cached.times);
    this.interactions.set(leaderId, { length: history.length, times });
    return times;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  /**
   * Reads new messages of a leader with topics on: the user's messages in a quest tab or a topic's
   * own thread (its conversation) are events of that topic.
   */
  sessionSaved(sessionId: string): void {
    if (!this.store.loaded) return;
    if (!this.store.isLeaderEnabled(sessionId)) {
      // A leader that never had topics, a new one included, gets them now.
      void this.turnOnByDefault(sessionId);
      return;
    }
    const session = this.deps.getSession(sessionId);
    if (!session) return;
    const history = session.messageHistory;
    const start = Math.min(this.store.cursorFor(sessionId) ?? history.length, history.length);
    let recorded = false;
    for (let index = start; index < history.length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
      const threadKey = leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]);
      const handle = topicIdOfViewKey(threadKey);
      const topic = threadKey.startsWith("q-")
        ? this.store.topicOfQuest(threadKey)
        : handle
          ? this.store.resolveHandle(handle)
          : undefined;
      if (!topic) continue;
      // A comment-only message has its words in its comments.
      const text = formatAnnotatedMessage(
        typeof message.content === "string" ? message.content : "",
        "annotations" in message ? message.annotations : undefined,
      );
      this.store.addEvent(topic.id, {
        at: typeof message.timestamp === "number" ? message.timestamp : this.now(),
        kind: "message",
        leaderId: sessionId,
        ...(handle ? {} : { questId: threadKey }),
        sessionId,
        messageIndex: index,
        text: excerpt(text),
      });
      recorded = true;
    }
    this.store.setCursor(sessionId, history.length);
    void this.store.flush();
    if (recorded) this.schedule(sessionId, "user");
  }

  /** A quest of a leader with topics on changed: finishing one is an event; a new one may need a topic. */
  questChanged(quest: QuestmasterTask): void {
    if (!this.store.loaded) return;
    const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
    if (!leaderId || !this.store.isLeaderEnabled(leaderId)) return;
    const topic = this.store.topicOfQuest(quest.questId);
    if (!topic) {
      if (quest.status !== "done") this.changed(leaderId);
      return;
    }
    this.noteResolutions(topic.id, leaderId, quest);
    if (quest.status !== "done") return;
    // A reopened quest finishes again (each landing completes it): every completion is news, so
    // only an event recorded since this completion counts as already told.
    const completedAt = (quest as { completedAt?: number }).completedAt ?? 0;
    const already = topic.events.some(
      (event) => event.kind === "quest_done" && event.questId === quest.questId && event.at >= completedAt,
    );
    if (already) return;
    const wrapUp = (quest as { debriefTldr?: string }).debriefTldr?.trim();
    this.event(topic.id, leaderId, {
      at: this.now(),
      kind: "quest_done",
      questId: quest.questId,
      // The wrap-up says what changed and whether it is live. The page's quest log lists it by
      // itself; what it settles or leaves open is the Scribe's.
      text: excerpt([quest.title, wrapUp].filter(Boolean).join(" · "), 900),
    });
  }

  /**
   * A note the user or the leader added to the quest is news for where the topic stands: it is how
   * the Scribe hears that something was resolved wherever the user said so. Phase write-ups by
   * workers are not (finishing the quest reports its wrap-up), and neither are ticked review
   * checks, which stay with the quest. The first look at a quest only records where it stands.
   */
  private noteResolutions(topicId: string, leaderId: string, quest: QuestmasterTask): void {
    const checks = (quest as { verificationItems?: Array<{ text: string; checked: boolean }> }).verificationItems ?? [];
    const feedback = (quest as { feedback?: QuestFeedbackEntry[] }).feedback ?? [];
    const checked = checks.filter((item) => item.checked).map((item) => item.text);
    const mark = this.store.questMark(quest.questId);
    this.store.setQuestMark(quest.questId, { checked, feedback: feedback.length });
    if (!mark) return;
    for (const entry of feedback.slice(mark.feedback)) {
      const byLeader = entry.author === "human" || entry.authorSessionId === leaderId;
      const plainNote = !entry.kind || entry.kind === "comment";
      if (!byLeader || !plainNote || entry.deletedAt) continue;
      // The leader often records the user's words on the quest: the Scribe has them as a message.
      if (this.repeatsMessage(topicId, entry.text)) continue;
      this.event(topicId, leaderId, {
        at: entry.ts ?? this.now(),
        kind: "note",
        questId: quest.questId,
        text: excerpt(entry.text),
      });
    }
  }

  /** A note that quotes a message of the user's the topic already has as an event (its start, in a recent message). */
  private repeatsMessage(topicId: string, note: string): boolean {
    const since = this.now() - 24 * 60 * 60_000;
    const text = normalizeQuote(note);
    return this.store
      .detail(topicId)
      .events.some(
        (event) =>
          event.kind === "message" &&
          event.at >= since &&
          !!event.text &&
          normalizeQuote(event.text).length >= 20 &&
          text.includes(normalizeQuote(event.text).slice(0, 80)),
      );
  }

  /** A new artifact version saved in a quest's tab or a topic's thread is an event for that topic. */
  artifactSaved(input: { sessionId: string; threadKey: string; title: string; kind: string; version: number }): void {
    if (!this.store.loaded) return;
    const handle = topicIdOfViewKey(input.threadKey);
    const topic = input.threadKey.startsWith("q-")
      ? this.store.topicOfQuest(input.threadKey)
      : handle
        ? this.store.resolveHandle(handle)
        : undefined;
    const leaderId = this.deps.leaderOf(input.sessionId);
    if (!topic || !leaderId || !this.store.isLeaderEnabled(leaderId)) return;
    this.event(topic.id, leaderId, {
      at: this.now(),
      kind: "artifact",
      ...(handle ? {} : { questId: input.threadKey }),
      sessionId: input.sessionId,
      text: `${input.kind} "${input.title}"${input.version > 1 ? ` v${input.version}` : ""}`,
    });
  }

  /**
   * The user's requests for a topic's page changed: the leader's Scribe hears about it, unless it
   * saved them itself.
   */
  setPageRequests(topicId: string, leaderId: string, text: string, byScribe = false): string {
    const saved = this.store.setTopicInstructions(topicId, text);
    this.event(topicId, leaderId, {
      at: this.now(),
      kind: "page_request",
      ...(byScribe ? { byScribe: true } : {}),
      text: saved
        ? `the user's requests for this page are now: "${excerpt(saved, 900)}"`
        : "the user cleared their requests for this page",
    });
    return saved;
  }

  /** Update now: the topic goes to the leader's Scribe with its next message, paused or not. */
  requestUpdate(leaderId: string, topicId: string): Promise<DeliveryResult> {
    const forced = this.forced.get(leaderId) ?? new Set<string>();
    forced.add(topicId);
    this.forced.set(leaderId, forced);
    return this.deliver(leaderId);
  }

  /**
   * The Scribe tells its leader about loose ends it noticed: requests with no answer or quest,
   * promises not followed through, the same ask sent to two leaders. One short line each, a few
   * messages a day at most; the leader decides what to do. Returns false when today's are used up.
   */
  tellLeader(leaderId: string, lines: readonly string[]): boolean {
    const clean = lines
      .map((line) =>
        line
          .replace(/^\s*[-*]\s+/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    if (!clean.length) throw new Error("Say what the loose ends are, one per line.");
    if (clean.length > LOOSE_ENDS_LINES_MAX)
      throw new Error(`At most ${LOOSE_ENDS_LINES_MAX} loose ends at a time: send the ones that matter most.`);
    const long = clean.find((line) => line.length > LOOSE_END_MAX);
    if (long) throw new Error(`Keep each to one line (${LOOSE_END_MAX} characters at most): "${long.slice(0, 60)}…"`);
    if (!this.store.countLooseEnds(leaderId, LOOSE_ENDS_PER_DAY)) return false;
    this.deps.notifyLeader(
      leaderId,
      looseEndsNotice(this.deps.sessionNum(this.store.scribeSession(leaderId) ?? ""), clean),
    );
    return true;
  }

  /** The user undid a tidying change: the Scribes of the space hear about it, after a short pause. */
  undone(space: string): void {
    for (const leader of this.enabledLeadersIn(space)) this.schedule(leader, "user");
  }

  /** The leader filed a quest under a topic: its Scribe hears about it promptly. */
  leaderActivity(leaderId: string): void {
    this.schedule(leaderId, "leader");
  }

  /**
   * The user read the last unread answer in one of a leader's threads: it settles, and one under no
   * topic goes to the leader's Scribe to be filed where it plainly belongs.
   */
  threadRead(leaderId: string, threadKey: string): void {
    if (!this.store.thread(threadKey)) return;
    const settled = this.store.settleThread(threadKey);
    void this.store.flush();
    this.deps.broadcastChanged();
    if (settled && this.store.isLeaderEnabled(leaderId)) void this.deliver(leaderId);
  }

  /** Something the leader's Scribe should hear about changed (instructions, a resume, a filing). */
  changed(leaderId: string): void {
    if (this.store.isLeaderEnabled(leaderId)) void this.deliver(leaderId);
  }

  /** Records an event for a leader's Scribe and schedules it by how urgent its kind is. */
  event(topicId: string, leaderId: string, event: TopicEvent): void {
    this.store.addEvent(topicId, { ...event, leaderId });
    void this.store.flush();
    this.deps.broadcastChanged();
    this.schedule(leaderId, eventTiming(event.kind));
  }

  /**
   * When new events go to the Scribe. Events that rarely change a page ("ride") wait for the next
   * message. The others, the user's and the leader's alike, wait for a pause of DEBOUNCE_MS, so a
   * burst becomes one message; none waits longer than MAX_WAIT_MS.
   */
  private schedule(leaderId: string, timing: EventTiming): void {
    if (timing === "ride" || !this.store.isLeaderEnabled(leaderId)) return;
    const now = this.now();
    // Already due (its delivery is underway or waits for the Scribe's turn to end): keep it due.
    const existing = this.dueAt.get(leaderId);
    if (existing !== undefined && existing <= now) {
      this.changed(leaderId);
      return;
    }
    const first = this.firstPendingAt.get(leaderId) ?? now;
    const due = Math.min(now + DEBOUNCE_MS, first + MAX_WAIT_MS);
    this.firstPendingAt.set(leaderId, first);
    this.dueAt.set(leaderId, due);
    if (due <= now) {
      this.changed(leaderId);
      return;
    }
    clearTimeout(this.dueTimers.get(leaderId));
    this.dueTimers.set(
      leaderId,
      setTimeout(() => this.changed(leaderId), due - now),
    );
  }

  // ─── Messages to the Scribe ───────────────────────────────────────────────

  /**
   * Sends the leader's Scribe what changed since its last message, if it is idle; otherwise the
   * changes wait for its turn to end. A topic the user asked to update now goes even when paused.
   */
  deliver(leaderId: string): Promise<DeliveryResult> {
    const previous = this.chains.get(leaderId) ?? Promise.resolve();
    const next = previous.then(
      () => this.deliverNow(leaderId),
      () => this.deliverNow(leaderId),
    );
    this.chains.set(leaderId, next);
    return next;
  }

  private async deliverNow(leaderId: string): Promise<DeliveryResult> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return "off";
    const forcedIds = [...(this.forced.get(leaderId) ?? [])];
    if (!forcedIds.length) {
      if (this.store.isScribePaused(leaderId)) return "paused";
    }
    const current = this.store.scribeSession(leaderId);
    if (current && this.deps.isScribeAlive(current) && this.isWorking(leaderId, current)) return "busy";
    // After failed turns, nothing goes before the wait is over, unless the user asked to update now.
    const failing = this.failing.get(leaderId);
    if (failing && failing.retryAt > this.now() && !forcedIds.length) return "waiting";
    const scribe = await this.ensureScribe(leader);
    // Its machine can't start one now (a remote host offline): the changes wait for the next event.
    if (!scribe) return "waiting";
    if (failing?.resend) {
      const resend = failing.resend;
      if (!this.deps.inject(scribe, retryMessage(resend.text))) return "busy";
      failing.resend = undefined;
      this.awaiting.set(leaderId, { ...resend, sentAt: this.now(), reminded: true });
      return this.sent();
    }
    const instructions = this.store.scribeInstructions(leaderId);
    const sendInstructions = !this.store.instructionsSent(leaderId);
    const recent = await this.leaderQuests(leaderId, this.now() - RECENT_WINDOW_MS);
    // Pictures on the pages this Scribe wrote that were redrawn since go with this message.
    for (const topic of this.store.list(leader.space)) {
      if (this.store.pageWriter(topic.id) !== leaderId) continue;
      await this.checkPictures(topic.id).catch((error: Error) =>
        console.warn(`[library-topics] Could not check the pictures of "${topic.name}":`, error.message),
      );
    }
    // Events recorded from here on are not in this message.
    const throughSeq = this.store.eventSeq();

    if (this.store.needsInitialization(leaderId)) {
      const text = initializationMessage(leader, instructions?.text);
      if (!this.deps.inject(scribe, text)) return "busy";
      this.store.markInitialized(leaderId);
      this.store.markInstructionsSent(leaderId);
      this.store.setPageFormat(leaderId, PAGE_FORMAT);
      this.stalled.delete(leaderId);
      // Initialization covers the recent quests and whatever happened before it.
      this.store.markDelivered(
        leaderId,
        throughSeq,
        recent.map((quest) => quest.questId),
      );
      this.awaiting.set(leaderId, {
        sentAt: this.now(),
        askedAt: this.now(),
        purpose: "initialize",
        text,
        rewrite: false,
        throughSeq,
        topics: [],
        reminded: false,
      });
      // Topics the user asked to update go with the next message, after initialization.
      return this.sent();
    }

    const since = this.store.deliveredSeq(leaderId);
    const ownQuests = await this.leaderQuestIds(leaderId);
    const isNew = (event: TopicEvent) => (event.seq ?? 0) > since && (event.seq ?? 0) <= throughSeq;
    const topics = this.store
      .list(leader.space)
      .map((summary) => {
        const events = this.store
          .detail(summary.id)
          .events.filter(
            (event) =>
              isNew(event) &&
              !event.byScribe &&
              (event.leaderId === leaderId || (!event.leaderId && summary.questIds.some((id) => ownQuests.has(id)))),
          );
        return { id: summary.id, name: summary.name, events };
      })
      .filter((topic) => topic.events.length);
    const forcedNames = forcedIds.flatMap((id) => {
      const topic = this.store.resolve(id);
      return topic ? [topic.name] : [];
    });
    const told = this.store.questsTold(leaderId);
    const unsorted = recent.filter(
      (quest) => quest.status !== "done" && !this.store.topicOfQuest(quest.questId) && !told.has(quest.questId),
    );
    // Threads that settled under no topic: the Scribe files them where they belong, now.
    const settledThreads = this.store.settledUnfiledThreads(leaderId);
    // What the user told other leaders meanwhile: it may settle something this Scribe's pages say is open.
    const elsewhereSince = this.store.elsewhereSeen(leaderId) ?? this.now() - ELSEWHERE_FIRST_MS;
    const elsewhere = this.userMessagesElsewhere(leaderId, elsewhereSince);
    const rewritePages = this.store.pageFormat(leaderId) < PAGE_FORMAT;
    const newTopics = this.store.topicsToReview(leaderId);
    const consolidate = await this.consolidation(leaderId, leader.space, ownQuests);
    // Events alone wait until they are due, and the user's own page actions only ride along.
    // A rewrite request the Scribe stopped on (its leader was told) waits for the next real update.
    const urgent =
      forcedNames.length > 0 ||
      unsorted.length > 0 ||
      settledThreads.length > 0 ||
      (rewritePages && !this.stalled.has(leaderId)) ||
      (sendInstructions && !!instructions) ||
      newTopics.length > 0 ||
      !!consolidate;
    if (!urgent) {
      if (!topics.some((topic) => topic.events.some((event) => eventTiming(event.kind) !== "ride"))) return "nothing";
      if ((this.dueAt.get(leaderId) ?? 0) > this.now()) return "waiting";
    }
    const text = updateMessage(
      leader,
      {
        topics,
        unsorted,
        settledThreads: settledThreads.map((thread) => ({
          key: thread.key,
          name: thread.name,
          ...(thread.startedFrom ? { startedFrom: thread.startedFrom } : {}),
          ...(thread.firstMessage ? { firstMessage: thread.firstMessage } : {}),
        })),
        rewritePages,
        ...(sendInstructions && instructions ? { instructions: instructions.text } : {}),
        forced: forcedNames,
        elsewhere,
        newTopics: newTopics.map((topic) => ({ id: topic.id, name: topic.name, questIds: topic.questIds })),
        ...(consolidate ? { consolidate } : {}),
      },
      (sessionId) => this.deps.sessionNum(sessionId),
    );
    this.forced.delete(leaderId);
    if (!text) return "nothing";
    if (!this.deps.inject(scribe, text)) return "busy";
    this.store.markDelivered(
      leaderId,
      throughSeq,
      unsorted.map((quest) => quest.questId),
    );
    this.store.markInstructionsSent(leaderId);
    this.store.setElsewhereSeen(leaderId, this.now());
    this.store.markThreadsSortAsked(settledThreads.map((thread) => thread.id));
    this.store.reviewed(newTopics.map((topic) => topic.id));
    if (consolidate) this.store.setConsolidationAskedAt(leaderId, consolidate.count);
    this.stalled.delete(leaderId);
    this.dueAt.delete(leaderId);
    this.firstPendingAt.delete(leaderId);
    clearTimeout(this.dueTimers.get(leaderId));
    this.dueTimers.delete(leaderId);
    const names = rewritePages
      ? this.store
          .list(leader.space)
          .filter((topic) => topic.questIds.some((id) => ownQuests.has(id)))
          .map((topic) => topic.name)
      : [...new Set([...forcedNames, ...topics.map((topic) => topic.name)])];
    this.awaiting.set(leaderId, {
      sentAt: this.now(),
      askedAt: this.now(),
      purpose: "update",
      text,
      rewrite: rewritePages,
      throughSeq,
      topics: names,
      reminded: false,
    });
    return this.sent();
  }

  /**
   * The leader's topics past the soft target: how many there are and the quietest ones, quietness
   * counted in the leader's quests since the topic last had activity (a topic none of its last 20
   * quests went into is quiet however recent the calendar says). Null while under the target, or
   * when the Scribe was already asked at this count or more.
   */
  private async consolidation(
    leaderId: string,
    space: string,
    ownQuests: ReadonlySet<string>,
  ): Promise<UpdateContent["consolidate"] | null> {
    const topics = this.store.list(space).filter((topic) => topic.questIds.some((id) => ownQuests.has(id)));
    if (topics.length <= TOPIC_COUNT_TARGET) {
      this.store.setConsolidationAskedAt(leaderId, undefined);
      return null;
    }
    const asked = this.store.consolidationAskedAt(leaderId);
    if (asked !== undefined && topics.length <= asked) return null;
    const quests = await this.deps.listQuests();
    const createdAt = new Map(quests.map((quest) => [quest.questId, quest.createdAt]));
    const ownTimes = quests
      .filter((quest) => ownQuests.has(quest.questId))
      .map((quest) => quest.createdAt)
      .sort((a, b) => a - b);
    const ranked = topics
      .map((topic) => {
        const lastActivity = Math.max(topic.activityAt, ...topic.questIds.map((id) => createdAt.get(id) ?? 0));
        return {
          id: topic.id,
          name: topic.name,
          quests: topic.questIds.length,
          questsSince: ownTimes.filter((at) => at > lastActivity).length,
        };
      })
      .sort((a, b) => b.questsSince - a.questsSince || a.quests - b.quests);
    return { count: topics.length, target: TOPIC_COUNT_TARGET, quiet: ranked.slice(0, MAX_CONSOLIDATION_CANDIDATES) };
  }

  /**
   * A leader started a topic (filed a quest under a new name): its Scribe checks with its next
   * message whether it is distinct enough, and merges it into the topic it plainly belongs to if not.
   */
  topicCreated(topicId: string, leaderId: string): void {
    if (!this.store.isLeaderEnabled(leaderId)) return;
    this.store.markForReview(topicId, leaderId);
    void this.store.flush();
    this.schedule(leaderId, "leader");
  }

  private sent(): DeliveryResult {
    void this.store.flush();
    this.deps.broadcastChanged();
    return "sent";
  }

  /** A Scribe works while its turn runs, or until a turn ends after the last message it got. */
  private isWorking(leaderId: string, scribe: string): boolean {
    if (this.deps.isScribeBusy(scribe)) return true;
    const delivery = this.awaiting.get(leaderId);
    return !!delivery && this.now() - delivery.sentAt < STALE_DELIVERY_MS;
  }

  /** A page was saved: the panels show it. */
  pageSaved(): void {
    this.deps.broadcastChanged();
  }

  /**
   * A Scribe ended a turn. A failed or interrupted turn gets its message again after a wait that
   * grows with each failure in a row (see `turnFailed`). A finished turn ends any such wait; if
   * work of its message is left, it gets one reminder, and if it stops again with work left, its
   * leader is told. Then whatever changed meanwhile is sent.
   */
  async scribeTurnEnded(sessionId: string, outcome: ScribeTurnOutcome = { unfinished: false }): Promise<void> {
    const leaderId = this.store.leaderOfScribe(sessionId);
    if (!leaderId) return;
    const delivery = this.awaiting.get(leaderId);
    this.awaiting.delete(leaderId);
    if (outcome.unfinished) {
      this.turnFailed(leaderId, sessionId, delivery);
      return;
    }
    this.failing.delete(leaderId);
    clearTimeout(this.retryTimers.get(leaderId));
    this.retryTimers.delete(leaderId);
    if (delivery) {
      const left = await this.workLeft(leaderId, delivery);
      const retry = reminderMessage(left);
      if (left.length && !delivery.reminded && this.deps.inject(sessionId, retry)) {
        this.awaiting.set(leaderId, { ...delivery, sentAt: this.now(), reminded: true });
        this.deps.broadcastChanged();
        return;
      }
      if (left.length) {
        this.stalled.set(leaderId, delivery);
        this.deps.notifyLeader(leaderId, leaderNotice(this.deps.sessionNum(sessionId), left));
      } else {
        this.settled(leaderId, delivery);
      }
    } else {
      // A Scribe that stopped may finish later, on its own or asked by its leader.
      const stall = this.stalled.get(leaderId);
      if (stall && !(await this.workLeft(leaderId, stall)).length) this.settled(leaderId, stall);
    }
    this.deps.broadcastChanged();
    await this.deliver(leaderId);
  }

  /** Everything a message asked for is done. */
  private settled(leaderId: string, delivery: Delivery): void {
    this.stalled.delete(leaderId);
    // The pages are rewritten only once the Scribe has actually done it.
    if (delivery.rewrite) this.store.setPageFormat(leaderId, PAGE_FORMAT);
  }

  /**
   * A Scribe's turn failed or was interrupted: its message goes again after 30 seconds, doubling
   * with each failure in a row up to 30 minutes, and other updates wait as well. After three in a
   * row the leader is told once; the next finished turn ends it all.
   */
  private turnFailed(leaderId: string, sessionId: string, delivery: Delivery | undefined): void {
    const previous = this.failing.get(leaderId);
    const count = (previous?.count ?? 0) + 1;
    const wait = Math.min(FAILURE_BACKOFF_MS * 2 ** (count - 1), MAX_FAILURE_BACKOFF_MS);
    const retryAt = this.now() + wait;
    const tell = !previous?.told && count >= FAILURES_BEFORE_NOTICE;
    this.failing.set(leaderId, {
      count,
      retryAt,
      ...(delivery || previous?.resend ? { resend: delivery ?? previous?.resend } : {}),
      told: !!previous?.told || tell,
    });
    if (tell) this.deps.notifyLeader(leaderId, failureNotice(this.deps.sessionNum(sessionId), count, retryAt));
    clearTimeout(this.retryTimers.get(leaderId));
    this.retryTimers.set(
      leaderId,
      setTimeout(() => {
        this.retryTimers.delete(leaderId);
        void this.deliver(leaderId);
      }, wait),
    );
    this.deps.broadcastChanged();
  }

  /** What a message asked for and is still not done, in a line each. */
  private async workLeft(leaderId: string, delivery: Delivery): Promise<string[]> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader) return [];
    const ownQuests = await this.leaderQuestIds(leaderId);
    const topics = this.store.list(leader.space).filter((topic) => topic.questIds.some((id) => ownQuests.has(id)));
    if (delivery.purpose === "initialize") {
      const { done, total } = await this.sortingProgress(leaderId);
      const pageless = topics
        .filter((topic) => topic.upToDateAt === null)
        .map((topic) => `"${topic.name}" has no page yet`);
      return done === 0 && total > 0 ? [`none of ${total} recent quests is under a topic yet`, ...pageless] : pageless;
    }
    if (delivery.rewrite) {
      // A page confirmed as already current (`--unchanged`) counts as rewritten, whenever it was
      // done after the request: a page rewritten before a reminder stays rewritten.
      const stale = topics.filter((topic) => this.store.pageTouchedAt(topic.id) < delivery.askedAt);
      if (stale.length) {
        return [
          `${stale.length} page${stale.length === 1 ? " isn't" : "s aren't"} rewritten yet: ${stale
            .slice(0, 5)
            .map((topic) => `"${topic.name}"`)
            .join(", ")}${stale.length > 5 ? " and more" : ""}`,
        ];
      }
    }
    return this.store.list(leader.space).flatMap((topic) => {
      const unread = this.store
        .pendingEvents(topic.id, leaderId)
        .filter(
          (event) => (event.seq ?? 0) <= delivery.throughSeq && !event.byScribe && event.kind !== "now_done",
        ).length;
      return unread ? [`"${topic.name}": ${unread} event${unread === 1 ? "" : "s"} not on its page yet`] : [];
    });
  }

  /**
   * The user turns topics on or off for a leader. Turning on starts its Scribe, which initializes:
   * it sorts the leader's recent work into topics and writes the pages. Turning off archives the
   * Scribe, and the leader stays off while other leaders get topics by default.
   */
  async setLeaderEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator) throw new Error("Topics can be turned on only for leaders.");
    if (enabled && !this.topicsForLeaders()) {
      throw new Error("Library topics are off for leaders in Settings; turn them on there first.");
    }
    this.store.setLeaderEnabled(sessionId, enabled, true);
    const session = this.deps.getSession(sessionId);
    if (enabled && session) this.store.setCursor(sessionId, session.messageHistory.length);
    if (!enabled) await this.stopScribe(sessionId);
    await this.store.flush();
    this.deps.broadcastChanged();
    if (enabled) await this.deliver(sessionId);
  }

  /**
   * Topics are on for every leader by default. At startup and when Settings change: with topics on
   * for leaders, each leader the user didn't turn off gets them; with them off, every leader's are
   * turned off (each leader's own choice is kept for when they come back on).
   */
  async applyLeaderDefaults(): Promise<void> {
    if (!this.store.loaded) return;
    // First, so leaders this turns off below aren't later taken for leaders the user turned off.
    this.store.recordEarlierTurnOffs();
    if (this.topicsForLeaders()) {
      for (const leader of this.deps.listLeaders()) await this.turnOnByDefault(leader.sessionId);
    } else {
      for (const leaderId of this.store.enabledLeaderIds()) {
        this.store.setLeaderEnabled(leaderId, false);
        await this.stopScribe(leaderId);
      }
    }
    await this.store.flush();
    this.deps.broadcastChanged();
  }

  /**
   * Turns topics on for a leader that hasn't got them and wasn't turned off by the user. Its Scribe
   * starts at once when the leader has recent quests to sort; a new leader's starts with its first.
   */
  private async turnOnByDefault(sessionId: string): Promise<void> {
    // Before any leader comes on by default, leaders turned off earlier are recorded as such.
    this.store.recordEarlierTurnOffs();
    if (!this.topicsForLeaders() || this.store.isLeaderEnabled(sessionId) || this.store.turnedOffByUser(sessionId)) {
      return;
    }
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator || leader.archived) return;
    this.store.setLeaderEnabled(sessionId, true);
    const session = this.deps.getSession(sessionId);
    if (session) this.store.setCursor(sessionId, session.messageHistory.length);
    await this.store.flush();
    this.deps.broadcastChanged();
    if ((await this.leaderQuests(sessionId, this.now() - RECENT_WINDOW_MS)).length) await this.deliver(sessionId);
  }

  private async stopScribe(leaderId: string): Promise<void> {
    const scribe = this.store.scribeSession(leaderId);
    this.store.setScribeSession(leaderId, undefined);
    this.awaiting.delete(leaderId);
    this.forced.delete(leaderId);
    if (scribe && this.deps.isScribeAlive(scribe)) await this.deps.retireScribe(scribe);
  }

  /**
   * Checks the images a topic's page shows: a picture redrawn since the page's text was brought up
   * to date with it, or a new image beside them, becomes an event for the Scribe of the leader that
   * wrote the page, which reads the picture and fixes the text about it. Run when the page is opened
   * and before that Scribe's updates, so a page can't keep text that its pictures have outgrown.
   * Returns each image's modification time, for the page to show.
   */
  async checkPictures(topicId: string, options: { schedule?: boolean } = {}): Promise<Record<string, number>> {
    const images = pageImages(this.store.detail(topicId).page);
    const paths = [...new Set(images.map((image) => image.path))];
    const leaderId = this.store.pageWriter(topicId);
    const { fileModifiedAt, listImages } = this.deps;
    if (!paths.length || !leaderId || !fileModifiedAt) return {};
    const stats: Record<string, number | null> = {};
    for (const path of paths) stats[path] = await fileModifiedAt(leaderId, path).catch(() => null);
    const folders: Record<string, Array<{ path: string; mtimeMs: number }>> = {};
    if (listImages) {
      for (const folder of new Set(paths.map((path) => path.slice(0, path.lastIndexOf("/"))))) {
        // Agents' reduced copies of an image (`.takode-agent.` siblings) aren't images of their own.
        folders[folder] = (await listImages(leaderId, folder).catch(() => [])).filter(
          (image) => !image.path.includes(".takode-agent."),
        );
      }
    }
    const { redrawn, added } = this.store.notePictures(topicId, stats, folders);
    const at = this.now();
    for (const image of redrawn) {
      this.store.addEvent(topicId, {
        at,
        kind: "picture",
        leaderId,
        text: `the picture ${image.path} on this page was redrawn (${clockOf(image.mtimeMs)}): look at it again and bring the text that describes it up to date`,
      });
    }
    for (const image of added) {
      this.store.addEvent(topicId, {
        at,
        kind: "picture",
        leaderId,
        text: `a new image appeared beside this page's pictures: ${image.path} (${clockOf(image.mtimeMs)}); show it if the page should`,
      });
    }
    if (redrawn.length || added.length) {
      void this.store.flush();
      this.deps.broadcastChanged();
      if (options.schedule) this.schedule(leaderId, "leader");
    }
    // By the page's own `src`, which is what the page's images look up.
    return Object.fromEntries(
      images.flatMap(({ src, path }) => (stats[path] == null ? [] : [[src, stats[path]] as [string, number]])),
    );
  }

  private topicsForLeaders(): boolean {
    return this.deps.topicsForLeaders?.() ?? true;
  }

  /** At startup: Scribes whose pages predate the current page format are asked to rewrite them. */
  askOutdatedScribes(): void {
    for (const leaderId of this.store.enabledLeaderIds()) {
      if (this.store.pageFormat(leaderId) < PAGE_FORMAT && !this.store.needsInitialization(leaderId)) {
        this.changed(leaderId);
      }
    }
  }

  /** Archives page writers of the retired one-per-space design. */
  async retireLegacyWriters(): Promise<void> {
    const ids = this.store.takeLegacyWriters();
    await this.store.flush();
    for (const id of ids) {
      if (this.deps.isScribeAlive(id)) await this.deps.retireScribe(id);
    }
  }

  /**
   * The leader's Scribe, started on the leader's machine when it has none (or its session is gone).
   * A Scribe on another machine (started before Scribes followed their leader) is replaced here, at
   * its next message: a conversation cannot resume on another machine. The new one starts first,
   * so a leader whose machine can't start one keeps its old Scribe. Null when none can run.
   */
  /**
   * The user's own messages to the other leaders since a time, newest last (the newest few):
   * something a page says is open may have been handled there (Jiayi asked another leader to do
   * a follow-up one page still listed).
   */
  private userMessagesElsewhere(
    leaderId: string,
    since: number,
  ): Array<{ sessionNum: number | null; at: number; index: number; threadKey: string; text: string }> {
    const found: Array<{ sessionNum: number | null; at: number; index: number; threadKey: string; text: string }> = [];
    for (const leader of this.deps.listLeaders()) {
      if (leader.sessionId === leaderId || leader.archived) continue;
      const history = this.deps.getSession(leader.sessionId)?.messageHistory ?? [];
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        const stamp = (message as { timestamp?: unknown } | undefined)?.timestamp;
        const at = typeof stamp === "number" ? stamp : 0;
        if (!message || at <= since) {
          if (message && at && at <= since) break;
          continue;
        }
        if (!isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
        const text = formatAnnotatedMessage(
          typeof message.content === "string" ? message.content : "",
          "annotations" in message ? message.annotations : undefined,
        );
        found.push({
          sessionNum: leader.sessionNum,
          at,
          index,
          threadKey: leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]),
          text: excerpt(text, 200),
        });
      }
    }
    return found.sort((a, b) => a.at - b.at).slice(-ELSEWHERE_MAX);
  }

  private async ensureScribe(leader: TopicLeaderInfo): Promise<string | null> {
    const existing = this.store.scribeSession(leader.sessionId);
    const alive = !!existing && this.deps.isScribeAlive(existing);
    if (alive) this.store.noteScribeRunning(leader.sessionId);
    // A day-old Scribe is replaced by a fresh one: its state is in the store, and every turn of a
    // long conversation carries all of it again.
    const fresh = this.now() - (this.store.scribeStartedAt(leader.sessionId) ?? this.now()) < SCRIBE_FRESH_MS;
    if (alive && fresh && this.deps.hostOf(existing) === leader.hostId) return existing;
    let sessionId: string;
    try {
      sessionId = await this.deps.createScribe(leader);
    } catch (error) {
      console.warn(`[library-topics] Could not start a Scribe for leader ${leader.sessionId}:`, error);
      return alive ? existing : null;
    }
    this.store.setScribeSession(leader.sessionId, sessionId);
    await this.store.flush();
    if (alive) await this.deps.retireScribe(existing);
    return sessionId;
  }

  // ─── Pages ────────────────────────────────────────────────────────────────

  /**
   * Quoted decisions that don't appear in the message they link to. A quote is text in double
   * quotes on the same line before a `session:N:index` link; ellipses may join separate parts.
   * Links to messages that can't be read are not checked.
   */
  checkQuotes(markdown: string): string[] {
    const problems: string[] = [];
    for (const line of markdown.split("\n")) {
      let segmentStart = 0;
      for (const link of line.matchAll(/\[[^\]]*\]\(session:(\d+):(\d+)\)/g)) {
        const segment = line.slice(segmentStart, link.index);
        segmentStart = (link.index ?? 0) + link[0].length;
        const quotes = [...segment.matchAll(/["“]([^"“”]{3,})["”]/g)].map((match) => match[1]);
        if (quotes.length === 0) continue;
        const text = this.deps.messageText(Number(link[1]), Number(link[2]));
        if (text === null) continue;
        const haystack = normalizeQuote(text);
        for (const quote of quotes) {
          const parts = quote
            .split(/\.\.\.|…/)
            .map(normalizeQuote)
            .filter(Boolean);
          if (parts.every((part) => haystack.includes(part))) continue;
          problems.push(`"${quote}" is not in message session:${link[1]}:${link[2]}`);
        }
      }
    }
    return problems;
  }

  // ─── Status and leader states ─────────────────────────────────────────────

  /** A leader's Scribe: what it is doing and how the user set it. */
  async overview(leaderId: string): Promise<ScribeOverview> {
    return {
      activity: await this.activity(leaderId),
      paused: this.store.isScribePaused(leaderId),
      instructions: this.store.scribeInstructions(leaderId)?.text ?? "",
    };
  }

  /** What a leader's Scribe is doing, in one line for the panel and `takode scribe status`. */
  async activity(leaderId: string): Promise<ScribeActivity> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return { state: "off", text: "Topics are off", pending: 0 };
    const scribe = this.store.scribeSession(leaderId);
    const alive = !!scribe && this.deps.isScribeAlive(scribe);
    const pending = this.store
      .list(leader.space)
      .reduce(
        (sum, topic) =>
          sum + this.store.pendingEvents(topic.id, leaderId).filter((event) => event.kind !== "now_done").length,
        0,
      );
    const lastPageAt = this.store
      .list(leader.space)
      .filter((topic) => topic.questIds.length)
      .reduce<number | undefined>((latest, topic) => {
        const written = topic.upToDateAt ?? undefined;
        return written && (!latest || written > latest) ? written : latest;
      }, undefined);
    const base = {
      ...(alive ? { sessionId: scribe, sessionNum: this.deps.sessionNum(scribe!) } : {}),
      pending,
      ...(lastPageAt ? { lastPageAt } : {}),
    };
    if (!alive) return { state: "starting", text: "Starting the Scribe", ...base };
    const delivery = this.awaiting.get(leaderId);
    if (delivery?.purpose === "initialize") {
      const { done, total } = await this.sortingProgress(leaderId);
      return {
        state: "initializing",
        text: `Sorting recent work into topics: ${done} of ${total} quests`,
        progress: { done, total },
        ...base,
      };
    }
    if (this.deps.isScribeBusy(scribe!)) {
      const names = delivery?.topics ?? [];
      const text = names.length
        ? `Updating ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}…`
        : "Working…";
      return { state: "updating", text, ...base };
    }
    // A request is out but no turn has picked it up yet (the Scribe may still be starting).
    if (delivery && this.now() - delivery.sentAt < STALE_DELIVERY_MS) {
      return {
        state: "waiting",
        text: delivery.reminded ? "Asked again; waiting for the Scribe" : "Request sent; waiting for the Scribe",
        ...base,
      };
    }
    const failing = this.failing.get(leaderId);
    if (failing) {
      const at = new Date(failing.retryAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const text = failing.told
        ? `Its turns keep failing; trying again at ${at}; your leader was told`
        : `Its last turn failed; trying again at ${at}`;
      return { state: "waiting", text, ...base };
    }
    if (this.stalled.has(leaderId)) {
      return { state: "waiting", text: "Stopped before finishing; your leader was told", ...base };
    }
    if (this.store.isScribePaused(leaderId)) {
      return { state: "paused", text: pending ? `Paused · ${pending} events not on pages` : "Paused", ...base };
    }
    if (pending) {
      return { state: "waiting", text: `${pending} event${pending === 1 ? "" : "s"} not on pages yet`, ...base };
    }
    return { state: "idle", text: "Up to date", ...base };
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
          ...(this.topicsForLeaders() ? {} : { offInSettings: true }),
        };
      });
  }

  /** How many of the leader's recent quests are under a topic. */
  private async sortingProgress(leaderId: string): Promise<{ done: number; total: number }> {
    const quests = await this.leaderQuests(leaderId, this.now() - RECENT_WINDOW_MS);
    return { done: quests.filter((quest) => this.store.topicOfQuest(quest.questId)).length, total: quests.length };
  }

  /** The leader's quests created since a time, oldest first. */
  private async leaderQuests(leaderId: string, since: number): Promise<QuestmasterTask[]> {
    return (await this.deps.listQuests())
      .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
      .filter((quest) => quest.createdAt > since)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private async leaderQuestIds(leaderId: string): Promise<Set<string>> {
    return new Set(
      (await this.deps.listQuests())
        .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
        .map((quest) => quest.questId),
    );
  }

  private enabledLeadersIn(space: string): string[] {
    return this.store.enabledLeaderIds().filter((leaderId) => this.deps.getLeaderInfo(leaderId)?.space === space);
  }
}

/** Text compared for the quote check: no markdown, quotes or dashes of different shapes, or spacing. */
function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(text: string, limit = EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

/** A history message's text: a user message with its comments, or an answer's text blocks. */
export function historyMessageText(message: BrowserIncomingMessage): string {
  if (message.type === "user_message") {
    return formatAnnotatedMessage(typeof message.content === "string" ? message.content : "", message.annotations);
  }
  if (message.type !== "assistant") return "";
  return (message.message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}
