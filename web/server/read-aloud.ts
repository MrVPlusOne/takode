import type { BrowserIncomingMessage } from "./session-types.js";
import { buildTranscriptionContext } from "./transcription-enhancer.js";
import { findStableStarTarget } from "./starred-messages.js";
import { MAIN_THREAD_KEY, buildProjectedThreadEntries } from "../shared/thread-window.js";
import { SpeechJob, concatBytes } from "./read-aloud-speech.js";

/** The voices OpenAI's speech endpoint offers. */
export const READ_ALOUD_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;
/** Voices the Realtime models accept; Nova, Onyx and Fable are speech-endpoint only. */
export const READ_ALOUD_REALTIME_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
] as const;

/** Speech models the debug panel can compare, with the voices each accepts. */
export const READ_ALOUD_SPEECH_MODELS: ReadonlyArray<{ model: string; voices: readonly string[] }> = [
  { model: "gpt-realtime-2.1-mini", voices: READ_ALOUD_REALTIME_VOICES },
  { model: "gpt-4o-mini-tts", voices: READ_ALOUD_VOICES },
];

/** The model's whole answer when the message already reads well aloud. */
const UNCHANGED_MARKER = "UNCHANGED";
/**
 * Speech requests take at most 4,096 characters, but a message's audio is ready only
 * when every piece is, and the time grows with piece size (gpt-realtime-2.1-mini,
 * October 2026: about 3.5 s for 350 characters, 4.7 s for 600, 7.4 s for 1,000,
 * 25 s for 4,000). Pieces of about 600 characters, synthesized in parallel, keep a
 * long message nearly as fast as a short one with fewer requests (Jiayi's choice).
 */
const TTS_CHUNK_TARGET_CHARS = 600;
const TTS_CHUNK_MAX_CHARS = 4096;
const OPENAI_TIMEOUT_MS = 60_000;
/** Rewrites kept so reading a message again, such as in another voice, skips the rewrite. */
const REWRITE_CACHE_LIMIT = 50;
const rewriteCache = new Map<string, string>();

const REWRITE_SYSTEM_PROMPT = `You prepare a message from Takode, an app where AI coding agents work in sessions, to be read aloud by a text-to-speech voice. The listener may not be looking at the screen, for example while driving, but can open the message later.

First decide whether the message needs rewriting to be easy to follow when heard.
- If it already reads naturally aloud (plain conversational prose with no Markdown, links, code, tables, file paths, IDs or symbols that sound wrong when spoken), output exactly ${UNCHANGED_MARKER} and nothing else.
- Otherwise rewrite it:
  - Keep every key point, decision, question and caveat, with the original meaning and tone. Stay close to the original wording. Do not summarize content away, add information, or answer questions the message asks.
  - Keep the agent's voice: first person, speaking to the listener as "you".
  - Remove Markdown and symbols. Turn lists and tables into short spoken sentences.
  - Leave out code, commands, raw URLs and link targets, commit hashes, file paths, line numbers and other opaque IDs. When one matters, say what it is in words instead, such as "the settings file".
  - Write abbreviations, units and symbols the way a person would say them.
  - Prefer short sentences, with a blank line between topics.
- Write in the language of the message.

Takode links. Agents write these as Markdown links with fixed kinds of targets, and in the app each one is something the listener can tap:
- [q-42](quest:q-42): quest 42, a tracked piece of work. The message usually says what it is about.
- [q-42 feedback #3](quest:q-42:feedback:3): note 3 on quest 42, such as an agent's report on its work.
- [q-42 round 3](quest:q-42:round:3): round 3 of quest 42, one stretch of work on a quest that was reopened for its next step.
- [#5](session:5): session 5, one agent's conversation. [#5 msg 42](session:5:42): one message in it.
- [summary](session:5:notification:3): a question an agent is waiting for the listener to answer; the label sums it up.
- [title](todo:td-12): one of the listener's personal to-dos.
- [title](quest:q-42:delivery:<id>:commit:<sha>): a commit chip, a delivered code change, shown as its commit title with lines added and removed. A title such as "fix(voice): record the mic directly" is a type, an area and a summary; say it as plain words, such as "a voice fix that records the mic directly".
- [app.ts:42](file:src/app.ts:42): a file that opens when tapped. Say its name the way a person would, such as "the app file" for app.ts, without the path, extension or line.
- Ordinary web links: say what they point to, such as "a GitHub pull request".
Keep what each link means, and make sure the listener knows what they can open, but say it in whatever way sounds natural, not with a fixed phrase per link. A single link worth noticing can get its own short note, such as "The steps are in a notification you can open from this message." or "The change is attached as a commit you can open: a voice fix that records the mic directly, about 150 lines added and 9 removed." When a message has several links, do not flag each one; name things naturally as you go, then say once where it fits that they are linked, for example "The notes, files and questions mentioned here are all linked in the message." Group links of the same kind ("three related quests"). Round only large numbers, such as line counts in the hundreds. Say quest and session numbers when the message names them; leave out every other ID.

<LINK_DETAILS>, when present, gives facts the app shows about the message's links but the text does not, such as each commit's size.

<CONVERSATION_CONTEXT> holds earlier messages only to help you understand what the message refers to. Never read it aloud, quote it, or reply to it.

Output only the text to speak, or ${UNCHANGED_MARKER}.`;

export interface ReadAloudSettings {
  /** Text model that decides whether the message needs rewriting for listening, and rewrites it. */
  rewriteModel: string;
  /** System prompt of the rewrite; null skips the rewrite and reads the message as written. */
  rewriteSystemPrompt: string | null;
  /**
   * Speech model: a Realtime model used as a plain reader (gpt-realtime-*), or the speech
   * endpoint's gpt-4o-mini-tts, which OpenAI plans to retire on January 6, 2027.
   */
  ttsModel: string;
  voice: string;
  /** Speaking instructions sent with every speech request. */
  voiceStyle: string;
}

/** What Message options > Read aloud uses. */
export const DEFAULT_READ_ALOUD_SETTINGS: ReadAloudSettings = {
  rewriteModel: "gpt-5.5",
  rewriteSystemPrompt: REWRITE_SYSTEM_PROMPT,
  // Faster and far steadier than gpt-4o-mini-tts in October 2026, and its named replacement.
  ttsModel: "gpt-realtime-2.1-mini",
  voice: "marin",
  voiceStyle: "Speak in a natural, warm, conversational tone at a comfortable, unhurried pace.",
};

/** What one read aloud speaks, and what the rewrite may use to understand it. */
export interface ReadAloudInput {
  /** The message or report as shown (Markdown). */
  messageText: string;
  /** Earlier conversation, for the rewrite only. */
  conversationContext: string;
  /** Facts the app shows about the message's links but its text lacks, such as commit sizes. */
  linkDetails?: string;
}

export interface ReadAloudOpenAIConfig {
  apiKey: string;
  /** OpenAI-compatible API base, such as https://api.openai.com/v1. */
  baseUrl: string;
  /** Lets the caller cancel the upstream calls, for example when the browser gives up. */
  signal?: AbortSignal;
}

/** Everything one read sent and got back, kept for the Read Aloud debug panel. */
export interface ReadAloudTrace {
  settings: ReadAloudSettings;
  /** The exact user message of the rewrite request; null when the rewrite was skipped. */
  rewriteUserPrompt: string | null;
  /** The rewrite model's answer as returned, including the UNCHANGED marker. */
  rewriteOutput: string | null;
  /** True when an identical earlier rewrite was reused instead of asking the model again. */
  rewriteCached: boolean;
  /** The text the voice read. Empty when the read failed before speech. */
  spokenText: string;
  speechParts: number;
  /** Time from the start until the rewrite was complete (0 when skipped or cached). */
  rewriteMs: number;
  /** Time after the rewrite until the audio was ready; speech starts while the rewrite is still streaming. */
  speechMs: number;
  /** Speech requests sent, including duplicates sent to dodge slow ones. Missing on older records. */
  speechRequests?: number;
  /** CPU time spent encoding the MP3, part of the time above. Missing on older records. */
  encodeMs?: number;
}

export interface ReadAloudRun {
  trace: ReadAloudTrace;
  /** MP3 audio of the whole message (48 kbps mono), or null when the read failed. */
  audio: Uint8Array<ArrayBuffer> | null;
  error: string | null;
}

/**
 * Turn an assistant message into speech: an optional rewrite for listening, using
 * earlier conversation as context, then text-to-speech that reads the result word
 * for word. Provider failures come back as `error` with the trace so far.
 */
export async function runReadAloud(
  input: ReadAloudInput,
  config: ReadAloudOpenAIConfig,
  settings: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS,
): Promise<ReadAloudRun> {
  const trace: ReadAloudTrace = {
    settings,
    rewriteUserPrompt: null,
    rewriteOutput: null,
    rewriteCached: false,
    spokenText: "",
    speechParts: 0,
    rewriteMs: 0,
    speechMs: 0,
  };
  const realtime = isRealtimeSpeechModel(settings.ttsModel);
  const speech = new SpeechJob(
    (text, signal) =>
      realtime
        ? synthesizeRealtimeSpeech(text, settings, { ...config, signal })
        : synthesizeSpeech(text, settings, { ...config, signal }),
    // The Realtime models rarely stream slowly, so they skip the up-front duplicate.
    { signal: config.signal, initialRequests: realtime ? 1 : 2 },
  );
  try {
    const startedAt = Date.now();
    trace.spokenText = await produceSpokenText(input, settings, config, trace, (piece) => speech.add(piece));
    trace.rewriteMs = trace.rewriteOutput === null || trace.rewriteCached ? 0 : Date.now() - startedAt;
    const speechStartedAt = Date.now();
    const audio = await speech.finish();
    trace.speechMs = Date.now() - speechStartedAt;
    trace.speechParts = speech.pieces;
    trace.speechRequests = speech.requests;
    trace.encodeMs = Math.round(speech.encodeMs);
    console.log(
      `[read-aloud] ${input.messageText.length} chars -> ${trace.spokenText.length} spoken, rewrite ${trace.rewriteMs}ms, then speech ${trace.speechMs}ms (${speech.pieces} parts, ${speech.requests} requests, encoding ${trace.encodeMs}ms)`,
    );
    return { trace, audio, error: null };
  } catch (error) {
    speech.cancel();
    return { trace, audio: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The text to speak, handed to `onPiece` in speech-sized pieces as soon as each is
 * known: while a fresh rewrite is still streaming, or all at once for a cached
 * rewrite or the message as written. Fills in the rewrite part of `trace`.
 */
async function produceSpokenText(
  input: ReadAloudInput,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
  trace: ReadAloudTrace,
  onPiece: (piece: string) => void,
): Promise<string> {
  const speakAll = (text: string) => {
    for (const piece of splitTextForSpeech(text)) onPiece(piece);
    return text;
  };
  if (settings.rewriteSystemPrompt === null) return speakAll(input.messageText);

  trace.rewriteUserPrompt = buildRewriteUserPrompt(input);
  const cacheKey = JSON.stringify([settings.rewriteModel, settings.rewriteSystemPrompt, trace.rewriteUserPrompt]);
  const cached = rewriteCache.get(cacheKey);
  if (cached !== undefined) {
    trace.rewriteCached = true;
    trace.rewriteOutput = cached;
    rememberRewrite(cacheKey, cached);
    return speakAll(cached === UNCHANGED_MARKER ? input.messageText : cached);
  }

  // The marker is far shorter than a piece, so no piece is sent before the answer turns out to be it.
  const pieces = new SpeechPieceStream(onPiece);
  const output = await streamRewrite(trace.rewriteUserPrompt, settings, config, (delta) => pieces.push(delta));
  trace.rewriteOutput = output;
  rememberRewrite(cacheKey, output);
  if (output === UNCHANGED_MARKER) return speakAll(input.messageText);
  pieces.end();
  return output;
}

/** True when the rewrite model judged the message fine to read as written. */
export function readAloudKeptOriginal(trace: ReadAloudTrace): boolean {
  return trace.rewriteOutput === null || trace.rewriteOutput === UNCHANGED_MARKER;
}

/**
 * The conversation leading up to a message or published report, as context for its
 * rewrite. For leader thread messages only that thread counts. Falls back to the
 * latest conversation when the message is not in the history.
 */
export function buildReadAloudContext(
  history: ReadonlyArray<BrowserIncomingMessage>,
  messageId: string,
  historyIndex?: number,
): string {
  const target = locateMessage(history, messageId, historyIndex);
  if (!target) return buildTranscriptionContext([...history]);
  const earlier = history.slice(0, target.historyIndex);
  const threadHistory = buildProjectedThreadEntries(earlier, target.threadKey).map((entry) => entry.message);
  return buildTranscriptionContext(threadHistory);
}

function locateMessage(
  history: ReadonlyArray<BrowserIncomingMessage>,
  messageId: string,
  historyIndex?: number,
): { historyIndex: number; threadKey: string } | null {
  const target = findStableStarTarget(history, messageId, historyIndex);
  if (target) return { historyIndex: target.historyIndex, threadKey: target.sourceThreadKey };
  // Published reports are not message-menu targets, so the star locator skips them.
  const reportIndex = history.findIndex((entry) => entry.type === "markdown_report" && entry.id === messageId);
  if (reportIndex < 0) return null;
  const report = history[reportIndex] as Extract<BrowserIncomingMessage, { type: "markdown_report" }>;
  return { historyIndex: reportIndex, threadKey: report.threadKey || MAIN_THREAD_KEY };
}

/**
 * Split text into speech pieces of at most `size` characters (never above the
 * 4,096-character request limit). Each piece is cut at the best break before the
 * limit: a blank line, else a line break, else a sentence end (English or Chinese),
 * else a space, else a plain cut. A break is only used if it keeps the piece at least
 * half full; failing all that, the best break anywhere wins.
 */
export function splitTextForSpeech(text: string, size = TTS_CHUNK_TARGET_CHARS): string[] {
  const pieces: string[] = [];
  let rest = normalizeSpeechText(text);
  while (rest.length > Math.min(size, TTS_CHUNK_MAX_CHARS)) {
    const cut = findSpeechCut(rest, size);
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/** Speech breaks, best first: blank line, line break, sentence end, space. */
const SPEECH_BREAKS = [/\n\n/g, /\n/g, /[.!?](?=\s)|[。！？]/g, / /g];

/** Where to end the first piece of `text`, which is longer than `size`. */
function findSpeechCut(text: string, size: number): number {
  const limit = Math.min(size, TTS_CHUNK_MAX_CHARS);
  const window = text.slice(0, limit + 1);
  for (const minimum of [limit / 2, 1]) {
    for (const pattern of SPEECH_BREAKS) {
      let best = 0;
      for (const match of window.matchAll(pattern)) {
        const end = match.index + match[0].length;
        if (end <= limit && end >= minimum) best = end;
      }
      if (best > 0) return best;
    }
  }
  return limit;
}

/** Trims lines, drops empty runs, and keeps single and blank-line breaks. */
function normalizeSpeechText(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

function rememberRewrite(key: string, output: string): void {
  rewriteCache.delete(key);
  rewriteCache.set(key, output);
  if (rewriteCache.size > REWRITE_CACHE_LIMIT) rewriteCache.delete(rewriteCache.keys().next().value!);
}

function buildRewriteUserPrompt(input: ReadAloudInput): string {
  return [
    input.conversationContext ? `<CONVERSATION_CONTEXT>\n${input.conversationContext}\n</CONVERSATION_CONTEXT>` : "",
    input.linkDetails ? `<LINK_DETAILS>\n${input.linkDetails}\n</LINK_DETAILS>` : "",
    `<MESSAGE>\n${input.messageText}\n</MESSAGE>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Streams the rewrite, passing each text delta to `onDelta`, and returns the whole
 * answer: the text to speak, or the UNCHANGED marker.
 */
async function streamRewrite(
  userPrompt: string,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
  onDelta: (delta: string) => void,
): Promise<string> {
  const res = await openAIRequest("/chat/completions", config, {
    model: settings.rewriteModel,
    messages: [
      { role: "system", content: settings.rewriteSystemPrompt },
      { role: "user", content: userPrompt },
    ],
    reasoning_effort: "none",
    stream: true,
  });
  let text = "";
  let finishReason: string | null = null;
  for await (const event of readServerSentEvents(res)) {
    if (event === "[DONE]") break;
    const chunk = JSON.parse(event) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
    };
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  if (!text.trim()) throw new Error("The rewrite model returned no text");
  if (finishReason !== "stop") throw new Error("The rewrite model stopped before finishing");
  return text.trim();
}

/** The `data:` payloads of a server-sent event stream. */
async function* readServerSentEvents(res: Response): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
      newline = buffer.indexOf("\n");
    }
  }
}

/**
 * Cuts streamed text into speech pieces as it arrives: once more than a piece has
 * arrived, the first piece is cut by the same rule splitTextForSpeech uses.
 */
class SpeechPieceStream {
  private pending = "";

  constructor(
    private readonly onPiece: (piece: string) => void,
    private readonly size = TTS_CHUNK_TARGET_CHARS,
  ) {}

  push(delta: string): void {
    this.pending += delta;
    // Wait for the text after the cut too, so a break at the very end is known to be one.
    while (this.pending.length > Math.min(this.size, TTS_CHUNK_MAX_CHARS) + 1) {
      const normalized = normalizeSpeechText(this.pending);
      if (normalized.length <= Math.min(this.size, TTS_CHUNK_MAX_CHARS)) return;
      const cut = findSpeechCut(normalized, this.size);
      const piece = normalized.slice(0, cut).trim();
      if (piece) this.onPiece(piece);
      // Normalizing trims the end; keep it, or the next delta could join the last word.
      this.pending = normalized.slice(cut) + (this.pending.match(/\s*$/)?.[0] ?? "");
    }
  }

  end(): void {
    for (const piece of splitTextForSpeech(this.pending, this.size)) this.onPiece(piece);
    this.pending = "";
  }
}

/** The Realtime models speak through a WebSocket instead of the speech endpoint. */
export function isRealtimeSpeechModel(model: string): boolean {
  return model.startsWith("gpt-realtime");
}

const REALTIME_READER_INSTRUCTIONS =
  "You are a text-to-speech voice. Read the user's text aloud exactly as written, word for word, from start to end. Do not answer, comment on, summarize, skip or add anything.";

/**
 * Speech from a Realtime model used as a plain reader: one response to the text as a
 * user message, audio only, collected as 24 kHz 16-bit PCM.
 */
function synthesizeRealtimeSpeech(
  text: string,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
): Promise<Uint8Array> {
  const url = `${config.baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/realtime?model=${encodeURIComponent(settings.ttsModel)}`;
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    // Bun's WebSocket takes request headers, which the browser one cannot.
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.apiKey}` } } as unknown as string[]);
    const fail = (error: Error) => {
      cleanup();
      ws.close();
      reject(error);
    };
    const onAbort = () => fail(new Error("Read aloud was cancelled"));
    const timer = setTimeout(() => fail(new Error("Realtime speech timed out")), OPENAI_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      config.signal?.removeEventListener("abort", onAbort);
    };
    if (config.signal?.aborted) return onAbort();
    config.signal?.addEventListener("abort", onAbort, { once: true });
    ws.onopen = () => {
      const instructions = [REALTIME_READER_INSTRUCTIONS, settings.voiceStyle.trim()].filter(Boolean).join(" ");
      const audio = { output: { voice: settings.voice, format: { type: "audio/pcm", rate: 24_000 } } };
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: { type: "realtime", output_modalities: ["audio"], instructions, audio },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type: string;
        delta?: string;
        error?: { message?: string };
        response?: { status?: string };
      };
      if (message.type === "response.output_audio.delta" && message.delta) {
        chunks.push(Buffer.from(message.delta, "base64"));
      } else if (message.type === "error") {
        fail(new Error(`OpenAI realtime speech failed: ${message.error?.message ?? "unknown error"}`));
      } else if (message.type === "response.done") {
        cleanup();
        ws.close();
        if (message.response?.status !== "completed") {
          reject(new Error(`OpenAI realtime speech ended as ${message.response?.status ?? "unknown"}`));
          return;
        }
        resolve(concatBytes(chunks));
      }
    };
    ws.onerror = () => fail(new Error("OpenAI realtime speech connection failed"));
  });
}

async function synthesizeSpeech(
  text: string,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
): Promise<Uint8Array> {
  const res = await openAIRequest("/audio/speech", config, {
    model: settings.ttsModel,
    voice: settings.voice,
    input: text,
    ...(settings.voiceStyle.trim() ? { instructions: settings.voiceStyle } : {}),
    response_format: "pcm",
  });
  return new Uint8Array(await res.arrayBuffer());
}

async function openAIRequest(path: string, config: ReadAloudOpenAIConfig, body: object): Promise<Response> {
  const timeout = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal: config.signal ? AbortSignal.any([config.signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${path} failed with ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  return res;
}
