/**
 * Library topics: subjects named in the user's words that group quests of a session space, each
 * with a page kept current by the Scribes of the leaders whose quests it holds (one Scribe per
 * leader, a worker in its herd). Topics and their pages are opt-in per leader.
 * Shared by the server, the browser and the `takode topic` and `takode scribe` commands.
 */
import type { NowEntry } from "./topic-now-items.js";

/** Who named a topic: names the user chose are never changed automatically. */
export type TopicNameSource = "user" | "agent";

export interface TopicSummary {
  id: string;
  space: string;
  name: string;
  nameSource: TopicNameSource;
  /** New and not settled yet: one quest, named by an agent, less than a day old. */
  tentative: boolean;
  createdAt: number;
  updatedAt: number;
  questIds: string[];
  /** First paragraph of the page's "Where it stands", for lists. */
  summary: string;
  /** The page includes everything up to this time; null before the first page. */
  upToDateAt: number | null;
  /** Events since the page was last written. */
  pendingEvents: number;
  /** When something last happened in the topic (a quest filed or finished, a message, an artifact). */
  activityAt: number;
  /** That newest thing, in a phrase ("q-12 finished", "You wrote in q-12"), with its quest. */
  latestActivity?: { at: number; text: string; questId?: string };
  /** The newest line of the page's History, as plain text. */
  latestUpdate?: string;
  /** How many Now entries are open. */
  openNow: number;
  /** Threads filed under this topic: they show in its conversation, each under its own name. */
  threads?: TopicThreadRef[];
}

/** A thread filed under a topic: its thread key's handle and its name. */
export interface TopicThreadRef {
  handle: string;
  name: string;
}

/**
 * A thread the user started on purpose (New thread): a lightweight conversation with the leader,
 * not a topic. It is listed in its leader's Threads menu, active until you read its last answer,
 * can start quests and be filed under a topic (it follows its first quest's topic).
 */
export interface ThreadSummary {
  id: string;
  /** Its thread key: `topic:<handle>` (threads share the topic-thread plumbing). */
  key: string;
  name: string;
  leaderId: string;
  /** The quest or thread it was started from (`q-12`, `topic:<handle>`); none from Main. */
  startedFrom?: string;
  /** The topic it is filed under, once it is. */
  topic?: { id: string; name: string };
  createdAt: number;
  activityAt: number;
  /**
   * When it settled: you read its last answer. A settled thread leaves the Threads menu's Active
   * section; writing in it makes it active again.
   */
  settledAt?: number;
  /** No message has arrived in it yet; if its first send failed it stays so, and can be removed. */
  empty?: true;
}

export interface TopicEvent {
  at: number;
  /**
   * check: a User review check of a quest was ticked; note: the user's or leader's note on a
   * quest; now_done: the user marked a Now item done on the page; page_request: the user's requests
   * for the topic's page changed.
   */
  kind:
    | "quest_filed"
    | "quest_done"
    | "message"
    | "artifact"
    | "undone"
    | "check"
    | "note"
    | "now_done"
    | "page_request";
  /** The leader whose activity it came from; its Scribe handles it. */
  leaderId?: string;
  /** Made by a Scribe's own filing or tidying: it needs a page update but is not news to Scribes. */
  byScribe?: boolean;
  /** Order in which events were recorded, so each is sent to a Scribe exactly once. */
  seq?: number;
  /**
   * A page already took it in before a merge moved it here: the merged-in topic's page did, and the
   * Scribe merging the topics carries that page over. Not waiting for any page.
   */
  covered?: boolean;
  questId?: string;
  /** Session and history index of the message, for links. */
  sessionId?: string;
  messageIndex?: number;
  text?: string;
}

export interface TopicDetail extends TopicSummary {
  aliases: string[];
  page: string | null;
  /** When the page was last saved. */
  writtenAt: number | null;
  /** The user's lasting requests for this page, such as a section to keep ("" when none). */
  instructions: string;
  events: TopicEvent[];
  /** Titles and states of the topic's quests, when the server includes them. */
  quests?: Array<{
    questId: string;
    title: string;
    status: string;
    /** When the quest last changed status, for listing the most recent first. */
    changedAt?: number;
  }>;
  /** The topic's Now entries, when the server includes them. */
  now?: NowEntry[];
}

/** One line in the Library's change list; every change can be undone. */
export interface TopicChange {
  id: string;
  at: number;
  space: string;
  text: string;
  /** Made by a Scribe (tidying) or by a person or leader. */
  byAgent: boolean;
  undone: boolean;
}

export interface TopicLeaderState {
  sessionId: string;
  sessionNum: number | null;
  name: string;
  space: string;
  enabled: boolean;
  questCount: number;
  /** Topics are off for every leader in Settings, so this one can't be turned on here. */
  offInSettings?: boolean;
}

/** A new name a Scribe suggests for a topic the user named; nothing changes until accepted. */
export interface TopicRenameSuggestion {
  id: string;
  topicId: string;
  topicName: string;
  name: string;
  reason?: string;
  at: number;
}

/** What a leader's Scribe is doing, for the panel's status line and `takode scribe status`. */
export interface ScribeActivity {
  state: "off" | "starting" | "initializing" | "updating" | "waiting" | "idle" | "paused";
  /** One line for people: "Sorting recent work into topics: 120 of 336 quests", "Updating T7 run…", "Up to date". */
  text: string;
  sessionId?: string;
  sessionNum?: number | null;
  /** While sorting the leader's recent quests into topics. */
  progress?: { done: number; total: number };
  /** Events no page includes yet. */
  pending: number;
  lastPageAt?: number;
}

/** A leader's Scribe: what it is doing and how the user set it. */
export interface ScribeOverview {
  activity: ScribeActivity;
  /** "Keep pages up to date" is off: events wait until the user asks for an update. */
  paused: boolean;
  /** The user's instructions for how to group the leader's topics ("" when none). */
  instructions: string;
}

export interface TopicListResponse {
  topics: TopicSummary[];
  changes: TopicChange[];
  leaders: TopicLeaderState[];
  spaces: string[];
  /** Renames waiting for the user to accept or dismiss. */
  suggestions: TopicRenameSuggestion[];
  /** With a leader: its Scribe. */
  scribe?: ScribeOverview;
}

/** Quests filed under a topic, for grouping the Done list: questId to topic. */
export type QuestTopicMap = Record<string, { id: string; name: string }>;

/** What a leader's tab bar and quest tabs need of a topic, without loading its page. */
export interface TopicBrief {
  name: string;
  /** All the topic's quests, open ones included. */
  questIds: string[];
  /** When something last happened in it (see `TopicSummary.activityAt`). */
  activityAt: number;
  /** Threads filed under it (see `TopicSummary.threads`). */
  threads?: TopicThreadRef[];
}

/** The quest-map answer: each named quest's topic, and those topics in brief. */
export interface QuestTopicsResponse {
  enabled: boolean;
  map: QuestTopicMap;
  topics: Record<string, TopicBrief>;
}

/** A topic stays tentative this long unless a second quest joins. */
export const TOPIC_TENTATIVE_MS = 24 * 60 * 60 * 1000;

/** Source of the requests Takode sends a Scribe. */
export const LIBRARY_MESSAGE_SOURCE = { sessionId: "library", sessionLabel: "Library" } as const;

/**
 * Soft target for a leader's topics: past it, its Scribe is asked to merge the quietest ones that
 * plainly belong in another. The user's own instructions for the Scribe (a different range) win.
 */
export const TOPIC_COUNT_TARGET = 15;
