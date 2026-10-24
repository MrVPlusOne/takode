/**
 * Library topics: subjects named in the user's words that group a leader's quests, each with a
 * page the space's page writer keeps current. Topics and their pages are opt-in per leader.
 * Shared by the server, the browser and the `takode topic` command.
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
  /** Made by the page writer (tidying) or by a person or leader. */
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

export interface TopicListResponse {
  topics: TopicSummary[];
  changes: TopicChange[];
  leaders: TopicLeaderState[];
  spaces: string[];
  paused: boolean;
  /** The page writer's spend over the last day against its budget (a share of the leaders' spend). */
  budget: { used: number; limit: number; overBudget: boolean };
}

/** Quests filed under a topic, for grouping the Done list: questId to topic. */
export type QuestTopicMap = Record<string, { id: string; name: string }>;

/** Leaders get a hint to turn topics on at this many quests. */
export const TOPIC_HINT_QUEST_COUNT = 20;
/** A topic stays tentative this long unless a second quest joins. */
export const TOPIC_TENTATIVE_MS = 24 * 60 * 60 * 1000;
/** The page writer's daily spend may reach this share of the leaders' own. */
export const STORYTELLER_BUDGET_SHARE = 0.1;
