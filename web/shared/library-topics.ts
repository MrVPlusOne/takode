/**
 * Library topics: subjects named in the user's words that group quests of a session space, each
 * with a page kept current by the Scribes of the leaders whose quests it holds (one Scribe per
 * leader, a worker in its herd). Topics and their pages are opt-in per leader.
 * Shared by the server, the browser and the `takode topic` and `takode scribe` commands.
 */

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
}

export interface TopicEvent {
  at: number;
  kind: "quest_filed" | "quest_done" | "message" | "artifact" | "feedback";
  /** The leader whose activity it came from; its Scribe handles it. */
  leaderId?: string;
  questId?: string;
  /** Session and history index of the message, for links. */
  sessionId?: string;
  messageIndex?: number;
  text?: string;
}

export interface TopicDetail extends TopicSummary {
  aliases: string[];
  page: string | null;
  events: TopicEvent[];
  /** Titles and states of the topic's quests, when the server includes them. */
  quests?: Array<{ questId: string; title: string; status: string }>;
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
  /** Suggest turning topics on: off, about 20 quests, hint not dismissed. */
  suggest: boolean;
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
  state: "off" | "starting" | "filing" | "updating" | "waiting" | "idle" | "paused" | "over_budget";
  /** One line for people: "Filing 120 of 336 quests", "Updating T7 run…", "Up to date". */
  text: string;
  sessionId?: string;
  sessionNum?: number | null;
  /** While filing the leader's recent quests. */
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
  /** Spend over the last day against its budget (a share of its leader's spend). */
  budget: { used: number; limit: number; overBudget: boolean };
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

/** Leaders get a hint to turn topics on at this many quests. */
export const TOPIC_HINT_QUEST_COUNT = 20;
/** A topic stays tentative this long unless a second quest joins. */
export const TOPIC_TENTATIVE_MS = 24 * 60 * 60 * 1000;
/** A Scribe's daily spend may reach this share of its leader's own. */
export const SCRIBE_BUDGET_SHARE = 0.1;

/** Source of the requests Takode sends a Scribe. */
export const LIBRARY_MESSAGE_SOURCE = { sessionId: "library", sessionLabel: "Library" } as const;
