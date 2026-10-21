/**
 * Workspace context for voice transcription: what the user has been working on across their
 * session space, so names and project terms used elsewhere in the space are recognized even
 * when the current thread never mentions them.
 *
 * Built from data the server already holds (quests and the activity stream), with no model call.
 * The key terms help most; the quest titles and activity lines are kept small because the
 * cleanup model is billed by input token (speech-to-text is billed by audio minute).
 */
import type { AnnotationWorkspaceReference } from "../shared/annotation-voice-context.js";
import type { ActivityThread } from "./activity-stream.js";

/** Quests active or completed within this window are context. */
const QUEST_DAYS = 7;
const QUEST_LIMIT = 25;
/** Activity shown as text: the last day. Terms come from a longer window because they are short. */
export const ACTIVITY_HOURS = 24;
export const TERM_HOURS = 72;
const ACTIVITY_LINE_CHARS = 400;
const TERM_LIMIT = 100;
/** Longer tokens are file names or fragments, not words anyone says. */
const TERM_MAX_CHARS = 32;

/** Rendered budgets. The speech-to-text prompt as a whole stays within its 10,000-character cap. */
const QUEST_TITLE_CHARS = 1000;
const STT_ACTIVITY_CHARS = 3000;
const ENHANCER_ACTIVITY_CHARS = 3000;
const ANNOTATION_ACTIVITY_CHARS = 2000;

export interface TranscriptionWorkspaceContext {
  /** Titles of recently active or completed quests in the session's space, most recent first. */
  questTitles: string[];
  /** The space's user messages and final answers from the last day, newest first, one line each. */
  activity: string[];
  /** Distinctive words from the quests and activity (names, acronyms, words with digits or joiners). */
  terms: string[];
}

/** The slow-changing part of the context, which can be reused for a while. */
export type WorkspaceVocabulary = Pick<TranscriptionWorkspaceContext, "questTitles" | "terms">;

export interface WorkspaceQuest {
  title: string;
  tldr?: string;
  cancelled?: boolean;
  createdAt: number;
  statusChangedAt?: number;
}

/**
 * Pick the recent quest titles and the key terms at `now` from the space's quests and its
 * activity stream over the last TERM_HOURS.
 */
export function buildWorkspaceVocabulary(input: {
  quests: ReadonlyArray<WorkspaceQuest>;
  activity: ReadonlyArray<ActivityThread>;
  now: number;
}): WorkspaceVocabulary {
  const questSince = input.now - QUEST_DAYS * 24 * 3600_000;
  const recentQuests = input.quests
    .filter((quest) => !quest.cancelled && quest.createdAt <= input.now)
    .map((quest) => ({ quest, at: Math.max(quest.createdAt, quest.statusChangedAt ?? 0) }))
    .filter((entry) => entry.at >= questSince)
    .sort((a, b) => b.at - a.at)
    .slice(0, QUEST_LIMIT)
    .map(({ quest }) => quest);

  // TLDRs only feed the terms: as prompt text they added nothing the titles and activity lacked.
  const terms = extractKeyTerms(
    [
      ...recentQuests.flatMap((quest) => [
        { text: quest.title, weight: 3 },
        { text: quest.tldr ?? "", weight: 1 },
      ]),
      // The user's own words are the best guide to what they will say.
      ...input.activity.flatMap((thread) =>
        thread.messages.map((message) => ({ text: message.text, weight: message.role === "user" ? 2 : 1 })),
      ),
    ],
    TERM_LIMIT,
  );
  return { questTitles: recentQuests.map((quest) => quest.title), terms };
}

/**
 * The activity lines, newest first, from an activity stream over the last ACTIVITY_HOURS.
 * `exclude` drops the thread being dictated into, whose conversation the prompts already carry.
 */
export function recentActivityLines(
  activity: ReadonlyArray<ActivityThread>,
  exclude?: { sessionId: string; threadKey: string },
): string[] {
  return activity
    .filter(
      (thread) => !exclude || thread.sessionId !== exclude.sessionId || (thread.thread ?? "main") !== exclude.threadKey,
    )
    .flatMap((thread) => thread.messages)
    .sort((a, b) => b.at - a.at)
    .map(
      (message) =>
        `[${message.role === "user" ? "user" : "agent"}] ${oneLine(stripLinkTargets(message.text), ACTIVITY_LINE_CHARS)}`,
    );
}

/** Speech-to-text lines: quest titles and activity, each within its budget (empty when there is none). */
export function workspaceSttLines(context: TranscriptionWorkspaceContext | undefined) {
  return {
    questLine: questLine(context),
    activityLines: withinBudget(context?.activity ?? [], STT_ACTIVITY_CHARS),
  };
}

/** Enhancer blocks for the user message, in the XML-tag style of the other context blocks. */
export function workspaceEnhancerBlocks(context: TranscriptionWorkspaceContext | undefined): string[] {
  const blocks: string[] = [];
  const quests = questLine(context);
  if (quests) blocks.push(`<RECENT_QUESTS>\n${quests}\n</RECENT_QUESTS>`);
  const activity = withinBudget(context?.activity ?? [], ENHANCER_ACTIVITY_CHARS);
  if (activity.length) {
    blocks.push(
      `<RECENT_ACTIVITY>\nRecent messages elsewhere in this workspace, newest first:\n${activity.join("\n")}\n</RECENT_ACTIVITY>`,
    );
  }
  return blocks;
}

/** The comment-voice reference fields: the same workspace context in JSON form. */
export function workspaceReference(
  context: TranscriptionWorkspaceContext | undefined,
): AnnotationWorkspaceReference | undefined {
  if (!context) return undefined;
  const quests = questLine(context);
  const activity = withinBudget(context.activity, ANNOTATION_ACTIVITY_CHARS);
  if (!quests && !activity.length && !context.terms.length) return undefined;
  return {
    ...(context.terms.length ? { key_terms: context.terms.join(", ") } : {}),
    ...(quests ? { recent_quests: quests } : {}),
    ...(activity.length ? { recent_activity: activity } : {}),
  };
}

function questLine(context: TranscriptionWorkspaceContext | undefined): string {
  const titles = context?.questTitles.join("; ") ?? "";
  return titles ? "Recent quests: " + truncate(titles, QUEST_TITLE_CHARS) : "";
}

const STOP_TERMS = new Set(
  "i i'm i'll i've i'd ok okay pr prs ui api url urls am pm id ids tldr md json http https monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec".split(
    " ",
  ),
);
const TOKEN = /[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*/g;
const PLAIN_WORD = /(?<![\w/@.-])[A-Za-z][a-z]+(?![\w/@-])/g;

/**
 * Pick the words a general speech recognizer is likely to get wrong: names and other capitalized
 * words in mid-sentence, acronyms and camel-case names, words with digits (12B, T7) and
 * hyphen- or underscore-joined names (seeded-QA, vsc3p_telemetry). Each text counts a word once;
 * the weighted counts rank the words, and a word must reach a weight of 2 to qualify.
 */
export function extractKeyTerms(texts: ReadonlyArray<{ text: string; weight: number }>, limit: number): string[] {
  const cleaned = texts.map(({ text, weight }) => ({ text: stripLinkTargets(text), weight }));
  // A capitalized word written in lowercase at least as often is an ordinary word (Read, Fix), not a name.
  const lowercase = new Map<string, number>();
  const capitalized = new Map<string, number>();
  for (const { text } of cleaned) {
    for (const [word] of text.matchAll(PLAIN_WORD)) {
      const counts = /^[A-Z]/.test(word) ? capitalized : lowercase;
      counts.set(word.toLowerCase(), (counts.get(word.toLowerCase()) ?? 0) + 1);
    }
  }
  const ordinary = (word: string) =>
    /^[A-Z][a-z]+$/.test(word) &&
    (lowercase.get(word.toLowerCase()) ?? 0) >= (capitalized.get(word.toLowerCase()) ?? 0);

  const scores = new Map<string, { score: number; forms: Map<string, number> }>();
  for (const { text, weight } of cleaned) {
    const seen = new Set<string>();
    for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+|["“”*`([]/)) {
      let first = true;
      for (const [word] of sentence.matchAll(TOKEN)) {
        const sentenceStart = first;
        first = false;
        if (!isKeyTerm(word, sentenceStart) || ordinary(word)) continue;
        const key = word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = scores.get(key) ?? { score: 0, forms: new Map<string, number>() };
        entry.score += weight;
        entry.forms.set(word, (entry.forms.get(word) ?? 0) + 1);
        scores.set(key, entry);
      }
    }
  }
  return [...scores.values()]
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => [...entry.forms].sort((a, b) => b[1] - a[1])[0]![0]);
}

function isKeyTerm(word: string, sentenceStart: boolean): boolean {
  if (word.length < 2 || word.length > TERM_MAX_CHARS || STOP_TERMS.has(word.toLowerCase())) return false;
  // Plain numbers, durations (39m), file names, hashes and dates are not words anyone dictates.
  if (/^\d+(\.\d+)?$/.test(word) || /^\d+[smhd]$/.test(word) || /\.[A-Za-z]/.test(word)) return false;
  if (/^[0-9a-f]{7,}$/i.test(word) && /\d/.test(word)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(word)) return false;
  // Hyphenated ordinary words (sign-in, read-only) are known to any recognizer.
  if (/^[a-z]+(-[a-z]+)+$/.test(word)) return false;
  if (/\d/.test(word) && /[A-Za-z]/.test(word)) return true;
  if (/[A-Z]/.test(word.slice(1))) return true;
  if (/[-_][A-Za-z]/.test(word)) return true;
  return /^[A-Z][a-z]/.test(word) && !sentenceStart;
}

/** Drop link targets, URLs and Takode IDs, which carry no spoken vocabulary. */
function stripLinkTargets(text: string): string {
  return text
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:quest|session|file|todo):[^\s)\]]+/g, " ")
    .replace(/\bq-\d+\b|#\d+\b|\bu\d+\b|\btd-\d+\b/g, " ")
    .replace(/\[(?:transcribed|System)\]/g, " ");
}

function oneLine(text: string, maxChars: number): string {
  return truncate(text.replace(/\s+/g, " ").trim(), maxChars);
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 3).trimEnd() + "...";
}

/** Leading activity lines (in order) whose joined length fits the budget. */
function withinBudget(lines: ReadonlyArray<string>, budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept;
}
