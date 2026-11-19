import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _setTranscriptionRecordingRootForTest } from "./transcription-recordings.js";
import {
  _resetMisheardPhrasesForTest,
  learnMisheardPhrases,
  phraseCorrections,
  rankMisheardPhrases,
} from "./transcription-misheard-phrases.js";

const DAY = 24 * 3600_000;

describe("phraseCorrections", () => {
  it("finds lowercase two-word phrases the cleanup put in place of other words, in the singular", () => {
    // The real case: the speaker says "tool-call time" and speech-to-text writes "two-core time" or "two cores".
    expect(
      phraseCorrections(
        "the total two-core time and how long the two cores take",
        "the total tool-call time and how long the tool calls take",
      ),
    ).toEqual([
      { phrase: "tool call", heard: "two-core" },
      { phrase: "tool call", heard: "two cores" },
    ]);
  });

  it("ignores edits that are not mishearings", () => {
    // Grammar and style rewrites, hyphens and plurals of the same words, names and other capitalized words,
    // phrases of everyday words, and new forms of the words that were heard.
    const cases: Array<[string, string]> = [
      ["this is less easy to read", "this is easier to read"],
      ["the pass rate went up", "the pass-rate went up"],
      ["each tool call", "each tool calls"],
      ["ask lin xiao about it", "ask Lingxiao about it"],
      ["the cloud code run", "the Claude Code run"],
      ["see you next week then", "see you next month then"],
      ["the tool calling loop", "the tool-call loop"],
      ["we were told by them", "with the vendor team"],
    ];
    for (const [raw, final] of cases) expect(phraseCorrections(raw, final)).toEqual([]);
  });
});

describe("rankMisheardPhrases", () => {
  it("keeps phrases corrected in two or more dictations, most often corrected first, with heard forms seen in two or more", () => {
    const tool = (heard: string) => ({ phrase: "tool call", heard });
    const ranked = rankMisheardPhrases([
      [tool("two cores"), tool("two cores")],
      [tool("two-core"), { phrase: "vendor test", heard: "venter test" }],
      [tool("two cores"), { phrase: "vendor test", heard: "vendor tests" }],
      [tool("token"), tool("token"), tool("token")],
      [{ phrase: "hack judge", heard: "hag judge" }],
    ]);
    // Phrases and heard forms count once per dictation: one dictation's correction is not enough (hack judge),
    // and neither is a form repeated within one dictation ("token") or seen once ("two-core", "venter test").
    expect(ranked).toEqual([
      { phrase: "tool call", heardAs: ["two cores"] },
      { phrase: "vendor test", heardAs: [] },
    ]);
  });
});

describe("learnMisheardPhrases", () => {
  let root: string;
  const now = Date.UTC(2026, 10, 19, 12);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "misheard-phrases-"));
    _setTranscriptionRecordingRootForTest(root);
    _resetMisheardPhrasesForTest();
  });

  afterEach(async () => {
    _setTranscriptionRecordingRootForTest(null);
    await rm(root, { recursive: true, force: true });
  });

  /** A recording folder as the server writes it; the manifest last, as it marks a complete recording. */
  async function record(name: string, at: number, manifest: object, raw: string, final: string) {
    const directory = join(root, new Date(at).toISOString().slice(0, 10), name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "raw-transcript.txt"), raw);
    await writeFile(join(directory, "final-result.txt"), final);
    if (Object.keys(manifest).length)
      await writeFile(join(directory, "manifest.json"), JSON.stringify({ createdAt: at, ...manifest }));
    return directory;
  }

  const dictation = { status: "success", mode: "dictation", sessionId: "work-1" };
  const raw = "keep the two cores short";
  const fixed = "keep the tool calls short";

  it("learns from finished dictations of the space in the last 60 days", async () => {
    await record("a", now - DAY, dictation, raw, fixed);
    // Not counted: another space, an edit of a draft, a failed request, and a dictation 61 days old.
    await record("b", now - DAY, { ...dictation, sessionId: "home-1" }, raw, fixed);
    await record("c", now - DAY, { ...dictation, mode: "edit" }, raw, fixed);
    await record("d", now - DAY, { ...dictation, status: "error" }, raw, fixed);
    await record("e", now - 61 * DAY, dictation, raw, fixed);
    const inSpace = (sessionId: string) => sessionId.startsWith("work");
    expect(await learnMisheardPhrases({ now, inSpace })).toEqual([]);

    await record(
      "f",
      now - 2 * DAY,
      { ...dictation, sessionId: "work-2" },
      "the two cores time",
      "the tool calls time",
    );
    expect(await learnMisheardPhrases({ now, inSpace })).toEqual([{ phrase: "tool call", heardAs: ["two cores"] }]);
  });

  it("reads a recording still being written once it is complete", async () => {
    await record("a", now - DAY, dictation, raw, fixed);
    const pending = await record("b", now - DAY, {}, raw, fixed);
    expect(await learnMisheardPhrases({ now, inSpace: () => true })).toEqual([]);
    await writeFile(join(pending, "manifest.json"), JSON.stringify({ createdAt: now - DAY, ...dictation }));
    expect(await learnMisheardPhrases({ now, inSpace: () => true })).toEqual([
      { phrase: "tool call", heardAs: ["two cores"] },
    ]);
  });
});
