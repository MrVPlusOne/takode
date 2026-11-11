/**
 * Workspace context for voice transcription: what the user has been working on across their
 * session space, so names and project terms used elsewhere in the space are recognized even
 * when the current thread never mentions them.
 *
 * Built from data the server already holds (quests and the activity stream), with no model call.
 * The key terms help most; the quest titles and activity lines are kept small because the
 * cleanup model is billed by input token (speech-to-text is billed by audio minute).
 */
import type { ActivityThread } from "./activity-stream.js";
import { COMMON_SPOKEN_WORDS } from "./common-spoken-words.js";

/** Quests active or completed within this window are context. */
const QUEST_DAYS = 7;
const QUEST_LIMIT = 25;
/** Activity shown as text: the last day. Terms come from a longer window because they are short. */
export const ACTIVITY_HOURS = 24;
export const TERM_HOURS = 72;
const TERM_LIMIT = 100;
/**
 * The speech recognizer gets at most this many keywords (Settings vocabulary first). A long list dilutes
 * it: replaying 12 past misheard-term dictations, 48 keywords got the term right in 13 of 24 runs and
 * 108 in 8, and the colleague Qingyu came out "Chengyu's" or "Chainwise" with 108.
 */
const STT_KEYWORD_LIMIT = 48;
/** Shorter terms (MB, AI, T7) are mostly noise a recognizer already handles. */
const TERM_MIN_CHARS = 3;
/** Longer tokens are file names or fragments, not words anyone says. */
const TERM_MAX_CHARS = 32;

/** Rendered budgets. The speech-to-text prompt as a whole stays within its 10,000-character cap. */
const QUEST_TITLE_CHARS = 1000;
const STT_ACTIVITY_CHARS = 3000;
const STT_ACTIVITY_LINE_CHARS = 400;
const ENHANCER_ACTIVITY_CHARS = 5000;
const ENHANCER_ACTIVITY_LINE_CHARS = 1200;

export interface TranscriptionWorkspaceContext {
  /** Titles of recently active or completed quests in the session's space, most recent first. */
  questTitles: string[];
  /** The space's user messages and final answers from the last day, newest first, one line each, links kept. */
  activity: string[];
  /**
   * Distinctive words from the quests and activity (names, acronyms, words with digits or joiners), most
   * used first; per request, words of the current conversation are moved to the front.
   */
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
 * activity stream over the last TERM_HOURS. Terms already in the user's comma-separated
 * `customVocabulary` are left out, so the user's list is not repeated and the slots go to other terms.
 */
export function buildWorkspaceVocabulary(input: {
  quests: ReadonlyArray<WorkspaceQuest>;
  activity: ReadonlyArray<ActivityThread>;
  now: number;
  customVocabulary?: string;
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
    new Set((input.customVocabulary ?? "").split(",").map((term) => term.trim().toLowerCase())),
  );
  return { questTitles: recentQuests.map((quest) => quest.title), terms };
}

/**
 * The activity lines, newest first, from an activity stream over the last ACTIVITY_HOURS, with links as
 * written: their text carries names. Each prompt cuts the lines to its own length.
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
    .map((message) => `[${message.role === "user" ? "user" : "agent"}] ${message.text.replace(/\s+/g, " ").trim()}`);
}

/** Speech-to-text lines: quest titles and activity, each within its budget (empty when there is none). */
export function workspaceSttLines(context: TranscriptionWorkspaceContext | undefined) {
  return {
    questLine: questLine(context),
    activityLines: withinBudget(context?.activity ?? [], STT_ACTIVITY_CHARS, STT_ACTIVITY_LINE_CHARS),
  };
}

/** Enhancer blocks for the user message, in the XML-tag style of the other context blocks. */
export function workspaceEnhancerBlocks(context: TranscriptionWorkspaceContext | undefined): string[] {
  const blocks: string[] = [];
  const quests = questLine(context);
  if (quests) blocks.push(`<RECENT_QUESTS>\n${quests}\n</RECENT_QUESTS>`);
  const activity = withinBudget(context?.activity ?? [], ENHANCER_ACTIVITY_CHARS, ENHANCER_ACTIVITY_LINE_CHARS);
  if (activity.length) {
    blocks.push(
      `<RECENT_ACTIVITY>\nRecent messages elsewhere in this workspace, newest first:\n${activity.join("\n")}\n</RECENT_ACTIVITY>`,
    );
  }
  return blocks;
}

/**
 * Move the terms that appear in `focusText` (the conversation being dictated into, a comment's passage) to
 * the front, keeping the order within each group: the words of the current topic are the likeliest to be said.
 */
export function rankTermsFor(terms: ReadonlyArray<string>, focusText: string): string[] {
  const focus = focusText.toLowerCase();
  const inFocus = (term: string) => {
    const at = focus.indexOf(term.toLowerCase());
    return at >= 0 && !/[a-z0-9]/.test(focus[at - 1] ?? "") && !/[a-z0-9]/.test(focus[at + term.length] ?? "");
  };
  return [...terms.filter(inFocus), ...terms.filter((term) => !inFocus(term))];
}

/**
 * The speech recognizer's vocabulary as one comma-separated list: the user's Settings vocabulary, then the
 * leading workspace terms up to STT_KEYWORD_LIMIT entries in all (Settings entries are never dropped).
 */
export function sttVocabulary(customVocabulary: string | undefined, terms: ReadonlyArray<string>): string | undefined {
  const own = (customVocabulary ?? "").split(",").filter((term) => term.trim()).length;
  return (
    [customVocabulary, ...terms.slice(0, Math.max(0, STT_KEYWORD_LIMIT - own))].filter(Boolean).join(", ") || undefined
  );
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
 * the weighted counts rank the words, and a word must reach a weight of 2 to qualify. Words shorter
 * than TERM_MIN_CHARS, words in `known` (lowercase) and their repeats are left out.
 */
export function extractKeyTerms(
  texts: ReadonlyArray<{ text: string; weight: number }>,
  limit: number,
  known: ReadonlySet<string> = new Set(),
): string[] {
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
  // Short and known words still count as candidates, so their plurals and joins are repeats (GPUs, Takode-style).
  const candidates = new Set([...scores.keys(), ...known]);
  return [...scores]
    .filter(
      ([key, entry]) =>
        entry.score >= 2 && key.length >= TERM_MIN_CHARS && !known.has(key) && !redundant(key, candidates),
    )
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([, entry]) => [...entry.forms].sort((a, b) => b[1] - a[1])[0]![0]);
}

/** Adjective endings that turn a term into a phrase about it (MSI-style, LLM-based). */
const TERM_SUFFIXES =
  /^(.+)-(style|based|friendly|like|only|side|level|wide|specific|related|aware|heavy|free|compatible|powered|driven)$/;

/**
 * A term that adds nothing to other candidates: the plural of a candidate or of an excluded word
 * (GPUs, APIs), a candidate with an adjective ending (TTS-friendly), and candidates joined by
 * hyphens, with everyday words in between (T7-vs-T6).
 */
function redundant(key: string, candidates: ReadonlySet<string>): boolean {
  for (const singular of [key.replace(/es$/, ""), key.replace(/s$/, "")]) {
    if (singular !== key && (candidates.has(singular) || STOP_TERMS.has(singular))) return true;
  }
  const base = TERM_SUFFIXES.exec(key)?.[1];
  if (base !== undefined && candidates.has(base)) return true;
  const parts = key.split("-");
  return (
    parts.length > 1 && parts.every((part) => candidates.has(part) || COMMON_SPOKEN_WORDS.has(part) || part === "vs")
  );
}

function isKeyTerm(word: string, sentenceStart: boolean): boolean {
  if (word.length < 2 || word.length > TERM_MAX_CHARS || STOP_TERMS.has(word.toLowerCase())) return false;
  // Everyday spoken words (Yes, Why, Main) are known to any recognizer, however they are capitalized.
  if (COMMON_SPOKEN_WORDS.has(word.toLowerCase())) return false;
  // Plain numbers, durations (39m), counted words (3-hourly, 096-character from "8,096-character"),
  // file names, hashes and dates are not words anyone dictates.
  if (/^\d+(\.\d+)?$/.test(word) || /^\d+[smhd]$/.test(word) || /\.[A-Za-z]/.test(word)) return false;
  if (/^\d+-[a-z]+$/.test(word)) return false;
  if (/^[0-9a-f]{7,}$/i.test(word) && /\d/.test(word)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(word)) return false;
  // Hyphenated ordinary words (sign-in, read-only, One-time at a list start) are known to any recognizer.
  if (/^[A-Za-z][a-z]*(-[a-z]+)+$/.test(word)) return false;
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

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 3).trimEnd() + "...";
}

/** Leading activity lines (in order), each cut to `lineChars`, whose joined length fits the budget. */
function withinBudget(lines: ReadonlyArray<string>, budget: number, lineChars: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const fullLine of lines) {
    const line = truncate(fullLine, lineChars);
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept;
}
