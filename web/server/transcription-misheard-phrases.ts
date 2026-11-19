/**
 * Phrases speech recognition keeps getting wrong for this speaker, learned from their saved dictations.
 *
 * The workspace terms (transcription-workspace-context.ts) cover names and other words that look like terms
 * in writing. Jargon made of two ordinary lowercase words never looks like a term, yet a speaker's accent can
 * turn it into a likelier phrase every time: "tool-call time" came out "two-core time" for weeks. The cleanup
 * pass fixes such a phrase only sometimes, but each time it does, the recording keeps both versions. A phrase
 * the cleanup put in place of other words in two or more of the space's recent dictations is a known
 * mishearing: speech-to-text gets it as a keyword, and the cleanup is told what it was heard as.
 */
import { diffArrays } from "diff";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMON_SPOKEN_WORDS } from "./common-spoken-words.js";
import { getTranscriptionRecordingRoot } from "./transcription-recordings.js";

/** Dictations of the last 60 days count: long enough that a phrase fixed at speech-to-text stays learned. */
export const MISHEARD_DAYS = 60;
/** A phrase must have been corrected in this many dictations, so a one-off rewrite is not learned. */
const MIN_DICTATIONS = 2;
const PHRASE_LIMIT = 10;
/** Heard forms shown to the cleanup model per phrase. */
const HEARD_LIMIT = 3;

/** A phrase recognized wrongly before, with what speech-to-text wrote instead, most frequent first. */
export interface MisheardPhrase {
  phrase: string;
  heardAs: string[];
}

/** One place where the cleanup pass replaced the transcript's words (`heard`) with a phrase. */
export interface PhraseCorrection {
  phrase: string;
  heard: string;
}

/**
 * The phrases a saved dictation's cleanup put in place of other words: two lowercase words written apart or
 * hyphenated (tool calls, tool-call), at least one of them outside everyday speech, in place of one to four
 * other words. Rewrites of the same words (a plural, a hyphen, "notify" for "notifying") are not mishearings.
 * The phrase comes back in the singular (tool call), which speech-to-text recognizes best as a keyword.
 */
export function phraseCorrections(rawTranscript: string, finalText: string): PhraseCorrection[] {
  const raw = words(rawTranscript);
  const final = words(finalText);
  const corrections: PhraseCorrection[] = [];
  // Compared in lowercase; the final text's own spelling decides whether a phrase is lowercase jargon.
  let finalAt = 0;
  let removed: string[] = [];
  for (const change of diffArrays(
    raw.map((word) => word.toLowerCase()),
    final.map((word) => word.toLowerCase()),
  )) {
    if (change.removed) {
      removed = change.value;
      continue;
    }
    const written = final.slice(finalAt, finalAt + change.value.length);
    finalAt += change.value.length;
    if (change.added && removed.length > 0 && removed.length <= 4) {
      const correction = asCorrection(removed, written);
      if (correction) corrections.push(correction);
    }
    removed = [];
  }
  return corrections;
}

/**
 * Phrases corrected in at least MIN_DICTATIONS of the given dictations, most often corrected first, each
 * with its heard forms that also recur in that many dictations, most frequent first.
 */
export function rankMisheardPhrases(dictations: ReadonlyArray<ReadonlyArray<PhraseCorrection>>): MisheardPhrase[] {
  const byPhrase = new Map<string, { dictations: number; heard: Map<string, number> }>();
  for (const corrections of dictations) {
    // Phrases and heard forms count once per dictation: one dictation repeating a form ("token" three times) is one case.
    const seen = new Set<string>();
    for (const { phrase, heard } of corrections) {
      const entry = byPhrase.get(phrase) ?? { dictations: 0, heard: new Map<string, number>() };
      if (!seen.has(phrase)) entry.dictations += 1;
      if (!seen.has(`${phrase}\n${heard}`)) entry.heard.set(heard, (entry.heard.get(heard) ?? 0) + 1);
      seen.add(phrase).add(`${phrase}\n${heard}`);
      byPhrase.set(phrase, entry);
    }
  }
  return [...byPhrase]
    .filter(([, entry]) => entry.dictations >= MIN_DICTATIONS)
    .sort((a, b) => b[1].dictations - a[1].dictations)
    .slice(0, PHRASE_LIMIT)
    .map(([phrase, entry]) => ({
      phrase,
      heardAs: [...entry.heard]
        .filter(([, count]) => count >= MIN_DICTATIONS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, HEARD_LIMIT)
        .map(([heard]) => heard),
    }));
}

/**
 * The misheard phrases of the dictations recorded in the last MISHEARD_DAYS by sessions `inSpace` accepts.
 * Each recording is read once and remembered; later calls only list the day folders and read new recordings.
 */
export async function learnMisheardPhrases(input: {
  now: number;
  inSpace: (sessionId: string) => boolean;
}): Promise<MisheardPhrase[]> {
  const since = input.now - MISHEARD_DAYS * 24 * 3600_000;
  const dictations = await readDictationCorrections(since);
  return rankMisheardPhrases(
    dictations
      .filter(
        (dictation) =>
          dictation.createdAt >= since && dictation.createdAt <= input.now && input.inSpace(dictation.sessionId),
      )
      .map((dictation) => dictation.corrections),
  );
}

interface DictationCorrections {
  sessionId: string;
  createdAt: number;
  corrections: PhraseCorrection[];
}

/** Recording folder path -> its corrections, or null for a recording that is not a finished dictation. */
const correctionsByRecording = new Map<string, DictationCorrections | null>();

/** Recordings live in `<root>/<UTC day>/<recording>/`; the manifest is written last, once a recording is complete. */
async function readDictationCorrections(since: number): Promise<DictationCorrections[]> {
  const root = getTranscriptionRecordingRoot();
  const firstDay = new Date(since).toISOString().slice(0, 10);
  const days = (await readdir(root).catch(() => [] as string[])).filter(
    (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= firstDay,
  );
  // Oldest first, so ties in ranking go the same way every time.
  days.sort();
  const found: DictationCorrections[] = [];
  for (const day of days) {
    const recordings = (await readdir(join(root, day)).catch(() => [] as string[])).sort();
    const read = await Promise.all(recordings.map((recording) => readRecording(join(root, day, recording))));
    for (const dictation of read) if (dictation) found.push(dictation);
  }
  return found;
}

async function readRecording(directory: string): Promise<DictationCorrections | null> {
  const known = correctionsByRecording.get(directory);
  if (known !== undefined) return known;
  let manifest: { status?: unknown; mode?: unknown; sessionId?: unknown; createdAt?: unknown };
  try {
    manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf-8"));
  } catch {
    // Not written yet (still recording) or unreadable: look again next time.
    return null;
  }
  let dictation: DictationCorrections | null = null;
  // Edits and appends put the speech into a draft, so their final text is not a cleaned-up transcript.
  if (
    manifest.status === "success" &&
    manifest.mode === "dictation" &&
    typeof manifest.sessionId === "string" &&
    typeof manifest.createdAt === "number"
  ) {
    const [raw, final] = await Promise.all(
      ["raw-transcript.txt", "final-result.txt"].map((file) =>
        readFile(join(directory, file), "utf-8").catch(() => ""),
      ),
    );
    dictation = {
      sessionId: manifest.sessionId,
      createdAt: manifest.createdAt,
      corrections: raw && final ? phraseCorrections(raw, final) : [],
    };
  }
  correctionsByRecording.set(directory, dictation);
  return dictation;
}

export function _resetMisheardPhrasesForTest(): void {
  correctionsByRecording.clear();
}

/** Words that make a pair a piece of a sentence ("the tool", "with calls") rather than a term. */
const FUNCTION_WORDS = new Set(
  "the and for with that this these those from into onto than then are was were been being have has had not nor but you your our their they them its can could would should will just also only more most less very much many some any each every all both one two three four five other another same such there here what which who whom when where why how about over under after before between out off again still even really maybe per via like".split(
    " ",
  ),
);

function words(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*[A-Za-z0-9]|[A-Za-z0-9]/g) ?? [];
}

function asCorrection(heardWords: string[], written: string[]): PhraseCorrection | undefined {
  const parts = written.flatMap((word) => word.split("-"));
  if (written.length > 2 || parts.length !== 2 || !parts.every((part) => /^[a-z]{3,}$/.test(part))) return undefined;
  if (parts.some((part) => FUNCTION_WORDS.has(part)) || parts.every(isCommon)) return undefined;
  const heard = heardWords.join(" ");
  const squash = (text: string) => text.replace(/[\s-]/g, "").replace(/s$/, "");
  if (squash(heard) === squash(parts.join(""))) return undefined;
  if (heardWords.some((word) => parts.some((part) => sameStem(word, part)))) return undefined;
  return { phrase: `${parts[0]} ${singular(parts[1]!)}`, heard };
}

function isCommon(word: string): boolean {
  return [word, word.replace(/s$/, ""), word.replace(/es$/, "")].some((form) => COMMON_SPOKEN_WORDS.has(form));
}

/** Two forms of one word (notify/notifying, easy/easier): a shared start of 3+ letters and most of the shorter. */
function sameStem(a: string, b: string): boolean {
  let shared = 0;
  while (shared < Math.min(a.length, b.length) && a[shared] === b[shared]) shared++;
  return shared >= 3 && shared >= 0.6 * Math.min(a.length, b.length);
}

function singular(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
